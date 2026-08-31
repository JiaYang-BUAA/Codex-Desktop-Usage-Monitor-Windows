(() => {
  const registry = window.__CODEX_USAGE_MONITOR_MODULES__ ||= {};
  registry.constants = Object.freeze({
    VERSION: "3.0.0",
    STATE_KEY: "__CODEX_USAGE_MONITOR_STATE__",
    USAGE_KEY: "__CODEX_USAGE_MONITOR__",
    HOST_ID: "codex-usage-monitor",
    SETTINGS_KEY: "codex-usage-monitor-settings-v2",
    PREVIOUS_SETTINGS_KEY: "codex-usage-monitor-settings-v1",
    PERSISTED_SETTINGS_KEY: "__CODEX_USAGE_MONITOR_PERSISTED_SETTINGS__",
    SETTINGS_BINDING: "__codexUsageMonitorSaveSettings",
    CONFIGURATION_KEY: "__CODEX_USAGE_MONITOR_CONFIGURATION__",
    CONFIGURATION_BINDING: "__codexUsageMonitorConfigureSource",
    REFRESH_INTERVAL_MS: 60000,
    LAYOUT_FALLBACK_INTERVAL_MS: 20000,
    COUNTDOWN_INTERVAL_MS: 1000,
    PLACEMENT_DEBOUNCE_MS: 120,
    MAX_SELECTED_METRICS: 8,
    MAX_MINIMAL_SELECTED_METRICS: 14,
  });
})();
