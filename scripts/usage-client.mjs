import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

const DEFAULT_REFRESH_MS = 60000;
const REQUEST_TIMEOUT_MS = 12000;
const RATE_LIMIT_BASE_BACKOFF_MS = 60000;
const RATE_LIMIT_MAX_BACKOFF_MS = 300000;
const CCTQ_DEFAULT_BASE_URL = "https://www.cctq.ai";
const CCTQ_ACCOUNT_PAGE_SIZE = 1000;
const CCTQ_ACCOUNT_MAX_PAGES = 100;
const CCTQ_ACCOUNT_MAX_LOG_IDS = CCTQ_ACCOUNT_PAGE_SIZE * CCTQ_ACCOUNT_MAX_PAGES;
const ACCOUNT_COUNTER_SCHEMA_VERSION = 5;
const CCTQ_PROVIDER = Object.freeze({
  schemaVersion: 1,
  id: "cctq",
  label: "CCTQ API",
  baseUrl: CCTQ_DEFAULT_BASE_URL,
  requests: { usagePath: "/api/usage/token/", statusPath: "/api/status" },
  auth: { header: "Authorization", scheme: "Bearer" },
  response: {
    usageRoot: "data",
    statusRoot: "data",
    used: "total_used",
    limit: "total_granted",
    unlimited: "unlimited_quota",
    expiresAt: "expires_at",
    quotaPerUnit: "quota_per_unit",
    currency: "quota_display_type",
    defaultQuotaPerUnit: 500000,
    defaultCurrency: "CNY",
  },
});

const PROVIDER_KEYS = new Set(["schemaVersion", "id", "label", "baseUrl", "requests", "auth", "response"]);
const REQUEST_KEYS = new Set(["usagePath", "statusPath"]);
const AUTH_KEYS = new Set(["header", "scheme"]);
const RESPONSE_KEYS = new Set([
  "usageRoot", "statusRoot", "used", "limit", "unlimited", "expiresAt",
  "quotaPerUnit", "currency", "defaultQuotaPerUnit", "defaultCurrency",
]);

function assertAllowedKeys(value, allowed, section) {
  for (const key of Object.keys(value || {})) {
    if (!allowed.has(key)) throw new Error(`${section} 包含不支持的字段：${key}`);
  }
}

function validateSelector(value, name, { required = false } = {}) {
  if (value == null || value === "") {
    if (required) throw new Error(`${name} 映射不能为空。`);
    return null;
  }
  if (typeof value !== "string" || value.length > 160 || !/^[A-Za-z0-9_$-]+(?:\.[A-Za-z0-9_$-]+)*$/.test(value)) {
    throw new Error(`${name} 不是有效的点路径。`);
  }
  return value;
}

function validateRequestPath(value, name, { required = false } = {}) {
  if (value == null || value === "") {
    if (required) throw new Error(`${name} 不能为空。`);
    return null;
  }
  if (typeof value !== "string" || value.length > 512 || !/^\/(?!\/)/.test(value) || value.includes("\\")) {
    throw new Error(`${name} 必须是以单个 / 开头的站内路径。`);
  }
  return value;
}

function readPath(value, selector) {
  if (!selector) return value;
  return String(selector).split(".").filter(Boolean).reduce((current, key) => current?.[key], value);
}

export function validateApiProviderConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("API Provider 配置必须是 JSON 对象。");
  const provider = structuredClone(value);
  assertAllowedKeys(provider, PROVIDER_KEYS, "Provider 配置");
  if (provider.schemaVersion !== 1) throw new Error("API Provider schemaVersion 必须为 1。");
  if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(provider.id || "")) throw new Error("API Provider id 无效。");
  if (typeof provider.label !== "string" || !provider.label.trim() || provider.label.length > 24) throw new Error("API Provider label 无效。");
  let baseUrl;
  try { baseUrl = new URL(provider.baseUrl); } catch { throw new Error("API Provider baseUrl 无效。"); }
  if (!/^https?:$/.test(baseUrl.protocol)) throw new Error("API Provider baseUrl 只支持 HTTP 或 HTTPS。");
  if (baseUrl.username || baseUrl.password) throw new Error("baseUrl 不能包含凭据。");
  if (!provider.requests || typeof provider.requests !== "object" || Array.isArray(provider.requests)) throw new Error("requests 配置不能为空。");
  assertAllowedKeys(provider.requests, REQUEST_KEYS, "requests");
  provider.requests.usagePath = validateRequestPath(provider.requests.usagePath, "usagePath", { required: true });
  provider.requests.statusPath = validateRequestPath(provider.requests.statusPath, "statusPath");
  if (provider.auth != null && (typeof provider.auth !== "object" || Array.isArray(provider.auth))) throw new Error("auth 必须是 JSON 对象。");
  assertAllowedKeys(provider.auth, AUTH_KEYS, "auth");
  const response = provider.response;
  if (!response || typeof response !== "object" || Array.isArray(response)) throw new Error("response 配置不能为空。");
  assertAllowedKeys(response, RESPONSE_KEYS, "response");
  response.usageRoot = validateSelector(response.usageRoot, "response.usageRoot");
  response.statusRoot = validateSelector(response.statusRoot, "response.statusRoot");
  response.used = validateSelector(response.used, "response.used", { required: true });
  for (const name of ["limit", "unlimited", "expiresAt", "quotaPerUnit", "currency"]) {
    response[name] = validateSelector(response[name], `response.${name}`);
  }
  if (response.defaultQuotaPerUnit != null && (!Number.isFinite(Number(response.defaultQuotaPerUnit)) || Number(response.defaultQuotaPerUnit) <= 0)) {
    throw new Error("response.defaultQuotaPerUnit 必须是正数。");
  }
  if (response.defaultCurrency != null && (typeof response.defaultCurrency !== "string" || response.defaultCurrency.length > 12)) {
    throw new Error("response.defaultCurrency 无效。");
  }
  provider.baseUrl = baseUrl.toString().replace(/\/$/, "");
  provider.auth = {
    header: typeof provider.auth?.header === "string" && provider.auth.header.trim() ? provider.auth.header.trim() : "Authorization",
    scheme: typeof provider.auth?.scheme === "string" ? provider.auth.scheme.trim() : "Bearer",
  };
  if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(provider.auth.header)) throw new Error("auth.header 不是有效的 HTTP 请求头名称。");
  if (["host", "content-length", "origin", "referer", "cookie", "set-cookie"].includes(provider.auth.header.toLowerCase())) {
    throw new Error("auth.header 不能覆盖受保护的 HTTP 请求头。");
  }
  if (provider.auth.scheme.length > 32 || /[\r\n]/.test(provider.auth.scheme)) throw new Error("auth.scheme 无效。");
  provider.label = provider.label.trim();
  return provider;
}

