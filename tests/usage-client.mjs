import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ApiAccountUsageClient,
  ApiUsageClient,
  LocalCodexTokenTracker,
  accountLogIdentity,
  loadApiProviderConfig,
  mergeRateLimitSnapshot,
  mergeOfficialLocalUsage,
  normalizeApiUsageView,
  normalizeApiAccountView,
  normalizeCctqUsageView,
  normalizeUsageView,
  conversationTokenDelta,
  officialModelProvidersFromAccount,
  parseAppServerLine,
  parseLocalTokenContextEvent,
  parseLocalTokenUsageEvent,
  toOfficialUsageSource,
  validateApiProviderConfig,
} from "../scripts/usage-client.mjs";

assert.deepEqual(parseAppServerLine('{"id":1,"result":{}}'), { id: 1, result: {} });
assert.equal(parseAppServerLine("  "), null);
assert.throws(() => parseAppServerLine("[]"), /JSON object/);
assert.throws(() => parseAppServerLine("not-json"), SyntaxError);

for (const accountType of ["chatgpt", "chatgptAuthTokens", "personalAccessToken"]) {
  assert.deepEqual(officialModelProvidersFromAccount(
    { account: { type: accountType }, requiresOpenaiAuth: true },
    { config: { model_provider: "custom", model_providers: { custom: { requires_openai_auth: true } } } },
  ), ["custom", "openai"]);
}
assert.deepEqual(officialModelProvidersFromAccount(
  { account: { type: "chatgpt" }, requiresOpenaiAuth: false },
  { config: { model_provider: "custom", model_providers: { custom: { requires_openai_auth: false } } } },
), ["openai"]);
assert.deepEqual(officialModelProvidersFromAccount(
  { account: { type: "apiKey" }, requiresOpenaiAuth: true },
  { config: { model_providers: { custom: { requires_openai_auth: true } } } },
), []);

const rateLimits = {
  rateLimits: {
    limitId: "codex",
    primary: { usedPercent: 32, windowDurationMins: 300, resetsAt: 1784700000 },
    secondary: { usedPercent: 58, windowDurationMins: 10080, resetsAt: 1785200000 },
  },
  rateLimitsByLimitId: {
    codex: {
      limitId: "codex",
      primary: { usedPercent: 32, windowDurationMins: 300, resetsAt: 1784700000 },
      secondary: { usedPercent: 58, windowDurationMins: 10080, resetsAt: 1785200000 },
    },
  },
};
const tokenUsage = {
  summary: { lifetimeTokens: 1250000 },
  dailyUsageBuckets: [
    { startDate: "2026-07-21", tokens: 9000 },
    { startDate: "2026-07-22", tokens: 18400 },
  ],
};
const now = new Date(2026, 6, 22, 12, 0, 0);
const view = normalizeUsageView(rateLimits, tokenUsage, now);
assert.equal(view.status, "ready");
assert.deepEqual(view.windows, [
  { label: "5H", remainingPercent: 68, windowDurationMins: 300, resetsAt: 1784700000, limitId: "codex" },
  { label: "周", remainingPercent: 42, windowDurationMins: 10080, resetsAt: 1785200000, limitId: "codex" },
]);
assert.equal(view.todayTokens, 18400);
assert.equal(view.lifetimeTokens, 1250000);
const official = toOfficialUsageSource(view, now.getTime(), 45000);
assert.deepEqual(official.metrics.filter((item) => item.defaultVisible).map((item) => item.id), ["primaryRemaining", "todayTokens"]);
assert.ok(!official.metrics.some((item) => item.id.startsWith("secondary")));
assert.equal(official.metrics.find((item) => item.id === "todayTokens").value, "2万");
assert.equal(official.metrics.find((item) => item.id === "lifetimeTokens").value, "125万");
assert.equal(official.nextRefreshAt - official.fetchedAt, 45000);
const largeOfficial = toOfficialUsageSource({ ...view, todayTokens: 123456789, lifetimeTokens: 100000000 }, now.getTime());
assert.equal(largeOfficial.metrics.find((item) => item.id === "todayTokens").value, "1.23亿");
assert.equal(largeOfficial.metrics.find((item) => item.id === "lifetimeTokens").value, "1.00亿");

const missingToday = normalizeUsageView(rateLimits, {
  summary: { lifetimeTokens: 1250000 },
  dailyUsageBuckets: [{ startDate: "2026-07-15", tokens: 169875 }],
}, now);
assert.equal(missingToday.todayTokens, null);
assert.equal(missingToday.tokenUsageAvailable, true);
assert.equal(missingToday.latestUsageDate, "2026-07-15");
assert.match(missingToday.error, /最新数据截至 2026-07-15/);
assert.equal(toOfficialUsageSource(missingToday, now.getTime()).metrics.find((item) => item.id === "todayTokens").value, "--");
const explicitZeroToday = normalizeUsageView(rateLimits, {
  summary: { lifetimeTokens: 1250000 },
  dailyUsageBuckets: [{ startDate: "2026-07-22", tokens: 0 }],
}, now);
assert.equal(explicitZeroToday.todayTokens, 0);
assert.equal(toOfficialUsageSource(explicitZeroToday, now.getTime()).metrics.find((item) => item.id === "todayTokens").value, "0");

