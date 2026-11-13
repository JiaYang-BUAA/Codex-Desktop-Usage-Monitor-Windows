import assert from "node:assert/strict";
import vm from "node:vm";
import {
  buildDesktopAutoResumeExpression,
  probeDesktopRequestClient,
  sendContinueThroughDesktop,
  sendContinueThroughQueue,
} from "../scripts/desktop-request.mjs";

const THREAD_ID = "019fb3b1-2638-7bb0-9a90-ec83b5bca0f2";
const EVENT_ID = "0123456789abcdef0123456789abcdef";
const TURN_ID = "019fb3b1-2638-7bb0-9a90-ec83b5bca0f3";

const calls = [];
const context = vm.createContext({ calls });
vm.runInContext(`
  const queuedFollowUps = {
    ${JSON.stringify(THREAD_ID)}: [
      { id: "queued-one", text: "排队消息 1" },
      { id: "queued-two", text: "排队消息 2" },
    ],
  };
  globalThis.window = {
    __codexRoot: {
      _internalRoot: {
        current: {
          nested: {
            queryClient: {
              getQueryCache() {
                return { getAll: () => [{ queryKey: ["get-global-state", "queued-follow-ups"], state: { data: { value: queuedFollowUps } } }] };
              },
            },
            hostId: "local",
            requestPromises: new Map(),
            async sendRequest(method, params, options) {
              calls.push({ method, params, options });
              return method === "turn/start" ? { turn: { id: ${JSON.stringify(TURN_ID)} } } : { thread: { id: params.threadId } };
            },
          },
        },
      },
    },
  };
`, context);

const session = {
  expressions: [],
  async evaluate(expression) {
    this.expressions.push(expression);
    const value = await vm.runInContext(expression, context);
    return JSON.parse(JSON.stringify(value));
  },
};

assert.deepEqual(
  await probeDesktopRequestClient(session),
  { ok: true, method: "codex-desktop-internal-request", hostId: "local" },
);

const result = await sendContinueThroughDesktop(session, {
  threadId: THREAD_ID.toUpperCase(),
  eventId: EVENT_ID.toUpperCase(),
  message: "请继续完成当前任务",
});
assert.deepEqual(result, {
  ok: true,
  method: "codex-desktop-internal-request",
  threadId: THREAD_ID,
  turnId: TURN_ID,
  queuedCount: 2,
  queuePreserved: true,
});
const normalizedCalls = JSON.parse(JSON.stringify(calls));
assert.deepEqual(normalizedCalls.map((item) => item.method), ["thread/resume", "turn/start"]);
assert.deepEqual(normalizedCalls[0], {
  method: "thread/resume",
  params: { threadId: THREAD_ID },
  options: { priority: "critical", source: "usage_monitor_auto_resume" },
});
assert.equal(normalizedCalls[1].params.threadId, THREAD_ID);
assert.deepEqual(normalizedCalls[1].params.input, [{ type: "text", text: "请继续完成当前任务" }]);
assert.equal(Object.hasOwn(normalizedCalls[1].params, "approvalPolicy"), false);
assert.equal(normalizedCalls[1].params.clientUserMessageId, `codex-usage-monitor-${EVENT_ID}`);
assert.equal(vm.runInContext(`queuedFollowUps[${JSON.stringify(THREAD_ID)}].length`, context), 2);
assert.equal(session.expressions.some((expression) => expression.includes("Input.insertText")), false);
assert.equal(session.expressions.some((expression) => expression.includes("prepareAutoResume")), false);

const encoded = buildDesktopAutoResumeExpression({ threadId: THREAD_ID, eventId: EVENT_ID, message: '继续处理 "A"' });
assert.doesNotMatch(encoded, /thread\/resume/);
assert.match(encoded, /turn\/start/);
assert.ok(session.expressions.some(expression => expression.includes('"thread/resume"') && !expression.includes('"turn/start"')));
assert.match(encoded, /继续处理 \\"A\\"/);

const beforeInvalid = session.expressions.length;
assert.deepEqual(
  await sendContinueThroughDesktop(session, { threadId: "bad", eventId: EVENT_ID, message: "继续" }),
  { ok: false, reason: "invalid-auto-resume-thread-id" },
);
assert.deepEqual(
  await sendContinueThroughDesktop(session, { threadId: THREAD_ID, eventId: "bad", message: "继续" }),
  { ok: false, reason: "invalid-auto-resume-event-id" },
);
assert.deepEqual(
  await sendContinueThroughDesktop(session, { threadId: THREAD_ID, eventId: EVENT_ID, message: "bad\nmessage" }),
  { ok: false, reason: "invalid-auto-resume-message" },
);
assert.equal(session.expressions.length, beforeInvalid);

const unavailable = {
  async evaluate() { throw new Error("codex-desktop-request-client-not-found"); },
};
assert.deepEqual(await probeDesktopRequestClient(unavailable), { ok: false, reason: "codex-desktop-request-client-not-found" });
assert.deepEqual(
  await sendContinueThroughDesktop(unavailable, { threadId: THREAD_ID, eventId: EVENT_ID, message: "继续" }),
  { ok: false, reason: "desktop-request-client-unavailable" },
);

