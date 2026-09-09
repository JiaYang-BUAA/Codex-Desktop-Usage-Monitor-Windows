import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { AutoResumeController, createAutoResumeStateStore } from "../scripts/auto-resume.mjs";
import { sendContinueThroughDesktop } from "../scripts/desktop-request.mjs";
import {
  LocalCodexTokenTracker,
  mergeOfficialLocalUsage,
  normalizeUsageView,
  toOfficialUsageSource,
} from "../scripts/usage-client.mjs";

// Entirely isolated: synthetic rollout files, a temporary state store, and a VM
// request client. Never opens a real CDP session or submits an actual user turn.
const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-auto-resume-integration-"));
const startAt = new Date(2026, 8, 9, 12).getTime();
const oldAt = startAt - 3 * 86400000;
let now = startAt;
const uuid = (timestamp, suffix) => {
  const hex = Math.trunc(timestamp).toString(16).padStart(12, "0") + suffix.toString(16).padStart(20, "0");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
const visibleId = uuid(startAt - 1000, 1);
const waitingIds = [uuid(oldAt, 2), uuid(oldAt, 3)];
const apiId = uuid(oldAt, 4);
const calls = [];
const queued = Object.fromEntries(waitingIds.map((id) => [id, [{ id: `queued-${id}`, text: "existing follow-up" }]]));
const context = vm.createContext({ calls, queued });
vm.runInContext(`window = { __codexRoot: { _internalRoot: { current: { client: {
  hostId: 'local', requestPromises: new Map(),
  queryClient: { getQueryCache() { return { getAll: () => [
    { queryKey: ['get-global-state', 'queued-follow-ups'], state: { data: { value: queued } } }
  ] }; } },
  async sendRequest(method, params, options) {
    calls.push({method, params, options});
    return method === 'turn/start' ? { turn: { id: params.threadId } } : {thread: {id: params.threadId}};
  }
} } } } };`, context);
const desktop = {
  async evaluate(expression, timeoutMs) {
    assert.equal(timeoutMs, 60000);
    return JSON.parse(JSON.stringify(await vm.runInContext(expression, context)));
  },
};
let tracker;
let controller;
try {
  const sessionRoot = path.join(root, "sessions");
  await fs.mkdir(sessionRoot);
  const event = (timestamp, type, payload) => JSON.stringify({ timestamp: new Date(timestamp).toISOString(), type, payload });
  await fs.writeFile(path.join(sessionRoot, `rollout-${visibleId}.jsonl`), [
    event(startAt - 1000, "session_meta", { id: visibleId, model_provider: "openai" }),
    event(startAt - 500, "turn_context", { turn_id: uuid(startAt - 500, 5) }), "",
  ].join("\n"));
  for (const [index, id] of [...waitingIds, apiId].entries()) {
    const turnId = uuid(oldAt + 1000, index + 10);
    const file = path.join(sessionRoot, `rollout-${id}.jsonl`);
    await fs.writeFile(file, [
      event(oldAt, "session_meta", { id, model_provider: id === apiId ? "custom" : "openai" }),
      event(oldAt + 1000, "turn_context", { turn_id: turnId }),
      event(oldAt + 2000, "event_msg", {
        type: "task_complete", turn_id: turnId,
        error: { message: "You've hit your usage limit.", codex_error_info: "usage_limit_exceeded" },
      }), "",
    ].join("\n"));
    await fs.utimes(file, new Date(oldAt + 2000), new Date(oldAt + 2000));
  }
  tracker = new LocalCodexTokenTracker({
    sessionRoot, counterPath: path.join(root, "counter.json"),
    officialModelProviders: ["openai"], now: () => now,
  });
  tracker.setCurrentThreadId(visibleId);
  const storePath = path.join(root, "auto-resume-state.json");
  const makeController = async () => new AutoResumeController({
    store: await createAutoResumeStateStore(storePath), now: () => now,
    sendContinue: (pending) => sendContinueThroughDesktop(desktop, pending),
  });
  controller = await makeController();
  const settings = { autoResumeThreads: Object.fromEntries([...waitingIds, apiId].map((id) =>
    [id, { enabled: true, message: `continue ${id}` }])) };
  const resetAt = startAt + 3600000;
  // Freeze the transport fixture's fetch timestamp; normalizeUsageView uses wall
  // time for fetchedAt, while its third argument controls token-bucket dates.
  const officialSnapshot = (remaining, fetchedAt) => ({ ...normalizeUsageView({
    rateLimits: { limitId: "codex",
      primary: { usedPercent: 100 - remaining, windowDurationMins: 300, resetsAt: resetAt / 1000 },
      secondary: { usedPercent: 20, windowDurationMins: 10080, resetsAt: (startAt + 7 * 86400000) / 1000 },
    },
  }, null, new Date(fetchedAt)), fetchedAt });
  const combined = async (snapshot) => {
    const merged = mergeOfficialLocalUsage(snapshot, await tracker.refresh(), new Date(now));
    return { ...merged, sources: { official: toOfficialUsageSource(merged, now) } };
  };
  await controller.observeUsage(await combined(officialSnapshot(0, startAt)));
  assert.equal(calls.length, 0);
  assert.equal(tracker.threadLatest.has(waitingIds[0]), false, "old background files begin untracked");

  // User enables resume after the historical quota errors, while another task is visible.
  tracker.setAutoResumeThreadIds(Object.keys(settings.autoResumeThreads));
  await controller.settingsChanged(settings);
  const blocked = await combined(officialSnapshot(0, startAt));
  assert.equal(blocked.currentThreadId, visibleId);
  assert.equal(blocked.currentStatus, "running");
  for (const id of waitingIds) {
    assert.equal(blocked.autoResumeTasks[id].currentStatus, "quota-paused");
    assert.equal(blocked.autoResumeTasks[id].quotaExceeded.observedLive, false);
  }
  assert.equal(blocked.autoResumeTasks[apiId].quotaExceeded, null);
  await controller.observeUsage(blocked);
  assert.deepEqual(Object.keys(controller.state.pendingByThread).sort(), [...waitingIds].sort());
  assert.equal(calls.length, 0, "zero quota cannot resume either waiting task");

  // Rebuilding the controller must preserve both waits and require official freshness.
  await controller.stop();
  controller = await makeController();
  await controller.settingsChanged(settings);
  now += 10000;
  const stale = await combined(officialSnapshot(100, oldAt));
  assert.equal(stale.sources.official.fetchedAt, oldAt, "local scans must not freshen official quota");
  await controller.observeUsage(stale);
  assert.equal(calls.length, 0, "a positive pre-error snapshot is not recovery");
  await controller.observeUsage(await combined(officialSnapshot(100, now)));
  assert.ok(now < resetAt, "the fixture exercises early quota recovery");
  assert.equal(calls.filter((item) => item.method === "turn/start").length, 2);
  assert.equal(calls.filter((item) => item.method === "thread/resume").length, 2);
  for (const id of waitingIds) {
    const starts = calls.filter((item) => item.method === "turn/start" && item.params.threadId === id);
    assert.equal(starts.length, 1, "exactly one turn is submitted per waiting task");
    assert.equal(starts[0].params.input[0].text, settings.autoResumeThreads[id].message);
    assert.equal(queued[id].length, 1, "existing follow-ups remain untouched");
  }
  assert.equal(calls.some((item) => [visibleId, apiId].includes(item.params.threadId)), false);
  assert.equal(Object.keys(controller.state.pendingByThread).length, 0);
  for (let i = 0; i < 3; i++) {
    now += 1000;
    await controller.observeUsage(await combined(officialSnapshot(100, now)));
  }
  await controller.stop();
  controller = await makeController();
  await controller.settingsChanged(settings);
  await controller.observeUsage(await combined(officialSnapshot(100, now)));
  assert.equal(calls.length, 4, "refreshes and a controller restart must not repeat handled events");
  console.log("PASS: isolated rollout -> merged official quota -> persisted multi-task resume -> Desktop request integration; late/background enable, early fresh recovery, API exclusion, queue preservation and no duplicate sends.");
} finally {
  await controller?.stop();
  await tracker?.stop();
  await fs.rm(root, { recursive: true, force: true });
}