const tokenEventLine = JSON.stringify({
  timestamp: "2026-07-22T04:00:00.000Z",
  type: "event_msg",
  payload: {
    type: "token_count",
    info: {
      total_token_usage: {
        total_tokens: 150,
        input_tokens: 120,
        cached_input_tokens: 80,
        output_tokens: 30,
      },
      last_token_usage: { total_tokens: 50 },
    },
  },
});
assert.equal(parseLocalTokenUsageEvent(tokenEventLine, "2026-07-22")?.tokens, 50);
assert.equal(parseLocalTokenUsageEvent(tokenEventLine, "2026-07-22")?.totalTokens, 150);
assert.equal(parseLocalTokenUsageEvent(tokenEventLine, "2026-07-21"), null);
assert.equal(parseLocalTokenUsageEvent('{"payload":{"type":"user_message","text":"token_count"}}'), null);
assert.deepEqual(parseLocalTokenContextEvent(JSON.stringify({
  timestamp: "2026-07-22T04:00:00.000Z",
  type: "turn_context",
  payload: { turn_id: "019f8e6a-f751-7963-8474-551fcc730496" },
})), {
  kind: "turn",
  timestamp: Date.parse("2026-07-22T04:00:00.000Z"),
  turnId: "019f8e6a-f751-7963-8474-551fcc730496",
});
assert.deepEqual(parseLocalTokenContextEvent(JSON.stringify({
  timestamp: "2026-07-22T04:00:01.000Z",
  type: "event_msg",
  payload: {
    type: "thread_settings_applied",
    thread_settings: { model_provider_id: "OpenAI" },
  },
})), {
  kind: "settings",
  timestamp: Date.parse("2026-07-22T04:00:01.000Z"),
  modelProvider: "openai",
});
assert.deepEqual(parseLocalTokenContextEvent(JSON.stringify({
  timestamp: "2026-07-22T04:00:02.000Z",
  type: "session_meta",
  payload: {
    id: "019f8e6a-f751-7963-8474-551fcc730496",
    parent_thread_id: "019f8e6a-f751-7963-8474-551fcc730400",
    model_provider: "ChatGPT",
  },
})), {
  kind: "session",
  timestamp: Date.parse("2026-07-22T04:00:02.000Z"),
  sessionId: "019f8e6a-f751-7963-8474-551fcc730496",
  parentThreadId: "019f8e6a-f751-7963-8474-551fcc730400",
  modelProvider: "chatgpt",
  forked: true,
});

assert.equal(conversationTokenDelta(150, 100), 50);
assert.equal(conversationTokenDelta(150, null), 150);
assert.equal(conversationTokenDelta(0, null), 0);
assert.equal(conversationTokenDelta(0, 0), 0);
assert.equal(conversationTokenDelta(20, 50), 0);
assert.equal(conversationTokenDelta(-1, 0), null);

function localDateString(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function uuidAt(timestamp, suffix = 1) {
  const prefix = Math.trunc(timestamp).toString(16).padStart(12, "0").slice(-12);
  const tail = `${Math.trunc(suffix).toString(16).padStart(20, "0")}`.slice(-20);
  const compact = `${prefix}${tail}`;
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

function sessionMeta(timestamp, id, provider, extra = {}) {
  return JSON.stringify({
    timestamp: new Date(timestamp).toISOString(),
    type: "session_meta",
    payload: { id, model_provider: provider, ...extra },
  });
}

function turnContext(timestamp, turnId) {
  return JSON.stringify({
    timestamp: new Date(timestamp).toISOString(),
    type: "turn_context",
    payload: { turn_id: turnId },
  });
}

function providerSettings(timestamp, provider) {
  return JSON.stringify({
    timestamp: new Date(timestamp).toISOString(),
    type: "event_msg",
    payload: {
      type: "thread_settings_applied",
      thread_settings: { model_provider_id: provider },
    },
  });
}

function tokenCount(timestamp, totalTokens, lastTokens = totalTokens) {
  return JSON.stringify({
    timestamp: new Date(timestamp).toISOString(),
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        total_token_usage: { total_tokens: totalTokens },
        last_token_usage: { total_tokens: lastTokens },
      },
    },
  });
}

