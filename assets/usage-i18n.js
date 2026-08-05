(() => {
  const registry = window.__CODEX_USAGE_MONITOR_MODULES__ ||= {};
  const messages = Object.freeze({
    zh: Object.freeze({
      summaryDetails: "Codex 用量详情",
      displaySettings: "用量显示设置",
      usageUnavailable: "用量 --",
      displayedItems: "Codex 用量，已显示 {count} 项",
      official: "官方订阅",
      apiAccount: "API 账户",
      apiKey: "API Key",
      taskSection: "本次任务相关",
      loading: "请求中",
      ready: "正常",
      stale: "数据过期",
      rateLimited: "请求受限",
      error: "请求失败",
      unavailable: "暂无数据",
      taskReady: "当前任务数据正常",
      taskUnavailable: "暂无当前任务数据",
      minimalMode: "极简模式",
      countdownVisualization: "倒计时可视化",
      englishUi: "English UI",
      updateNotifications: "版本更新提醒",
      maximum: "最多显示 {count} 项",
      minimalMaximum: "极简最多 {count} 项",
      refreshIn: "刷新 {seconds}",
      updateAvailable: "v{version} 可用",
      updateTitle: "打开 GitHub Release v{version}",
      metrics: Object.freeze({
        primaryRemaining: "5小时剩余", secondaryRemaining: "7天剩余", primaryReset: "重置时间",
        todayTokens: "今日 Token", lifetimeTokens: "累计 Token", currentTaskTokens: "当前任务累计 Token",
        lastTurnTokens: "上次对话消耗 Token", balance: "账户余额", usedQuota: "累计已用额度",
        totalTokens: "累计 Token", lastQuota: "上次消耗额度", lastModel: "上次响应模型",
        lastRequestAt: "上次请求时间", lastLatency: "上次响应耗时", usedAmount: "已用额度",
        quotaLimit: "限额", expiresAt: "到期时间", requestStatus: "请求状态",
      }),
      compact: Object.freeze({
        primaryRemaining: "5时", secondaryRemaining: "7天", primaryReset: "重置", todayTokens: "今日",
        lifetimeTokens: "累计", currentTaskTokens: "任务", lastTurnTokens: "上次", balance: "余额",
        usedQuota: "已用", totalTokens: "累计", lastQuota: "消耗", lastModel: "模型",
        lastRequestAt: "请求", lastLatency: "耗时", usedAmount: "已用", quotaLimit: "限额",
        expiresAt: "到期", requestStatus: "状态",
      }),
    }),
    en: Object.freeze({
      summaryDetails: "Codex usage details",
      displaySettings: "Usage display settings",
      usageUnavailable: "Usage --",
      displayedItems: "Codex usage, {count} items shown",
      official: "Official Subscription",
      apiAccount: "API Account",
      apiKey: "API Key",
      taskSection: "Current Task",
      loading: "Loading",
      ready: "Ready",
      stale: "Stale",
      rateLimited: "Rate limited",
      error: "Request failed",
      unavailable: "No data",
      taskReady: "Current task data is ready",
      taskUnavailable: "No current task data",
      minimalMode: "Minimal mode",
      countdownVisualization: "Countdown ring",
      englishUi: "中文界面",
      updateNotifications: "Update alerts",
      maximum: "Up to {count} items",
      minimalMaximum: "Minimal up to {count}",
      refreshIn: "Refresh in {seconds}",
      updateAvailable: "v{version} available",
      updateTitle: "Open GitHub Release v{version}",
      metrics: Object.freeze({
        primaryRemaining: "5-hour remaining", secondaryRemaining: "7-day remaining", primaryReset: "Reset time",
        todayTokens: "Tokens today", lifetimeTokens: "Lifetime tokens", currentTaskTokens: "Current task tokens",
        lastTurnTokens: "Last turn tokens", balance: "Balance", usedQuota: "Total quota used",
        totalTokens: "Total tokens", lastQuota: "Last quota cost", lastModel: "Last response model",
        lastRequestAt: "Last request", lastLatency: "Last latency", usedAmount: "Amount used",
        quotaLimit: "Limit", expiresAt: "Expires", requestStatus: "Request status",
      }),
      compact: Object.freeze({
        primaryRemaining: "5h", secondaryRemaining: "7d", primaryReset: "Reset", todayTokens: "Today",
        lifetimeTokens: "Total", currentTaskTokens: "Task", lastTurnTokens: "Last", balance: "Balance",
        usedQuota: "Used", totalTokens: "Total", lastQuota: "Cost", lastModel: "Model",
        lastRequestAt: "Request", lastLatency: "Latency", usedAmount: "Used", quotaLimit: "Limit",
        expiresAt: "Expires", requestStatus: "Status",
      }),
    }),
  });

  const interpolate = (value, variables) => String(value).replace(/\{(\w+)\}/g, (_, key) => String(variables?.[key] ?? ""));
  const createTranslator = (language) => {
    const locale = language === "en" ? "en" : "zh";
    const dictionary = messages[locale];
    const t = (key, variables) => interpolate(dictionary[key] ?? messages.zh[key] ?? key, variables);
    t.metric = (id, fallback = id) => dictionary.metrics[id] ?? messages.zh.metrics[id] ?? fallback;
    t.compact = (id, fallback = id) => dictionary.compact[id] ?? messages.zh.compact[id] ?? fallback;
    t.language = locale;
    return t;
  };

  registry.i18n = Object.freeze({ createTranslator });
})();
