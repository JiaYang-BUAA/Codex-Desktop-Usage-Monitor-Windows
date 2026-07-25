(() => {
  const STATE_KEY = "__CODEX_USAGE_MONITOR_STATE__";
  const USAGE_KEY = "__CODEX_USAGE_MONITOR__";
  const HOST_ID = "codex-usage-monitor";
  const SETTINGS_KEY = "codex-usage-monitor-settings-v1";
  const LEGACY_STATE_KEY = "__CODEX_DREAM_SKIN_USAGE_STATE__";
  const LEGACY_THEME_STATE_KEY = "__CODEX_DREAM_SKIN_STATE__";
  const LEGACY_USAGE_KEY = "__CODEX_DREAM_SKIN_USAGE__";
  const LEGACY_HOST_ID = "codex-dream-skin-usage";
  const LEGACY_SETTINGS_KEY = "codex-dream-skin-usage-settings-v1";
  const REFRESH_INTERVAL_MS = 30000;
  const MAX_SELECTED_METRICS = 8;
  const MAX_MINIMAL_SELECTED_METRICS = 14;

  const previousUsage = window[STATE_KEY]?.usage || window[USAGE_KEY] || window[LEGACY_STATE_KEY]?.usage || window[LEGACY_THEME_STATE_KEY]?.usage || window[LEGACY_USAGE_KEY] || null;
  try { window[STATE_KEY]?.cleanup?.(); } catch {}
  try { window[LEGACY_STATE_KEY]?.cleanup?.(); } catch {}
  try { window[LEGACY_THEME_STATE_KEY]?.cleanup?.(); } catch {}
  document.getElementById(LEGACY_HOST_ID)?.remove();

  const root = document.documentElement;
  root?.classList.remove("codex-dream-skin");
  root?.removeAttribute("data-dream-shell");
  root?.removeAttribute("data-dream-theme");
  root?.removeAttribute("data-dream-mode");
  root?.removeAttribute("data-dream-copy");
  document.querySelectorAll(".dream-home, .dream-skin-home, .dream-home-shell, .dream-skin-home-shell")
    .forEach((node) => node.classList.remove("dream-home", "dream-skin-home", "dream-home-shell", "dream-skin-home-shell"));
  document.getElementById("codex-dream-skin-style")?.remove();
  document.getElementById("codex-dream-skin-chrome")?.remove();

  const setText = (node, value) => {
    const text = String(value ?? "");
    if (node && node.textContent !== text) node.textContent = text;
  };
  const finiteNumber = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
  const formatExactInteger = (value) => finiteNumber(value)
    ? String(Math.round(Math.max(0, Number(value)))).replace(/\B(?=(\d{3})+(?!\d))/g, ",")
    : "--";
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
      metrics.push({ id: index ? "secondaryRemaining" : "primaryRemaining", label: `${label} 剩余`, display: `${label} ${formatPercent(remaining)}`, detail: `${label} 剩余 ${formatPercent(remaining)}`, defaultVisible: index === 0 });
      metrics.push({ id: index ? "secondaryReset" : "primaryReset", label: `${label} 重置`, display: `${label} ${formatReset(item?.resetsAt)}`, detail: `${label}：${formatReset(item?.resetsAt)}`, defaultVisible: false });
    }
    if (finiteNumber(source.todayTokens)) metrics.push({ id: "todayTokens", label: "今日 token", display: `今日 ${formatTokens(Number(source.todayTokens))}`, detail: `今日 token：${formatTokens(Number(source.todayTokens))}`, defaultVisible: true });
    if (finiteNumber(source.lifetimeTokens)) metrics.push({ id: "lifetimeTokens", label: "累计 token", display: `累计 ${formatTokens(Number(source.lifetimeTokens))}`, detail: `累计 token：${formatTokens(Number(source.lifetimeTokens))}`, defaultVisible: false });
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
        if (metric.id === "todayTokens" && finiteNumber(source.todayTokens)) return { ...metric, value: formatExactInteger(source.todayTokens) };
        if (metric.id === "lifetimeTokens" && finiteNumber(source.lifetimeTokens)) return { ...metric, value: formatExactInteger(source.lifetimeTokens) };
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
    if (value >= 1000000) return `${(value / 1000000).toFixed(value >= 10000000 ? 0 : 1).replace(/\.0$/, "")}m`;
    if (value >= 1000) return `${(value / 1000).toFixed(value >= 100000 ? 0 : 1).replace(/\.0$/, "")}k`;
    return String(Math.round(value));
  };
  const formatChineseTokenUnit = (value) => {
    if (!finiteNumber(value)) return "--";
    const number = Math.max(0, Number(value));
    if (number >= 100000000) return `${(number / 100000000).toFixed(2)}亿`;
    return `${Math.round(number / 10000)}万`;
  };
  const formatReset = (timestamp) => {
    if (!timestamp) return "重置时间未知";
    const minutes = Math.round(Math.max(0, timestamp * 1000 - Date.now()) / 60000);
    if (minutes < 60) return `${Math.max(1, minutes)} 分钟后重置`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} 小时后重置`;
    return `${Math.floor(hours / 24)} 天后重置`;
  };
  const loadSettings = () => {
    try {
      const value = JSON.parse(localStorage.getItem(SETTINGS_KEY) || localStorage.getItem(LEGACY_SETTINGS_KEY) || "null");
      const metrics = value?.metrics && typeof value.metrics === "object" ? value.metrics : {};
      return {
        metrics: Object.fromEntries(Object.entries(metrics).map(([id, ids]) => [id, Array.isArray(ids) ? ids.map((item) => item === "dayTokens" ? "todayTokens" : item).filter((item) => typeof item === "string").slice(0, 12) : []])),
        apiKeyMetricsVersion: Number(value?.apiKeyMetricsVersion) || 0,
        officialMetricsVersion: Number(value?.officialMetricsVersion) || 0,
        unifiedMetricsVersion: Number(value?.unifiedMetricsVersion) || 0,
        minimalMode: Boolean(value?.minimalMode),
        countdownVisualization: Boolean(value?.countdownVisualization),
      };
    } catch {
      return { metrics: {}, apiKeyMetricsVersion: 0, officialMetricsVersion: 0, unifiedMetricsVersion: 0, minimalMode: false, countdownVisualization: false };
    }
  };
  const saveSettings = (value) => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(value));
      localStorage.removeItem(LEGACY_SETTINGS_KEY);
    } catch {}
  };
  const selectedMetrics = (source, settings) => {
    const available = new Map(source.metrics.map((item) => [item.id, item]));
    const hasSavedSelection = Object.prototype.hasOwnProperty.call(settings.metrics, source.id);
    let ids = hasSavedSelection && Array.isArray(settings.metrics[source.id])
      ? settings.metrics[source.id].filter((id) => available.has(id))
      : source.metrics.filter((item) => item.defaultVisible).map((item) => item.id);
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
    // Official accounts may return a primary short window and a secondary weekly window.
    // The monitor intentionally follows only the primary/short window.
    const remainingMetrics = source.metrics.filter((item) => /Remaining$/.test(item.id)).slice(0, 1);
    const rows = [];
    for (const [index, metric] of remainingMetrics.entries()) {
      const resetId = metric.id.replace(/Remaining$/, "Reset");
      const resetMetric = metricById.get(resetId);
      const period = metric.label.replace(/\s*剩余\s*$/, "").trim() || (index === 0 ? "主周期" : "次周期");
      const remainingValue = metric.value || metric.display.match(/(?:^|\s)(\d+(?:\.\d+)?%|--)\s*$/)?.[1] || "--";
      const compactRemaining = remainingMetrics.length === 1 ? "剩余" : index === 0 ? "短期" : "长期";
      rows.push({
        id: metric.id,
        label: remainingMetrics.length === 1 ? "周期剩余" : index === 0 ? "短期剩余" : "长期剩余",
        display: `${compactRemaining} ${remainingValue}`,
        value: remainingValue,
        defaultVisible: index === 0,
      });
      if (resetMetric) {
        const legacyReset = metricValue(resetMetric, new RegExp(`^${period.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`));
        const resetValue = legacyReset.replace(/\s+/g, "").replace(/后重置$/, "后");
        const compactReset = remainingMetrics.length === 1 ? "重置" : index === 0 ? "短重" : "长重";
        rows.push({
          id: resetMetric.id,
          label: remainingMetrics.length === 1 ? "重置时间" : `${period}重置时间`,
          display: `${compactReset} ${resetValue}`,
          value: resetValue,
          defaultVisible: index === 0,
        });
      }
    }
    for (const [id, label, compactLabel] of [
      ["todayTokens", "今日 Token", "今日"],
      ["lifetimeTokens", "累计 Token", "累计"],
    ]) {
      const metric = metricById.get(id);
      if (!metric) continue;
      const value = metric.value || metricValue(metric, new RegExp(`^${compactLabel}\\s*`));
      const numericValue = Number(String(value).replace(/,/g, ""));
      const displayValue = Number.isFinite(numericValue) ? formatChineseTokenUnit(numericValue) : metricValue(metric, new RegExp(`^${compactLabel}\\s*`));
      rows.push({ id, label, display: `${compactLabel} ${displayValue}`, value: displayValue, defaultVisible: false });
    }
    const requestValue = source.status === "ready" ? "正常"
      : source.status === "loading" ? "请求中"
      : source.status === "stale" ? "数据过期"
      : source.status === "error" ? "请求失败" : "不可用";
    rows.push({ id: "requestStatus", label: "请求状态", display: `状态 ${requestValue}`, value: requestValue, defaultVisible: false });
    return rows;
  };
  const selectableSource = (source) => ({
    ...source,
    metrics: source.accountType === "api-key"
      ? apiKeyMetrics(source)
      : source.accountType === "api-account" ? apiAccountMetrics(source) : officialMetrics(source),
  });
  const box = (node) => {
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
  };
  const isVisible = (node) => {
    const rect = node?.getBoundingClientRect();
    return Boolean(rect && rect.width > 0 && rect.height > 0);
  };
  const controlText = (node) => `${node.getAttribute("aria-label") || ""} ${node.getAttribute("title") || ""} ${node.textContent || ""}`.trim();

  const findPlacement = () => {
    const composerSelector = '.composer-surface-chrome, [data-testid="composer"], [data-testid*="composer-"]';
    const composers = [...document.querySelectorAll(composerSelector)].filter(isVisible);
    const editables = [...document.querySelectorAll('textarea, [contenteditable="true"]')]
      .filter((node) => isVisible(node) && !node.closest(`#${HOST_ID}`));
    const nearestComposer = (editable) => {
      const explicit = editable.closest(composerSelector);
      if (explicit && isVisible(explicit)) return explicit;
      let current = editable.parentElement;
      for (let depth = 0; current && depth < 6; depth += 1, current = current.parentElement) {
        const rect = box(current);
        if (rect && rect.height >= 56 && rect.height <= 260 && current.querySelectorAll('button, [role="button"]').length >= 2) return current;
      }
      return null;
    };
    let composer = editables.map(nearestComposer).find(Boolean) || composers.at(-1) || null;
    if (!composer) return null;
    const composerBox = box(composer);
    const wrapper = composer.parentElement;
    const wrapperBox = box(wrapper);
    const wrapperWorks = wrapper && wrapperBox && getComputedStyle(wrapper).position !== "static" &&
      Math.abs(wrapperBox.width - composerBox.width) < 8 && Math.abs(wrapperBox.height - composerBox.height) < 8;
    return { composer, parent: wrapperWorks ? wrapper : composer };
  };

  const markup = `
    <button class="usage-summary" type="button" aria-label="Codex 用量详情" aria-expanded="false">
      <span class="usage-refresh-ring" aria-hidden="true" hidden></span>
      <span class="usage-summary-items"><span class="usage-summary-item">用量 --</span></span>
    </button>
    <div class="usage-popover" role="dialog" aria-label="用量显示设置" hidden>
      <div class="usage-columns"></div>
    </div>`;
  const css = `
    :host {
      position: absolute;
      left: var(--usage-left, 0px);
      bottom: 8px;
      z-index: 30;
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
      border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent);
      font-weight: 650;
    }
    .usage-status { width: 7px; height: 7px; flex: 0 0 auto; border-radius: 50%; background: #a1a1aa; }
    .usage-column[data-status="ready"] .usage-status { background: #22c55e; }
    .usage-column[data-status="loading"] .usage-status { background: #facc15; }
    .usage-column[data-status="stale"] .usage-status { background: #fb3f4f; }
    .usage-column-rows { display: grid; }
    .usage-detail-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 8px;
      min-height: 27px;
      border-bottom: 1px solid color-mix(in srgb, currentColor 9%, transparent);
    }
    .usage-detail-row:last-child { border-bottom: 0; }
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
      margin-top: auto;
      padding: 4px 0 2px;
      font-weight: 450;
      line-height: 1.35;
      opacity: .55;
      white-space: nowrap;
    }
    .usage-brand-product { font-size: 12px; }
    .usage-brand-credit { font-size: 9px; font-weight: 450; text-align: right; }
    .usage-column-footer {
      display: grid;
      gap: 2px;
      min-width: 0;
      margin-top: auto;
      padding-top: 4px;
    }
    .usage-mode-switches {
      display: flex;
      align-items: center;
      gap: 10px;
      min-height: 22px;
      white-space: nowrap;
    }
    .usage-mode-toggle {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      min-width: 0;
      font-size: 9px;
      line-height: 1;
      opacity: .72;
      cursor: pointer;
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
      justify-content: flex-start;
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
      .usage-mode-toggle { gap: 3px; font-size: 8px; }
      .usage-toggle-track { width: 22px; flex-basis: 22px; }
      .usage-mode-toggle input:checked + .usage-toggle-track::after { transform: translateX(8px); }
      .usage-column-meta { font-size: 9px; }
    }
    @supports not (color: color-mix(in srgb, red 50%, transparent)) {
      .usage-summary { border-color: rgba(128, 128, 128, .22); background: rgba(128, 128, 128, .06); }
      .usage-popover { border-color: rgba(128, 128, 128, .22); }
    }
  `;

  const compactSummaryDisplay = (metric) => {
    let display = String(metric?.display ?? "").replace(/\s+/g, "");
    if (/(?:Reset|nextRefreshAt)$/.test(String(metric?.id ?? ""))) display = display.replace(/后$/, "");
    return display;
  };
  const minimalSummaryDisplay = (metric) => {
    let value = String(metric?.value ?? "--").replace(/\s+/g, "");
    if (/(?:Reset|nextRefreshAt)$/.test(String(metric?.id ?? ""))) value = value.replace(/后$/, "");
    return value;
  };
  const selectedMetricLimit = (settings) => settings?.minimalMode
    ? MAX_MINIMAL_SELECTED_METRICS
    : MAX_SELECTED_METRICS;

  const updateCountdowns = (host, value) => {
    if (!host?.shadowRoot) return;
    const usage = normalizeUsage(value);
    const now = Date.now();
    const remainingMs = finiteNumber(usage.nextRefreshAt)
      ? Math.max(0, Number(usage.nextRefreshAt) - now)
      : null;
    const seconds = remainingMs === null ? null : Math.ceil(remainingMs / 1000);
    setText(host.shadowRoot.querySelector(".usage-refresh-countdown"), `刷新 ${seconds === null ? "--" : `${seconds}秒后`}`);
    const ring = host.shadowRoot.querySelector(".usage-refresh-ring");
    if (ring) {
      const progress = remainingMs === null ? 0 : Math.max(0, Math.min(1, 1 - remainingMs / REFRESH_INTERVAL_MS));
      ring.style.setProperty("--usage-refresh-progress", `${Math.round(progress * 360)}deg`);
    }
  };

  const render = (host, value) => {
    if (!host?.shadowRoot) return;
    const usage = normalizeUsage(value);
    const settings = loadSettings();
    const apiKeySource = Object.values(usage.sources).find((item) => item.accountType === "api-key")
      || normalizeSource({ id: "api-key", label: "API Key", accountType: "api-key", status: "unavailable", error: "未配置 API key" }, "api-key");
    const sources = [
      usage.sources.official || normalizeSource({ id: "official", label: "官方订阅", accountType: "subscription", status: "unavailable" }, "official"),
      usage.sources["api-account"] || normalizeSource({ id: "api-account", label: "API 账户", accountType: "api-account", status: "unavailable", error: "未配置 API 账户令牌" }, "api-account"),
      { ...apiKeySource, label: "API Key" },
    ].map(selectableSource);
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
      const items = selected.length ? selected : [{ source: null, metric: { display: "用量 --" } }];
      summaryRoot.replaceChildren(...items.map(({ source, metric }) => {
        const item = document.createElement("span");
        item.className = "usage-summary-item";
        item.textContent = summaryDisplay(metric);
        if (source) {
          item.dataset.source = source.id;
          item.dataset.metric = metric.id;
          item.title = `${source.label} · ${metric.label}：${metric.value || "--"}`;
        }
        return item;
      }));
    }
    shadow.querySelector(".usage-summary")?.setAttribute("aria-label", `Codex 用量，已显示 ${selected.length} 项`);
    const columns = shadow.querySelector(".usage-columns");
    if (columns) {
      const selectedKeys = new Set(selected.map((item) => `${item.source.id}:${item.metric.id}`));
      columns.replaceChildren(...sources.map((source) => {
        const column = document.createElement("section");
        column.className = "usage-column";
        column.dataset.status = source.status;
        const title = document.createElement("div");
        title.className = "usage-column-title";
        const status = document.createElement("span");
        status.className = "usage-status";
        const statusText = source.status === "loading" ? "请求中" : source.status === "ready" ? "正常" : source.status === "stale" ? "数据过期" : source.status === "rate-limited" ? "请求受限" : source.status === "error" ? "请求失败" : "暂无数据";
        status.title = source.error || statusText;
        status.setAttribute("aria-label", statusText);
        const heading = document.createElement("span");
        heading.textContent = source.label;
        title.append(status, heading);
        const rows = document.createElement("div");
        rows.className = "usage-column-rows";
        rows.replaceChildren(...source.metrics.map((metric) => {
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
        column.append(title, rows);
        if (source.accountType === "api-key") {
          const brand = document.createElement("div");
          brand.className = "usage-column-brand";
          const product = document.createElement("span");
          product.className = "usage-brand-product";
          product.textContent = "Codex Usage Monitor for Windows";
          const credit = document.createElement("span");
          credit.className = "usage-brand-credit";
          credit.textContent = "—— Designed by +羊 and Codex";
          brand.append(product, credit);
          column.append(brand);
        } else if (source.accountType === "subscription") {
          const footer = document.createElement("div");
          footer.className = "usage-column-footer";
          const switches = document.createElement("div");
          switches.className = "usage-mode-switches";
          for (const [setting, labelText] of [["minimalMode", "极简模式"], ["countdownVisualization", "倒计时可视化"]]) {
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
            ? `极简最多 ${MAX_MINIMAL_SELECTED_METRICS} 项`
            : `最多显示 ${MAX_SELECTED_METRICS} 项`;
          const separator = document.createElement("span");
          separator.setAttribute("aria-hidden", "true");
          separator.textContent = "·";
          const countdown = document.createElement("span");
          countdown.className = "usage-refresh-countdown";
          countdown.textContent = "刷新 --";
          meta.append(maximum, separator, countdown);
          footer.append(switches, meta);
          column.append(footer);
        }
        return column;
      }));
    }
    updateCountdowns(host, usage);
    host.dataset.rendered = "true";
  };

  const configurePosition = (host, composer) => {
    const composerBox = box(composer);
    const parentBox = box(host.parentElement) || composerBox;
    const controls = [...composer.querySelectorAll('button, [role="button"]')]
      .filter((node) => isVisible(node) && !node.closest(`#${HOST_ID}`));
    const approval = controls.find((node) => /(?:替我审批|approve|approval)/i.test(controlText(node))) || null;
    const controlBoxes = controls.map((node) => ({ node, rect: box(node) }));
    const bottomCenter = controlBoxes.reduce((maximum, item) => Math.max(maximum, item.rect.y + item.rect.height / 2), -Infinity);
    const bottomRow = controlBoxes
      .filter((item) => Math.abs(item.rect.y + item.rect.height / 2 - bottomCenter) <= 14)
      .sort((left, right) => left.rect.x - right.rect.x);
    const anchor = approval || bottomRow[0]?.node || null;
    const anchorBox = box(anchor);
    const rowCenter = anchorBox ? anchorBox.y + anchorBox.height / 2 : composerBox.bottom - 22;
    const controlsToRight = controls
      .map((node) => ({ node, rect: box(node) }))
      .filter(({ node, rect }) => node !== anchor && rect.x >= (anchorBox?.right ?? composerBox.x) &&
        Math.abs(rect.y + rect.height / 2 - rowCenter) <= 14);
    const anchorRight = anchorBox?.right ?? composerBox.x + 12;
    const placementX = anchorRight + 8;
    const rightBoundary = controlsToRight.reduce((minimum, value) => Math.min(minimum, value.rect.x), composerBox.right);
    const available = Math.max(0, Math.floor(rightBoundary - placementX - 8));
    const reference = anchor || controls.find((node) => /(?:\b5\.\d|model|极高|high)/i.test(controlText(node))) || controls[0];
    if (reference) {
      const referenceStyle = getComputedStyle(reference);
      host.style.setProperty("--usage-color", referenceStyle.color);
      if (referenceStyle.fontSize) host.style.setProperty("--usage-font-size", referenceStyle.fontSize);
      const surface = getComputedStyle(composer).backgroundColor;
      host.style.setProperty("--usage-surface", surface && surface !== "rgba(0, 0, 0, 0)" ? surface : "rgba(255, 255, 255, .96)");
    }
    host.style.setProperty("--usage-left", `${Math.round(placementX - parentBox.x)}px`);
    host.style.setProperty("--usage-max-width", `${available}px`);
    const popoverWidth = Math.max(280, Math.min(720, window.innerWidth - 24));
    const popoverShift = Math.min(0, window.innerWidth - 12 - placementX - popoverWidth);
    host.style.setProperty("--usage-popover-width", `${popoverWidth}px`);
    host.style.setProperty("--usage-popover-shift", `${Math.max(12 - placementX, popoverShift)}px`);
    host.dataset.anchor = approval ? "approval" : anchor ? "control" : "composer-left";
    host.dataset.compact = String(available < 210);
    host.hidden = available < 104;
  };

  const ensure = () => {
    const placement = findPlacement();
    const state = window[STATE_KEY];
    if (!placement) {
      document.getElementById(HOST_ID)?.remove();
      if (state) state.host = null;
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
      host.shadowRoot.addEventListener("change", (event) => {
        const input = event.target;
        if (!(input instanceof HTMLInputElement) || input.type !== "checkbox") return;
        const state = window[STATE_KEY];
        const usage = normalizeUsage(state?.usage || window[USAGE_KEY]);
        if (["minimalMode", "countdownVisualization"].includes(input.dataset.setting)) {
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
    const moved = host.parentElement !== placement.parent;
    if (moved) placement.parent.appendChild(host);
    configurePosition(host, placement.composer);
    if (state) state.host = host;
    if (created || moved || host.dataset.rendered !== "true") render(host, state?.usage || window[USAGE_KEY]);
    return host;
  };

  const scheduler = { timeout: null };
  const scheduleEnsure = () => {
    if (scheduler.timeout) clearTimeout(scheduler.timeout);
    scheduler.timeout = setTimeout(() => {
      scheduler.timeout = null;
      ensure();
    }, 120);
  };
  const observer = new MutationObserver(scheduleEnsure);
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  const timer = setInterval(ensure, 4000);
  const countdownTimer = setInterval(() => {
    const state = window[STATE_KEY];
    if (state?.host) updateCountdowns(state.host, state.usage);
  }, 250);
  const resizeHandler = scheduleEnsure;
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

  window[STATE_KEY] = {
    observer,
    timer,
    countdownTimer,
    scheduler,
    resizeHandler,
    outsideHandler,
    host: null,
    usage: normalizeUsage(previousUsage),
    ensure,
    updateUsage(value) {
      const usage = preserveMetricsWhileLoading(this.usage, normalizeUsage(value));
      this.usage = usage;
      window[USAGE_KEY] = usage;
      window[LEGACY_USAGE_KEY] = usage;
      const host = ensure();
      if (host) render(host, usage);
      return true;
    },
    cleanup() {
      observer.disconnect();
      clearInterval(timer);
      clearInterval(countdownTimer);
      if (scheduler.timeout) clearTimeout(scheduler.timeout);
      window.removeEventListener("resize", resizeHandler);
      window.removeEventListener("pointerdown", outsideHandler, true);
      document.getElementById(HOST_ID)?.remove();
      document.getElementById(LEGACY_HOST_ID)?.remove();
      delete window[USAGE_KEY];
      delete window[STATE_KEY];
      delete window[LEGACY_USAGE_KEY];
      delete window[LEGACY_STATE_KEY];
      return true;
    },
  };
  window[USAGE_KEY] = window[STATE_KEY].usage;
  // Temporary aliases let an already-running pre-1.0 injector update the migrated monitor.
  window[LEGACY_STATE_KEY] = window[STATE_KEY];
  window[LEGACY_USAGE_KEY] = window[STATE_KEY].usage;
  const host = ensure();
  return {
    installed: Boolean(host),
    mode: "monitor-only",
    anchoredToApproval: Boolean(host && host.dataset.anchor === "approval"),
  };
})()