// Retrying a completed event in the same renderer must not create another turn.
const callCount = calls.length;
await sendContinueThroughDesktop(session, { threadId: THREAD_ID, eventId: EVENT_ID, message: "继续" });
assert.equal(calls.length, callCount);
// Two overlapping evaluations share the in-flight operation. Queue movement after
// an accepted turn does not turn success into a retryable failure.
vm.runInContext(`window.__codexRoot._internalRoot.current.nested.sendRequest = async (method, params, options) => {
  calls.push({method, params, options});
  if (method === 'turn/start') { queuedFollowUps[${JSON.stringify(THREAD_ID)}] = []; return {turn:{id:${JSON.stringify(TURN_ID)}}}; }
  return {};
}`, context);
const next = { threadId: THREAD_ID, eventId: 'f'.repeat(32), message: '继续' };
const parallel = await Promise.all([sendContinueThroughDesktop(session, next), sendContinueThroughDesktop(session, next)]);
assert.equal(calls.length, callCount + 2);
assert.equal(parallel[0].ok, true);
assert.equal(parallel[0].queuePreserved, false);
assert.equal(parallel[1].turnId, TURN_ID);
const timeoutSession = { async evaluate(expression, timeout) { assert.equal(timeout, 60000); throw new Error('Runtime.evaluate timed out'); } };
assert.deepEqual(await sendContinueThroughDesktop(timeoutSession, next), {ok:false, reason:'desktop-request-client-unavailable'});

const request = {threadId: THREAD_ID, eventId: 'e'.repeat(32), message: '继续'};
const beforeCancel = calls.length;
let allowed = true;
const revokeAfterPreparation = { async evaluate(expression, timeout) {
  const value = await session.evaluate(expression, timeout);
  allowed = false;
  return value;
} };
assert.deepEqual(await sendContinueThroughDesktop(revokeAfterPreparation, request, () => allowed),
  {ok:false, reason:'not-authorized'});
assert.deepEqual(calls.slice(beforeCancel).map(item => item.method), ['thread/resume']);

for (const [index, behavior] of ['reject', 'missing-receipt', 'lost-transport'].entries()) {
  const event = {...request, eventId: String(index).repeat(32)};
  vm.runInContext(`window.__codexRoot._internalRoot.current.nested.sendRequest = async (method) => {
    calls.push({method});
    if (method === 'thread/resume') return {};
    if (${JSON.stringify(behavior)} === 'reject') throw Error('uncertain submission');
    if (${JSON.stringify(behavior)} === 'missing-receipt') return {turn:{}};
    return {turn:{id:${JSON.stringify(TURN_ID)}}};
  }`, context);
  const fake = { async evaluate(expression, timeout) {
    assert.equal(timeout, 60000);
    const value = await session.evaluate(expression);
    if (behavior === 'lost-transport' && expression.includes('"turn/start"')) throw Error('Timeout');
    return value;
  } };
  const before = calls.length;
  const first = await sendContinueThroughDesktop(fake, event);
  assert.deepEqual(first, {ok:false, reason:'desktop-send-unconfirmed'});
  const repeated = await sendContinueThroughDesktop(session, event);
  if (behavior === 'lost-transport') assert.equal(repeated.turnId, TURN_ID);
  else assert.deepEqual(repeated, first);
  assert.deepEqual(calls.slice(before).map(item => item.method), ['thread/resume','turn/start']);
}

// Queue RPCs do not deduplicate clientUserMessageId. A lost write reply
// must never be routed to the legacy renderer as a second send.
const pending = { threadId: THREAD_ID, turnId: TURN_ID, eventId: EVENT_ID, message: "继续" };
const queueId = "queue-receipt";
const clientUserMessageId = `codex-usage-monitor-${EVENT_ID}`;
for (const scenario of ["unsupported", "existing", "busy", "revoke", "failed-turn-changed", "lost-reply", "wrong-receipt", "accepted"]) {
  let enabled = true;
  let additions = 0;
  let stops = 0;
  const rpc = {
    async start() {},
    async stop() { stops++; },
    async request(method, params) {
      assert.equal(params.threadId, THREAD_ID);
      if (method === "thread/queue/list") {
        if (scenario === "unsupported") throw Error("unsupported");
        if (scenario === "existing") return { data: [{ id: queueId, clientUserMessageId }] };
        if (scenario === "busy") return { data: [{ id: "other" }] };
        return { data: [] };
      }
      if (method === "thread/turns/list") {
        assert.equal(params.itemsView, "notLoaded");
        if (scenario === "revoke") enabled = false;
        return { data: [{ id: TURN_ID, status: scenario === "failed-turn-changed" ? "completed" : "failed",
          error: { codexErrorInfo: "usageLimitExceeded" } }] };
      }
      assert.equal(method, "thread/queue/add");
      additions++;
      assert.equal(params.clientUserMessageId, clientUserMessageId);
      if (scenario === "lost-reply") throw Error("connection lost");
      return { queuedSubmission: { id: queueId, clientUserMessageId: scenario === "wrong-receipt" ? "other" : clientUserMessageId } };
    },
  };
  const outcome = await sendContinueThroughQueue("fixture", pending, () => enabled, () => rpc);
  assert.equal(stops, 1);
  assert.equal(additions, ["accepted", "lost-reply", "wrong-receipt"].includes(scenario) ? 1 : 0);
  if (["accepted", "existing"].includes(scenario)) assert.deepEqual(outcome, { ok: true, queued: true, queueId });
  else assert.deepEqual(outcome, { ok: false, reason: {
    unsupported: "desktop-request-client-unavailable", busy: "desktop-queue-pending", revoke: "not-authorized",
    "failed-turn-changed": "not-authorized", "lost-reply": "desktop-send-unconfirmed", "wrong-receipt": "desktop-send-unconfirmed",
  }[scenario] });
}
console.log("PASS: exact-thread desktop requests and queue receipts, cancellation, existing messages and uncertain deliveries.");
