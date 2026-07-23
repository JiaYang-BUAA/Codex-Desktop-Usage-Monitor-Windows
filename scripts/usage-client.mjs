import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const DEFAULT_REFRESH_MS = 90000;
const REQUEST_TIMEOUT_MS = 12000;
const CCTQ_DEFAULT_BASE_URL = "https://www.cctq.ai";
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

function formatApiQuota(value, quotaPerUnit, symbol) {
  if (!Number.isFinite(Number(value))) return "--";
  const amount = Math.max(0, Number(value)) / quotaPerUnit;
  const decimals = amount >= 100 ? 0 : amount >= 10 ? 1 : 2;
  return `${symbol}${amount.toFixed(decimals).replace(/\.0+$|(?<=\.\d)0+$/, "")}`;
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

export class ApiUsageClient {
  constructor({ provider = loadApiProviderConfig(), apiKey = resolveApiKey(), refreshMs = DEFAULT_REFRESH_MS, onUpdate = () => {} } = {}) {
    this.provider = validateApiProviderConfig(provider);
    this.baseUrl = this.provider.baseUrl;
    this.apiKey = apiKey;
    this.refreshMs = refreshMs;
    this.onUpdate = onUpdate;
    this.timer = null;
    this.refreshing = null;
    this.stopped = true;
    this.statusResponse = null;
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
      if (!response.ok) throw new Error(`${this.provider.label} 用量接口返回 HTTP ${response.status}`);
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
    this.refreshing = (async () => {
      if (!this.apiKey) {
        this.emit({ ...this.view, status: "unavailable", error: `未配置 ${this.provider.label} API key`, nextRefreshAt: Date.now() + this.refreshMs });
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
        this.emit(normalizeApiUsageView(usageResponse, statusResponse, this.provider, Date.now(), this.refreshMs));
      } catch {
        this.emit({ ...this.view, status: "error", error: `${this.provider.label} 用量接口请求失败`, nextRefreshAt: Date.now() + this.refreshMs });
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
    this.timer = setInterval(() => this.refresh().catch(() => {}), this.refreshMs);
    this.timer.unref?.();
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

export class CombinedUsageClient {
  constructor({ command = resolveCodexExecutable(), provider = loadApiProviderConfig(), refreshMs = DEFAULT_REFRESH_MS, onUpdate = () => {} } = {}) {
    this.onUpdate = onUpdate;
    this.refreshMs = refreshMs;
    this.officialView = { status: "loading", windows: [], todayTokens: null, lifetimeTokens: null, fetchedAt: null, error: null };
    this.apiView = normalizeApiUsageView(null, null, provider);
    this.official = new UsageClient({ command, refreshMs, onUpdate: (view) => { this.officialView = view; this.emit(); } });
    this.api = new ApiUsageClient({ provider, refreshMs, onUpdate: (view) => { this.apiView = view; this.emit(); } });
  }

  emit() {
    this.onUpdate({
      ...this.officialView,
      schemaVersion: 2,
      sources: {
        official: toOfficialUsageSource(this.officialView, Date.now(), this.refreshMs),
        [this.apiView.id]: this.apiView,
      },
    });
  }

  async start() {
    await Promise.all([this.official.start(), this.api.start()]);
    this.emit();
  }

  async stop() {
    await Promise.all([this.official.stop(), this.api.stop()]);
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
  constructor({ command = resolveCodexExecutable(), refreshMs = DEFAULT_REFRESH_MS, onUpdate = () => {} } = {}) {
    this.command = command;
    this.refreshMs = refreshMs;
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
    this.timer = setInterval(() => this.refresh().catch(() => {}), this.refreshMs);
    this.timer.unref?.();
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
