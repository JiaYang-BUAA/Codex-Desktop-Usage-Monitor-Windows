import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  AutoResumeController,
  createAutoResumePending,
  createAutoResumeStateStore,
  isAutoResumeQuotaRecovered,
  normalizeAutoResumeState,
} from "../scripts/auto-resume.mjs";

const THREAD_ID = "019fb3b1-2638-7bb0-9a90-ec83b5bca0f2";
const TURN_ID = "019fb3b1-2638-7bb0-9a90-ec83b5bca0f3";
const OTHER_THREAD_ID = "019fb3b1-2638-7bb0-9a90-ec83b5bca0f4";
const EVENT_ID = "0123456789abcdef0123456789abcdef";
const startAt = new Date(2026, 7, 30, 14, 0, 0).getTime();
const resetAt = startAt + 60_000;
const account = "c".repeat(64);

function usage({ remaining = "0%", quota = true, observedLive = true, timestamp = startAt,
  fetchedAt = resetAt + 5_000, currentStatus = quota ? "quota-paused" : null } = {}) {
  return {
    resumeAccountKey: account,
    resumeAccountSince: startAt - 86400000,
    resumeQuota: { accountKey: account, observedAt: fetchedAt, windows: [
      { id: "primaryRemaining", remainingPercent: parseFloat(remaining), resetsAt: resetAt / 1000 },
      { id: "secondaryRemaining", remainingPercent: 55, resetsAt: (resetAt + 7 * 86400_000) / 1000 },
    ] },
    currentThreadId: THREAD_ID,
    currentStatus,
    timestamp,
    quotaExceeded: quota ? { eventId: EVENT_ID, turnId: TURN_ID, timestamp, resetAt, observedLive } : null,
    sources: {
      official: {
        status: "ready",
        fetchedAt,
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
assert.equal(isAutoResumeQuotaRecovered(usage({ remaining: "50%", fetchedAt: startAt }), pending, resetAt + 5_000), false);
assert.equal(isAutoResumeQuotaRecovered(usage({ remaining: "50%" }), pending, resetAt + 5_000), true);
assert.equal(isAutoResumeQuotaRecovered(usage({ remaining: "50%", fetchedAt: startAt + 10_000 }), pending, startAt + 10_000), true);
assert.equal(isAutoResumeQuotaRecovered({ ...usage({ remaining: "50%" }), sources: { official: { status: "stale", metrics: usage({ remaining: "50%" }).sources.official.metrics } } }, pending, resetAt + 5_000), false);
const bothBlockedUsage = usage();
bothBlockedUsage.sources.official.metrics[1].value = "0%";
bothBlockedUsage.resumeQuota.windows[1].remainingPercent = 0;
const bothBlockedPending = createAutoResumePending(bothBlockedUsage, startAt);
assert.deepEqual(bothBlockedPending.blockedMetricIds, ["primaryRemaining", "secondaryRemaining"]);
const partiallyRecovered = usage({ remaining: "50%" });
partiallyRecovered.sources.official.metrics[1].value = "0%";
partiallyRecovered.resumeQuota.windows[1].remainingPercent = 0;
assert.equal(isAutoResumeQuotaRecovered(partiallyRecovered, bothBlockedPending, resetAt + 5_000), false);
const noReset = usage();
noReset.quotaExceeded.resetAt = null;
noReset.sources.official.metrics = [];
noReset.resumeQuota.windows = [];
assert.ok(createAutoResumePending(noReset, startAt), "missing reset estimate must still preserve the quota wait");
const migrated = normalizeAutoResumeState({ schemaVersion: 1, pending, lastHandledEventId: "a".repeat(32) });
const pro = usage({ fetchedAt: startAt });
pro.quotaExceeded.resetAt = null;
pro.resumeQuota.windows = [{ id: "secondaryRemaining", resetsAt: null, remainingPercent: 0 }];
const weeklyWait = createAutoResumePending(pro, startAt);
assert.deepEqual(weeklyWait.blockedMetricIds, ["secondaryRemaining"]);
const recoveryTime = startAt + 10_000;
const weeklyRecovery = { ...pro, resumeQuota: { accountKey: account, observedAt: recoveryTime,
  windows: [{ id: "secondaryRemaining", resetsAt: null, remainingPercent: 65 }] } };
assert.equal(isAutoResumeQuotaRecovered(weeklyRecovery, weeklyWait, recoveryTime), true);
for (const sparse of [null, { ...weeklyRecovery.resumeQuota, windows: [
  { id: "primaryRemaining", remainingPercent: 90, resetsAt: null },
] }]) {
  assert.equal(isAutoResumeQuotaRecovered({ ...weeklyRecovery, resumeQuota: sparse }, weeklyWait, recoveryTime), false);
}
assert.equal(isAutoResumeQuotaRecovered({ ...weeklyRecovery, resumeAccountKey: "d".repeat(64) }, weeklyWait, recoveryTime), false);
const unknownWindow = createAutoResumePending({ ...pro, resumeQuota: null }, startAt);
assert.equal(isAutoResumeQuotaRecovered(weeklyRecovery, unknownWindow, recoveryTime), false);
const wrongWindow = usage();
wrongWindow.quotaExceeded.resetAt = resetAt + 7 * 86400_000;
wrongWindow.resumeQuota.windows = wrongWindow.resumeQuota.windows.slice(0, 1);
assert.deepEqual(createAutoResumePending(wrongWindow, startAt).blockedMetricIds, [],
  "a depleted 5h window cannot identify a weekly pause when its reset time disagrees");
assert.equal(createAutoResumePending({ ...pro, resumeAccountSince: startAt + 1 }, startAt).accountKey, null);
assert.equal(migrated.schemaVersion, 2);
assert.equal(migrated.pendingByThread[THREAD_ID].eventId, EVENT_ID);
assert.equal(migrated.legacyHandledEventId, "a".repeat(32));
const ledger = Object.fromEntries(Array.from({ length: 150 }, (_, index) =>
  [`019fb3b1-2638-7bb0-9a90-${index.toString(16).padStart(12, "0")}`, { eventId: EVENT_ID, handledAt: startAt }]));
assert.equal(Object.keys(normalizeAutoResumeState({ handledByThread: ledger }).handledByThread).length, 128);

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
  assert.equal((await createAutoResumeStateStore(statePath)).current.handledByThread[THREAD_ID].eventId, EVENT_ID);
  await controller.stop();

  const queuedPath = path.join(root, "queued.json");
  const on = { autoResumeThreads: { [THREAD_ID]: { enabled: true } } };
  let checks = 0;
  let queueClock = resetAt + 5_000;
  const queueController = async () => new AutoResumeController({
    store: await createAutoResumeStateStore(queuedPath), now: () => queueClock,
    sendContinue: async () => ++checks === 1 ? { ok: false, reason: "desktop-queue-pending" }
      : { ok: true, queued: true, queueId: TURN_ID },
  });
  const readyQuota = usage({ remaining: "55%" });
  let queued = await queueController();
  await queued.settingsChanged(on);
  await queued.observeUsage(readyQuota);
  assert.equal(queued.status.reason, "desktop-queue-pending");
  await queued.stop();
  queued = await queueController();
  await queued.settingsChanged(on);
  await queued.observeUsage(readyQuota);
  assert.equal(queued.status.reason, "desktop-queue-pending");
  assert.equal(checks, 1, "an existing queued message defers submission");
  queueClock += 30_000;
  await queued.observeUsage(readyQuota);
  assert.equal(queued.status.status, "queued");
  await queued.stop();
  queued = await queueController();
  await queued.settingsChanged(on);
  assert.equal(queued.statusForThread(THREAD_ID).status, "queued", "receipt survives a monitor restart");
  await queued.observeUsage(readyQuota);
  const resumed = { ...usage({ quota: false, currentStatus: "running", timestamp: queueClock + 1 }), turnId: TURN_ID };
  await queued.observeUsage(resumed);
  assert.equal(queued.status.status, "queued", "same-turn status cannot prove the thread advanced");
  await queued.observeUsage({ ...resumed, turnId: null });
  assert.equal(queued.status.status, "queued", "an unhydrated turn cannot clear the receipt");
  await queued.observeUsage({ ...resumed, turnId: OTHER_THREAD_ID });
  assert.equal(queued.status.status, "idle", "a newer turn clears the receipt without attributing who started it");
  await queued.stop();
  queued = await queueController();
  await queued.settingsChanged(on);
  await queued.observeUsage(readyQuota);
  assert.equal(queued.status.status, "idle");
  assert.equal(checks, 2, "an acknowledged queue entry never causes a second enqueue");
  await queued.stop();

  // Two renderer windows can query their own status without changing the
  // controller's current task or publishing another status update.
  const windowsStore = await createAutoResumeStateStore(path.join(root, "windows.json"));
  let windowPublications = 0;
  const windows = new AutoResumeController({
    store: windowsStore,
    now: () => startAt,
    sendContinue: async () => assert.fail("status projection must never send a message"),
    onStatusChange: () => { windowPublications++; },
  });
  await windows.settingsChanged({ autoResumeThreads: {
    [THREAD_ID]: { enabled: true },
    [OTHER_THREAD_ID]: { enabled: true },
  } });
  await windows.observeUsage(usage());
  windows.publish("sent", { threadId: OTHER_THREAD_ID, sentAt: startAt, resetAt });
  const activeStatus = windows.status;
  const publicationCount = windowPublications;
  const persistedBeforeRead = JSON.stringify(windowsStore.current);
  assert.deepEqual(windows.statusForThread(THREAD_ID), { enabled: true, status: "waiting", resetAt });
  assert.deepEqual(windows.statusForThread(OTHER_THREAD_ID.toUpperCase()), {
    enabled: true, status: "sent", resetAt, sentAt: startAt,
  });
  assert.deepEqual(windows.statusForThread(null), { enabled: false, status: "idle", resetAt: null });
  assert.deepEqual(windows.statusForThread("invalid"), { enabled: false, status: "idle", resetAt: null });
  windows.statusForThread(OTHER_THREAD_ID).status = "idle";
  assert.equal(windows.statusForThread(OTHER_THREAD_ID).status, "sent", "a projection cannot mutate saved status");
  assert.equal(windows.currentThreadId, THREAD_ID);
  assert.equal(windows.status, activeStatus, "reading another window does not replace the published status");
  assert.equal(windowPublications, publicationCount, "status reads must not trigger recursive broadcasts");
  assert.equal(JSON.stringify(windowsStore.current), persistedBeforeRead);
  await windows.settingsChanged({ autoResumeThreads: {
    [THREAD_ID]: { enabled: true },
    [OTHER_THREAD_ID]: { enabled: false },
  } });
  assert.deepEqual(windows.statusForThread(OTHER_THREAD_ID), { enabled: false, status: "idle", resetAt: null },
    "disabled windows cannot inherit an earlier sent state");
  assert.equal(windows.statusForThread(THREAD_ID).status, "waiting");
  await windows.stop();

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
  assert.ok(cancellationStore.current.pendingByThread[THREAD_ID]);
  now += 1_000;
  await cancellationController.observeUsage(usage({ quota: false }));
  assert.ok(cancellationStore.current.pendingByThread[THREAD_ID]);
  await cancellationController.observeUsage(usage({ quota: false, currentStatus: "paused", timestamp: now }));
  assert.equal(cancellationStore.current.pendingByThread[THREAD_ID], undefined);
  assert.equal(cancellationController.status.status, "idle");

  const historicalStore = await createAutoResumeStateStore(path.join(root, "historical.json"));
  const historicalController = new AutoResumeController({
    store: historicalStore,
    now: () => startAt,
    sendContinue: async () => { throw new Error("historical event must not send"); },
  });
  await historicalController.settingsChanged({ autoResumeThreads: { [THREAD_ID]: { enabled: true, message: "继续" } } });
  await historicalController.observeUsage(usage({ observedLive: false }));
  assert.ok(historicalStore.current.pendingByThread[THREAD_ID]);
  await historicalController.observeUsage(usage({ timestamp: startAt - 1 }));
  assert.ok(historicalStore.current.pendingByThread[THREAD_ID]);

  const restartPath = path.join(root, "restart.json");
  now = startAt;
  const firstStore = await createAutoResumeStateStore(restartPath);
  const firstController = new AutoResumeController({ store: firstStore, now: () => now, sendContinue: async () => ({ ok: true }) });
  await firstController.settingsChanged({ autoResumeThreads: { [THREAD_ID]: { enabled: true, message: "继续" } } });
  await firstController.observeUsage(usage());
  await firstController.stop();
  assert.ok(firstStore.current.pendingByThread[THREAD_ID]);
  now = resetAt + 5_000;
  const restartedStore = await createAutoResumeStateStore(restartPath);
  let restartedSends = 0;
  const restartedController = new AutoResumeController({
    store: restartedStore,
    now: () => now,
    sendContinue: async (attempt) => { restartedSends += 1; assert.equal(attempt.message, "继续检查"); return { ok: true }; },
  });
  await restartedController.settingsChanged({ autoResumeThreads: { [THREAD_ID]: { enabled: true, message: "继续检查" } } });
  await restartedController.observeUsage(usage({ remaining: "40%", quota: false }));
  assert.equal(restartedSends, 0);
  assert.ok(restartedStore.current.pendingByThread[THREAD_ID]);
  await restartedController.observeUsage(usage({ remaining: "40%" }));
  assert.equal(restartedSends, 1);
  assert.equal(restartedStore.current.pendingByThread[THREAD_ID], undefined);
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

  const task = (quota = usage().quotaExceeded, currentStatus = "quota-paused", timestamp = startAt) =>
    ({ quotaExceeded: quota, currentStatus, timestamp, turnId: quota?.turnId || TURN_ID });
  const otherQuota = { ...usage().quotaExceeded, eventId: "b".repeat(32) };
  let multiNow = startAt;
  const multiSends = [];
  const multiStore = await createAutoResumeStateStore(path.join(root, "multi.json"));
  const multi = new AutoResumeController({ store: multiStore, now: () => multiNow,
    sendContinue: async (attempt) => { multiSends.push(attempt); return { ok: true }; } });
  await multi.settingsChanged({ autoResumeThreads: {
    [THREAD_ID]: { enabled: true, message: "继续 A" }, [OTHER_THREAD_ID]: { enabled: true, message: "继续 B" },
  } });
  const taskMap = { [THREAD_ID]: task(), [OTHER_THREAD_ID]: task(otherQuota) };
  await multi.observeUsage({ ...usage(), autoResumeTasks: taskMap });
  assert.equal(Object.keys(multiStore.current.pendingByThread).length, 2);
  multiNow += 10_000;
  const ready = usage({ remaining: "50%", fetchedAt: multiNow });
  await multi.observeUsage({ ...ready, currentThreadId: null, autoResumeTasks: {} });
  assert.equal(multiSends.length, 0, "no task hydration means no permission to send");
  assert.equal(Object.keys(multiStore.current.pendingByThread).length, 2);
  await multi.observeUsage({ ...ready, currentThreadId: null, autoResumeTasks: taskMap });
  assert.deepEqual(multiSends.map((item) => item.threadId), [THREAD_ID, OTHER_THREAD_ID]);
  assert.deepEqual(multiSends.map((item) => item.message), ["继续 A", "继续 B"]);
  assert.equal(Object.keys(multiStore.current.pendingByThread).length, 0);
  await multi.observeUsage({ ...ready, autoResumeTasks: taskMap });
  assert.equal(multiSends.length, 2, "both handled event fingerprints survive subsequent observations");
  await multi.stop();

  // An edit can arrive while a different thread's transport is awaiting an
  // acknowledgement. Closing B must revoke its authorization immediately.
  let releaseA;
  let enteredA;
  const entered = new Promise(resolve => { enteredA = resolve; });
  const held = new Promise(resolve => { releaseA = resolve; });
  const raceSends = [];
  const race = new AutoResumeController({ now: () => recoveryTime,
    store: await createAutoResumeStateStore(path.join(root, "race.json")),
    sendContinue: async attempt => {
      raceSends.push(attempt.threadId);
      enteredA();
      await held;
      return { ok: true };
    } });
  const both = { autoResumeThreads: { [THREAD_ID]: { enabled: true }, [OTHER_THREAD_ID]: { enabled: true } } };
  await race.settingsChanged(both);
  await race.observeUsage({ ...usage(), autoResumeTasks: taskMap });
  const inFlight = race.observeUsage({ ...ready, autoResumeTasks: taskMap });
  await entered;
  const edited = race.settingsChanged({ autoResumeThreads: { [THREAD_ID]: { enabled: true } } });
  releaseA();
  await Promise.all([inFlight, edited]);
  assert.deepEqual(raceSends, [THREAD_ID]);
  await race.stop();

  let publications = 0;
  const quiet = new AutoResumeController({ now: () => recoveryTime, store: { current: null, flush() {} },
    onStatusChange: () => { publications++; } });
  await quiet.settingsChanged({});
  for (let i = 0; i < 20; i++) await quiet.observeUsage(ready);
  assert.equal(publications, 0, "the 20 usage broadcasts need no additional status broadcasts");
  await quiet.stop();

  for (const currentStatus of ["running", "completed", "paused"]) {
    let cancelSends = 0;
    const store = await createAutoResumeStateStore(path.join(root, `cancel-${currentStatus}.json`));
    const controller = new AutoResumeController({ store, now: () => resetAt + 5_000,
      sendContinue: async () => { cancelSends++; return { ok: true }; } });
    await controller.settingsChanged({ autoResumeThreads: { [THREAD_ID]: { enabled: true } } });
    await controller.observeUsage({ ...usage(), autoResumeTasks: { [THREAD_ID]: task() } });
    await controller.observeUsage({ ...ready, autoResumeTasks: { [THREAD_ID]: task(null, currentStatus, startAt - 1) } });
    assert.ok(store.current.pendingByThread[THREAD_ID], "older status does not erase newer quota event");
    await controller.observeUsage({ ...ready, autoResumeTasks: { [THREAD_ID]: task(null, currentStatus, startAt + 1) } });
    assert.equal(store.current.pendingByThread[THREAD_ID], undefined);
    await controller.observeUsage({ ...ready, autoResumeTasks: { [THREAD_ID]: task() } });
    assert.equal(cancelSends, 0, "stale quota event cannot revive a cancelled wait");
    await controller.stop();
  }

  let failureNow = resetAt + 5_000;
  const failurePath = path.join(root, "failure.json");
  const failureStore = await createAutoResumeStateStore(failurePath);
  const failure = new AutoResumeController({ store: failureStore, now: () => failureNow,
    sendContinue: async () => ({ ok: false, reason: "desktop-request-client-unavailable" }) });
  await failure.observeUsage(usage({ remaining: "50%", observedLive: false }));
  await failure.settingsChanged({ autoResumeThreads: { [THREAD_ID]: { enabled: true } } });
  assert.equal(failure.status.reason, "desktop-request-client-unavailable", "late enable registers confirmed historical quota pause");
  await failure.observeUsage(usage({ remaining: "50%" }));
  assert.equal(failure.status.reason, "desktop-request-client-unavailable", "polling must retain the failure reason");
  await failure.stop();
  const retryStore = await createAutoResumeStateStore(failurePath);
  const retrySends = [];
  const retry = new AutoResumeController({ store: retryStore, now: () => failureNow,
    sendContinue: async (attempt) => { retrySends.push(attempt); throw new Error("private secret must not be persisted"); } });
  await retry.settingsChanged({ autoResumeThreads: { [THREAD_ID]: { enabled: true } } });
  await retry.observeUsage(usage({ remaining: "50%", quota: false }));
  assert.equal(retry.status.reason, "desktop-request-client-unavailable");
  await retry.observeUsage(usage({ remaining: "50%" }));
  assert.equal(retrySends.length, 0);
  failureNow += 30_000;
  await retry.observeUsage(usage({ remaining: "50%", fetchedAt: failureNow }));
  assert.equal(retrySends.length, 1);
  assert.equal(retry.status.reason, "desktop-send-unconfirmed");
  const afterCrash = new AutoResumeController({ store: await createAutoResumeStateStore(failurePath), now: () => failureNow + 60_000,
    sendContinue: async () => assert.fail("unknown delivery must survive process restarts") });
  await afterCrash.settingsChanged({ autoResumeThreads: { [THREAD_ID]: { enabled: true } } });
  await afterCrash.observeUsage(usage({ remaining: "80%", fetchedAt: failureNow + 60_000 }));
  assert.equal(afterCrash.status.reason, "desktop-send-unconfirmed");
  await afterCrash.stop();
  assert.ok(!(await fs.readFile(failurePath, "utf8")).includes("private secret"));
  await retry.settingsChanged({ autoResumeThreads: { [THREAD_ID]: { enabled: false } } });
  assert.equal(retryStore.current.pendingByThread[THREAD_ID], undefined);
  await retry.settingsChanged({ autoResumeThreads: { [THREAD_ID]: { enabled: true } } });
  assert.equal(retrySends.length, 1, "a disabled/re-enabled uncertain delivery must not be repeated");
  await retry.stop();

  const unconfirmedStore = await createAutoResumeStateStore(path.join(root, "unconfirmed.json"));
  const unconfirmed = new AutoResumeController({ store: unconfirmedStore, now: () => resetAt + 5_000,
    sendContinue: async () => assert.fail("unconfirmed history must not resume") });
  await unconfirmed.settingsChanged({ autoResumeThreads: { [THREAD_ID]: { enabled: true } } });
  await unconfirmed.observeUsage({ ...ready, autoResumeTasks: { [THREAD_ID]: task(usage().quotaExceeded, null) } });
  assert.equal(unconfirmedStore.current.pendingByThread[THREAD_ID], undefined);
  await unconfirmed.stop();

  console.log("PASS: per-thread persisted waits, late enable, fresh early recovery, hydration safety, cancellation, failure retry, and shared messages.");
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