const providerTrackerRoot = mkdtempSync(path.join(os.tmpdir(), "codex-usage-provider-token-test-"));
try {
  const sessionRoot = path.join(providerTrackerRoot, "sessions");
  const counterPath = path.join(providerTrackerRoot, "official-token-counter.json");
  mkdirSync(sessionRoot, { recursive: true });
  const trackerNow = Date.now();
  const trackerDateKey = localDateString(trackerNow);
  const threadId = uuidAt(trackerNow - 60_000, 1);
  const sessionPath = path.join(sessionRoot, `rollout-provider-${threadId}.jsonl`);
  const at = (seconds) => trackerNow - 50_000 + seconds * 1000;
  const zeroEvent = tokenCount(at(2), 0, 0);
  writeFileSync(sessionPath, [
    sessionMeta(at(0), threadId, "custom"),
    turnContext(at(1), uuidAt(at(1), 11)),
    providerSettings(at(1), "openai"),
    zeroEvent,
    zeroEvent,
    turnContext(at(3), uuidAt(at(3), 12)),
    providerSettings(at(3), "custom"),
    tokenCount(at(4), 10, 10),
    turnContext(at(5), uuidAt(at(5), 13)),
    providerSettings(at(5), "openai"),
    tokenCount(at(6), 30, 20),
    turnContext(at(7), uuidAt(at(7), 14)),
    providerSettings(at(7), "custom"),
    tokenCount(at(8), 50, 20),
    turnContext(at(9), uuidAt(at(9), 15)),
    providerSettings(at(9), "openai"),
    tokenCount(at(10), 70, 20),
    turnContext(at(11), uuidAt(at(11), 16)),
    tokenCount(at(12), 20, 20),
    turnContext(at(13), uuidAt(at(13), 17)),
    tokenCount(at(14), 27, 7),
    "",
  ].join("\n"), "utf8");
  writeFileSync(counterPath, `${JSON.stringify({
    schemaVersion: 5,
    dailyDate: trackerDateKey,
    todayTokens: 999999,
    seenEvents: ["legacy:event"],
  })}\n`, "utf8");

  const tracker = new LocalCodexTokenTracker({
    sessionRoot,
    counterPath,
    now: () => trackerNow,
  });
  tracker.setCurrentThreadId(threadId);
  assert.equal((await tracker.refresh()).todayTokens, 0);
  tracker.setOfficialModelProviders(["openai"]);
  const firstView = await tracker.refresh();
  assert.equal(firstView.todayTokens, 47);
  assert.equal(firstView.currentTaskTokens, 27);
  assert.equal(firstView.lastTurnTokens, 7);
  const persisted = JSON.parse(readFileSync(counterPath, "utf8"));
  assert.equal(persisted.schemaVersion, 6);
  assert.equal(persisted.mode, "official-conversation-raw");
  assert.equal(persisted.todayTokens, 47);
  assert.ok(!persisted.seenEvents.includes("legacy:event"));
  assert.equal(persisted.seenEvents.filter((identity) => identity.endsWith(":total:0")).length, 1);

  const restartedTracker = new LocalCodexTokenTracker({
    sessionRoot,
    counterPath,
    officialModelProviders: ["openai"],
    now: () => trackerNow + 1,
  });
  restartedTracker.setCurrentThreadId(threadId);
  const restartedView = await restartedTracker.refresh();
  assert.equal(restartedView.todayTokens, 47);
  assert.equal(JSON.parse(readFileSync(counterPath, "utf8")).todayTokens, 47);
} finally {
  rmSync(providerTrackerRoot, { recursive: true, force: true });
}

const forkTrackerRoot = mkdtempSync(path.join(os.tmpdir(), "codex-usage-fork-token-test-"));
try {
  const sessionRoot = path.join(forkTrackerRoot, "sessions");
  const counterPath = path.join(forkTrackerRoot, "official-token-counter.json");
  mkdirSync(sessionRoot, { recursive: true });
  const trackerNow = Date.now();
  const parentId = uuidAt(trackerNow - 90_000, 21);
  const childCreatedAt = trackerNow - 40_000;
  const childId = uuidAt(childCreatedAt, 22);
  const replayedTurnId = uuidAt(childCreatedAt - 10_000, 23);
  const childTurnId = uuidAt(childCreatedAt + 10_000, 24);
  const childPath = path.join(sessionRoot, `a-rollout-child-${childId}.jsonl`);
  const parentPath = path.join(sessionRoot, `b-rollout-parent-${parentId}.jsonl`);
  writeFileSync(parentPath, [
    sessionMeta(trackerNow - 80_000, parentId, "openai"),
    turnContext(trackerNow - 70_000, replayedTurnId),
    tokenCount(trackerNow - 60_000, 100, 100),
    "",
  ].join("\n"), "utf8");
  writeFileSync(childPath, [
    sessionMeta(childCreatedAt, childId, "openai", {
      parent_thread_id: parentId,
      source: { subagent: { role: "worker" } },
    }),
    turnContext(childCreatedAt + 1000, replayedTurnId),
    tokenCount(childCreatedAt + 2000, 100, 100),
    turnContext(childCreatedAt + 10_000, childTurnId),
    tokenCount(childCreatedAt + 20_000, 130, 30),
    "",
  ].join("\n"), "utf8");

  const tracker = new LocalCodexTokenTracker({
    sessionRoot,
    counterPath,
    officialModelProviders: ["openai"],
    now: () => trackerNow,
  });
  tracker.setCurrentThreadId(parentId);
  const forkView = await tracker.refresh();
  assert.equal(forkView.todayTokens, 130);
  const persisted = JSON.parse(readFileSync(counterPath, "utf8"));
  assert.equal(persisted.seenEvents.filter((identity) => identity === `${replayedTurnId}:epoch:0:total:100`).length, 1);
  assert.ok(persisted.seenEvents.includes(`${childTurnId}:epoch:0:total:130`));
} finally {
  rmSync(forkTrackerRoot, { recursive: true, force: true });
}