export function loadApiProviderConfig(configPath = process.env.CODEX_USAGE_PROVIDER_CONFIG_PATH) {
  const value = configPath
    ? JSON.parse(readFileSync(path.resolve(configPath), "utf8"))
    : structuredClone(CCTQ_PROVIDER);
  const baseUrlOverride = process.env.CODEX_USAGE_BASE_URL || (!configPath ? process.env.CCTQ_USAGE_BASE_URL : null);
  if (baseUrlOverride) value.baseUrl = baseUrlOverride;
  return validateApiProviderConfig(value);
}

export function parseAppServerLine(line) {
  const text = String(line ?? "").trim();
  if (!text) return null;
  const value = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("App-server message must be a JSON object.");
  return value;
}

function clampPercent(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : null;
}

function labelWindow(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return "主";
  if (minutes >= 6 * 24 * 60 && minutes <= 8 * 24 * 60) return "周";
  if (minutes % 60 === 0 && minutes < 24 * 60) return `${minutes / 60}H`;
  if (minutes < 60) return `${minutes}m`;
  if (minutes % (24 * 60) === 0) return `${minutes / (24 * 60)}天`;
  return `${Math.round(minutes / 60)}H`;
}

function normalizeWindow(window, snapshot, position) {
  if (!window || typeof window !== "object") return null;
  const usedPercent = clampPercent(window.usedPercent);
  if (usedPercent === null) return null;
  const duration = Number.isFinite(Number(window.windowDurationMins)) ? Number(window.windowDurationMins) : null;
  const resetsAt = Number.isFinite(Number(window.resetsAt)) ? Number(window.resetsAt) : null;
  return {
    label: labelWindow(duration),
    remainingPercent: 100 - usedPercent,
    windowDurationMins: duration,
    resetsAt,
    limitId: typeof snapshot?.limitId === "string" ? snapshot.limitId : null,
    position,
  };
}

function windowsFromSnapshot(snapshot) {
  return [
    normalizeWindow(snapshot?.primary, snapshot, "primary"),
    normalizeWindow(snapshot?.secondary, snapshot, "secondary"),
  ].filter(Boolean);
}

