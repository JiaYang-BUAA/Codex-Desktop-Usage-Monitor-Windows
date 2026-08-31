import assert from "node:assert/strict";
import vm from "node:vm";
import {
  buildDesktopAutoResumeExpression,
  probeDesktopRequestClient,
  sendContinueThroughDesktop,
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
assert.equal(normalizedCalls[1].params.approvalPolicy, "never");
assert.equal(normalizedCalls[1].params.clientUserMessageId, `codex-usage-monitor-${EVENT_ID}`);
assert.equal(vm.runInContext(`queuedFollowUps[${JSON.stringify(THREAD_ID)}].length`, context), 2);
assert.equal(session.expressions.some((expression) => expression.includes("Input.insertText")), false);
assert.equal(session.expressions.some((expression) => expression.includes("prepareAutoResume")), false);

const encoded = buildDesktopAutoResumeExpression({ threadId: THREAD_ID, eventId: EVENT_ID, message: '继续处理 "A"' });
assert.match(encoded, /thread\/resume/);
assert.match(encoded, /turn\/start/);
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
  { ok: false, reason: "codex-desktop-request-client-not-found" },
);

console.log("PASS: Codex Desktop internal request submission targets the exact task with validated, idempotent resume turns.");
