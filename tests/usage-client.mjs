import assert from "node:assert/strict";
import {
  ApiUsageClient,
  loadApiProviderConfig,
  mergeRateLimitSnapshot,
  normalizeApiUsageView,
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
assert.equal(cctq.metrics.find((item) => item.id === "usedAmount").value, "¥5");
assert.equal(cctq.metrics.find((item) => item.id === "quotaLimit").value, "¥15");
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
assert.equal(custom.metrics.find((item) => item.id === "quotaLimit").value, "$50");
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
assert.equal(noLimit.metrics.find((item) => item.id === "usedAmount").value, "123");
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
assert.equal(apiUpdates.at(-1).metrics.find((item) => item.id === "usedAmount").value, "¥1");
statusAvailable = false;
usedAmount = 250;
await apiClient.refresh();
assert.equal(apiUpdates.at(-1).status, "ready");
assert.equal(apiUpdates.at(-1).metrics.find((item) => item.id === "usedAmount").value, "¥2.5");

const merged = mergeRateLimitSnapshot(rateLimits.rateLimits, { primary: { usedPercent: 40 }, secondary: null, planType: null });
assert.deepEqual(merged.primary, { usedPercent: 40, windowDurationMins: 300, resetsAt: 1784700000 });
assert.deepEqual(merged.secondary, rateLimits.rateLimits.secondary);
assert.equal(normalizeUsageView(null, null, now).status, "unavailable");

console.log("PASS: official usage, generic API mapping, provider validation, CCTQ compatibility, and sparse updates.");
