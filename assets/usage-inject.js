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
  const REFRESH_INTERVAL_MS = 90000;

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
  const validStatus = (value) => ["loading", "ready", "stale", "unavailable", "error"].includes(value) ? value : "unavailable";
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
      accountType: source.accountType === "api-key" ? "api-key" : "subscription",
      status: validStatus(source.status),
      error: typeof source.error === "string" ? source.error.slice(0, 160) : null,
      fetchedAt: finiteNumber(source.fetchedAt) ? Number(source.fetchedAt) : null,
      nextRefreshAt: finiteNumber(source.nextRefreshAt)
        ? Number(source.nextRefreshAt)
        : finiteNumber(source.fetchedAt) ? Number(source.fetchedAt) + REFRESH_INTERVAL_MS : null,
      metrics: (Array.isArray(source.metrics) ? source.metrics : []).map(normalizeMetric).filter(Boolean).slice(0, 12),
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
        source: typeof value?.source === "string" ? value.source : "official",
        metrics: Object.fromEntries(Object.entries(metrics).map(([id, ids]) => [id, Array.isArray(ids) ? ids.filter((item) => typeof item === "string").slice(0, 12) : []])),
        apiKeyMetricsVersion: Number(value?.apiKeyMetricsVersion) || 0,
        officialMetricsVersion: Number(value?.officialMetricsVersion) || 0,
      };
    } catch {
      return { source: "official", metrics: {}, apiKeyMetricsVersion: 0, officialMetricsVersion: 0 };
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
    let ids = Array.isArray(settings.metrics[source.id]) ? settings.metrics[source.id].filter((id) => available.has(id)) : [];
    if (!ids.length) ids = source.metrics.filter((item) => item.defaultVisible).map((item) => item.id);
    if (!ids.length && source.metrics[0]) ids = [source.metrics[0].id];
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
      : source.status === "error" ? "请求失败"
      : source.error?.includes("未配置") ? "未配置" : "不可用";
    const seconds = finiteNumber(source.nextRefreshAt)
      ? Math.max(0, Math.ceil((Number(source.nextRefreshAt) - Date.now()) / 1000))
      : null;
    const refreshValue = seconds === null ? "--" : `${seconds}秒后`;
    return [
      { id: "usedAmount", label: "已用额度", display: `已用 ${usedValue}`, value: usedValue, defaultVisible: true },
      { id: "quotaLimit", label: "限额", display: `限额 ${limitValue}`, value: limitValue, defaultVisible: true },
      { id: "expiresAt", label: "到期时间", display: `到期 ${expiryValue}`, value: expiryValue, defaultVisible: false },
      { id: "requestStatus", label: "请求状态", display: `状态 ${requestValue}`, value: requestValue, defaultVisible: false },
      { id: "nextRefreshAt", label: "下次刷新时间", display: `刷新 ${refreshValue}`, value: refreshValue, defaultVisible: false },
    ];
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
    const seconds = finiteNumber(source.nextRefreshAt)
      ? Math.max(0, Math.ceil((Number(source.nextRefreshAt) - Date.now()) / 1000))
      : null;
    const refreshValue = seconds === null ? "--" : `${seconds}秒后`;
    rows.push(
      { id: "requestStatus", label: "请求状态", display: `状态 ${requestValue}`, value: requestValue, defaultVisible: false },
      { id: "nextRefreshAt", label: "下次刷新时间", display: `刷新 ${refreshValue}`, value: refreshValue, defaultVisible: false },
    );
    return rows;
  };
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
      <span class="usage-dot" aria-hidden="true"></span>
      <span class="usage-primary">用量 --</span>
      <span class="usage-separator" aria-hidden="true">·</span>
      <span class="usage-secondary"></span>
      <span class="usage-today-separator" aria-hidden="true">·</span>
      <span class="usage-today"></span>
      <span class="usage-extra"></span>
    </button>
    <div class="usage-popover" role="dialog" aria-label="用量显示设置" hidden>
      <div class="usage-source-switch" role="tablist" aria-label="用量来源">
        <button type="button" role="tab" data-source="official">官方订阅</button>
        <button type="button" role="tab" data-source="api-key">API Key</button>
      </div>
      <div class="usage-metric-options"></div>
      <div class="usage-popover-body"></div>
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
      gap: 6px;
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
    }
    .usage-summary:hover, .usage-summary:focus-visible {
      background: color-mix(in srgb, currentColor 10%, transparent);
      outline: none;
    }
    :host([data-density="dense"]) .usage-summary {
      gap: 2px;
      padding-inline: 6px;
    }
    :host([data-density="dense"]) .usage-summary > .usage-primary,
    :host([data-density="dense"]) .usage-summary > .usage-secondary,
    :host([data-density="dense"]) .usage-summary > .usage-today,
    :host([data-density="dense"]) .usage-summary > .usage-extra,
    :host([data-density="dense"]) .usage-extra-item {
      flex: 0 0 auto;
      overflow: visible;
      text-overflow: clip;
    }
    :host([data-density="dense"]) .usage-extra { gap: 2px; }
    :host([data-density="dense"]) .usage-today { padding-left: 0; }
    .usage-dot {
      width: 5px;
      height: 5px;
      flex: 0 0 auto;
      border-radius: 50%;
      background: #34a853;
      box-shadow: 0 0 0 2px color-mix(in srgb, #34a853 15%, transparent);
    }
    :host([data-status="loading"]) .usage-dot { background: #d49b33; }
    :host([data-status="unavailable"]) .usage-dot { background: #929292; box-shadow: none; }
    :host([data-status="stale"]) .usage-dot, :host([data-status="error"]) .usage-dot { background: #d36b55; }
    .usage-primary, .usage-secondary, .usage-today, .usage-extra-item { overflow: hidden; text-overflow: ellipsis; }
    .usage-secondary, .usage-today, .usage-extra { opacity: .82; }
    .usage-today { padding-left: 4px; }
    .usage-extra { display: inline-flex; align-items: center; min-width: 0; gap: 6px; }
    :host([data-compact="true"]) .usage-secondary,
    :host([data-compact="true"]) .usage-separator,
    :host([data-compact="true"]) .usage-today,
    :host([data-compact="true"]) .usage-today-separator,
    :host([data-compact="true"]) .usage-extra { display: none; }
    [hidden] { display: none !important; }
    .usage-popover {
      position: absolute;
      left: 0;
      bottom: calc(100% + 8px);
      z-index: 40;
      width: min(252px, calc(100vw - 24px));
      max-height: min(360px, calc(100vh - 72px));
      padding: 10px 11px;
      border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
      border-radius: 8px;
      color: inherit;
      background: var(--usage-surface, rgba(255, 255, 255, .96));
      box-shadow: 0 10px 28px rgba(0, 0, 0, .16);
      overflow-x: hidden;
      overflow-y: auto;
      overscroll-behavior: contain;
      scrollbar-gutter: stable;
      white-space: normal;
    }
    .usage-source-switch {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 2px;
      margin-bottom: 9px;
      padding: 2px;
      border: 1px solid color-mix(in srgb, currentColor 14%, transparent);
      border-radius: 6px;
      background: color-mix(in srgb, currentColor 4%, transparent);
    }
    .usage-source-switch button {
      height: 24px;
      padding: 0 7px;
      border: 0;
      border-radius: 4px;
      color: inherit;
      background: transparent;
      font: inherit;
      cursor: pointer;
    }
    .usage-source-switch button[aria-selected="true"] {
      background: var(--usage-surface, rgba(255, 255, 255, .96));
      box-shadow: 0 1px 3px rgba(0, 0, 0, .14);
      font-weight: 650;
    }
    .usage-metric-options { display: grid; grid-template-columns: 1fr 1fr; gap: 7px 8px; }
    .usage-metric-option { display: flex; align-items: center; min-width: 0; gap: 6px; cursor: pointer; }
    .usage-metric-option input { width: 13px; height: 13px; margin: 0; flex: 0 0 auto; accent-color: currentColor; }
    .usage-metric-option span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .usage-metric-option:has(input:disabled) { opacity: .45; cursor: default; }
    .usage-popover-body { margin-top: 9px; padding-top: 8px; border-top: 1px solid color-mix(in srgb, currentColor 12%, transparent); display: grid; gap: 4px; opacity: .84; white-space: pre-line; }
    .usage-popover-body[data-layout="rows"] { gap: 0; opacity: 1; white-space: normal; }
    .usage-detail-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 14px;
      min-height: 27px;
      border-bottom: 1px solid color-mix(in srgb, currentColor 9%, transparent);
    }
    .usage-detail-row:last-child { border-bottom: 0; }
    .usage-detail-select { display: flex; align-items: center; min-width: 0; gap: 7px; cursor: pointer; }
    .usage-detail-select input { width: 13px; height: 13px; margin: 0; flex: 0 0 auto; accent-color: currentColor; }
    .usage-detail-select:has(input:disabled) { opacity: .45; cursor: default; }
    .usage-detail-label { min-width: 0; opacity: .68; }
    .usage-detail-value { max-width: 138px; overflow: hidden; color: inherit; font-weight: 650; text-align: right; text-overflow: ellipsis; white-space: nowrap; }
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

  const render = (host, value) => {
    if (!host?.shadowRoot) return;
    const usage = normalizeUsage(value);
    const settings = loadSettings();
    const source = usage.sources[settings.source] || usage.sources.official || Object.values(usage.sources)[0];
    if (!source) return;
    if (settings.source !== source.id) {
      settings.source = source.id;
      saveSettings(settings);
    }
    const apiKeyMode = source.accountType === "api-key";
    if (apiKeyMode && settings.apiKeyMetricsVersion < 1) {
      delete settings.metrics[source.id];
      settings.apiKeyMetricsVersion = 1;
      saveSettings(settings);
    }
    if (!apiKeyMode && settings.officialMetricsVersion < 1) {
      delete settings.metrics[source.id];
      settings.officialMetricsVersion = 1;
      saveSettings(settings);
    }
    const selectableSource = { ...source, metrics: apiKeyMode ? apiKeyMetrics(source) : officialMetrics(source) };
    const selected = selectedMetrics(selectableSource, settings);
    const denseSummary = selected.length >= 5;
    host.dataset.density = denseSummary ? "dense" : "normal";
    const summaryDisplay = (metric) => denseSummary ? compactSummaryDisplay(metric) : metric?.display;
    host.dataset.status = source.status;
    host.dataset.source = source.id;
    const shadow = host.shadowRoot;
    setText(shadow.querySelector(".usage-primary"), summaryDisplay(selected[0]) || `${source.label} --`);
    setText(shadow.querySelector(".usage-secondary"), summaryDisplay(selected[1]) || "");
    setText(shadow.querySelector(".usage-today"), summaryDisplay(selected[2]) || "");
    const extraRoot = shadow.querySelector(".usage-extra");
    if (extraRoot) {
      extraRoot.replaceChildren(...selected.slice(3).flatMap((metric) => {
        const separator = document.createElement("span");
        separator.className = "usage-extra-separator";
        separator.setAttribute("aria-hidden", "true");
        separator.textContent = "·";
        const item = document.createElement("span");
        item.className = "usage-extra-item";
        item.textContent = summaryDisplay(metric);
        return [separator, item];
      }));
      extraRoot.hidden = selected.length <= 3;
    }
    const secondaryNode = shadow.querySelector(".usage-secondary");
    const separatorNode = shadow.querySelector(".usage-separator");
    const todayNode = shadow.querySelector(".usage-today");
    const todaySeparatorNode = shadow.querySelector(".usage-today-separator");
    if (secondaryNode) secondaryNode.hidden = !selected[1];
    if (separatorNode) separatorNode.hidden = !selected[1];
    if (todayNode) todayNode.hidden = !selected[2];
    if (todaySeparatorNode) todaySeparatorNode.hidden = !selected[2];
    const statusText = source.status === "loading" ? "正在同步" : source.status === "error" ? "同步失败" : source.status === "stale" ? "数据可能已过期" : source.status === "ready" ? "已同步" : "暂无用量数据";
    shadow.querySelector(".usage-summary")?.setAttribute("aria-label", `${source.label}用量，${statusText}`);
    const apiSource = Object.values(usage.sources).find((item) => item.accountType === "api-key") || null;
    for (const button of shadow.querySelectorAll("[data-source]")) {
      const sourceId = button.dataset.source === "api-key" ? apiSource?.id : button.dataset.source;
      const exists = Boolean(sourceId && usage.sources[sourceId]);
      button.dataset.sourceId = sourceId || "";
      if (button.dataset.source === "api-key") button.textContent = "API Key";
      button.hidden = !exists;
      button.setAttribute("aria-selected", String(sourceId === source.id));
      button.tabIndex = sourceId === source.id ? 0 : -1;
    }
    const optionRoot = shadow.querySelector(".usage-metric-options");
    if (optionRoot) {
      optionRoot.hidden = true;
      optionRoot.replaceChildren();
    }
    const body = shadow.querySelector(".usage-popover-body");
    if (body) {
      body.dataset.layout = "rows";
      body.replaceChildren(...selectableSource.metrics.map((metric) => {
        const row = document.createElement("div");
        row.className = "usage-detail-row";
        const select = document.createElement("label");
        select.className = "usage-detail-select";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.dataset.metric = metric.id;
        input.checked = selected.some((item) => item.id === metric.id);
        const label = document.createElement("span");
        label.className = "usage-detail-label";
        label.textContent = metric.label;
        select.append(input, label);
        const value = document.createElement("span");
        value.className = "usage-detail-value";
        value.textContent = metric.value;
        row.append(select, value);
        return row;
      }));
    }
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
      const surface = getComputedStyle(composer).backgroundColor;
      host.style.setProperty("--usage-surface", surface && surface !== "rgba(0, 0, 0, 0)" ? surface : "rgba(255, 255, 255, .96)");
    }
    host.style.setProperty("--usage-left", `${Math.round(placementX - parentBox.x)}px`);
    host.style.setProperty("--usage-max-width", `${available}px`);
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
    if (!host?.shadowRoot) {
      host?.remove();
      host = document.createElement("span");
      host.id = HOST_ID;
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
      for (const button of host.shadowRoot.querySelectorAll("[data-source]")) {
        button.addEventListener("click", () => {
          const state = window[STATE_KEY];
          const usage = normalizeUsage(state?.usage || window[USAGE_KEY]);
          const sourceId = button.dataset.sourceId || button.dataset.source;
          if (!usage.sources[sourceId]) return;
          const settings = loadSettings();
          settings.source = sourceId;
          saveSettings(settings);
          render(host, usage);
        });
      }
      host.shadowRoot.addEventListener("change", (event) => {
        const input = event.target;
        if (!(input instanceof HTMLInputElement) || input.type !== "checkbox" || !input.dataset.metric) return;
        const state = window[STATE_KEY];
        const usage = normalizeUsage(state?.usage || window[USAGE_KEY]);
        const source = usage.sources[host.dataset.source];
        if (!source) return;
        const selectableSource = { ...source, metrics: source.accountType === "api-key" ? apiKeyMetrics(source) : officialMetrics(source) };
        const settings = loadSettings();
        const current = selectedMetrics(selectableSource, settings).map((item) => item.id);
        let next = input.checked
          ? [...new Set([...current, input.dataset.metric])]
          : current.filter((id) => id !== input.dataset.metric);
        if (!next.length) {
          input.checked = true;
          return;
        }
        settings.metrics[source.id] = next;
        saveSettings(settings);
        render(host, usage);
      });
    }
    if (host.parentElement !== placement.parent) placement.parent.appendChild(host);
    configurePosition(host, placement.composer);
    if (state) state.host = host;
    render(host, state?.usage || window[USAGE_KEY]);
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
    if (state?.host) {
      render(state.host, state.usage);
    }
  }, 1000);
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