const midnightTrackerRoot = mkdtempSync(path.join(os.tmpdir(), "codex-usage-midnight-token-test-"));
try {
  const sessionRoot = path.join(midnightTrackerRoot, "sessions");
  const counterPath = path.join(midnightTrackerRoot, "official-token-counter.json");
  mkdirSync(sessionRoot, { recursive: true });
  const dayOne = new Date();
  dayOne.setHours(23, 59, 30, 0);
  let trackerNow = dayOne.getTime();
  const dayTwo = new Date(dayOne);
  dayTwo.setDate(dayTwo.getDate() + 1);
  dayTwo.setHours(0, 1, 0, 0);
  const threadId = uuidAt(trackerNow - 60_000, 31);
  const sessionPath = path.join(sessionRoot, `rollout-midnight-${threadId}.jsonl`);
  writeFileSync(sessionPath, [
    sessionMeta(trackerNow - 50_000, threadId, "openai"),
    turnContext(trackerNow - 40_000, uuidAt(trackerNow - 40_000, 32)),
    tokenCount(trackerNow - 30_000, 200, 200),
    "",
  ].join("\n"), "utf8");
  const tracker = new LocalCodexTokenTracker({
    sessionRoot,
    counterPath,
    officialModelProviders: ["openai"],
    now: () => trackerNow,
  });
  tracker.setCurrentThreadId(threadId);
  assert.equal((await tracker.refresh()).todayTokens, 200);

  trackerNow = dayTwo.getTime();
  appendFileSync(sessionPath, [
    turnContext(trackerNow - 20_000, uuidAt(trackerNow - 20_000, 33)),
    tokenCount(trackerNow - 10_000, 260, 60),
    "",
  ].join("\n"), "utf8");
  const dayTwoView = await tracker.refresh();
  assert.equal(dayTwoView.dailyDate, localDateString(trackerNow));
  assert.equal(dayTwoView.todayTokens, 60);
  assert.equal(JSON.parse(readFileSync(counterPath, "utf8")).todayTokens, 60);
} finally {
  rmSync(midnightTrackerRoot, { recursive: true, force: true });
}

const trackerDate = new Date();
const trackerDateKey = localDateString(trackerDate);
const mergeThreadId = "019f8e6a-f751-7963-8474-551fcc730496";
const delayedOfficial = mergeOfficialLocalUsage(missingToday, {
  status: "ready",
  dailyDate: trackerDateKey,
  todayTokens: 90,
  currentThreadId: mergeThreadId,
  currentTaskTokens: 190,
  lastTurnTokens: 40,
}, trackerDate);
assert.equal(delayedOfficial.todayTokens, 90);
assert.equal(delayedOfficial.todayTokenScope, "local-official-conversations");
const delayedSource = toOfficialUsageSource(delayedOfficial, trackerDate.getTime());
assert.equal(delayedSource.metrics.find((item) => item.id === "todayTokens").value, "90");
assert.equal(delayedSource.metrics.find((item) => item.id === "currentTaskTokens").value, "190");
assert.equal(delayedSource.metrics.find((item) => item.id === "lastTurnTokens").value, "40");
const localZeroOverridesOfficialBucket = mergeOfficialLocalUsage({ ...view, todayTokens: 120 }, {
  dailyDate: trackerDateKey,
  todayTokens: 0,
}, trackerDate);
assert.equal(localZeroOverridesOfficialBucket.todayTokens, 0);
assert.equal(localZeroOverridesOfficialBucket.todayTokenScope, "local-official-conversations");

const reversed = toOfficialUsageSource({ ...view, windows: [...view.windows].reverse() }, now.getTime());
assert.equal(reversed.metrics.find((item) => item.id === "primaryRemaining").value, "68%");

const cctq = normalizeCctqUsageView({
  data: { total_granted: 7500000, total_used: 2500000, unlimited_quota: false, expires_at: 0 },
}, {
  data: { quota_per_unit: 500000, quota_display_type: "CNY" },
}, now.getTime());
assert.equal(cctq.metrics.find((item) => item.id === "usedAmount").value, "¥5.0");
assert.equal(cctq.metrics.find((item) => item.id === "quotaLimit").value, "¥15.0");
assert.equal(cctq.metrics.find((item) => item.id === "expiresAt").value, "永久");