function localDateKey(now) {
  const date = now instanceof Date ? now : new Date(now);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function normalizeUsageView(rateLimitResponse, tokenUsageResponse, now = new Date()) {
  const windows = windowsFromSnapshot(rateLimitResponse?.rateLimits);
  const seen = new Set(windows.map((item) => `${item.limitId || ""}:${item.position}:${item.windowDurationMins || ""}`));
  for (const snapshot of Object.values(rateLimitResponse?.rateLimitsByLimitId || {})) {
    for (const item of windowsFromSnapshot(snapshot)) {
      const key = `${item.limitId || ""}:${item.position}:${item.windowDurationMins || ""}`;
      if (!seen.has(key)) {
        seen.add(key);
        windows.push(item);
      }
    }
  }

  const buckets = Array.isArray(tokenUsageResponse?.dailyUsageBuckets) ? tokenUsageResponse.dailyUsageBuckets : null;
  const todayKey = localDateKey(now);
  const todayBucket = buckets?.find((item) => item?.startDate === todayKey);
  const todayTokens = buckets ? Math.max(0, Number(todayBucket?.tokens) || 0) : null;
  const lifetimeTokens = Number.isFinite(Number(tokenUsageResponse?.summary?.lifetimeTokens))
    ? Math.max(0, Number(tokenUsageResponse.summary.lifetimeTokens))
    : null;
  return {
    status: windows.length || todayTokens !== null ? "ready" : "unavailable",
    windows: windows.slice(0, 2).map(({ position, ...item }) => item),
    todayTokens,
    lifetimeTokens,
    fetchedAt: Date.now(),
    error: null,
  };
}

function formatMetricTokens(value) {
  if (!Number.isFinite(Number(value))) return "--";
  const number = Math.max(0, Number(value));
  if (number >= 1000000) return `${(number / 1000000).toFixed(number >= 10000000 ? 0 : 1).replace(/\.0$/, "")}m`;
  if (number >= 1000) return `${(number / 1000).toFixed(number >= 100000 ? 0 : 1).replace(/\.0$/, "")}k`;
  return String(Math.round(number));
}

function formatExactMetricTokens(value) {
  if (!Number.isFinite(Number(value))) return "--";
  return String(Math.round(Math.max(0, Number(value)))).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatMetricReset(timestamp, now = Date.now()) {
  if (!Number.isFinite(Number(timestamp)) || Number(timestamp) <= 0) return "重置时间未知";
  const minutes = Math.round(Math.max(0, Number(timestamp) * 1000 - now) / 60000);
  if (minutes < 60) return `${Math.max(1, minutes)}分钟后`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时后`;
  return `${Math.floor(hours / 24)}天后`;
}

export function toOfficialUsageSource(view, now = Date.now(), refreshMs = DEFAULT_REFRESH_MS) {
  const availableWindows = Array.isArray(view?.windows) ? view.windows : [];
  const windows = availableWindows.length > 1
    ? [availableWindows.reduce((shortest, item) => {
        const shortestDuration = Number(shortest?.windowDurationMins);
        const itemDuration = Number(item?.windowDurationMins);
        if (!Number.isFinite(itemDuration)) return shortest;
        if (!Number.isFinite(shortestDuration) || itemDuration < shortestDuration) return item;
        return shortest;
      })]
    : availableWindows;
  const metrics = [];
  for (const [index, item] of windows.entries()) {
    const id = index === 0 ? "primaryRemaining" : "secondaryRemaining";
    metrics.push({
      id,
      label: `${item.label} 剩余`,
      display: `${item.label} ${item.remainingPercent === null ? "--" : `${Math.round(item.remainingPercent)}%`}`,
      detail: `${item.label} 剩余 ${item.remainingPercent === null ? "--" : `${Math.round(item.remainingPercent)}%`}`,
      value: item.remainingPercent === null ? "--" : `${Math.round(item.remainingPercent)}%`,
      defaultVisible: index === 0,
    });
    metrics.push({
      id: index === 0 ? "primaryReset" : "secondaryReset",
      label: `${item.label} 重置`,
      display: `${item.label} ${formatMetricReset(item.resetsAt, now)}`,
      detail: `${item.label}：${formatMetricReset(item.resetsAt, now)}`,
      value: formatMetricReset(item.resetsAt, now),
      defaultVisible: false,
    });
  }
  if (view?.todayTokens !== null && view?.todayTokens !== undefined) {
    metrics.push({
      id: "todayTokens",
      label: "今日 token",
      display: `今日 ${formatMetricTokens(view.todayTokens)}`,
      detail: `今日 token：${formatExactMetricTokens(view.todayTokens)}`,
      value: formatExactMetricTokens(view.todayTokens),
      defaultVisible: true,
    });
  }
  if (view?.lifetimeTokens !== null && view?.lifetimeTokens !== undefined) {
    metrics.push({
      id: "lifetimeTokens",
      label: "累计 token",
      display: `累计 ${formatMetricTokens(view.lifetimeTokens)}`,
      detail: `累计 token：${formatExactMetricTokens(view.lifetimeTokens)}`,
      value: formatExactMetricTokens(view.lifetimeTokens),
      defaultVisible: false,
    });
  }
  return {
    id: "official",
    label: "官方订阅",
    accountType: "subscription",
    status: view?.status || "unavailable",
    error: view?.error || null,
    fetchedAt: view?.fetchedAt || null,
    nextRefreshAt: view?.fetchedAt ? Number(view.fetchedAt) + refreshMs : null,
    metrics,
  };
}

function readApiPayload(response, root) {
  if (!response || typeof response !== "object") return null;
  const value = readPath(response, root);
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function readMapped(value, selector) {
  return selector ? readPath(value, selector) : undefined;
}

function formatApiQuota(value, quotaPerUnit, symbol, decimals = 1) {
  if (!Number.isFinite(Number(value))) return "--";
  const amount = Math.max(0, Number(value)) / quotaPerUnit;
  return `${symbol}${amount.toFixed(decimals)}`;
}

function parseApiBoolean(value) {
  if (value === true || value === 1) return true;
  if (typeof value !== "string") return false;
  return ["true", "1", "yes"].includes(value.trim().toLowerCase());
}

function formatApiExpiry(value, now) {
  if (value == null || value === "" || Number(value) === 0) return "永久";
  const numeric = Number(value);
  const expiresAt = Number.isFinite(numeric)
    ? numeric > 100000000000 ? numeric : numeric * 1000
    : Date.parse(String(value));
  if (!Number.isFinite(expiresAt) || expiresAt <= 0) return "永久";
  const days = Math.max(0, Math.ceil((expiresAt - now) / 86400000));
  return `${days}天后`;
}

export function normalizeApiUsageView(response, statusResponse, provider = CCTQ_PROVIDER, now = Date.now(), refreshMs = DEFAULT_REFRESH_MS) {
  const config = validateApiProviderConfig(provider);
  const data = readApiPayload(response, config.response.usageRoot);
  const status = readApiPayload(statusResponse, config.response.statusRoot) || data || {};
  if (!data) {
    return {
      id: config.id,
      label: config.label,
      accountType: "api-key",
      status: "unavailable",
      error: `${config.label} 用量接口暂不可用`,
      fetchedAt: null,
      metrics: [],
    };
  }
  const responseConfig = config.response;
  const mappedQuotaPerUnit = readMapped(status, responseConfig.quotaPerUnit);
  const quotaPerUnit = Number(mappedQuotaPerUnit) > 0
    ? Number(mappedQuotaPerUnit)
    : Number(responseConfig.defaultQuotaPerUnit) > 0 ? Number(responseConfig.defaultQuotaPerUnit) : 1;
  const currency = String(readMapped(status, responseConfig.currency) ?? responseConfig.defaultCurrency ?? "").toUpperCase();
  const symbol = currency === "CNY" ? "¥" : currency === "USD" ? "$" : currency ? `${currency} ` : "";
  const grantedRaw = responseConfig.limit ? readPath(data, responseConfig.limit) : null;
  const granted = Number(grantedRaw);
  const used = Number(readPath(data, responseConfig.used));
  const unlimited = responseConfig.unlimited
    ? parseApiBoolean(readMapped(data, responseConfig.unlimited))
    : !responseConfig.limit;
  const usedValue = formatApiQuota(used, quotaPerUnit, symbol);
  const limitValue = unlimited ? "不限" : formatApiQuota(granted, quotaPerUnit, symbol);
  const expiryValue = formatApiExpiry(readMapped(data, responseConfig.expiresAt), now);
  const metrics = [
    {
      id: "usedAmount",
      label: "已用额度",
      value: usedValue,
      display: `已用 ${usedValue}`,
      detail: `已用额度：${usedValue}`,
      defaultVisible: true,
    },
    {
      id: "quotaLimit",
      label: "限额",
      value: limitValue,
      display: `限额 ${limitValue}`,
      detail: `限额：${limitValue}`,
      defaultVisible: true,
    },
    {
      id: "expiresAt",
      label: "到期时间",
      value: expiryValue,
      display: `到期 ${expiryValue}`,
      detail: `到期时间：${expiryValue}`,
      defaultVisible: false,
    },
  ];
  return {
    id: config.id,
    label: config.label,
    accountType: "api-key",
    status: "ready",
    error: null,
    fetchedAt: now,
    nextRefreshAt: now + refreshMs,
    metrics,
  };
}

export function normalizeCctqUsageView(response, statusResponse, now = Date.now(), refreshMs = DEFAULT_REFRESH_MS) {
  return normalizeApiUsageView(response, statusResponse, CCTQ_PROVIDER, now, refreshMs);
}

function resolveApiKey(explicit) {
  const candidates = [explicit, process.env.CODEX_USAGE_API_KEY, process.env.CCTQ_USAGE_API_KEY, process.env.CCTQ_API_KEY];
  return candidates.find((value) => typeof value === "string" && value.trim().length > 0)?.trim() || null;
}

function resolveApiAccountToken(explicit) {
  const candidates = [explicit, process.env.CODEX_USAGE_ACCOUNT_TOKEN];
  return candidates.find((value) => typeof value === "string" && value.trim().length > 0)?.trim() || null;
}

function resolveApiAccountUserId(explicit) {
  const candidates = [explicit, process.env.CODEX_USAGE_ACCOUNT_USER_ID];
  return candidates.find((value) => typeof value === "string" && /^[1-9][0-9]{0,19}$/.test(value.trim()))?.trim() || null;
}

function formatAccountQuota(value, decimals = 1) {
  return formatApiQuota(value, CCTQ_PROVIDER.response.defaultQuotaPerUnit, "¥", decimals);
}

function formatAccountTokens(value) {
  if (!Number.isFinite(Number(value))) return "--";
  const number = Math.max(0, Number(value));
  if (number >= 100000000) return `${(number / 100000000).toFixed(2)}亿`;
  if (number >= 10000) return `${Math.round(number / 10000)}万`;
  return formatExactMetricTokens(number);
}

function normalizeLogTimestamp(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric > 100000000000 ? numeric : numeric * 1000;
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function localStartOfDay(timestamp) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function formatAccountTime(value) {
  const timestamp = normalizeLogTimestamp(value);
  if (!timestamp) return "--";
  const date = new Date(timestamp);
  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function encodeLogIdentityPart(value) {
  return encodeURIComponent(String(value ?? ""));
}

export function accountLogIdentity(item) {
  const stableIdFields = ["request_id", "requestId", "log_id", "logId", "trace_id", "traceId", "uuid"];
  for (const field of stableIdFields) {
    if (item?.[field] != null && String(item[field]).trim()) {
      return `${field}:${encodeLogIdentityPart(item[field])}`;
    }
  }
  // CCTQ's generic `id` is a page-row identifier and is reused for different requests.
  return `record:${[
    item?.created_at,
    Math.max(0, Number(item?.prompt_tokens) || 0),
    Math.max(0, Number(item?.completion_tokens) || 0),
    item?.quota,
    item?.model_name,
    item?.use_time,
  ].map(encodeLogIdentityPart).join("|")}`;
}

function resolveAccountCounterPath(explicit) {
  if (explicit) return path.resolve(explicit);
  return process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, "CodexUsageMonitor", "account-token-counter.json")
    : null;
}

function loadAccountCounter(counterPath) {
  if (!counterPath || !existsSync(counterPath)) return null;
  try {
    const value = JSON.parse(readFileSync(counterPath, "utf8"));
    if (![1, 2, 3, 4, ACCOUNT_COUNTER_SCHEMA_VERSION].includes(value?.schemaVersion) || !Number.isSafeInteger(value.totalTokens) || value.totalTokens < 0) return null;
    const legacy = value.schemaVersion < ACCOUNT_COUNTER_SCHEMA_VERSION;
    const initialTokens = Number.isSafeInteger(value.initialTokens) && value.initialTokens >= 0 ? value.initialTokens : value.totalTokens;
    const checkpointAt = Math.max(0, Number(value.checkpointAt) || 0) + (legacy ? 1 : 0);
    return {
      schemaVersion: ACCOUNT_COUNTER_SCHEMA_VERSION,
      baselineConfigured: value.schemaVersion === 1 ? true : value.baselineConfigured !== false,
      initialTokens,
      totalTokens: Math.max(initialTokens, value.totalTokens),
      checkpointAt,
      recentLogIds: legacy ? [] : Array.isArray(value.recentLogIds) ? value.recentLogIds.filter((item) => typeof item === "string").slice(-CCTQ_ACCOUNT_MAX_LOG_IDS) : [],
      dailyDate: typeof value.dailyDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.dailyDate) ? value.dailyDate : null,
      dailyTokens: Number.isSafeInteger(value.dailyTokens) && value.dailyTokens >= 0 ? value.dailyTokens : 0,
      dailyCheckpointAt: legacy ? checkpointAt : Math.max(0, Number(value.dailyCheckpointAt) || 0),
      dailyLogIds: legacy ? [] : Array.isArray(value.dailyLogIds) ? value.dailyLogIds.filter((item) => typeof item === "string").slice(-CCTQ_ACCOUNT_MAX_LOG_IDS) : [],
      configuredAt: typeof value.configuredAt === "string" ? value.configuredAt : null,
      updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : null,
    };
  } catch {
    return null;
  }
}

function saveAccountCounter(counterPath, counter) {
  if (!counterPath || !counter) return;
  mkdirSync(path.dirname(counterPath), { recursive: true });
  const temporaryPath = `${counterPath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(counter, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, counterPath);
}

export function normalizeApiAccountView(profileResponse, logs, {
  now = Date.now(),
  refreshMs = DEFAULT_REFRESH_MS,
  truncated = false,
  cumulativeTokens = null,
  persistentTodayTokens = null,
} = {}) {
  const profile = profileResponse?.data && typeof profileResponse.data === "object" ? profileResponse.data : null;
  if (!profile) {
    return {
      id: "api-account",
      label: "API 账户",
      accountType: "api-account",
      status: "unavailable",
      error: "未配置 API 账户令牌",
      fetchedAt: null,
      nextRefreshAt: now + refreshMs,
      metrics: [],
    };
  }
  const items = Array.isArray(logs) ? logs.filter((item) => item && typeof item === "object") : [];
  const latest = [...items].sort((left, right) => (normalizeLogTimestamp(right.created_at) || 0) - (normalizeLogTimestamp(left.created_at) || 0))[0] || null;
  const dayStart = localStartOfDay(now);
  const visibleTokens = items.reduce((sum, item) => sum + Math.max(0, Number(item.prompt_tokens) || 0) + Math.max(0, Number(item.completion_tokens) || 0), 0);
  const totalTokens = Number.isSafeInteger(cumulativeTokens) && cumulativeTokens >= 0 ? cumulativeTokens : visibleTokens;
  const visibleDayTokens = items.reduce((sum, item) => {
    const timestamp = normalizeLogTimestamp(item.created_at);
    return timestamp && timestamp >= dayStart
      ? sum + Math.max(0, Number(item.prompt_tokens) || 0) + Math.max(0, Number(item.completion_tokens) || 0)
      : sum;
  }, 0);
  const dayTokens = Number.isSafeInteger(persistentTodayTokens) && persistentTodayTokens >= 0
    ? persistentTodayTokens
    : visibleDayTokens;
  const metrics = [
    { id: "balance", label: "账户余额", value: formatAccountQuota(profile.quota), display: `余额 ${formatAccountQuota(profile.quota)}`, defaultVisible: true },
    { id: "usedQuota", label: "累计已用额度", value: formatAccountQuota(profile.used_quota), display: `已用 ${formatAccountQuota(profile.used_quota)}`, defaultVisible: false },
    { id: "todayTokens", label: "今日 Token", value: formatAccountTokens(dayTokens), display: `今日 ${formatAccountTokens(dayTokens)}`, defaultVisible: false },
    { id: "totalTokens", label: "累计 Token", value: formatAccountTokens(totalTokens), display: `累计 ${formatAccountTokens(totalTokens)}`, defaultVisible: false },
    { id: "lastQuota", label: "上次消耗额度", value: latest ? formatAccountQuota(latest.quota, 3) : "--", display: `消耗 ${latest ? formatAccountQuota(latest.quota, 3) : "--"}`, defaultVisible: false },
    { id: "lastModel", label: "上次响应模型", value: typeof latest?.model_name === "string" && latest.model_name.trim() ? latest.model_name.trim() : "--", display: `模型 ${typeof latest?.model_name === "string" && latest.model_name.trim() ? latest.model_name.trim() : "--"}`, defaultVisible: false },
    { id: "lastRequestAt", label: "上次请求时间", value: formatAccountTime(latest?.created_at), display: `请求 ${formatAccountTime(latest?.created_at)}`, defaultVisible: false },
    { id: "lastLatency", label: "上次响应耗时", value: Number.isFinite(Number(latest?.use_time)) ? `${Math.max(0, Number(latest.use_time))}ms` : "--", display: `耗时 ${Number.isFinite(Number(latest?.use_time)) ? `${Math.max(0, Number(latest.use_time))}ms` : "--"}`, defaultVisible: false },
  ];
  return {
    id: "api-account",
    label: "API 账户",
    accountType: "api-account",
    status: "ready",
    error: truncated ? "日志分页未覆盖上次检查点，Token 账本保留原值" : null,
    fetchedAt: now,
    nextRefreshAt: now + refreshMs,
    metrics,
  };
}

export class ApiUsageClient {
  constructor({ provider = loadApiProviderConfig(), apiKey = resolveApiKey(), refreshMs = DEFAULT_REFRESH_MS, managed = false, now = () => Date.now(), onUpdate = () => {} } = {}) {
    this.provider = validateApiProviderConfig(provider);
    this.baseUrl = this.provider.baseUrl;
    this.apiKey = apiKey;
    this.refreshMs = refreshMs;
    this.managed = managed;
    this.now = now;
    this.onUpdate = onUpdate;
    this.timer = null;
    this.refreshing = null;
    this.stopped = true;
    this.statusResponse = null;
    this.rateLimitFailures = 0;
    this.retryAt = 0;
    this.view = normalizeApiUsageView(null, null, this.provider);
  }

  emit(view) {
    this.view = view;
    this.onUpdate(view);
  }

  async requestJson(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          [this.provider.auth.header]: `${this.provider.auth.scheme ? `${this.provider.auth.scheme} ` : ""}${this.apiKey}`,
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        const error = new Error(`${this.provider.label} 用量接口返回 HTTP ${response.status}`);
        error.status = response.status;
        const retryAfter = response.headers.get("retry-after");
        const seconds = Number(retryAfter);
        if (retryAfter && Number.isFinite(seconds) && seconds >= 0) error.retryAfterMs = seconds * 1000;
        else if (retryAfter) {
          const timestamp = Date.parse(retryAfter);
          if (Number.isFinite(timestamp)) error.retryAfterMs = Math.max(0, timestamp - this.now());
        }
        throw error;
      }
      const declaredLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > 2 * 1024 * 1024) throw new Error(`${this.provider.label} 响应过大`);
      const body = await response.text();
      if (body.length > 2 * 1024 * 1024) throw new Error(`${this.provider.label} 响应过大`);
      return JSON.parse(body);
    } finally {
      clearTimeout(timer);
    }
  }

  async refresh() {
    if (this.refreshing) return this.refreshing;
    const operation = (async () => {
      const now = this.now();
      if (!this.apiKey) {
        this.emit({ ...this.view, status: "unavailable", error: `未配置 ${this.provider.label} API key`, nextRefreshAt: now + this.refreshMs });
        return;
      }
      if (this.retryAt > now) {
        this.emit({ ...this.view, status: "rate-limited", error: `${this.provider.label} 请求受限（HTTP 429），稍后自动重试`, nextRefreshAt: this.retryAt });
        return;
      }
      try {
        const [usageResult, statusResult] = await Promise.allSettled([
          this.requestJson(new URL(this.provider.requests.usagePath, `${this.baseUrl}/`).toString()),
          this.provider.requests.statusPath
            ? this.requestJson(new URL(this.provider.requests.statusPath, `${this.baseUrl}/`).toString())
            : Promise.resolve(null),
        ]);
        if (statusResult.status === "fulfilled" && statusResult.value !== null) this.statusResponse = statusResult.value;
        if (usageResult.status === "rejected") throw usageResult.reason;
        const usageResponse = usageResult.value;
        const statusResponse = statusResult.status === "fulfilled" ? statusResult.value : this.statusResponse;
        this.rateLimitFailures = 0;
        this.retryAt = 0;
        this.emit(normalizeApiUsageView(usageResponse, statusResponse, this.provider, this.now(), this.refreshMs));
      } catch (error) {
        if (error?.status === 429) {
          this.rateLimitFailures += 1;
          const fallback = Math.min(RATE_LIMIT_BASE_BACKOFF_MS * (2 ** (this.rateLimitFailures - 1)), RATE_LIMIT_MAX_BACKOFF_MS);
          const delay = Math.min(Math.max(Number(error.retryAfterMs) || fallback, this.refreshMs), RATE_LIMIT_MAX_BACKOFF_MS);
          this.retryAt = this.now() + delay;
          this.emit({ ...this.view, status: "rate-limited", error: `${this.provider.label} 请求受限（HTTP 429），稍后自动重试`, nextRefreshAt: this.retryAt });
        } else {
          this.emit({ ...this.view, status: "error", error: `${this.provider.label} 用量接口请求失败`, nextRefreshAt: this.now() + this.refreshMs });
        }
      }
    })();
    this.refreshing = operation;
    try {
      return await operation;
    } finally {
      if (this.refreshing === operation) this.refreshing = null;
    }
  }

  async start() {
    if (!this.stopped) return this.view;
    this.stopped = false;
    this.emit({ ...this.view, status: "loading", error: null });
    await this.refresh();
    if (!this.managed) {
      this.timer = setInterval(() => this.refresh().catch(() => {}), this.refreshMs);
      this.timer.unref?.();
    }
    return this.view;
  }

  async stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

export class CctqUsageClient extends ApiUsageClient {
  constructor(options = {}) {
    super({ ...options, provider: CCTQ_PROVIDER, apiKey: options.apiKey ?? resolveApiKey() });
  }
}

export class ApiAccountUsageClient {
  constructor({
    baseUrl = process.env.CODEX_USAGE_ACCOUNT_BASE_URL || CCTQ_DEFAULT_BASE_URL,
    token = resolveApiAccountToken(),
    userId = resolveApiAccountUserId(),
    counterPath = resolveAccountCounterPath(process.env.CODEX_USAGE_ACCOUNT_COUNTER_PATH),
    refreshMs = DEFAULT_REFRESH_MS,
    managed = false,
    now = () => Date.now(),
    onUpdate = () => {},
  } = {}) {
    const parsedBaseUrl = new URL(baseUrl);
    if (!/^https?:$/.test(parsedBaseUrl.protocol) || parsedBaseUrl.username || parsedBaseUrl.password) throw new Error("API 账户 BaseUrl 无效");
    this.baseUrl = parsedBaseUrl.toString().replace(/\/$/, "");
    this.token = token;
    this.userId = userId;
    this.counterPath = resolveAccountCounterPath(counterPath);
    this.counter = loadAccountCounter(this.counterPath);
    this.refreshMs = refreshMs;
    this.managed = managed;
    this.now = typeof now === "function" ? now : () => Date.now();
    this.onUpdate = onUpdate;
    this.timer = null;
    this.refreshing = null;
    this.stopped = true;
    this.cachedLogs = [];
    this.view = normalizeApiAccountView(null, [], { refreshMs });
  }

  updateCounter(logs) {
    const now = this.now();
    const nowIso = new Date(now).toISOString();
    const today = localDateKey(now);
    if (!this.counter) {
      this.counter = {
        schemaVersion: ACCOUNT_COUNTER_SCHEMA_VERSION,
        baselineConfigured: false,
        initialTokens: 0,
        totalTokens: 0,
        checkpointAt: 0,
        recentLogIds: [],
        dailyDate: today,
        dailyTokens: 0,
        dailyCheckpointAt: localStartOfDay(now),
        dailyLogIds: [],
        configuredAt: nowIso,
        updatedAt: nowIso,
      };
    }
    let recent = new Set(this.counter.recentLogIds);
    let dailyRecent = new Set(this.counter.dailyLogIds);
    let checkpointAt = this.counter.checkpointAt;
    let dailyCheckpointAt = this.counter.dailyCheckpointAt;
    let totalTokens = this.counter.totalTokens;
    let dailyTokens = this.counter.dailyTokens;
    let changed = this.counter.schemaVersion !== ACCOUNT_COUNTER_SCHEMA_VERSION;
    if (this.counter.dailyDate !== today) {
      dailyRecent = new Set();
      dailyTokens = 0;
      dailyCheckpointAt = localStartOfDay(now);
      changed = true;
    }
    const ordered = [...logs].sort((left, right) => (normalizeLogTimestamp(left?.created_at) || 0) - (normalizeLogTimestamp(right?.created_at) || 0));
    for (const item of ordered) {
      const timestamp = normalizeLogTimestamp(item?.created_at);
      if (!timestamp) continue;
      const identity = accountLogIdentity(item);
      const tokens = Math.max(0, Number(item?.prompt_tokens) || 0) + Math.max(0, Number(item?.completion_tokens) || 0);
      if (localDateKey(timestamp) === today && timestamp >= dailyCheckpointAt) {
        if (timestamp > dailyCheckpointAt) {
          dailyCheckpointAt = timestamp;
          dailyRecent = new Set();
        }
        if (!dailyRecent.has(identity)) {
          dailyTokens += tokens;
          dailyRecent.add(identity);
          changed = true;
        }
      }
      if (timestamp >= checkpointAt) {
        if (timestamp > checkpointAt) {
          checkpointAt = timestamp;
          recent = new Set();
        }
        if (!recent.has(identity)) {
          totalTokens += tokens;
          recent.add(identity);
          changed = true;
        }
      }
    }
    if (changed) {
      this.counter = {
        ...this.counter,
        schemaVersion: ACCOUNT_COUNTER_SCHEMA_VERSION,
        totalTokens,
        checkpointAt,
        recentLogIds: [...recent].slice(-CCTQ_ACCOUNT_MAX_LOG_IDS),
        dailyDate: today,
        dailyTokens,
        dailyCheckpointAt,
        dailyLogIds: [...dailyRecent].slice(-CCTQ_ACCOUNT_MAX_LOG_IDS),
        updatedAt: nowIso,
      };
      saveAccountCounter(this.counterPath, this.counter);
    }
    return { totalTokens: this.counter.totalTokens, dailyTokens: this.counter.dailyTokens };
  }

  emit(view) {
    this.view = view;
    this.onUpdate(view);
  }

  async requestJson(pathname, searchParams = null) {
    const url = new URL(pathname, `${this.baseUrl}/`);
    if (searchParams) {
      for (const [key, value] of Object.entries(searchParams)) url.searchParams.set(key, String(value));
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.token}`,
          "New-Api-User": this.userId,
        },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`API 账户接口返回 HTTP ${response.status}`);
      const declaredLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > 2 * 1024 * 1024) throw new Error("API 账户响应过大");
      const body = await response.text();
      if (body.length > 2 * 1024 * 1024) throw new Error("API 账户响应过大");
      return JSON.parse(body);
    } finally {
      clearTimeout(timer);
    }
  }

  requiredLogCheckpoint() {
    if (!this.counter) return 0;
    const now = this.now();
    const today = localDateKey(now);
    const dailyCheckpoint = this.counter.dailyDate === today
      ? Math.max(0, Number(this.counter.dailyCheckpointAt) || 0)
      : localStartOfDay(now);
    return Math.min(Math.max(0, Number(this.counter.checkpointAt) || 0), dailyCheckpoint);
  }

  async readLogs() {
    const response = await this.requestJson("/api/log/self", { p: 1, size: CCTQ_ACCOUNT_PAGE_SIZE });
    const data = response?.data && typeof response.data === "object" ? response.data : response;
    const items = Array.isArray(data?.items) ? [...data.items] : [];
    const total = Math.max(items.length, Number(data?.total) || 0);
    const pageSize = Math.max(1, Number(data?.page_size) || CCTQ_ACCOUNT_PAGE_SIZE);
    const pageCount = Math.ceil(total / pageSize);
    const availablePages = Math.min(pageCount, CCTQ_ACCOUNT_MAX_PAGES);
    const requiredCheckpoint = this.requiredLogCheckpoint();
    const reachesCheckpoint = (pageItems) => requiredCheckpoint > 0 && pageItems.some((item) => {
      const timestamp = normalizeLogTimestamp(item?.created_at);
      return timestamp > 0 && timestamp <= requiredCheckpoint;
    });
    let reachedCheckpoint = reachesCheckpoint(items);
    let historyFailed = false;
    if (!reachedCheckpoint && availablePages > 1) {
      const pendingPages = Array.from({ length: availablePages - 1 }, (_, index) => index + 2);
      const historyResults = await Promise.allSettled(pendingPages.map((page) =>
        this.requestJson("/api/log/self", { p: page, size: CCTQ_ACCOUNT_PAGE_SIZE })));
      for (const result of historyResults) {
        if (result.status === "rejected") {
          historyFailed = true;
          continue;
        }
        const historyData = result.value?.data && typeof result.value.data === "object" ? result.value.data : result.value;
        const historyItems = Array.isArray(historyData?.items) ? historyData.items : [];
        items.push(...historyItems);
        if (reachesCheckpoint(historyItems)) reachedCheckpoint = true;
      }
    }
    const complete = !historyFailed && (requiredCheckpoint === 0
      ? availablePages === pageCount
      : reachedCheckpoint || availablePages === 1);
    return { items, truncated: !complete || pageCount > CCTQ_ACCOUNT_MAX_PAGES, complete };
  }

  async refresh() {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      if (!this.token || !this.userId) {
        this.emit({ ...this.view, status: "unavailable", error: "未配置 API 账户令牌", nextRefreshAt: Date.now() + this.refreshMs });
        return;
      }
      try {
        const [profile, logResult] = await Promise.all([
          this.requestJson("/api/user/self"),
          this.readLogs(),
        ]);
        const merged = new Map();
        for (const item of logResult.items) merged.set(accountLogIdentity(item), item);
        this.cachedLogs = [...merged.values()];
        const counters = logResult.complete
          ? this.updateCounter(logResult.items)
          : this.counter && { totalTokens: this.counter.totalTokens, dailyTokens: this.counter.dailyTokens };
        const now = this.now();
        this.emit(normalizeApiAccountView(profile, this.cachedLogs, {
          now,
          refreshMs: this.refreshMs,
          truncated: logResult.truncated,
          cumulativeTokens: counters?.totalTokens ?? null,
          persistentTodayTokens: counters?.dailyTokens ?? null,
        }));
      } catch {
        this.emit({ ...this.view, status: "error", error: "API 账户接口请求失败", nextRefreshAt: Date.now() + this.refreshMs });
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  async start() {
    if (!this.stopped) return this.view;
    this.stopped = false;
    this.emit({ ...this.view, status: "loading", error: null });
    await this.refresh();
    if (!this.managed) {
      this.timer = setInterval(() => this.refresh().catch(() => {}), this.refreshMs);
      this.timer.unref?.();
    }
    return this.view;
  }

  async stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

export class CombinedUsageClient {
  constructor({ command = resolveCodexExecutable(), provider = loadApiProviderConfig(), refreshMs = DEFAULT_REFRESH_MS, onUpdate = () => {} } = {}) {
    this.onUpdate = onUpdate;
    this.refreshMs = refreshMs;
    this.timer = null;
    this.nextRefreshAt = null;
    this.officialView = { status: "loading", windows: [], todayTokens: null, lifetimeTokens: null, fetchedAt: null, error: null };
    this.accountView = normalizeApiAccountView(null, [], { refreshMs });
    this.apiView = normalizeApiUsageView(null, null, provider);
    this.official = new UsageClient({ command, refreshMs, managed: true, onUpdate: (view) => { this.officialView = view; this.emit(); } });
    this.account = new ApiAccountUsageClient({ refreshMs, managed: true, onUpdate: (view) => { this.accountView = view; this.emit(); } });
    this.api = new ApiUsageClient({ provider, refreshMs, managed: true, onUpdate: (view) => { this.apiView = view; this.emit(); } });
  }

  emit() {
    this.onUpdate({
      ...this.officialView,
      schemaVersion: 2,
      nextRefreshAt: this.nextRefreshAt,
      sources: {
        official: toOfficialUsageSource(this.officialView, Date.now(), this.refreshMs),
        "api-account": this.accountView,
        [this.apiView.id]: this.apiView,
      },
    });
  }

  async start() {
    await Promise.all([this.official.start(), this.account.start(), this.api.start()]);
    this.nextRefreshAt = Date.now() + this.refreshMs;
    this.timer = setInterval(() => {
      this.nextRefreshAt = Date.now() + this.refreshMs;
      this.emit();
      Promise.all([this.official.refresh(), this.account.refresh(), this.api.refresh()]).catch(() => {});
    }, this.refreshMs);
    this.timer.unref?.();
    this.emit();
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await Promise.all([this.official.stop(), this.account.stop(), this.api.stop()]);
  }
}

export function mergeRateLimitSnapshot(previous, patch) {
  if (!previous || typeof previous !== "object") return patch && typeof patch === "object" ? { ...patch } : previous;
  if (!patch || typeof patch !== "object") return { ...previous };
  const merged = { ...previous };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined) continue;
    if (["primary", "secondary", "credits", "individualLimit"].includes(key) && typeof value === "object") {
      merged[key] = { ...(previous[key] || {}), ...value };
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

export function resolveCodexExecutable(explicitPath = process.env.CODEX_USAGE_CODEX_PATH || process.env.CODEX_DREAM_SKIN_CODEX_PATH) {
  const candidates = [
    explicitPath,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Programs", "OpenAI Codex CLI", "codex.exe") : null,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Programs", "OpenAI Codex CLI", "codex") : null,
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) || "codex";
}

class AppServerRpc {
  constructor({ command, requestTimeoutMs = REQUEST_TIMEOUT_MS, onNotification = () => {}, onExit = () => {} }) {
    this.command = command;
    this.requestTimeoutMs = requestTimeoutMs;
    this.onNotification = onNotification;
    this.onExit = onExit;
    this.child = null;
    this.nextId = 1;
    this.pending = new Map();
    this.stdoutBuffer = "";
    this.lastStderr = "";
    this.stopping = false;
  }

  async start() {
    if (this.child && this.child.exitCode === null) return;
    this.stopping = false;
    const child = spawn(this.command, ["app-server", "--listen", "stdio://"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    });
    this.child = child;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => this.handleStdout(chunk));
    child.stderr.on("data", (chunk) => {
      const lines = String(chunk).trim().split(/\r?\n/).filter(Boolean);
      if (lines.length) this.lastStderr = lines.at(-1).slice(0, 300);
    });
    child.on("error", (error) => this.failAll(error));
    child.on("exit", (code, signal) => {
      const detail = this.lastStderr || `app-server exited (${code ?? signal ?? "unknown"})`;
      const error = new Error(detail);
      this.failAll(error);
      this.child = null;
      if (!this.stopping) this.onExit(error);
    });

    await this.request("initialize", {
      clientInfo: { name: "codex-usage-monitor", title: "Codex Usage Monitor", version: "1.0.0" },
      capabilities: { optOutNotificationMethods: [] },
    });
    this.notify("initialized");
  }

  handleStdout(chunk) {
    this.stdoutBuffer += String(chunk);
    while (true) {
      const newline = this.stdoutBuffer.indexOf("\n");
      if (newline < 0) break;
      const line = this.stdoutBuffer.slice(0, newline).replace(/\r$/, "");
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (!line.trim()) continue;
      let message;
      try { message = parseAppServerLine(line); } catch { continue; }
      this.handleMessage(message);
    }
  }

  handleMessage(message) {
    if (Object.prototype.hasOwnProperty.call(message, "id")) {
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      clearTimeout(waiter.timer);
      if (message.error) waiter.reject(new Error(message.error.message || "App-server request failed."));
      else waiter.resolve(message.result);
      return;
    }
    if (typeof message.method === "string") this.onNotification(message.method, message.params || {});
  }

  request(method, params) {
    if (!this.child?.stdin?.writable) return Promise.reject(new Error("App-server is not connected."));
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        if (!this.pending.delete(id)) return;
        reject(new Error(`${method} timed out after ${this.requestTimeoutMs} ms`));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      const message = params === undefined ? { id, method } : { id, method, params };
      this.child.stdin.write(`${JSON.stringify(message)}\n`);
    });
  }

  notify(method, params) {
    if (!this.child?.stdin?.writable) return false;
    const message = params === undefined ? { method } : { method, params };
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
    return true;
  }

  failAll(error) {
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.pending.clear();
  }

  async stop() {
    this.stopping = true;
    const child = this.child;
    this.child = null;
    this.failAll(new Error("App-server stopped."));
    if (!child || child.exitCode !== null) return;
    try { child.stdin.end(); } catch {}
    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      child.once("exit", finish);
      const timer = setTimeout(() => {
        try { child.kill(); } catch {}
        finish();
      }, 750);
    });
  }
}

export class UsageClient {
  constructor({ command = resolveCodexExecutable(), refreshMs = DEFAULT_REFRESH_MS, managed = false, onUpdate = () => {} } = {}) {
    this.command = command;
    this.refreshMs = refreshMs;
    this.managed = managed;
    this.onUpdate = onUpdate;
    this.rpc = null;
    this.timer = null;
    this.refreshing = null;
    this.rateLimits = null;
    this.tokenUsage = null;
    this.view = { status: "loading", windows: [], todayTokens: null, lifetimeTokens: null, fetchedAt: null, error: null };
    this.stopped = true;
  }

  emit(view) {
    this.view = view;
    this.onUpdate(view);
  }

  async ensureConnected() {
    if (this.rpc) return this.rpc;
    const rpc = new AppServerRpc({
      command: this.command,
      onNotification: (method, params) => this.handleNotification(method, params),
      onExit: (error) => {
        if (this.rpc === rpc) this.rpc = null;
        this.emitFailure(error);
      },
    });
    await rpc.start();
    this.rpc = rpc;
    return rpc;
  }

  handleNotification(method, params) {
    if (method !== "account/rateLimits/updated" || !params?.rateLimits) return;
    const previous = this.rateLimits?.rateLimits || null;
    const rateLimits = mergeRateLimitSnapshot(previous, params.rateLimits);
    const byId = { ...(this.rateLimits?.rateLimitsByLimitId || {}) };
    if (rateLimits?.limitId) byId[rateLimits.limitId] = mergeRateLimitSnapshot(byId[rateLimits.limitId], rateLimits);
    this.rateLimits = { ...(this.rateLimits || {}), rateLimits, rateLimitsByLimitId: Object.keys(byId).length ? byId : null };
    this.emit(normalizeUsageView(this.rateLimits, this.tokenUsage));
  }

  emitFailure(error) {
    const hasData = this.view.windows?.length || this.view.todayTokens !== null;
    this.emit({
      ...this.view,
      status: hasData ? "stale" : "error",
      error: error?.message || "Codex 用量暂时不可用",
    });
  }

  async refresh() {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      try {
        const rpc = await this.ensureConnected();
        const [limitsResult, usageResult] = await Promise.allSettled([
          rpc.request("account/rateLimits/read"),
          rpc.request("account/usage/read"),
        ]);
        if (limitsResult.status === "fulfilled") this.rateLimits = limitsResult.value;
        if (usageResult.status === "fulfilled") this.tokenUsage = usageResult.value;
        if (limitsResult.status === "rejected" && usageResult.status === "rejected") throw limitsResult.reason;
        this.emit(normalizeUsageView(this.rateLimits, this.tokenUsage));
      } catch (error) {
        if (this.rpc) {
          await this.rpc.stop().catch(() => {});
          this.rpc = null;
        }
        this.emitFailure(error);
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  async start() {
    if (!this.stopped) return this.view;
    this.stopped = false;
    this.emit({ ...this.view, status: "loading", error: null });
    await this.refresh();
    if (!this.managed) {
      this.timer = setInterval(() => this.refresh().catch(() => {}), this.refreshMs);
      this.timer.unref?.();
    }
    return this.view;
  }

  async stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const rpc = this.rpc;
    this.rpc = null;
    if (rpc) await rpc.stop();
  }
}
