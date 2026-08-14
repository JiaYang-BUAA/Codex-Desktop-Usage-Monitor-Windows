(() => {
  const modules = window.__CODEX_USAGE_MONITOR_MODULES__;
  if (!modules?.constants || !modules?.i18n || !modules?.placement) {
    throw new Error("Codex Usage Monitor modules are incomplete.");
  }
  const {
    VERSION, STATE_KEY, USAGE_KEY, HOST_ID, SETTINGS_KEY, PREVIOUS_SETTINGS_KEY,
    PERSISTED_SETTINGS_KEY, SETTINGS_BINDING, CONFIGURATION_KEY, CONFIGURATION_BINDING,
    REFRESH_INTERVAL_MS, LAYOUT_FALLBACK_INTERVAL_MS, COUNTDOWN_INTERVAL_MS,
    PLACEMENT_DEBOUNCE_MS, MAX_SELECTED_METRICS,
    MAX_MINIMAL_SELECTED_METRICS,
  } = modules.constants;
  const { createTranslator } = modules.i18n;
  const { findPlacement, configurePosition } = modules.placement;
  const TASK_METRIC_IDS = new Set(["currentTaskTokens", "lastTurnTokens"]);
  const TASK_METRIC_FALLBACKS = [
    { id: "currentTaskTokens", label: "当前任务累计 Token", display: "任务 --", value: "--", defaultVisible: false },
    { id: "lastTurnTokens", label: "上次对话消耗 Token", display: "上次 --", value: "--", defaultVisible: false },
  ];
  const DEFAULT_METRIC_SELECTIONS = Object.freeze({
    official: Object.freeze(["secondaryRemaining", "currentTaskTokens"]),
  });
  const CUSTOM_PROVIDER_DEFAULTS = Object.freeze({
    id: "custom", label: "API Key", baseUrl: "",
    usagePath: "", statusPath: "", authHeader: "Authorization", authScheme: "Bearer",
    usageRoot: "data", statusRoot: "data", used: "total_used", limit: "total_granted",
    unlimited: "unlimited", expiresAt: "expires_at", quotaPerUnit: "quota_per_unit",
    currency: "currency", defaultQuotaPerUnit: "1", defaultCurrency: "USD",
  });

  const previousUsage = window[STATE_KEY]?.usage || window[USAGE_KEY] || null;
  try { window[STATE_KEY]?.cleanup?.(); } catch {}

  const normalizeConfigurationSummary = (value) => {
    const source = value && typeof value === "object" ? value : {};
    const account = source.account && typeof source.account === "object" ? source.account : {};
    const provider = source.provider && typeof source.provider === "object" ? source.provider : {};
    const response = provider.response && typeof provider.response === "object" ? provider.response : {};
    return {
      account: {
        configured: Boolean(account.configured),
        baseUrl: typeof account.baseUrl === "string" ? account.baseUrl.slice(0, 2048) : "https://www.cctq.ai",
        userId: typeof account.userId === "string" ? account.userId.slice(0, 20) : "",
        baselineConfigured: Boolean(account.baselineConfigured),
        initialTokens: typeof account.initialTokens === "string" && /^\d{1,19}$/.test(account.initialTokens)
          ? account.initialTokens
          : finiteNumber(account.initialTokens) ? String(Math.max(0, Math.trunc(Number(account.initialTokens)))) : "0",
      },
      provider: {
        configured: Boolean(provider.configured),
        id: typeof provider.id === "string" ? provider.id.slice(0, 32) : CUSTOM_PROVIDER_DEFAULTS.id,
        label: typeof provider.label === "string" ? provider.label.slice(0, 24) : CUSTOM_PROVIDER_DEFAULTS.label,
        baseUrl: typeof provider.baseUrl === "string" ? provider.baseUrl.slice(0, 2048) : CUSTOM_PROVIDER_DEFAULTS.baseUrl,
        usagePath: typeof provider.requests?.usagePath === "string" ? provider.requests.usagePath.slice(0, 2048) : CUSTOM_PROVIDER_DEFAULTS.usagePath,
        statusPath: typeof provider.requests?.statusPath === "string" ? provider.requests.statusPath.slice(0, 2048) : "",
        authHeader: typeof provider.auth?.header === "string" ? provider.auth.header.slice(0, 128) : "Authorization",
        authScheme: typeof provider.auth?.scheme === "string" ? provider.auth.scheme.slice(0, 32) : "Bearer",
        usageRoot: typeof response.usageRoot === "string" ? response.usageRoot.slice(0, 256) : "data",
        statusRoot: typeof response.statusRoot === "string" ? response.statusRoot.slice(0, 256) : "data",
        used: typeof response.used === "string" ? response.used.slice(0, 256) : "total_used",
        limit: typeof response.limit === "string" ? response.limit.slice(0, 256) : "total_granted",
        unlimited: typeof response.unlimited === "string" ? response.unlimited.slice(0, 256) : CUSTOM_PROVIDER_DEFAULTS.unlimited,
        expiresAt: typeof response.expiresAt === "string" ? response.expiresAt.slice(0, 256) : "expires_at",
        quotaPerUnit: typeof response.quotaPerUnit === "string" ? response.quotaPerUnit.slice(0, 256) : "quota_per_unit",
        currency: typeof response.currency === "string" ? response.currency.slice(0, 256) : CUSTOM_PROVIDER_DEFAULTS.currency,
        defaultQuotaPerUnit: finiteNumber(response.defaultQuotaPerUnit) ? String(response.defaultQuotaPerUnit) : CUSTOM_PROVIDER_DEFAULTS.defaultQuotaPerUnit,
        defaultCurrency: typeof response.defaultCurrency === "string" ? response.defaultCurrency.slice(0, 12) : CUSTOM_PROVIDER_DEFAULTS.defaultCurrency,
      },
    };
  };

  const setText = (node, value) => {
    const text = String(value ?? "");
    if (node && node.textContent !== text) node.textContent = text;
  };
  const finiteNumber = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
  const validStatus = (value) => ["loading", "ready", "stale", "unavailable", "error", "rate-limited"].includes(value) ? value : "unavailable";
  const normalizeMetric = (item) => {
    if (!item || typeof item !== "object" || typeof item.id !== "string") return null;
    const id = item.id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 48);
    if (!id) return null;
    return {
      id,
      label: typeof item.label === "string" ? item.label.slice(0, 32) : id,
      display: typeof item.display === "string" ? item.display.slice(0, 48) : "--",
      detail: typeof item.detail === "string" ? item.detail.slice(0, 96) : null,
      value: typeof item.value === "string" ? item.value.slice(0, 48) : null,
      defaultVisible: Boolean(item.defaultVisible),
    };
  };
  const normalizeSource = (item, fallbackId) => {
    const source = item && typeof item === "object" ? item : {};
    const id = typeof source.id === "string" ? source.id : fallbackId;
    return {
      id,
      label: typeof source.label === "string" ? source.label.slice(0, 24) : id,
      accountType: ["api-key", "api-account"].includes(source.accountType) ? source.accountType : "subscription",
      status: validStatus(source.status),
      error: typeof source.error === "string" ? source.error.slice(0, 160) : null,
      fetchedAt: finiteNumber(source.fetchedAt) ? Number(source.fetchedAt) : null,
      nextRefreshAt: finiteNumber(source.nextRefreshAt)
        ? Number(source.nextRefreshAt)
        : finiteNumber(source.fetchedAt) ? Number(source.fetchedAt) + REFRESH_INTERVAL_MS : null,
      metrics: (Array.isArray(source.metrics) ? source.metrics : []).map(normalizeMetric).filter(Boolean).slice(0, 16),
    };
  };
  const legacyOfficialSource = (source) => {
    const windows = Array.isArray(source.windows) ? source.windows.slice(0, 3) : [];
    const metrics = [];
    for (const [index, item] of windows.entries()) {
      const label = typeof item?.label === "string" ? item.label.slice(0, 8) : "主";
      const remaining = finiteNumber(item?.remainingPercent) ? Math.max(0, Math.min(100, Number(item.remainingPercent))) : null;
      const reset = formatReset(item?.resetsAt);
      metrics.push({ id: index ? "secondaryRemaining" : "primaryRemaining", label: `${label} 剩余`, display: `${label} ${formatPercent(remaining)}`, detail: `${label} 剩余 ${formatPercent(remaining)}`, defaultVisible: index === 0 });
      metrics.push({ id: index ? "secondaryReset" : "primaryReset", label: `${label} 重置`, display: `${label} ${reset}`, detail: `${label}：${reset}`, value: reset, defaultVisible: false });
    }
    if (finiteNumber(source.todayTokens)) metrics.push({ id: "todayTokens", label: "今日 token", display: `今日 ${formatTokens(Number(source.todayTokens))}`, detail: `今日 token：${formatTokens(Number(source.todayTokens))}`, value: String(Math.max(0, Math.round(Number(source.todayTokens)))), defaultVisible: true });
    if (finiteNumber(source.lifetimeTokens)) metrics.push({ id: "lifetimeTokens", label: "累计 token", display: `累计 ${formatTokens(Number(source.lifetimeTokens))}`, detail: `累计 token：${formatTokens(Number(source.lifetimeTokens))}`, value: String(Math.max(0, Math.round(Number(source.lifetimeTokens)))), defaultVisible: false });
    return normalizeSource({ id: "official", label: "官方订阅", accountType: "subscription", status: source.status, error: source.error, fetchedAt: source.fetchedAt, metrics }, "official");
  };
  const normalizeUsage = (value) => {
    const source = value && typeof value === "object" ? value : {};
    const sources = {};
    if (source.sources && typeof source.sources === "object") {
      for (const [id, item] of Object.entries(source.sources)) {
        if (!/^[a-zA-Z0-9_-]{1,32}$/.test(id)) continue;
        sources[id] = normalizeSource(item, id);
      }
    }
    if (!sources.official) sources.official = legacyOfficialSource(source);
    if (sources.official && (finiteNumber(source.todayTokens) || finiteNumber(source.lifetimeTokens))) {
      sources.official.metrics = sources.official.metrics.map((metric) => {
        if (metric.id === "todayTokens" && finiteNumber(source.todayTokens)) return { ...metric, value: String(Math.max(0, Math.round(Number(source.todayTokens)))) };
        if (metric.id === "lifetimeTokens" && finiteNumber(source.lifetimeTokens)) return { ...metric, value: String(Math.max(0, Math.round(Number(source.lifetimeTokens)))) };
        return metric;
      });
    }
    return {
      schemaVersion: finiteNumber(source.schemaVersion) ? Number(source.schemaVersion) : 1,
      nextRefreshAt: finiteNumber(source.nextRefreshAt) ? Number(source.nextRefreshAt) : null,
      sources,
    };
  };
  const preserveMetricsWhileLoading = (previous, incoming) => {
    if (!previous?.sources || !incoming?.sources) return incoming;
    const sources = { ...incoming.sources };
    for (const [id, source] of Object.entries(sources)) {
      const previousSource = previous.sources[id];
      if (source.status !== "loading" || !previousSource?.metrics?.length) continue;
      sources[id] = {
        ...source,
        fetchedAt: previousSource.fetchedAt,
        nextRefreshAt: previousSource.nextRefreshAt,
        metrics: previousSource.metrics,
      };
    }
    return { ...incoming, sources };
  };
  const formatPercent = (value) => value === null ? "--" : `${Math.round(value)}%`;
  const formatTokens = (value) => {
    if (value === null) return "--";
    if (value >= 100000000) return `${(value / 100000000).toFixed(2)}亿`;
    if (value >= 10000) return `${Math.round(value / 10000)}万`;
    return String(Math.round(value));
  };
  const formatChineseTokenUnit = (value) => {
    if (!finiteNumber(value)) return "--";
    const number = Math.max(0, Number(value));
    if (number >= 100000000) return `${(number / 100000000).toFixed(2)}亿`;
    if (number >= 10000) return `${Math.round(number / 10000)}万`;
    return String(Math.round(number));
  };
  const parseTokenUnit = (value) => {
    const match = String(value ?? "").trim().replace(/,/g, "").match(/^(\d+(?:\.\d+)?)(万|亿|[KMB])?$/i);
    if (!match) return null;
    const multiplier = match[2] === "万" ? 10000
      : match[2] === "亿" ? 100000000
        : match[2]?.toUpperCase() === "K" ? 1000
          : match[2]?.toUpperCase() === "M" ? 1000000
            : match[2]?.toUpperCase() === "B" ? 1000000000 : 1;
    const number = Number(match[1]) * multiplier;
    return Number.isFinite(number) ? Math.max(0, number) : null;
  };
  const formatEnglishTokenUnit = (value) => {
    const number = parseTokenUnit(value);
    if (number === null) return String(value ?? "--");
    const compact = (divisor, suffix) => `${Number((number / divisor).toFixed(2))}${suffix}`;
    if (number >= 1000000000) return compact(1000000000, "B");
    if (number >= 1000000) return compact(1000000, "M");
    if (number >= 1000) return compact(1000, "K");
    return String(Math.round(number));
  };
  const formatLocalizedTokenUnit = (value, language) => language === "en"
    ? formatEnglishTokenUnit(value)
    : formatChineseTokenUnit(parseTokenUnit(value));
  const formatReset = (timestamp) => {
    if (!timestamp) return "重置时间未知";
    const date = new Date(Number(timestamp) * 1000);
    if (!Number.isFinite(date.getTime())) return "重置时间未知";
    const pad = (value) => String(value).padStart(2, "0");
    return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };
  const loadSettings = () => {
    try {
      const persisted = window[PERSISTED_SETTINGS_KEY];
      const value = persisted && typeof persisted === "object"
        ? persisted
        : JSON.parse(localStorage.getItem(SETTINGS_KEY) || localStorage.getItem(PREVIOUS_SETTINGS_KEY) || "null");
      const metrics = value?.metrics && typeof value.metrics === "object" ? value.metrics : {};
      return {
        metrics: Object.fromEntries(Object.entries(metrics).map(([id, ids]) => [id, Array.isArray(ids) ? ids.map((item) => item === "dayTokens" ? "todayTokens" : item).filter((item) => typeof item === "string").slice(0, 12) : []])),
        apiKeyMetricsVersion: Number(value?.apiKeyMetricsVersion) || 0,
        officialMetricsVersion: Number(value?.officialMetricsVersion) || 0,
        unifiedMetricsVersion: Number(value?.unifiedMetricsVersion) || 0,
        minimalMode: Boolean(value?.minimalMode),
        countdownVisualization: Boolean(value?.countdownVisualization),
        englishUi: Boolean(value?.englishUi),
        updateNotifications: Boolean(value?.updateNotifications),
      };
    } catch {
      return {
        metrics: {}, apiKeyMetricsVersion: 0, officialMetricsVersion: 0, unifiedMetricsVersion: 0,
        minimalMode: false, countdownVisualization: false, englishUi: false, updateNotifications: false,
      };
    }
  };
  const saveSettings = (value) => {
    try {
      window[PERSISTED_SETTINGS_KEY] = value;
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(value));
      localStorage.removeItem(PREVIOUS_SETTINGS_KEY);
      if (typeof window[SETTINGS_BINDING] === "function") window[SETTINGS_BINDING](JSON.stringify(value));
    } catch {}
  };
  const selectedMetrics = (source, settings) => {
    const available = new Map(source.metrics.map((item) => [item.id, item]));
    const hasSavedSelection = Object.prototype.hasOwnProperty.call(settings.metrics, source.id);
    let ids = hasSavedSelection && Array.isArray(settings.metrics[source.id])
      ? settings.metrics[source.id].filter((id) => available.has(id))
      : (DEFAULT_METRIC_SELECTIONS[source.id] || []).filter((id) => available.has(id));
    return ids.map((id) => available.get(id)).filter(Boolean);
  };
  const metricValue = (metric, prefix) => metric?.value || metric?.display?.replace(prefix, "").trim() || "--";
  const apiKeyMetrics = (source) => {
    const metricById = new Map(source.metrics.map((item) => [item.id, item]));
    const usedValue = metricValue(metricById.get("usedAmount"), /^已用(?:额度)?\s*/);
    const limitValue = metricValue(metricById.get("quotaLimit") || metricById.get("grantedAmount"), /^(?:限额|总额)\s*/);
    const expiryValue = metricValue(metricById.get("expiresAt"), /^到期\s*/);
    const requestValue = source.status === "ready" ? "正常"
      : source.status === "loading" ? "请求中"
      : source.status === "stale" ? "数据过期"
      : source.status === "rate-limited" ? "请求受限"
      : source.status === "error" ? "请求失败"
      : source.error?.includes("未配置") ? "未配置" : "不可用";
    return [
      { id: "usedAmount", label: "已用额度", display: `已用 ${usedValue}`, value: usedValue, defaultVisible: metricById.get("usedAmount")?.defaultVisible ?? source.status === "ready" },
      { id: "quotaLimit", label: "限额", display: `限额 ${limitValue}`, value: limitValue, defaultVisible: metricById.get("quotaLimit")?.defaultVisible ?? source.status === "ready" },
      { id: "expiresAt", label: "到期时间", display: `到期 ${expiryValue}`, value: expiryValue, defaultVisible: false },
      { id: "requestStatus", label: "请求状态", display: `状态 ${requestValue}`, value: requestValue, defaultVisible: false },
    ];
  };
  const apiAccountMetrics = (source) => {
    const metricById = new Map(source.metrics.map((item) => [item.id, item]));
    const rows = [
      ["balance", "账户余额", "余额", true],
      ["usedQuota", "累计已用额度", "已用", false],
      ["todayTokens", "今日 Token", "今日", false],
      ["totalTokens", "累计 Token", "累计", false],
      ["lastQuota", "上次消耗额度", "消耗", false],
      ["lastModel", "上次响应模型", "模型", false],
      ["lastRequestAt", "上次请求时间", "请求", false],
      ["lastLatency", "上次响应耗时", "耗时", false],
    ].map(([id, label, compactLabel, defaultVisible]) => {
      const metric = metricById.get(id);
      const value = metric?.value || "--";
      return { id, label, value, display: metric?.display || `${compactLabel} ${value}`, defaultVisible: metric?.defaultVisible ?? (defaultVisible && source.status === "ready") };
    });
    return rows;
  };
  const officialMetrics = (source) => {
    const metricById = new Map(source.metrics.map((item) => [item.id, item]));
    const rows = [];
    for (const [id, label, compactLabel, defaultVisible] of [
      ["primaryRemaining", "5小时剩余", "5时", true],
      ["secondaryRemaining", "7天剩余", "7天", false],
    ]) {
      const metric = metricById.get(id);
      if (!metric) continue;
      const remainingValue = metric.value || metric.display.match(/(?:^|\s)(\d+(?:\.\d+)?%|--)\s*$/)?.[1] || "--";
      rows.push({
        id,
        label,
        display: `${compactLabel} ${remainingValue}`,
        value: remainingValue,
        defaultVisible,
      });
    }
    const resetMetric = metricById.get("primaryReset");
    if (resetMetric) {
      const resetValue = metricValue(resetMetric, /^重置\s*/).replace(/后重置$/, "后").trim();
      rows.push({
        id: "primaryReset",
        label: "重置时间",
        display: `重置 ${resetValue}`,
        value: resetValue,
        defaultVisible: true,
      });
    }
    for (const [id, label, compactLabel] of [
      ["todayTokens", "今日 Token", "今日"],
      ["lifetimeTokens", "累计 Token", "累计"],
      ["currentTaskTokens", "当前任务累计 Token", "任务"],
      ["lastTurnTokens", "上次对话消耗 Token", "上次"],
    ]) {
      const metric = metricById.get(id);
      if (!metric) continue;
      const value = metric.value || metricValue(metric, new RegExp(`^${compactLabel}\\s*`));
      const numericValue = Number(String(value).replace(/,/g, ""));
      const displayValue = id.endsWith("Tokens") && Number.isFinite(numericValue)
        ? String(Math.max(0, Math.round(numericValue)))
        : value;
      rows.push({ id, label, display: `${compactLabel} ${displayValue}`, value: displayValue, defaultVisible: false });
    }
    return rows;
  };
  const selectableSource = (source) => ({
    ...source,
    metrics: source.accountType === "api-key"
      ? apiKeyMetrics(source)
      : source.accountType === "api-account" ? apiAccountMetrics(source) : officialMetrics(source),
  });
  const markup = `
    <button class="usage-summary" type="button" aria-label="Codex usage details" aria-expanded="false">
      <span class="usage-refresh-ring" aria-hidden="true" hidden></span>
      <span class="usage-summary-items"><span class="usage-summary-item">Usage --</span></span>
    </button>
    <div class="usage-popover" role="dialog" aria-label="Usage display settings" hidden>
      <div class="usage-columns"></div>
    </div>`;
  const css = `
    :host {
      position: fixed;
      left: var(--usage-left, 0px);
      top: var(--usage-top, 0px);
      z-index: 2147483000;
      display: inline-flex;
      max-width: var(--usage-max-width, 280px);
      color: var(--usage-color, currentColor);
      font: 500 11px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      pointer-events: auto;
    }
    :host([hidden]) { display: none; }
    .usage-summary {
      display: inline-flex;
      align-items: center;
      gap: 0;
      min-width: 0;
      max-width: 100%;
      height: 28px;
      padding: 0 9px;
      border: 1px solid color-mix(in srgb, currentColor 14%, transparent);
      border-radius: 7px;
      color: inherit;
      background: color-mix(in srgb, currentColor 5%, transparent);
      cursor: pointer;
      white-space: nowrap;
      overflow: hidden;
      font-size: var(--usage-font-size, 11px);
    }
    .usage-summary:hover, .usage-summary:focus-visible {
      background: color-mix(in srgb, currentColor 10%, transparent);
      outline: none;
    }
    .usage-summary-items { display: flex; align-items: center; min-width: 0; max-width: 100%; height: 100%; gap: 0; overflow: hidden; line-height: 1; }
    .usage-summary-item { position: relative; display: inline-flex; align-items: center; min-width: 0; height: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .usage-summary-item + .usage-summary-item { padding-left: 13px; }
    .usage-summary-item + .usage-summary-item::before {
      content: "";
      position: absolute;
      left: 6px;
      top: calc(50% + 1px);
      width: 1px;
      height: 14px;
      background: currentColor;
      opacity: .40;
      transform: translateY(-50%);
    }
    .usage-refresh-ring {
      --usage-refresh-progress: 0deg;
      box-sizing: border-box;
      position: relative;
      top: 0;
      width: 13px;
      height: 13px;
      margin-right: 6px;
      flex: 0 0 13px;
      border: 1.5px solid currentColor;
      border-radius: 50%;
      background: transparent;
    }
    .usage-refresh-ring::before {
      content: "";
      position: absolute;
      top: -3px;
      left: 50%;
      width: 3px;
      height: 3px;
      border-radius: 1px 1px 0 0;
      background: currentColor;
      transform: translateX(-50%);
    }
    .usage-refresh-ring::after {
      content: "";
      position: absolute;
      left: calc(50% - .75px);
      bottom: 50%;
      width: 1.5px;
      height: calc(50% + .5px);
      border-radius: 1px;
      background: #22c55e;
      transform: rotate(var(--usage-refresh-progress));
      transform-origin: 50% 100%;
    }
    :host([data-density="dense"]) .usage-summary { padding-inline: 6px; }
    :host([data-density="dense"]) .usage-refresh-ring { width: 12px; height: 12px; margin-right: 4px; flex-basis: 12px; }
    :host([data-density="dense"]) .usage-summary-item + .usage-summary-item { padding-left: 7px; }
    :host([data-density="dense"]) .usage-summary-item + .usage-summary-item::before { left: 3px; height: 13px; }
    :host([data-density="packed"]) .usage-summary { height: 30px; padding: 2px 5px; }
    :host([data-density="packed"]) .usage-refresh-ring { width: 11px; height: 11px; margin-right: 3px; flex-basis: 11px; }
    :host([data-density="packed"]) .usage-summary-items { display: grid; grid-template-rows: repeat(2, minmax(0, 1fr)); grid-auto-flow: column; align-items: stretch; line-height: 1; }
    :host([data-density="packed"]) .usage-summary-item + .usage-summary-item { padding-left: 5px; }
    :host([data-density="packed"]) .usage-summary-item + .usage-summary-item::before { left: 2px; height: 12px; }
    :host([data-density="packed"]) .usage-summary-item:nth-child(2) { padding-left: 0; }
    :host([data-density="packed"]) .usage-summary-item:nth-child(2)::before { display: none; }
    [hidden] { display: none !important; }
    .usage-popover {
      box-sizing: border-box;
      position: absolute;
      left: 0;
      bottom: calc(100% + 8px);
      z-index: 40;
      left: var(--usage-popover-shift, 0px);
      width: var(--usage-popover-width, min(720px, calc(100vw - 24px)));
      max-height: min(440px, calc(100vh - 72px));
      padding: 10px 11px;
      border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
      border-radius: 8px;
      color: inherit;
      background: Canvas;
      box-shadow: 0 10px 28px rgba(0, 0, 0, .16);
      overflow-x: hidden;
      overflow-y: auto;
      overscroll-behavior: contain;
      scrollbar-gutter: stable;
      white-space: normal;
    }
    .usage-columns {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      align-items: stretch;
    }
    .usage-column { box-sizing: border-box; display: flex; flex-direction: column; width: 100%; min-width: 0; padding: 0 11px; }
    .usage-column:first-child { padding-left: 0; }
    .usage-column:last-child { padding-right: 0; }
    .usage-column-title {
      display: flex;
      align-items: center;
      gap: 7px;
      min-height: 27px;
      padding-bottom: 5px;
      font-weight: 650;
    }
    .usage-column-heading { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .usage-config-trigger {
      min-height: 25px;
      margin-left: auto;
      padding: 2px 7px;
      border: 1px solid color-mix(in srgb, currentColor 28%, transparent);
      border-radius: 5px;
      color: inherit;
      background: transparent;
      font: inherit;
      font-weight: 600;
      cursor: pointer;
    }
    .usage-config-trigger:hover { background: color-mix(in srgb, currentColor 8%, transparent); }
    .usage-config-trigger:focus-visible,
    .usage-config-control:focus-visible,
    .usage-config-submit:focus-visible { outline: 2px solid color-mix(in srgb, currentColor 42%, transparent); outline-offset: 1px; }
    .usage-config-form { display: grid; gap: 8px; padding: 3px 0 5px; }
    .usage-config-field { display: grid; gap: 3px; min-width: 0; }
    .usage-config-label { font-size: 10px; font-weight: 650; line-height: 1.25; }
    .usage-config-control {
      box-sizing: border-box;
      width: 100%;
      min-width: 0;
      min-height: 32px;
      padding: 5px 7px;
      border: 1px solid color-mix(in srgb, currentColor 28%, transparent);
      border-radius: 5px;
      color: inherit;
      background: Canvas;
      font: inherit;
    }
    .usage-config-control[aria-invalid="true"] { border-color: #ef4444; }
    .usage-config-error { min-height: 13px; color: #dc2626; font-size: 9px; line-height: 1.3; }
    .usage-config-hint { color: inherit; font-size: 9px; line-height: 1.35; opacity: .62; }
    .usage-config-secret-wrap { position: relative; }
    .usage-config-secret-wrap .usage-config-control { padding-right: 44px; }
    .usage-config-reveal {
      position: absolute;
      top: 0;
      right: 0;
      width: 42px;
      height: 32px;
      padding: 0;
      border: 0;
      color: inherit;
      background: transparent;
      cursor: pointer;
      opacity: .68;
      font: inherit;
      font-size: 9px;
    }
    .usage-config-reveal:focus-visible { outline: 2px solid color-mix(in srgb, currentColor 42%, transparent); outline-offset: -2px; }
    .usage-config-advanced { display: grid; gap: 8px; padding-top: 2px; }
    .usage-config-disclosure {
      border: 1px solid color-mix(in srgb, currentColor 20%, transparent);
      border-radius: 5px;
      padding: 0 7px;
    }
    .usage-config-disclosure > summary {
      min-height: 31px;
      display: flex;
      align-items: center;
      color: inherit;
      font-size: 10px;
      font-weight: 650;
      cursor: pointer;
    }
    .usage-config-disclosure[open] { padding-bottom: 7px; }
    .usage-config-disclosure > summary:focus-visible { outline: 2px solid color-mix(in srgb, currentColor 42%, transparent); outline-offset: 1px; }
    .usage-config-advanced-title { margin: 1px 0; font-size: 10px; font-weight: 700; opacity: .72; }
    .usage-config-status { min-height: 15px; font-size: 9px; line-height: 1.35; }
    .usage-config-status[data-kind="error"] { color: #dc2626; }
    .usage-config-status[data-kind="success"] { color: #15803d; }
    .usage-config-submit {
      min-height: 32px;
      padding: 5px 10px;
      border: 1px solid color-mix(in srgb, currentColor 36%, transparent);
      border-radius: 5px;
      color: Canvas;
      background: color-mix(in srgb, currentColor 88%, Canvas);
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }
    .usage-config-submit:disabled { cursor: wait; opacity: .55; }
    .usage-config-trigger:active, .usage-config-reveal:active, .usage-config-submit:active { opacity: .72; }
    .usage-status { width: 7px; height: 7px; flex: 0 0 auto; border-radius: 50%; background: #a1a1aa; }
    .usage-column[data-status="ready"] .usage-status { background: #22c55e; }
    .usage-column[data-status="loading"] .usage-status { background: #facc15; }
    .usage-column[data-status="stale"] .usage-status { background: #fb3f4f; }
    .usage-column-subsection { display: flex; flex-direction: column; }
    .usage-column-subsection-title { margin-top: 5px; }
    .usage-column-subsection[data-status="ready"] .usage-status { background: #22c55e; }
    .usage-column-subsection[data-status="unavailable"] .usage-status { background: #a1a1aa; }
    .usage-column-rows { display: grid; }
    .usage-detail-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 8px;
      min-height: 27px;
    }
    .usage-detail-select { display: flex; align-items: center; min-width: 0; gap: 6px; cursor: pointer; }
    .usage-detail-select input {
      appearance: none;
      box-sizing: border-box;
      width: 13px;
      height: 13px;
      margin: 0;
      flex: 0 0 13px;
      display: grid;
      place-content: center;
      border: 1px solid color-mix(in srgb, currentColor 48%, transparent);
      border-radius: 2px;
      color: inherit;
      background: transparent;
      cursor: pointer;
    }
    .usage-detail-select input::before {
      content: "";
      width: 6px;
      height: 3px;
      border-left: 1.5px solid currentColor;
      border-bottom: 1.5px solid currentColor;
      transform: translateY(-1px) rotate(-45deg) scale(0);
      transform-origin: center;
    }
    .usage-detail-select input:checked { border-color: currentColor; background: color-mix(in srgb, currentColor 16%, transparent); }
    .usage-detail-select input:checked::before { transform: translateY(-1px) rotate(-45deg) scale(1); }
    .usage-detail-select input:focus-visible { outline: 2px solid color-mix(in srgb, currentColor 40%, transparent); outline-offset: 1px; }
    .usage-detail-select input:disabled { cursor: default; }
    .usage-detail-select:has(input:disabled) { opacity: .45; cursor: default; }
    .usage-detail-label { min-width: 0; color: inherit; font-weight: 650; }
    .usage-detail-value { max-width: 94px; overflow: hidden; color: inherit; font-weight: 650; text-align: right; text-overflow: ellipsis; white-space: nowrap; }
    .usage-column-brand {
      display: flex;
      flex-direction: column;
      justify-content: flex-end;
      align-self: flex-end;
      width: fit-content;
      max-width: 100%;
      min-height: 36px;
      margin-top: 0;
      padding: 4px 0 2px;
      font-weight: 450;
      line-height: 1.35;
      opacity: .55;
      white-space: nowrap;
    }
    .usage-brand-product { color: inherit; font-size: 12px; text-decoration: none; }
    .usage-brand-product[href] { text-decoration: underline; text-underline-offset: 2px; }
    .usage-brand-credit { font-size: 9px; font-weight: 450; text-align: right; }
    .usage-column-footer {
      display: grid;
      gap: 2px;
      align-self: flex-end;
      width: 100%;
      max-width: 100%;
      min-width: 0;
      margin-top: auto;
      padding-top: 4px;
    }
    .usage-mode-switches {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      align-items: center;
      justify-content: flex-end;
      gap: 6px 10px;
      width: 100%;
      min-height: 22px;
      white-space: nowrap;
    }
    .usage-mode-toggle {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 24px;
      align-items: center;
      gap: 5px;
      min-width: 0;
      font-size: 9px;
      line-height: 1;
      opacity: .72;
      cursor: pointer;
    }
    .usage-mode-toggle > span:first-child {
      overflow: hidden;
      text-align: right;
      text-overflow: ellipsis;
    }
    .usage-mode-toggle input {
      position: absolute;
      width: 1px;
      height: 1px;
      opacity: 0;
      pointer-events: none;
    }
    .usage-toggle-track {
      box-sizing: border-box;
      position: relative;
      width: 24px;
      height: 14px;
      flex: 0 0 24px;
      border: 1px solid color-mix(in srgb, currentColor 30%, transparent);
      border-radius: 999px;
      background: color-mix(in srgb, currentColor 9%, transparent);
      transition: background-color 120ms ease, border-color 120ms ease;
    }
    .usage-toggle-track::after {
      content: "";
      position: absolute;
      top: 2px;
      left: 2px;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: color-mix(in srgb, currentColor 72%, Canvas);
      transition: transform 120ms ease, background-color 120ms ease;
    }
    .usage-mode-toggle input:checked + .usage-toggle-track { border-color: #86efac; background: #86efac; }
    .usage-mode-toggle input:checked + .usage-toggle-track::after { background: #166534; transform: translateX(10px); }
    .usage-mode-toggle input:focus-visible + .usage-toggle-track { outline: 2px solid color-mix(in srgb, #86efac 60%, transparent); outline-offset: 1px; }
    .usage-column-meta {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: 5px;
      min-height: 27px;
      font-size: 10px;
      line-height: 1;
      opacity: .55;
      white-space: nowrap;
    }
    @media (max-width: 680px) {
      .usage-popover { padding-inline: 8px; font-size: 10px; }
      .usage-column { padding-inline: 6px; }
      .usage-detail-row { gap: 4px; }
      .usage-detail-select { gap: 4px; }
      .usage-detail-value { max-width: 72px; }
      .usage-brand-product { font-size: 10px; }
      .usage-brand-credit { font-size: 8px; }
      .usage-mode-switches { gap: 6px; }
      .usage-mode-toggle { grid-template-columns: minmax(0, 1fr) 22px; gap: 3px; font-size: 8px; }
      .usage-toggle-track { width: 22px; flex-basis: 22px; }
      .usage-mode-toggle input:checked + .usage-toggle-track::after { transform: translateX(8px); }
      .usage-column-meta { font-size: 9px; }
      .usage-config-trigger { padding-inline: 5px; }
    }
    @supports not (color: color-mix(in srgb, red 50%, transparent)) {
      .usage-summary { border-color: rgba(128, 128, 128, .22); background: rgba(128, 128, 128, .06); }
      .usage-popover { border-color: rgba(128, 128, 128, .22); }
    }
  `;

  const compactSummaryDisplay = (metric) => {
    let display = String(metric?.display ?? "").replace(/\s+/g, "");
    if (/(?:Reset|nextRefreshAt)$/.test(String(metric?.id ?? ""))) {
      display = display.replace(/(\d{2}-\d{2})(\d{2}:\d{2})/, "$1 $2").replace(/后$/, "");
    }
    return display;
  };
  const minimalSummaryDisplay = (metric) => {
    let value = String(metric?.value ?? "--").replace(/\s+/g, "");
    if (/(?:Reset|nextRefreshAt)$/.test(String(metric?.id ?? ""))) {
      value = value.replace(/(\d{2}-\d{2})(\d{2}:\d{2})/, "$1 $2").replace(/后$/, "");
    }
    return value;
  };
  const selectedMetricLimit = (settings) => settings?.minimalMode
    ? MAX_MINIMAL_SELECTED_METRICS
    : MAX_SELECTED_METRICS;

  const updateCountdowns = (host, value) => {
    if (!host?.shadowRoot) return;
    const usage = normalizeUsage(value);
    const settings = loadSettings();
    const t = createTranslator(settings.englishUi ? "en" : "zh");
    const now = Date.now();
    const remainingMs = finiteNumber(usage.nextRefreshAt)
      ? Math.max(0, Number(usage.nextRefreshAt) - now)
      : null;
    const seconds = remainingMs === null ? null : Math.ceil(remainingMs / 1000);
    setText(host.shadowRoot.querySelector(".usage-refresh-countdown"), t("refreshIn", {
      seconds: seconds === null ? "--" : t.language === "en" ? `${seconds}s` : `${seconds}秒后`,
    }));
    const ring = host.shadowRoot.querySelector(".usage-refresh-ring");
    if (ring) {
      const progress = remainingMs === null ? 0 : Math.max(0, Math.min(1, 1 - remainingMs / REFRESH_INTERVAL_MS));
      ring.style.setProperty("--usage-refresh-progress", `${Math.round(progress * 360)}deg`);
    }
  };

  const configurationDraft = (sourceId) => {
    const configuration = window[STATE_KEY]?.configuration;
    if (!configuration) return {};
    if (configuration.drafts[sourceId]) return configuration.drafts[sourceId];
    if (sourceId === "api-account") {
      configuration.drafts[sourceId] = {
        baseUrl: configuration.summary.account.baseUrl || "https://www.cctq.ai",
        userId: configuration.summary.account.userId || "",
        token: "",
        initialTokens: configuration.summary.account.initialTokens || "0",
      };
    } else {
      const summary = configuration.summary.provider;
      configuration.drafts[sourceId] = { ...(summary.configured ? summary : CUSTOM_PROVIDER_DEFAULTS), apiKey: "" };
    }
    return configuration.drafts[sourceId];
  };

  const configurationField = (t, { name, label, value = "", type = "text", inputMode = "", placeholder = "", hint = "", required = false }) => {
    const field = document.createElement("label");
    field.className = "usage-config-field";
    const labelNode = document.createElement("span");
    labelNode.className = "usage-config-label";
    labelNode.textContent = label;
    const input = document.createElement("input");
    input.className = "usage-config-control";
    input.dataset.configField = name;
    input.name = name;
    input.type = type;
    if (inputMode) input.inputMode = inputMode;
    input.value = String(value ?? "");
    input.placeholder = placeholder;
    input.required = required;
    input.autocomplete = "off";
    input.spellcheck = false;
    const error = document.createElement("span");
    error.className = "usage-config-error";
    error.dataset.configError = name;
    error.id = `usage-config-error-${name}`;
    const hintNode = document.createElement("span");
    hintNode.className = "usage-config-hint";
    hintNode.id = `usage-config-hint-${name}`;
    hintNode.textContent = hint;
    input.setAttribute("aria-describedby", `${hint ? `${hintNode.id} ` : ""}${error.id}`);
    if (type === "password") {
      const wrapper = document.createElement("span");
      wrapper.className = "usage-config-secret-wrap";
      const reveal = document.createElement("button");
      reveal.type = "button";
      reveal.className = "usage-config-reveal";
      reveal.dataset.revealSecret = name;
      reveal.textContent = t.language === "en" ? "Show" : "显示";
      reveal.title = t.language === "en" ? "Show or hide credential" : "显示或隐藏凭据";
      reveal.setAttribute("aria-label", reveal.title);
      wrapper.append(input, reveal);
      field.append(labelNode, wrapper);
    } else {
      field.append(labelNode, input);
    }
    if (hint) field.append(hintNode);
    field.append(error);
    return field;
  };

  const createConfigurationForm = (source, t) => {
    const configuration = window[STATE_KEY]?.configuration;
    const draft = configurationDraft(source.id);
    const form = document.createElement("form");
    form.className = "usage-config-form";
    form.dataset.configSource = source.id;
    form.noValidate = true;
    if (source.accountType === "api-account") {
      form.append(
        configurationField(t, { name: "baseUrl", label: t("accountBaseUrl"), value: draft.baseUrl, required: true }),
        configurationField(t, { name: "userId", label: t("accountUserId"), value: draft.userId, required: true }),
        configurationField(t, {
          name: "token", label: t("accountToken"), value: draft.token, type: "password",
          placeholder: configuration?.summary.account.configured ? t("configuredSecretHint") : t("newSecretHint"),
          hint: configuration?.summary.account.configured ? t("storedCredentialNotice") : "",
        }),
        configurationField(t, {
          name: "initialTokens", label: t("accountTokenBaseline"), value: draft.initialTokens,
          inputMode: "numeric", hint: t("tokenBaselineHint"), required: true,
        }),
      );
    } else {
      const configured = Boolean(configuration?.summary.provider.configured);
      form.append(configurationField(t, {
        name: "apiKey", label: t("apiKeySecret"), value: draft.apiKey, type: "password",
        placeholder: configured ? t("configuredSecretHint") : t("newSecretHint"),
        hint: configured ? t("storedCredentialNotice") : "",
      }));
      const baseUrlField = () => configurationField(t, {
        name: "baseUrl", label: t("apiServiceUrl"), value: draft.baseUrl,
        placeholder: "https://api.example.com", hint: t("apiServiceUrlHint"), required: true,
      });
      const usagePathField = () => configurationField(t, {
        name: "usagePath", label: t("usagePath"), value: draft.usagePath,
        placeholder: "/v1/usage", hint: t("usagePathHint"), required: true,
      });
      if (!configured) form.append(baseUrlField(), usagePathField());
      const disclosure = document.createElement("details");
      disclosure.className = "usage-config-disclosure";
      const disclosureSummary = document.createElement("summary");
      disclosureSummary.textContent = configured ? t("connectionSettings") : t("advancedSettings");
      const advanced = document.createElement("div");
      advanced.className = "usage-config-advanced";
      if (configured) advanced.append(baseUrlField(), usagePathField());
      const advancedTitle = document.createElement("div");
      advancedTitle.className = "usage-config-advanced-title";
      advancedTitle.textContent = t("responseMapping");
      advanced.append(
        configurationField(t, { name: "statusPath", label: t("statusPath"), value: draft.statusPath }),
        configurationField(t, { name: "authHeader", label: t("authHeader"), value: draft.authHeader, required: true }),
        configurationField(t, { name: "authScheme", label: t("authScheme"), value: draft.authScheme }),
        advancedTitle,
      );
      for (const [name, label] of [
        ["usageRoot", t("usageRoot")], ["statusRoot", t("statusRoot")], ["used", t("usedField")],
        ["limit", t("limitField")], ["unlimited", t("unlimitedField")], ["expiresAt", t("expiresAtField")],
        ["quotaPerUnit", t("quotaPerUnitField")], ["currency", t("currencyField")],
        ["defaultQuotaPerUnit", t("defaultQuotaPerUnit")], ["defaultCurrency", t("defaultCurrency")],
      ]) advanced.append(configurationField(t, { name, label, value: draft[name], required: true }));
      disclosure.append(disclosureSummary, advanced);
      form.append(disclosure);
    }
    const status = document.createElement("div");
    status.className = "usage-config-status";
    status.setAttribute("role", configuration?.status?.kind === "error" ? "alert" : "status");
    status.setAttribute("aria-live", "polite");
    status.dataset.kind = configuration?.status?.kind || "idle";
    status.textContent = configuration?.status?.sourceId === source.id ? configuration.status.message : "";
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = "usage-config-submit";
    submit.disabled = Boolean(configuration?.pending);
    submit.textContent = configuration?.pending ? t("savingConfiguration") : t("saveConfiguration");
    form.append(status, submit);
    return form;
  };

  const validConfigurationUrl = (value) => {
    try {
      const url = new URL(value);
      const local = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname.toLowerCase());
      return !url.username && !url.password && !url.search && !url.hash && (url.protocol === "https:" || (url.protocol === "http:" && local));
    } catch { return false; }
  };

  const validateConfiguration = (sourceId, draft, t) => {
    const configuration = window[STATE_KEY]?.configuration;
    const errors = {};
    if (!String(draft.baseUrl || "").trim()) errors.baseUrl = t("requiredField");
    else if (!validConfigurationUrl(String(draft.baseUrl).trim())) errors.baseUrl = t("invalidUrl");
    const secretName = sourceId === "api-account" ? "token" : "apiKey";
    const configured = sourceId === "api-account" ? configuration?.summary.account.configured : configuration?.summary.provider.configured;
    const secret = String(draft[secretName] || "");
    if (!secret && !configured) errors[secretName] = t("requiredField");
    else if (secret && (!/^[\x21-\x7E]+$/.test(secret) || secret.length > 16384)) errors[secretName] = t("invalidCredential");
    if (sourceId === "api-account") {
      if (!/^[1-9][0-9]{0,19}$/.test(String(draft.userId || ""))) errors.userId = t("invalidUserId");
      const baseline = String(draft.initialTokens || "").trim();
      if (!/^\d+$/.test(baseline) || baseline.length > 19 || (baseline.length === 19 && baseline > "9223372036854775807")) {
        errors.initialTokens = t("invalidTokenBaseline");
      }
    } else {
      for (const name of ["usagePath", "authHeader", "usageRoot", "statusRoot", "used", "limit", "unlimited", "expiresAt", "quotaPerUnit", "currency", "defaultQuotaPerUnit", "defaultCurrency"]) {
        if (!String(draft[name] || "").trim()) errors[name] = t("requiredField");
      }
    }
    return errors;
  };

  const render = (host, value, forceColumns = false) => {
    if (!host?.shadowRoot) return;
    const usage = normalizeUsage(value);
    const settings = loadSettings();
    const t = createTranslator(settings.englishUi ? "en" : "zh");
    const apiKeySource = Object.values(usage.sources).find((item) => item.accountType === "api-key")
      || normalizeSource({ id: "api-key", label: "API Key", accountType: "api-key", status: "unavailable", error: "未配置 API key" }, "api-key");
    const sources = [
      usage.sources.official || normalizeSource({ id: "official", label: "官方订阅", accountType: "subscription", status: "unavailable" }, "official"),
      usage.sources["api-account"] || normalizeSource({ id: "api-account", label: "API 账户", accountType: "api-account", status: "unavailable", error: "未配置 API 账户令牌" }, "api-account"),
      { ...apiKeySource, label: "API Key" },
    ].map(selectableSource).map((source) => {
      const localizedStatus = source.status === "loading" ? t("loading") : source.status === "ready" ? t("ready")
        : source.status === "stale" ? t("stale") : source.status === "rate-limited" ? t("rateLimited")
          : source.status === "error" ? t("error") : t("unavailable");
      return {
        ...source,
        label: source.id === "official" ? t("official")
          : source.accountType === "api-account" ? t("apiAccount")
            : source.accountType === "api-key" ? t("apiKey") : source.label,
        metrics: source.metrics.map((metric) => {
          const value = metric.id === "requestStatus" ? localizedStatus
            : metric.id.endsWith("Tokens") ? formatLocalizedTokenUnit(metric.value, t.language)
              : metric.value;
          return {
            ...metric,
            value,
            label: t.metric(metric.id, metric.label),
            display: `${t.compact(metric.id, metric.label)} ${value || "--"}`,
          };
        }),
      };
    });
    let selected = sources.flatMap((source) => selectedMetrics(source, settings).map((metric) => ({ source, metric })));
    const selectedLimit = selectedMetricLimit(settings);
    let settingsChanged = false;
    if (selected.length > selectedLimit) {
      selected = selected.slice(0, selectedLimit);
      for (const source of sources) {
        settings.metrics[source.id] = selected.filter((item) => item.source.id === source.id).map((item) => item.metric.id);
      }
      settingsChanged = true;
    }
    if (settings.unifiedMetricsVersion < 1) {
      settings.unifiedMetricsVersion = 1;
      settingsChanged = true;
    }
    if (settingsChanged) saveSettings(settings);
    const availableWidth = Number.parseInt(host.style.getPropertyValue("--usage-max-width"), 10) || 280;
    host.dataset.density = settings.minimalMode
      ? selected.length >= 9 ? "packed" : "normal"
      : selected.length >= 7 || (selected.length >= 5 && availableWidth < 280)
        ? "packed" : selected.length >= 5 ? "dense" : "normal";
    host.dataset.minimal = String(settings.minimalMode);
    const summaryDisplay = (metric) => settings.minimalMode
      ? minimalSummaryDisplay(metric)
      : host.dataset.density === "normal" ? metric?.display : compactSummaryDisplay(metric);
    const shadow = host.shadowRoot;
    const refreshRing = shadow.querySelector(".usage-refresh-ring");
    if (refreshRing) refreshRing.hidden = !settings.countdownVisualization;
    const summaryRoot = shadow.querySelector(".usage-summary-items");
    if (summaryRoot) {
      const items = selected.length ? selected : [{ source: null, metric: { display: t("usageUnavailable") } }];
      summaryRoot.replaceChildren(...items.map(({ source, metric }) => {
        const item = document.createElement("span");
        item.className = "usage-summary-item";
        item.textContent = summaryDisplay(metric);
        if (source) {
          item.dataset.source = source.id;
          item.dataset.metric = metric.id;
          const groupLabel = source.id === "official" && TASK_METRIC_IDS.has(metric.id)
            ? t("taskSection")
            : source.label;
          item.title = `${groupLabel} · ${metric.label}：${metric.value || "--"}`;
        }
        return item;
      }));
    }
    shadow.querySelector(".usage-summary")?.setAttribute("aria-label", t("displayedItems", { count: selected.length }));
    shadow.querySelector(".usage-popover")?.setAttribute("aria-label", t("displaySettings"));
    const columns = shadow.querySelector(".usage-columns");
    if (columns && (forceColumns || !shadow.activeElement?.closest?.(".usage-config-form"))) {
      const selectedKeys = new Set(selected.map((item) => `${item.source.id}:${item.metric.id}`));
      columns.replaceChildren(...sources.map((source) => {
        const column = document.createElement("section");
        column.className = "usage-column";
        column.dataset.status = source.status;
        const title = document.createElement("div");
        title.className = "usage-column-title";
        const status = document.createElement("span");
        status.className = "usage-status";
        const statusText = source.status === "loading" ? t("loading") : source.status === "ready" ? t("ready")
          : source.status === "stale" ? t("stale") : source.status === "rate-limited" ? t("rateLimited")
            : source.status === "error" ? t("error") : t("unavailable");
        status.title = source.error || statusText;
        status.setAttribute("aria-label", statusText);
        const heading = document.createElement("span");
        heading.className = "usage-column-heading";
        heading.textContent = source.label;
        title.append(status, heading);
        const configurable = ["api-account", "api-key"].includes(source.accountType);
        const configurationOpen = window[STATE_KEY]?.configuration?.openSourceId === source.id;
        if (configurable) {
          const configure = document.createElement("button");
          configure.type = "button";
          configure.className = "usage-config-trigger";
          configure.dataset.configureSource = source.id;
          configure.textContent = configurationOpen ? t("back") : t("configure");
          configure.setAttribute("aria-expanded", String(configurationOpen));
          title.append(configure);
        }
        const createRows = (metrics) => {
          const rows = document.createElement("div");
          rows.className = "usage-column-rows";
          rows.replaceChildren(...metrics.map((metric) => {
            const key = `${source.id}:${metric.id}`;
            const checked = selectedKeys.has(key);
            const row = document.createElement("div");
            row.className = "usage-detail-row";
            const select = document.createElement("label");
            select.className = "usage-detail-select";
            const input = document.createElement("input");
            input.type = "checkbox";
            input.dataset.source = source.id;
            input.dataset.metric = metric.id;
            input.checked = checked;
            input.disabled = !checked && selected.length >= selectedLimit;
            const label = document.createElement("span");
            label.className = "usage-detail-label";
            label.textContent = metric.label;
            select.append(input, label);
            const metricValueNode = document.createElement("span");
            metricValueNode.className = "usage-detail-value";
            metricValueNode.textContent = metric.value || "--";
            metricValueNode.title = metric.value || "--";
            row.append(select, metricValueNode);
            return row;
          }));
          return rows;
        };
        const taskMetrics = source.id === "official"
          ? TASK_METRIC_FALLBACKS.map((fallback) => source.metrics.find((metric) => metric.id === fallback.id) || fallback)
          : [];
        const primaryMetrics = source.id === "official"
          ? source.metrics.filter((metric) => !TASK_METRIC_IDS.has(metric.id))
          : source.metrics;
        if (configurationOpen) {
          column.append(title, createConfigurationForm(source, t));
          return column;
        }
        column.append(title, createRows(primaryMetrics));
        if (taskMetrics.length) {
          const taskSection = document.createElement("section");
          taskSection.className = "usage-column-subsection";
          const taskReady = taskMetrics.some((metric) => metric.value && metric.value !== "--");
          taskSection.dataset.status = taskReady ? "ready" : "unavailable";
          const taskTitle = document.createElement("div");
          taskTitle.className = "usage-column-title usage-column-subsection-title";
          const taskStatus = document.createElement("span");
          taskStatus.className = "usage-status";
          taskStatus.title = taskReady ? t("taskReady") : t("taskUnavailable");
          taskStatus.setAttribute("aria-label", taskReady ? t("ready") : t("unavailable"));
          const taskHeading = document.createElement("span");
          taskHeading.className = "usage-column-heading";
          taskHeading.textContent = t("taskSection");
          taskTitle.append(taskStatus, taskHeading);
          taskSection.append(taskTitle, createRows(taskMetrics));
          column.append(taskSection);
        }
        if (source.accountType === "api-key") {
          const footer = document.createElement("div");
          footer.className = "usage-column-footer";
          const switches = document.createElement("div");
          switches.className = "usage-mode-switches";
          for (const [setting, labelText] of [
            ["minimalMode", t("minimalMode")],
            ["countdownVisualization", t("countdownVisualization")],
            ["englishUi", t("englishUi")],
            ["updateNotifications", t("updateNotifications")],
          ]) {
            const toggle = document.createElement("label");
            toggle.className = "usage-mode-toggle";
            const toggleLabel = document.createElement("span");
            toggleLabel.textContent = labelText;
            const toggleInput = document.createElement("input");
            toggleInput.type = "checkbox";
            toggleInput.dataset.setting = setting;
            toggleInput.checked = Boolean(settings[setting]);
            toggleInput.setAttribute("aria-label", labelText);
            const track = document.createElement("span");
            track.className = "usage-toggle-track";
            track.setAttribute("aria-hidden", "true");
            toggle.append(toggleLabel, toggleInput, track);
            switches.append(toggle);
          }
          const meta = document.createElement("div");
          meta.className = "usage-column-meta";
          const maximum = document.createElement("span");
          maximum.textContent = settings.minimalMode
            ? t("minimalMaximum", { count: MAX_MINIMAL_SELECTED_METRICS })
            : t("maximum", { count: MAX_SELECTED_METRICS });
          const separator = document.createElement("span");
          separator.setAttribute("aria-hidden", "true");
          separator.textContent = "·";
          const countdown = document.createElement("span");
          countdown.className = "usage-refresh-countdown";
          countdown.textContent = t("refreshIn", { seconds: "--" });
          meta.append(maximum, separator, countdown);
          footer.append(switches, meta);
          column.append(footer);

          const brand = document.createElement("div");
          brand.className = "usage-column-brand";
          const product = document.createElement("a");
          product.className = "usage-brand-product";
          product.textContent = `Codex Usage Monitor for Windows v${VERSION}`;
          product.rel = "noreferrer";
          product.target = "_blank";
          const credit = document.createElement("span");
          credit.className = "usage-brand-credit";
          credit.textContent = "—— Designed by +羊 and Codex";
          brand.append(product, credit);
          column.append(brand);
        }
        return column;
      }));
    }
    updateCountdowns(host, usage);
    host.dataset.rendered = "true";
  };

  const ensure = () => {
    const placement = findPlacement(HOST_ID);
    const state = window[STATE_KEY];
    if (!placement.composer) {
      document.getElementById(HOST_ID)?.remove();
      if (state) {
        state.host = null;
        state.health = { ok: false, reason: placement.reason, strategy: placement.strategy, checkedAt: Date.now() };
      }
      return null;
    }
    let host = document.getElementById(HOST_ID);
    let created = false;
    if (!host?.shadowRoot) {
      host?.remove();
      host = document.createElement("span");
      host.id = HOST_ID;
      created = true;
      host.setAttribute("data-codex-usage-ui", "monitor");
      host.attachShadow({ mode: "open" }).innerHTML = `<style>${css}</style>${markup}`;
      const summary = host.shadowRoot.querySelector(".usage-summary");
      summary?.addEventListener("click", () => {
        const open = host.dataset.open !== "true";
        host.dataset.open = String(open);
        summary.setAttribute("aria-expanded", String(open));
        const popover = host.shadowRoot.querySelector(".usage-popover");
        if (popover) popover.hidden = !open;
        if (open) render(host, window[STATE_KEY]?.usage || window[USAGE_KEY]);
      });
      host.shadowRoot.addEventListener("click", (event) => {
        const trigger = event.target?.closest?.("[data-configure-source]");
        if (trigger) {
          const state = window[STATE_KEY];
          if (!state?.configuration?.pending) {
            const sourceId = trigger.dataset.configureSource;
            state.configuration.openSourceId = state.configuration.openSourceId === sourceId ? null : sourceId;
            state.configuration.status = { sourceId, kind: "idle", message: "" };
            render(host, state.usage, true);
            if (state.configuration.openSourceId) {
              host.shadowRoot.querySelector(`[data-config-source="${sourceId}"] .usage-config-control`)?.focus();
            }
          }
          return;
        }
        const reveal = event.target?.closest?.("[data-reveal-secret]");
        if (reveal) {
          const input = host.shadowRoot.querySelector(`[data-config-field="${reveal.dataset.revealSecret}"]`);
          if (input instanceof HTMLInputElement) {
            input.type = input.type === "password" ? "text" : "password";
            const t = createTranslator(loadSettings().englishUi ? "en" : "zh");
            reveal.textContent = input.type === "password" ? (t.language === "en" ? "Show" : "显示") : (t.language === "en" ? "Hide" : "隐藏");
          }
        }
      });
      host.shadowRoot.addEventListener("input", (event) => {
        const control = event.target;
        if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement)) return;
        const form = control.closest("[data-config-source]");
        if (!form || !control.dataset.configField) return;
        const state = window[STATE_KEY];
        if (!state?.configuration) return;
        const sourceId = form.dataset.configSource;
        const draft = configurationDraft(sourceId);
        draft[control.dataset.configField] = control.value;
        control.removeAttribute("aria-invalid");
        setText(form.querySelector(`[data-config-error="${control.dataset.configField}"]`), "");
      });
      host.shadowRoot.addEventListener("submit", (event) => {
        const form = event.target;
        if (!(form instanceof HTMLFormElement) || !form.dataset.configSource) return;
        event.preventDefault();
        const state = window[STATE_KEY];
        if (!state?.configuration || state.configuration.pending) return;
        const sourceId = form.dataset.configSource;
        const draft = configurationDraft(sourceId);
        const t = createTranslator(loadSettings().englishUi ? "en" : "zh");
        const errors = validateConfiguration(sourceId, draft, t);
        for (const control of form.querySelectorAll("[data-config-field]")) {
          const message = errors[control.dataset.configField] || "";
          control.setAttribute("aria-invalid", String(Boolean(message)));
          setText(form.querySelector(`[data-config-error="${control.dataset.configField}"]`), message);
        }
        const firstInvalid = form.querySelector('[aria-invalid="true"]');
        if (firstInvalid) {
          firstInvalid.closest("details")?.setAttribute("open", "");
          firstInvalid.focus();
          return;
        }
        if (typeof window[CONFIGURATION_BINDING] !== "function") {
          state.configuration.status = { sourceId, kind: "error", message: t("configurationUnavailable") };
          render(host, state.usage, true);
          return;
        }
        const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        const type = sourceId === "api-account" ? "api-account" : "api-key";
        const request = type === "api-account"
          ? {
              requestId, type, baseUrl: draft.baseUrl.trim(), userId: draft.userId.trim(), token: draft.token,
              initialTokens: draft.initialTokens.trim(),
            }
          : {
              requestId, type, apiKey: draft.apiKey,
              provider: {
                id: /^[a-z0-9][a-z0-9_-]{0,31}$/.test(draft.id || "") ? draft.id : "custom",
                label: "API Key",
                baseUrl: draft.baseUrl.trim(), usagePath: draft.usagePath,
                statusPath: draft.statusPath, authHeader: draft.authHeader, authScheme: draft.authScheme,
                usageRoot: draft.usageRoot, statusRoot: draft.statusRoot, used: draft.used, limit: draft.limit,
                unlimited: draft.unlimited, expiresAt: draft.expiresAt, quotaPerUnit: draft.quotaPerUnit,
                currency: draft.currency, defaultQuotaPerUnit: Number(draft.defaultQuotaPerUnit),
                defaultCurrency: draft.defaultCurrency,
              },
            };
        state.configuration.pending = requestId;
        state.configuration.status = { sourceId, kind: "idle", message: t("savingConfiguration") };
        render(host, state.usage, true);
        try { window[CONFIGURATION_BINDING](JSON.stringify(request)); }
        catch {
          state.configuration.pending = null;
          state.configuration.status = { sourceId, kind: "error", message: t("configurationUnavailable") };
          render(host, state.usage, true);
        }
      });
      host.shadowRoot.addEventListener("change", (event) => {
        const input = event.target;
        if (!(input instanceof HTMLInputElement) || input.type !== "checkbox") return;
        const state = window[STATE_KEY];
        const usage = normalizeUsage(state?.usage || window[USAGE_KEY]);
        if (["minimalMode", "countdownVisualization", "englishUi", "updateNotifications"].includes(input.dataset.setting)) {
          const settings = loadSettings();
          settings[input.dataset.setting] = input.checked;
          saveSettings(settings);
          render(host, usage);
          return;
        }
        if (!input.dataset.metric || !input.dataset.source) return;
        const rawSource = usage.sources[input.dataset.source]
          || (input.dataset.source === "api-key" ? Object.values(usage.sources).find((item) => item.accountType === "api-key") : null);
        if (!rawSource) return;
        const source = selectableSource(rawSource);
        const settings = loadSettings();
        const current = selectedMetrics(source, settings).map((item) => item.id);
        const selectedCount = Object.values(usage.sources)
          .map(selectableSource)
          .reduce((count, candidate) => count + selectedMetrics(candidate, settings).length, 0);
        if (input.checked && selectedCount >= selectedMetricLimit(settings)) {
          input.checked = false;
          return;
        }
        let next = input.checked
          ? [...new Set([...current, input.dataset.metric])]
          : current.filter((id) => id !== input.dataset.metric);
        settings.metrics[source.id] = next;
        saveSettings(settings);
        render(host, usage);
      });
    }
    const portal = document.body || placement.composer.parentElement;
    const moved = host.parentElement !== portal;
    if (moved) portal.appendChild(host);
    const position = configurePosition(host, placement.composer, HOST_ID);
    host.dataset.placementStrategy = placement.strategy;
    host.dataset.status = position.ok ? "ready" : "degraded";
    if (state) {
      state.host = host;
      state.health = {
        ok: position.ok,
        reason: position.reason,
        strategy: placement.strategy,
        anchor: position.anchor,
        availableWidth: position.availableWidth,
        checkedAt: Date.now(),
      };
    }
    if (created || moved || host.dataset.rendered !== "true") render(host, state?.usage || window[USAGE_KEY]);
    return host;
  };

  const scheduler = { timeout: null };
  const scheduleEnsure = () => {
    if (scheduler.timeout) clearTimeout(scheduler.timeout);
    scheduler.timeout = setTimeout(() => {
      scheduler.timeout = null;
      ensure();
    }, PLACEMENT_DEBOUNCE_MS);
  };
  const observer = new MutationObserver(scheduleEnsure);
  const observerTarget = document.documentElement || document;
  observer.observe(observerTarget, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  const timer = setInterval(() => {
    if (!document.hidden) ensure();
  }, LAYOUT_FALLBACK_INTERVAL_MS);
  const countdownTimer = setInterval(() => {
    if (document.hidden) return;
    const state = window[STATE_KEY];
    if (state?.host) updateCountdowns(state.host, state.usage);
  }, COUNTDOWN_INTERVAL_MS);
  const resizeHandler = scheduleEnsure;
  const visibilityHandler = () => {
    if (document.hidden) return;
    ensure();
    const state = window[STATE_KEY];
    if (state?.host) updateCountdowns(state.host, state.usage);
  };
  const outsideHandler = (event) => {
    const host = document.getElementById(HOST_ID);
    if (!host || host.dataset.open !== "true" || host.contains(event.target)) return;
    host.dataset.open = "false";
    host.shadowRoot?.querySelector(".usage-summary")?.setAttribute("aria-expanded", "false");
    const popover = host.shadowRoot?.querySelector(".usage-popover");
    if (popover) popover.hidden = true;
  };
  window.addEventListener("resize", resizeHandler, { passive: true });
  window.addEventListener("pointerdown", outsideHandler, true);
  document.addEventListener("visibilitychange", visibilityHandler);

  window[STATE_KEY] = {
    observer,
    timer,
    countdownTimer,
    scheduler,
    resizeHandler,
    visibilityHandler,
    outsideHandler,
    host: null,
    health: { ok: false, reason: "initializing", strategy: "none", checkedAt: Date.now() },
    usage: normalizeUsage(previousUsage),
    configuration: {
      summary: normalizeConfigurationSummary(window[CONFIGURATION_KEY]),
      openSourceId: null,
      drafts: {},
      pending: null,
      status: { sourceId: null, kind: "idle", message: "" },
    },
    ensure,
    diagnose() { return { ...this.health }; },
    getSettings() { return loadSettings(); },
    updateUsage(value) {
      const usage = preserveMetricsWhileLoading(this.usage, normalizeUsage(value));
      this.usage = usage;
      window[USAGE_KEY] = usage;
      const host = ensure();
      if (host) render(host, usage);
      return true;
    },
    configurationResult(requestId, result) {
      if (!this.configuration.pending || requestId !== this.configuration.pending) return false;
      const sourceId = this.configuration.openSourceId;
      const t = createTranslator(loadSettings().englishUi ? "en" : "zh");
      this.configuration.pending = null;
      if (result?.ok) {
        this.configuration.summary = normalizeConfigurationSummary(result.configuration || this.configuration.summary);
        if (this.configuration.drafts[sourceId]) {
          this.configuration.drafts[sourceId].token = "";
          this.configuration.drafts[sourceId].apiKey = "";
        }
        this.configuration.status = { sourceId, kind: "success", message: t("configurationSaved") };
      } else {
        const detail = typeof result?.message === "string" ? result.message.slice(0, 240) : t("configurationFailed");
        this.configuration.status = { sourceId, kind: "error", message: detail };
      }
      const host = ensure();
      if (host) render(host, this.usage, true);
      return true;
    },
    cleanup() {
      for (const draft of Object.values(this.configuration?.drafts || {})) {
        if (draft && typeof draft === "object") { draft.token = ""; draft.apiKey = ""; }
      }
      observer.disconnect();
      clearInterval(timer);
      clearInterval(countdownTimer);
      if (scheduler.timeout) clearTimeout(scheduler.timeout);
      window.removeEventListener("resize", resizeHandler);
      window.removeEventListener("pointerdown", outsideHandler, true);
      document.removeEventListener("visibilitychange", visibilityHandler);
      document.getElementById(HOST_ID)?.remove();
      delete window[USAGE_KEY];
      delete window[STATE_KEY];
      delete window.__CODEX_USAGE_MONITOR_MODULES__;
      return true;
    },
  };
  window[USAGE_KEY] = window[STATE_KEY].usage;
  const host = ensure();
  return {
    installed: Boolean(host),
    mode: "monitor-only",
    anchoredToApproval: Boolean(host && host.dataset.anchor === "approval"),
  };
})()
