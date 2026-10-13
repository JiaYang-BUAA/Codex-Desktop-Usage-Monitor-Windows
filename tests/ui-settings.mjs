import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createUiSettingsStore,
  MAX_UI_SETTINGS_BYTES,
  normalizeUiSettings,
  readUiSettingsFile,
  resolveUiSettingsPath,
  writeUiSettingsFile,
} from "../scripts/ui-settings.mjs";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-usage-ui-settings-"));
const settingsPath = path.join(root, "state", "ui-settings.json");
const threadId = "019fb3b1-2638-7bb0-9a90-ec83b5bca0f2";
try {
  assert.equal(resolveUiSettingsPath({ CODEX_USAGE_UI_SETTINGS_PATH: settingsPath }), settingsPath);
  assert.equal(resolveUiSettingsPath({ LOCALAPPDATA: root }), path.join(root, "CodexUsageMonitor", "ui-settings.json"));
  assert.equal(normalizeUiSettings(null), null);
  const migratedDuration = normalizeUiSettings({
    metrics: { session: ["currentStatus", "autoResume", "executionTime"], official: ["currentStatus"] },
    metricOrder: ["session:currentStatus", "session:autoResume", "session:executionTime", "official:currentStatus"],
  });
  assert.deepEqual(migratedDuration.metrics.session, ["executionTime", "autoResume"]);
  assert.deepEqual(migratedDuration.metrics.official, ["executionTime"]);
  assert.deepEqual(migratedDuration.metricOrder, ["session:executionTime", "session:autoResume", "official:executionTime"]);
  assert.deepEqual(normalizeUiSettings(migratedDuration), migratedDuration, "duration selection migration is idempotent");
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
    refreshEvery30Seconds: false,
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
    refreshEvery30Seconds: false,
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
    metrics: { official: ["secondaryRemaining", "currentTaskTokens"], "api-account": [], "quota-token": ["wholeEstimateTokens"] },
    unifiedMetricsVersion: 1,
    minimalMode: false,
    countdownVisualization: true,
    refreshEvery30Seconds: true,
    englishUi: false,
    updateNotifications: true,
    autoResume: true,
    showApiColumns: false,
    showResetForecast: false,
    showQuotaToken: false,
    metricOrder: ["official:secondaryRemaining", "quota-token:wholeEstimateTokens", "api-account:balance"],
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
  assert.equal(restarted.current.refreshEvery30Seconds, true);
  assert.equal(restarted.current.updateNotifications, true);
  assert.equal(restarted.current.autoResume, true);
  assert.equal(restarted.current.showApiColumns, false);
  assert.equal(restarted.current.showResetForecast, false);
  assert.equal(Object.hasOwn(restarted.current, "showQuotaToken"), false, "the retired feature switch is dropped while loading old settings");
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

  const blockedDirectory = path.join(root, "blocked");
  await fs.writeFile(blockedDirectory, "temporarily unavailable directory");
  const retryPath = path.join(blockedDirectory, "ui-settings.json");
  const retryStore = await createUiSettingsStore(retryPath);
  const retryValue = { englishUi: true };
  await assert.rejects(retryStore.save(retryValue));
  await fs.unlink(blockedDirectory);
  await fs.mkdir(blockedDirectory);
  await retryStore.save(retryValue);
  assert.equal((await readUiSettingsFile(retryPath)).englishUi, true,
    "an identical save retries after a transient persistence failure");
  await Promise.all([retryStore.save({ englishUi: false }), retryStore.save({ englishUi: true })]);
  assert.equal((await readUiSettingsFile(retryPath)).englishUi, true,
    "queued saves still persist the newest settings");

  // Exercise both ordinary Chinese and the longest possible JSON encoding of
  // a valid 500-character message, rather than relying on ASCII fixtures.
  for (const message of ["继".repeat(500), "\ud800".repeat(500)]) {
    const autoResumeThreads = Object.fromEntries(Array.from({ length: 128 }, (_, index) => [
      `019fb3b1-2638-7bb0-9a90-${String(index).padStart(12, "0")}`,
      { enabled: true, message },
    ]));
    const largeSettings = normalizeUiSettings({ autoResumeThreads, autoResumeMessage: message });
    assert.ok(Buffer.byteLength(JSON.stringify(largeSettings, null, 2), "utf8") <= MAX_UI_SETTINGS_BYTES);
    await writeUiSettingsFile(settingsPath, largeSettings);
    assert.deepEqual(await readUiSettingsFile(settingsPath), largeSettings,
      "every accepted per-thread message survives a restart at maximum capacity");
  }
  await fs.writeFile(settingsPath, " ".repeat(MAX_UI_SETTINGS_BYTES + 1));
  assert.equal(await readUiSettingsFile(settingsPath), null, "oversized input is still rejected");
  console.log("PASS: monitor-owned UI settings validation, atomic persistence, and restart recovery.");
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