const customProvider = validateApiProviderConfig({
  schemaVersion: 1,
  id: "acme",
  label: "Acme API",
  baseUrl: "https://api.example.com/",
  requests: { usagePath: "/v2/usage", statusPath: null },
  auth: { header: "X-API-Key", scheme: "" },
  response: {
    usageRoot: "result.account",
    statusRoot: "result.account",
    used: "quota.used",
    limit: "quota.limit",
    unlimited: "quota.unlimited",
    expiresAt: "subscription.expires",
    quotaPerUnit: "display.perUnit",
    currency: "display.currency",
    defaultQuotaPerUnit: 100,
    defaultCurrency: "USD",
  },
});
assert.equal(customProvider.baseUrl, "https://api.example.com");
assert.equal(customProvider.auth.header, "X-API-Key");
const custom = normalizeApiUsageView({
  result: {
    account: {
      quota: { used: 1234, limit: 5000, unlimited: "false" },
      subscription: { expires: "2026-07-25T00:00:00Z" },
      display: { perUnit: 100, currency: "USD" },
    },
  },
}, null, customProvider, now.getTime());
assert.equal(custom.id, "acme");
assert.equal(custom.label, "Acme API");
assert.equal(custom.accountType, "api-key");
assert.equal(custom.metrics.find((item) => item.id === "usedAmount").value, "$12.3");
assert.equal(custom.metrics.find((item) => item.id === "quotaLimit").value, "$50.0");
assert.equal(custom.metrics.find((item) => item.id === "expiresAt").value, "3天后");

const noLimitProvider = validateApiProviderConfig({
  schemaVersion: 1,
  id: "raw",
  label: "Raw API",
  baseUrl: "http://127.0.0.1:8080",
  requests: { usagePath: "/usage", statusPath: null },
  auth: {},
  response: { used: "used", limit: null, unlimited: null, defaultQuotaPerUnit: 1, defaultCurrency: "" },
});
const noLimit = normalizeApiUsageView({ used: 123 }, null, noLimitProvider, now.getTime());
assert.equal(noLimit.metrics.find((item) => item.id === "usedAmount").value, "123.0");
assert.equal(noLimit.metrics.find((item) => item.id === "quotaLimit").value, "不限");

const baseProvider = {
  schemaVersion: 1,
  id: "test",
  label: "Test API",
  baseUrl: "https://api.example.com",
  requests: { usagePath: "/usage", statusPath: null },
  auth: {},
  response: { used: "used" },
};
assert.throws(() => validateApiProviderConfig({ ...baseProvider, baseUrl: "https://user:pass@example.com" }), /不能包含凭据/);
assert.throws(() => validateApiProviderConfig({ ...baseProvider, baseUrl: "file:///tmp/data" }), /HTTP/);
assert.throws(() => validateApiProviderConfig({ ...baseProvider, requests: { usagePath: "//evil.example/usage" } }), /站内路径/);
assert.throws(() => validateApiProviderConfig({ ...baseProvider, auth: { header: "X-Key\r\nHost", scheme: "" } }), /请求头/);
assert.throws(() => validateApiProviderConfig({ ...baseProvider, auth: { header: "Cookie", scheme: "" } }), /受保护/);
assert.throws(() => validateApiProviderConfig({ ...baseProvider, credentials: { apiKey: "not-allowed" } }), /不支持的字段/);
assert.throws(() => validateApiProviderConfig({ ...baseProvider, response: { used: "used", secret: "value" } }), /不支持的字段/);
assert.equal(loadApiProviderConfig().id, "cctq");

const resilientProvider = validateApiProviderConfig({
  ...baseProvider,
  requests: { usagePath: "/usage", statusPath: "/status" },
  response: {
    used: "used",
    quotaPerUnit: "quotaPerUnit",
    currency: "currency",
    defaultQuotaPerUnit: 1,
    defaultCurrency: "USD",
  },
});
const apiUpdates = [];
const apiClient = new ApiUsageClient({ provider: resilientProvider, apiKey: "test-key", onUpdate: (value) => apiUpdates.push(value) });
let statusAvailable = true;
let usedAmount = 100;
apiClient.requestJson = async (url) => {
  if (url.endsWith("/status")) {
    if (!statusAvailable) throw new Error("status unavailable");
    return { quotaPerUnit: 100, currency: "CNY" };
  }
  return { used: usedAmount };
};
await apiClient.refresh();
assert.equal(apiUpdates.at(-1).metrics.find((item) => item.id === "usedAmount").value, "¥1.0");
statusAvailable = false;
usedAmount = 250;
await apiClient.refresh();
assert.equal(apiUpdates.at(-1).status, "ready");
assert.equal(apiUpdates.at(-1).metrics.find((item) => item.id === "usedAmount").value, "¥2.5");

let rateLimitNow = 1784700000000;
let rateLimitRequests = 0;
let rateLimited = false;
const rateLimitUpdates = [];
const rateLimitClient = new ApiUsageClient({
  provider: validateApiProviderConfig({ ...baseProvider, response: { used: "used" } }),
  apiKey: "test-key",
  now: () => rateLimitNow,
  onUpdate: (value) => rateLimitUpdates.push(value),
});
rateLimitClient.requestJson = async () => {
  rateLimitRequests += 1;
  if (rateLimited) {
    const error = new Error("rate limited");
    error.status = 429;
    throw error;
  }
  return { used: 12 };
};
await rateLimitClient.refresh();
assert.equal(rateLimitUpdates.at(-1).status, "ready");
const successfulMetrics = rateLimitUpdates.at(-1).metrics;
rateLimited = true;
await rateLimitClient.refresh();
assert.equal(rateLimitUpdates.at(-1).status, "rate-limited");
assert.match(rateLimitUpdates.at(-1).error, /HTTP 429/);
assert.deepEqual(rateLimitUpdates.at(-1).metrics, successfulMetrics);
assert.equal(rateLimitUpdates.at(-1).nextRefreshAt, rateLimitNow + 60000);
rateLimitNow += 30000;
await rateLimitClient.refresh();
assert.equal(rateLimitRequests, 2);
assert.equal(rateLimitUpdates.at(-1).status, "rate-limited");
rateLimitNow += 30000;
rateLimited = false;
await rateLimitClient.refresh();
assert.equal(rateLimitRequests, 3);
assert.equal(rateLimitUpdates.at(-1).status, "ready");

