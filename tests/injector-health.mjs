import assert from "node:assert/strict";
import vm from "node:vm";
import { backendHeartbeatExpression, backendVerificationExpression, nextEndpointLoss, runOnce } from "../scripts/injector.mjs";

const now = Date.now();
const document = { getElementById: () => ({ shadowRoot: {} }) };
const window = { __CODEX_USAGE_MONITOR_STATE__: { usage: { currentThreadId: "preserve-me" } } };
const context = vm.createContext({ window, document });
const evaluate = (expression) => vm.runInContext(expression, context);
assert.equal(evaluate(backendVerificationExpression(123, now)).backendRunning, false, "leftover panel is not backend liveness");
evaluate(backendHeartbeatExpression(123, now));
assert.equal(evaluate(backendVerificationExpression(123, now + 1000)).backendRunning, true);
assert.equal(evaluate(backendVerificationExpression(456, now + 1000)).backendRunning, false, "old process cannot verify its replacement");
assert.equal(evaluate(backendVerificationExpression(123, now + 16000)).backendRunning, false);
document.getElementById = () => null;
evaluate(backendHeartbeatExpression(456, now));
assert.equal(evaluate(backendVerificationExpression(456, now + 1000)).phase, "waiting-composer");
assert.equal(evaluate(backendVerificationExpression(456, now + 1000)).backendRunning, true, "slow/absent Composer is not a stopped daemon");
assert.equal(evaluate(backendVerificationExpression(123, now + 1000)).backendRunning, true, "each candidate owns its own heartbeat");
assert.equal(nextEndpointLoss(null, true, now + 600000).shouldExit, false, "responsive desktop without a page can load arbitrarily slowly");
const loss = nextEndpointLoss(null, false, now);
assert.equal(nextEndpointLoss(loss.missingSince, false, now + 179999).shouldExit, false);
assert.equal(nextEndpointLoss(loss.missingSince, false, now + 180000).shouldExit, true, "closed desktop eventually releases daemon");
assert.deepEqual(nextEndpointLoss(loss.missingSince, true, now + 150000), { missingSince: null, shouldExit: false });

// Exercise the actual CLI verification route with an isolated CDP transport.
// Any injected code, settings writes or runtime bindings would fail these checks.
const originalFetch = globalThis.fetch;
const originalSocket = globalThis.WebSocket;
const originalLog = console.log;
const originalExitCode = process.exitCode;
const methods = [];
class FakeSocket extends EventTarget {
  constructor() { super(); setTimeout(() => this.dispatchEvent(new Event("open")), 0); }
  send(text) {
    const message = JSON.parse(text);
    methods.push(message.method);
    let result = {};
    if (message.method === "Runtime.evaluate") result = { result: { value: evaluate(message.params.expression) } };
    queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ id: message.id, result }) })));
  }
  close() { queueMicrotask(() => this.dispatchEvent(new Event("close"))); }
}
try {
  globalThis.WebSocket = FakeSocket;
  globalThis.fetch = async () => ({ ok: true, json: async () => [{ id: "main", type: "page", url: "app://-/index.html", webSocketDebuggerUrl: "ws://127.0.0.1:9335/devtools/page/main" }] });
  const results = [];
  console.log = (text) => results.push(JSON.parse(text));
  const previousUsage = JSON.stringify(window.__CODEX_USAGE_MONITOR_STATE__);
  await runOnce({ mode: "verify", port: 9335, timeoutMs: 1000, expectedPid: 456 });
  assert.equal(results.at(-1).verified, true);
  assert.equal(JSON.stringify(window.__CODEX_USAGE_MONITOR_STATE__), previousUsage);
  assert.deepEqual([...new Set(methods)].sort(), ["Page.enable", "Runtime.enable", "Runtime.evaluate"]);
  methods.length = 0;
  await runOnce({ mode: "verify", port: 9335, timeoutMs: 1000, expectedPid: 999 });
  assert.equal(results.at(-1).verified, false);
  assert.equal(process.exitCode, 1);
  assert.equal(JSON.stringify(window.__CODEX_USAGE_MONITOR_STATE__), previousUsage);
} finally {
  globalThis.fetch = originalFetch;
  globalThis.WebSocket = originalSocket;
  console.log = originalLog;
  process.exitCode = originalExitCode;
}
console.log("PASS: read-only PID heartbeat verification, slow Composer readiness, endpoint recovery, and stale panel rejection.");
