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
const threadId = "019fb3b1-2638-7bb0-9a90-ec83b5bca0f2";
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
    metricOrder: ["official:secondaryRemaining", "bad", "official:secondaryRemaining", "api-account:balance"],
    secret: "must-not-persist",
  }), {
    schemaVersion: 2,
    metrics: { official: ["secondaryRemaining", "currentTaskTokens"] },
    metricOrder: ["official:secondaryRemaining", "api-account:balance"],
    apiKeyMetricsVersion: 0,
    officialMetricsVersion: 2,
    unifiedMetricsVersion: 1,
    minimalMode: true,
    countdownVisualization: false,
    englishUi: true,
    updateNotifications: false,
    autoResume: false,
    autoResumeSharedMessage: false,
    showApiColumns: true,
    showResetForecast: true,
    autoResumeMessage: "继续",
    autoResumeThreads: {},
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
    autoResume: true,
    showApiColumns: false,
    showResetForecast: false,
    metricOrder: ["official:secondaryRemaining", "api-account:balance"],
    autoResumeMessage: "请继续完成当前任务",
    autoResumeThreads: { [threadId]: { enabled: true, message: "请继续完成当前任务" }, invalid: { enabled: true, message: "bad" } },
  });
  await first.flush();

  const restarted = await createUiSettingsStore(settingsPath);
  assert.deepEqual(restarted.current.metrics, {
    official: ["secondaryRemaining", "currentTaskTokens"],
    "api-account": [],
  });
  assert.equal(restarted.current.countdownVisualization, true);
  assert.equal(restarted.current.updateNotifications, true);
  assert.equal(restarted.current.autoResume, true);
  assert.equal(restarted.current.showApiColumns, false);
  assert.equal(restarted.current.showResetForecast, false);
  assert.deepEqual(restarted.current.metricOrder, ["official:secondaryRemaining", "api-account:balance"]);
  assert.equal(restarted.current.autoResumeMessage, "请继续完成当前任务");
  await restarted.save({ ...restarted.current, autoResumeSharedMessage: true });
  assert.equal((await createUiSettingsStore(settingsPath)).current.autoResumeSharedMessage, true);
  assert.deepEqual(restarted.current.autoResumeThreads, { [threadId]: { enabled: true, message: "请继续完成当前任务" } });
  assert.equal(normalizeUiSettings({ autoResumeMessage: "\n" }).autoResumeMessage, "继续");
  assert.equal(normalizeUiSettings({ autoResumeMessage: "x".repeat(501) }).autoResumeMessage, "继续");
  assert.equal(JSON.parse(await fs.readFile(settingsPath, "utf8")).secret, undefined);

  await fs.writeFile(settingsPath, "not-json", "utf8");
  assert.equal(await readUiSettingsFile(settingsPath), null);
  console.log("PASS: monitor-owned UI settings validation, atomic persistence, and restart recovery.");
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
