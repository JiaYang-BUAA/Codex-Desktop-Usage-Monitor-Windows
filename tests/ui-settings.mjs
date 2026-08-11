import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createUiSettingsStore,
  normalizeUiSettings,
  readUiSettingsFile,
  resolveUiSettingsPath,
} from "../scripts/ui-settings.mjs";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-usage-ui-settings-"));
const settingsPath = path.join(root, "state", "ui-settings.json");
try {
  assert.equal(resolveUiSettingsPath({ CODEX_USAGE_UI_SETTINGS_PATH: settingsPath }), settingsPath);
  assert.equal(resolveUiSettingsPath({ LOCALAPPDATA: root }), path.join(root, "CodexUsageMonitor", "ui-settings.json"));
  assert.equal(normalizeUiSettings(null), null);
  assert.deepEqual(normalizeUiSettings({
    metrics: {
      official: ["secondaryRemaining", "currentTaskTokens", "secondaryRemaining", "bad metric"],
      "../unsafe": ["todayTokens"],
    },
    apiKeyMetricsVersion: -1,
    officialMetricsVersion: 2,
    unifiedMetricsVersion: 1,
    minimalMode: true,
    countdownVisualization: false,
    englishUi: true,
    updateNotifications: false,
    secret: "must-not-persist",
  }), {
    schemaVersion: 1,
    metrics: { official: ["secondaryRemaining", "currentTaskTokens"] },
    apiKeyMetricsVersion: 0,
    officialMetricsVersion: 2,
    unifiedMetricsVersion: 1,
    minimalMode: true,
    countdownVisualization: false,
    englishUi: true,
    updateNotifications: false,
  });

  const first = await createUiSettingsStore(settingsPath);
  assert.equal(first.current, null);
  await first.save({
    metrics: { official: ["secondaryRemaining", "currentTaskTokens"], "api-account": [] },
    unifiedMetricsVersion: 1,
    minimalMode: false,
    countdownVisualization: true,
    englishUi: false,
    updateNotifications: true,
  });
  await first.flush();

  const restarted = await createUiSettingsStore(settingsPath);
  assert.deepEqual(restarted.current.metrics, {
    official: ["secondaryRemaining", "currentTaskTokens"],
    "api-account": [],
  });
  assert.equal(restarted.current.countdownVisualization, true);
  assert.equal(restarted.current.updateNotifications, true);
  assert.equal(JSON.parse(await fs.readFile(settingsPath, "utf8")).secret, undefined);

  await fs.writeFile(settingsPath, "not-json", "utf8");
  assert.equal(await readUiSettingsFile(settingsPath), null);
  console.log("PASS: monitor-owned UI settings validation, atomic persistence, and restart recovery.");
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
