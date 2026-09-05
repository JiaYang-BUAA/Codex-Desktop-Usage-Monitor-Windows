import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  AutoResumeController,
  createAutoResumePending,
  createAutoResumeStateStore,
  isAutoResumeQuotaRecovered,
} from "../scripts/auto-resume.mjs";

const THREAD_ID = "019fb3b1-2638-7bb0-9a90-ec83b5bca0f2";
const TURN_ID = "019fb3b1-2638-7bb0-9a90-ec83b5bca0f3";
const OTHER_THREAD_ID = "019fb3b1-2638-7bb0-9a90-ec83b5bca0f4";
const EVENT_ID = "0123456789abcdef0123456789abcdef";
const startAt = new Date(2026, 7, 30, 14, 0, 0).getTime();
const resetAt = startAt + 60_000;

function usage({ remaining = "0%", quota = true, observedLive = true, timestamp = startAt } = {}) {
  return {
    currentThreadId: THREAD_ID,
    quotaExceeded: quota ? { eventId: EVENT_ID, turnId: TURN_ID, timestamp, resetAt, observedLive } : null,
    sources: {
      official: {
        status: "ready",
        metrics: [
          { id: "primaryRemaining", value: remaining, resetsAt: resetAt / 1000 },
          { id: "secondaryRemaining", value: "55%", resetsAt: (resetAt + 7 * 86400_000) / 1000 },
        ],
      },
    },
  };
}

const pending = createAutoResumePending(usage(), startAt);
assert.equal(pending.threadId, THREAD_ID);
assert.equal(pending.resetAt, resetAt);
assert.deepEqual(pending.blockedMetricIds, ["primaryRemaining"]);
assert.equal(isAutoResumeQuotaRecovered(usage({ remaining: "50%" }), pending, resetAt + 4_999), false);
assert.equal(isAutoResumeQuotaRecovered(usage({ remaining: "50%" }), pending, resetAt + 5_000), true);
assert.equal(isAutoResumeQuotaRecovered({ ...usage({ remaining: "50%" }), sources: { official: { status: "stale", metrics: usage({ remaining: "50%" }).sources.official.metrics } } }, pending, resetAt + 5_000), false);