const accountNow = new Date(2026, 6, 22, 12, 0, 0).getTime();
const account = normalizeApiAccountView({ data: { quota: 5000000, used_quota: 1250000 } }, [
  { created_at: Math.floor((accountNow - 10 * 60000) / 1000), prompt_tokens: 1200, completion_tokens: 300, quota: 250000, model_name: "gpt-5.6-sol", use_time: 842 },
  { created_at: Math.floor((accountNow - 3 * 3600000) / 1000), prompt_tokens: 5000, completion_tokens: 700, quota: 400000, model_name: "gpt-5.5", use_time: 1200 },
  { created_at: Math.floor((accountNow - 13 * 3600000) / 1000), prompt_tokens: 100, completion_tokens: 0, quota: 10000, model_name: "gpt-5.5", use_time: 300 },
  { created_at: Math.floor((accountNow - 2 * 86400000) / 1000), prompt_tokens: 10000, completion_tokens: 2000, quota: 800000, model_name: "gpt-5.4", use_time: 1600 },
], { now: accountNow, refreshMs: 90000 });
assert.equal(account.accountType, "api-account");
assert.equal(account.metrics.length, 8);
assert.equal(account.metrics.find((item) => item.id === "balance").value, "¥10.0");
assert.equal(account.metrics.find((item) => item.id === "usedQuota").value, "¥2.5");
assert.equal(account.metrics.find((item) => item.id === "totalTokens").value, "2万");
assert.equal(account.metrics.find((item) => item.id === "todayTokens").value, "7,200");
assert.equal(account.metrics.find((item) => item.id === "todayTokens").label, "今日 Token");
assert.equal(account.metrics.find((item) => item.id === "totalTokens").label, "累计 Token");
assert.equal(account.metrics.find((item) => item.id === "lastQuota").value, "¥0.500");
assert.equal(account.metrics.find((item) => item.id === "lastModel").value, "gpt-5.6-sol");
assert.equal(account.metrics.find((item) => item.id === "lastModel").label, "上次响应模型");
assert.match(account.metrics.find((item) => item.id === "lastRequestAt").value, /^2026-07-22 11:50$/);
assert.equal(account.metrics.find((item) => item.id === "lastLatency").value, "842ms");

const persistedToday = normalizeApiAccountView({ data: { quota: 5000000, used_quota: 1250000 } }, [], {
  now: accountNow,
  persistentTodayTokens: 123456,
});
assert.equal(persistedToday.metrics.find((item) => item.id === "todayTokens").value, "12万");

