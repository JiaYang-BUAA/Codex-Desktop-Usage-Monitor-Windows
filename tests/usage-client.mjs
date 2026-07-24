import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ApiAccountUsageClient,
  ApiUsageClient,
  loadApiProviderConfig,
  mergeRateLimitSnapshot,
  normalizeApiUsageView,
  normalizeApiAccountView,
  normalizeCctqUsageView,
  normalizeUsageView,
  parseAppServerLine,
  toOfficialUsageSource,
  validateApiProviderConfig,
} from "../scripts/usage-client.mjs";

assert.deepEqual(parseAppServerLine('{"id":1,"result":{}}'), { id: 1, result: {} });
assert.equal(parseAppServerLine("  "), null);
assert.throws(() => parseAppServerLine("[]"), /JSON object/);
assert.throws(() => parseAppServerLine("not-json"), SyntaxError);

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
assert.equal(official.metrics.find((item) => item.id === "todayTokens").value, "18,400");
assert.equal(official.nextRefreshAt - official.fetchedAt, 45000);

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
    if (query.p === 1) return { data: { total: 101, page_size: 100, items: [{ id: 1, created_at: Math.floor(accountNow / 1000), prompt_tokens: 2, completion_tokens: 3 }] } };
    return { data: { total: 101, page_size: 100, items: [{ id: 2, created_at: Math.floor(accountNow / 1000) - 1, prompt_tokens: 5, completion_tokens: 7 }] } };
  };
  await accountClient.refresh();
  assert.equal(accountUpdates.at(-1).status, "ready");
  assert.equal(accountUpdates.at(-1).metrics.find((item) => item.id === "totalTokens").value, "5");
  assert.equal(accountUpdates.at(-1).metrics.find((item) => item.id === "todayTokens").value, "5");
  assert.match(accountUpdates.at(-1).error, /最近 1 条日志/);
  assert.equal(accountUpdates.at(-1).nextRefreshAt - accountUpdates.at(-1).fetchedAt, 30000);
  assert.deepEqual(requestedLogPages, [1]);
  await accountClient.refresh();
  assert.deepEqual(requestedLogPages, [1, 2]);
  assert.equal(accountUpdates.at(-1).metrics.find((item) => item.id === "totalTokens").value, "17");
  assert.equal(accountUpdates.at(-1).metrics.find((item) => item.id === "todayTokens").value, "17");
  assert.equal(accountUpdates.at(-1).error, null);
  await accountClient.refresh();
  assert.deepEqual(requestedLogPages, [1, 2, 1]);
  assert.equal(accountUpdates.at(-1).metrics.find((item) => item.id === "totalTokens").value, "17");

  const restartedUpdates = [];
  const restartedClient = new ApiAccountUsageClient({ token: "account-token", userId: "10530", counterPath: automaticCounterPath, now: () => accountNow, onUpdate: (value) => restartedUpdates.push(value) });
  restartedClient.requestJson = accountClient.requestJson;
  await restartedClient.refresh();
  assert.equal(restartedUpdates.at(-1).metrics.find((item) => item.id === "todayTokens").value, "17");
  assert.equal(restartedUpdates.at(-1).metrics.find((item) => item.id === "totalTokens").value, "17");
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
  assert.equal(migratedCounter.schemaVersion, 2);
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
} finally {
  rmSync(counterRoot, { recursive: true, force: true });
}

const merged = mergeRateLimitSnapshot(rateLimits.rateLimits, { primary: { usedPercent: 40 }, secondary: null, planType: null });
assert.deepEqual(merged.primary, { usedPercent: 40, windowDurationMins: 300, resetsAt: 1784700000 });
assert.deepEqual(merged.secondary, rateLimits.rateLimits.secondary);
assert.equal(normalizeUsageView(null, null, now).status, "unavailable");

console.log("PASS: official usage, API account aggregation, generic API mapping, provider validation, CCTQ compatibility, and sparse updates.");