const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-usage-auto-resume-"));
try {
  let now = startAt;
  const statePath = path.join(root, "state", "auto-resume-state.json");
  const store = await createAutoResumeStateStore(statePath);
  const sends = [];
  const controller = new AutoResumeController({
    store,
    now: () => now,
    sendContinue: async (value) => { sends.push(value); return { ok: true }; },
  });
  await controller.settingsChanged({ autoResumeThreads: { [THREAD_ID]: { enabled: true, message: "请继续完成当前任务" } } });
  await controller.observeUsage(usage());
  assert.equal(controller.status.status, "waiting");
  assert.equal(sends.length, 0);
  now = resetAt + 5_000;
  await controller.observeUsage(usage({ remaining: "50%" }));
  assert.equal(sends.length, 1);
  assert.equal(sends[0].threadId, THREAD_ID);
  assert.equal(sends[0].message, "请继续完成当前任务");
  assert.equal(controller.status.status, "sent");
  await controller.observeUsage(usage({ remaining: "50%" }));
  assert.equal(sends.length, 1);
  assert.equal((await createAutoResumeStateStore(statePath)).current.lastHandledEventId, EVENT_ID);
  await controller.stop();

  const cancellationPath = path.join(root, "cancel.json");
  now = startAt;
  const cancellationStore = await createAutoResumeStateStore(cancellationPath);
  const cancellationController = new AutoResumeController({
    store: cancellationStore,
    now: () => now,
    sendContinue: async () => ({ ok: true }),
  });
  await cancellationController.settingsChanged({ autoResumeThreads: { [THREAD_ID]: { enabled: true, message: "继续" } } });
  await cancellationController.observeUsage(usage());
  assert.ok(cancellationStore.current.pending);
  now += 1_000;
  await cancellationController.observeUsage(usage({ quota: false }));
  assert.equal(cancellationStore.current.pending, null);
  assert.equal(cancellationController.status.status, "idle");

  const historicalStore = await createAutoResumeStateStore(path.join(root, "historical.json"));
  const historicalController = new AutoResumeController({
    store: historicalStore,
    now: () => startAt,
    sendContinue: async () => { throw new Error("historical event must not send"); },
  });
  await historicalController.settingsChanged({ autoResumeThreads: { [THREAD_ID]: { enabled: true, message: "继续" } } });
  await historicalController.observeUsage(usage({ observedLive: false }));
  assert.equal(historicalStore.current.pending, null);
  await historicalController.observeUsage(usage({ timestamp: startAt - 1 }));
  assert.equal(historicalStore.current.pending, null);

  const restartPath = path.join(root, "restart.json");
  now = startAt;
  const firstStore = await createAutoResumeStateStore(restartPath);
  const firstController = new AutoResumeController({ store: firstStore, now: () => now, sendContinue: async () => ({ ok: true }) });
  await firstController.settingsChanged({ autoResumeThreads: { [THREAD_ID]: { enabled: true, message: "继续" } } });
  await firstController.observeUsage(usage());
  await firstController.stop();
  assert.ok(firstStore.current.pending);
  now = resetAt + 5_000;
  const restartedStore = await createAutoResumeStateStore(restartPath);
  let restartedSends = 0;
  const restartedController = new AutoResumeController({
    store: restartedStore,
    now: () => now,
    sendContinue: async (attempt) => { restartedSends += 1; assert.equal(attempt.message, "继续检查"); return { ok: true }; },
  });
  await restartedController.settingsChanged({ autoResumeThreads: { [THREAD_ID]: { enabled: true, message: "继续检查" } } });
  await restartedController.observeUsage(usage({ remaining: "40%" }));
  assert.equal(restartedSends, 1);
  assert.equal(restartedStore.current.pending, null);
  await restartedController.stop();

  const independentStore = await createAutoResumeStateStore(path.join(root, "independent.json"));
  const independentController = new AutoResumeController({ store: independentStore, now: () => startAt, sendContinue: async () => ({ ok: true }) });
  await independentController.settingsChanged({
    autoResumeThreads: {
      [THREAD_ID]: { enabled: true, message: "继续 A" },
      [OTHER_THREAD_ID]: { enabled: false, message: "继续 B" },
    },
  });
  await independentController.observeUsage(usage({ quota: false }));
  assert.equal(independentController.status.enabled, true);
  await independentController.observeUsage({ ...usage({ quota: false }), currentThreadId: OTHER_THREAD_ID });
  assert.equal(independentController.status.enabled, false);
  await independentController.settingsChanged({
    autoResumeThreads: {
      [THREAD_ID]: { enabled: true, message: "继续 A" },
      [OTHER_THREAD_ID]: { enabled: true, message: "继续 B" },
    },
  });
  assert.equal(independentController.status.enabled, true);
  await independentController.observeUsage(usage({ quota: false }));
  assert.equal(independentController.status.enabled, true);
  await independentController.stop();

  for (const shared of [true, false]) {
    let clock = startAt;
    const sent = [];
    const sharedStore = await createAutoResumeStateStore(path.join(root, `shared-${shared}.json`));
    const sharedController = new AutoResumeController({ store: sharedStore, now: () => clock,
      sendContinue: async (value) => { sent.push(value); return { ok: true }; } });
    const settings = { autoResumeSharedMessage: true, autoResumeMessage: "统一继续",
      autoResumeThreads: { [THREAD_ID]: { enabled: true, message: "独立继续" }, [OTHER_THREAD_ID]: { enabled: false, message: "不发送" } } };
    await sharedController.settingsChanged(settings);
    await sharedController.observeUsage(usage());
    await sharedController.settingsChanged({ ...settings, autoResumeSharedMessage: shared,
      autoResumeThreads: Object.fromEntries(Object.entries(settings.autoResumeThreads).map(([id, config]) => [id, { ...config, message: "统一继续" }])) });
    assert.equal(sharedController.threadSettings[OTHER_THREAD_ID].enabled, false);
    clock = resetAt + 5_000;
    await sharedController.observeUsage(usage({ remaining: "50%" }));
    assert.equal(sent.length, 1);
    assert.equal(sent[0].message, "统一继续");
    await sharedController.stop();
  }

  console.log("PASS: per-task quota recovery auto-resume, duplicate prevention, cancellation, and restart persistence.");
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