const automaticCounterRoot = mkdtempSync(path.join(os.tmpdir(), "codex-usage-auto-counter-test-"));
try {
  const automaticCounterPath = path.join(automaticCounterRoot, "counter.json");
  const accountUpdates = [];
  const accountClient = new ApiAccountUsageClient({ token: "account-token", userId: "10530", counterPath: automaticCounterPath, now: () => accountNow, onUpdate: (value) => accountUpdates.push(value) });
  const requestedLogPages = [];
  accountClient.requestJson = async (pathname, query) => {
    if (pathname === "/api/user/self") return { data: { quota: 1000000, used_quota: 500000 } };
    requestedLogPages.push(query.p);
    if (query.p === 1) return { data: { total: 201, page_size: 100, items: [{ id: 1, created_at: Math.floor(accountNow / 1000), prompt_tokens: 2, completion_tokens: 3 }] } };
    if (query.p === 2) return { data: { page: 2, total: 201, page_size: 100, items: [{ id: 2, created_at: Math.floor(accountNow / 1000) - 1, prompt_tokens: 5, completion_tokens: 7 }] } };
    return { data: { page: 3, total: 201, page_size: 100, items: [{ id: 3, created_at: Math.floor(accountNow / 1000) - 2, prompt_tokens: 11, completion_tokens: 8 }] } };
  };
  await accountClient.refresh();
  assert.equal(accountUpdates.at(-1).status, "ready");
  assert.equal(accountUpdates.at(-1).metrics.find((item) => item.id === "totalTokens").value, "36");
  assert.equal(accountUpdates.at(-1).metrics.find((item) => item.id === "todayTokens").value, "36");
  assert.equal(accountUpdates.at(-1).error, null);
  assert.equal(accountUpdates.at(-1).nextRefreshAt - accountUpdates.at(-1).fetchedAt, 60000);
  assert.deepEqual(requestedLogPages, [1, 2, 3]);
  await accountClient.refresh();
  assert.deepEqual(requestedLogPages, [1, 2, 3, 1]);
  assert.equal(accountUpdates.at(-1).metrics.find((item) => item.id === "totalTokens").value, "36");
  assert.equal(accountUpdates.at(-1).metrics.find((item) => item.id === "todayTokens").value, "36");
  assert.equal(accountUpdates.at(-1).error, null);
  await accountClient.refresh();
  assert.deepEqual(requestedLogPages, [1, 2, 3, 1, 1]);
  assert.equal(accountUpdates.at(-1).metrics.find((item) => item.id === "totalTokens").value, "36");

  const restartedUpdates = [];
  const restartedClient = new ApiAccountUsageClient({ token: "account-token", userId: "10530", counterPath: automaticCounterPath, now: () => accountNow, onUpdate: (value) => restartedUpdates.push(value) });
  restartedClient.requestJson = accountClient.requestJson;
  await restartedClient.refresh();
  assert.equal(restartedUpdates.at(-1).metrics.find((item) => item.id === "todayTokens").value, "36");
  assert.equal(restartedUpdates.at(-1).metrics.find((item) => item.id === "totalTokens").value, "36");

  const incompleteUpdates = [];
  const incompleteClient = new ApiAccountUsageClient({ token: "account-token", userId: "10530", counterPath: automaticCounterPath, now: () => accountNow + 1000, onUpdate: (value) => incompleteUpdates.push(value) });
  incompleteClient.requestJson = async (pathname, query) => {
    if (pathname === "/api/user/self") return { data: { quota: 1000000, used_quota: 500000 } };
    if (query.p === 1) return { data: { total: 201, page_size: 100, items: [{ id: 1, created_at: Math.floor((accountNow + 1000) / 1000), prompt_tokens: 100, completion_tokens: 50 }] } };
    if (query.p === 2) throw new Error("temporary history failure");
    return { data: { page: 3, total: 201, page_size: 100, items: [] } };
  };
  await incompleteClient.refresh();
  assert.equal(incompleteUpdates.at(-1).metrics.find((item) => item.id === "totalTokens").value, "36");
  assert.equal(incompleteUpdates.at(-1).metrics.find((item) => item.id === "todayTokens").value, "36");
  assert.match(incompleteUpdates.at(-1).error, /账本保留原值/);
} finally {
  rmSync(automaticCounterRoot, { recursive: true, force: true });
}

const counterRoot = mkdtempSync(path.join(os.tmpdir(), "codex-usage-counter-test-"));
try {
  const counterPath = path.join(counterRoot, "counter.json");
  writeFileSync(counterPath, JSON.stringify({
    schemaVersion: 1,
    initialTokens: 500,
    totalTokens: 500,
    checkpointAt: accountNow - 1000,
    recentLogIds: [],
    configuredAt: new Date(accountNow - 1000).toISOString(),
    updatedAt: new Date(accountNow - 1000).toISOString(),
  }));
  const counterUpdates = [];
  let counterNow = accountNow;
  let counterLog = { id: 99, created_at: Math.floor(accountNow / 1000), prompt_tokens: 2, completion_tokens: 3 };
  const counterClient = new ApiAccountUsageClient({ token: "account-token", userId: "10530", counterPath, now: () => counterNow, onUpdate: (value) => counterUpdates.push(value) });
  counterClient.requestJson = async (pathname) => pathname === "/api/user/self"
    ? { data: { quota: 1000000, used_quota: 500000 } }
    : { data: { page: 1, page_size: 100, total: 1, items: [counterLog] } };
  await counterClient.refresh();
  assert.equal(counterUpdates.at(-1).metrics.find((item) => item.id === "totalTokens").value, "505");
  assert.equal(counterUpdates.at(-1).metrics.find((item) => item.id === "todayTokens").value, "5");
  const migratedCounter = JSON.parse(readFileSync(counterPath, "utf8"));
  assert.equal(migratedCounter.schemaVersion, 5);
  assert.equal(migratedCounter.dailyTokens, 5);
  await counterClient.refresh();
  assert.equal(counterUpdates.at(-1).metrics.find((item) => item.id === "totalTokens").value, "505");
  assert.equal(counterUpdates.at(-1).metrics.find((item) => item.id === "todayTokens").value, "5");

  counterNow += 86400000;
  counterLog = { id: 100, created_at: Math.floor(counterNow / 1000), prompt_tokens: 7, completion_tokens: 11 };
  await counterClient.refresh();
  assert.equal(counterUpdates.at(-1).metrics.find((item) => item.id === "totalTokens").value, "523");
  assert.equal(counterUpdates.at(-1).metrics.find((item) => item.id === "todayTokens").value, "18");
  const nextDayCounter = JSON.parse(readFileSync(counterPath, "utf8"));
  assert.equal(nextDayCounter.dailyTokens, 18);
  assert.equal(nextDayCounter.dailyLogIds.length, 1);

  writeFileSync(counterPath, JSON.stringify({
    schemaVersion: 3,
    baselineConfigured: true,
    baselineSnapshotComplete: true,
    initialTokens: 500,
    totalTokens: 500,
    checkpointAt: accountNow + 60000,
    recentLogIds: [],
    dailyDate: "2026-07-22",
    dailyTokens: 0,
    dailyLogIds: [],
  }));
  const delayedUpdates = [];
  const delayedClient = new ApiAccountUsageClient({ token: "account-token", userId: "10530", counterPath, now: () => accountNow, onUpdate: (value) => delayedUpdates.push(value) });
  delayedClient.requestJson = async (pathname) => pathname === "/api/user/self"
    ? { data: { quota: 1000000, used_quota: 500000 } }
    : { data: { page: 1, page_size: 100, total: 1, items: [{ id: 101, created_at: Math.floor(accountNow / 1000), prompt_tokens: 2, completion_tokens: 3 }] } };
  await delayedClient.refresh();
  assert.equal(delayedUpdates.at(-1).metrics.find((item) => item.id === "totalTokens").value, "500");

  writeFileSync(counterPath, JSON.stringify({
    schemaVersion: 4,
    baselineConfigured: true,
    initialTokens: 500,
    totalTokens: 450,
    checkpointAt: accountNow,
    recentLogIds: ["id:102"],
    dailyDate: "2026-07-22",
    dailyTokens: 5,
    dailyLogIds: ["id:102"],
  }));
  const legacyUpdates = [];
  const legacyClient = new ApiAccountUsageClient({ token: "account-token", userId: "10530", counterPath, now: () => accountNow, onUpdate: (value) => legacyUpdates.push(value) });
  legacyClient.requestJson = async (pathname) => pathname === "/api/user/self"
    ? { data: { quota: 1000000, used_quota: 500000 } }
    : { data: { page: 1, page_size: 100, total: 1, items: [{ id: 102, created_at: Math.floor(accountNow / 1000), prompt_tokens: 5, completion_tokens: 0 }] } };
  await legacyClient.refresh();
  assert.equal(legacyUpdates.at(-1).metrics.find((item) => item.id === "totalTokens").value, "500");

  const baselineLog = { id: 1, created_at: Math.floor(accountNow / 1000), prompt_tokens: 2, completion_tokens: 3, quota: 10, model_name: "gpt", use_time: 50 };
  writeFileSync(counterPath, JSON.stringify({
    schemaVersion: 5,
    baselineConfigured: true,
    initialTokens: 500,
    totalTokens: 500,
    checkpointAt: accountNow,
    recentLogIds: [accountLogIdentity(baselineLog)],
    dailyDate: "2026-07-22",
    dailyTokens: 5,
    dailyCheckpointAt: accountNow,
    dailyLogIds: [accountLogIdentity(baselineLog)],
  }));
  const immutableUpdates = [];
  let immutableLog = baselineLog;
  const immutableClient = new ApiAccountUsageClient({ token: "account-token", userId: "10530", counterPath, now: () => accountNow + 2000, onUpdate: (value) => immutableUpdates.push(value) });
  immutableClient.requestJson = async (pathname) => pathname === "/api/user/self"
    ? { data: { quota: 1000000, used_quota: 500000 } }
    : { data: { page: 1, page_size: 100, total: 1, items: [immutableLog] } };
  await immutableClient.refresh();
  assert.equal(immutableUpdates.at(-1).metrics.find((item) => item.id === "totalTokens").value, "500");
  immutableLog = { id: 1, created_at: Math.floor((accountNow + 1000) / 1000), prompt_tokens: 10, completion_tokens: 5, quota: 20, model_name: "gpt", use_time: 60 };
  await immutableClient.refresh();
  assert.equal(immutableUpdates.at(-1).metrics.find((item) => item.id === "totalTokens").value, "515");
  assert.equal(immutableUpdates.at(-1).metrics.find((item) => item.id === "todayTokens").value, "20");
  immutableLog = { ...immutableLog, id: 999 };
  await immutableClient.refresh();
  assert.equal(immutableUpdates.at(-1).metrics.find((item) => item.id === "totalTokens").value, "515");
  immutableLog = { id: 1, created_at: Math.floor((accountNow + 1000) / 1000), prompt_tokens: 7, completion_tokens: 3, quota: 21, model_name: "gpt", use_time: 61 };
  await immutableClient.refresh();
  assert.equal(immutableUpdates.at(-1).metrics.find((item) => item.id === "totalTokens").value, "525");
  assert.equal(immutableUpdates.at(-1).metrics.find((item) => item.id === "todayTokens").value, "30");
} finally {
  rmSync(counterRoot, { recursive: true, force: true });
}

const merged = mergeRateLimitSnapshot(rateLimits.rateLimits, { primary: { usedPercent: 40 }, secondary: null, planType: null });
assert.deepEqual(merged.primary, { usedPercent: 40, windowDurationMins: 300, resetsAt: 1784700000 });
assert.deepEqual(merged.secondary, rateLimits.rateLimits.secondary);
assert.equal(normalizeUsageView(null, null, now).status, "unavailable");

console.log("PASS: official usage, API account aggregation, generic API mapping, provider validation, CCTQ compatibility, and sparse updates.");
