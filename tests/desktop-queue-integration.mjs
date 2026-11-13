import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { AppServerRpc, LocalCodexTokenTracker } from "../scripts/usage-client.mjs";
import { sendContinueThroughQueue } from "../scripts/desktop-request.mjs";

// Two actual app-server processes share only this fixture's home. The writer
// must not load the conversation; the owner must consume the queued message.
const command = process.env.CODEX_APP_RUNTIME_CLI_PATH;
if (!command || !path.isAbsolute(command) || !existsSync(command)) {
  console.log("SKIP: no explicit desktop runtime CLI for the offline queue integration.");
  process.exit(0);
}
const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-monitor-desktop-queue-"));
const cwd = path.join(root, "workspace");
const home = path.join(root, "codex-home");
const environment = Object.fromEntries(
  ["PATH", "SystemRoot", "WINDIR", "SystemDrive", "ComSpec", "PATHEXT", "PROCESSOR_ARCHITECTURE", "NUMBER_OF_PROCESSORS"]
    .filter(name => process.env[name]).map(name => [name, process.env[name]])
);
Object.assign(environment, {
  TEMP: root, TMP: root, USERPROFILE: root, HOME: root, LOCALAPPDATA: root, APPDATA: root, CODEX_HOME: home,
  HTTP_PROXY: "http://127.0.0.1:1", HTTPS_PROXY: "http://127.0.0.1:1", ALL_PROXY: "http://127.0.0.1:1",
  NO_PROXY: "127.0.0.1,localhost", DO_NOT_TRACK: "1", OTEL_SDK_DISABLED: "true", RUST_LOG: "off",
});

let requests = 0;
let quotaExceeded = true;
const model = http.createServer((req, res) => {
  if (req.url !== "/v1/responses") {
    res.writeHead(404).end();
    return;
  }
  req.resume();
  requests++;
  if (quotaExceeded) {
    res.writeHead(429, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { type: "usage_limit_reached", message: "Fixture quota exceeded",
      plan_type: "plus", resets_at: Math.floor(Date.now() / 1000) + 1 } }));
    return;
  }
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  for (const type of ["response.created", "response.completed"]) {
    const response = { id: `resp_${requests}`, status: "completed", output: [],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
    res.write(`event: ${type}\ndata: ${JSON.stringify({ type, response })}\n\n`);
  }
  res.end();
});

const completed = [];
const owner = new AppServerRpc({ command, environment, cwd, experimentalApi: true,
  onNotification(method, params) {
    if (method === "turn/completed") completed.push(params);
  } });
const client = () => new AppServerRpc({ command, environment, cwd, experimentalApi: true });
async function waitForCompleted(count) {
  const deadline = Date.now() + 30_000;
  while (completed.length < count && Date.now() < deadline) await delay(100);
  assert.ok(completed.length >= count, `Original process did not complete turn ${count}`);
  return completed[count - 1];
}

async function run() {
  await Promise.all([fs.mkdir(cwd), fs.mkdir(home)]);
  const help = (...args) => execFileSync(command, [...args, "--help"], { cwd, env: environment,
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true, timeout: 10_000 });
  if (!/^\s+queue\s/m.test(help()) || !help("queue").includes("--resume")) {
    console.log("SKIP: desktop runtime predates the tested shared-queue protocol.");
    return;
  }
  await new Promise((resolve, reject) => { model.once("error", reject); model.listen(0, "127.0.0.1", resolve); });
  await fs.writeFile(path.join(home, "config.toml"), [
    'model_provider = "fixture"', 'model = "fixture"', "check_for_update_on_startup = false",
    "[model_providers.fixture]", 'name = "Offline fixture"',
    `base_url = "http://127.0.0.1:${model.address().port}/v1"`, 'wire_api = "responses"',
    "supports_websockets = false", "requires_openai_auth = false",
    "request_max_retries = 0", "stream_max_retries = 0", "[analytics]", "enabled = false", "",
  ].join("\n"));
  await owner.start();
  const { thread } = await owner.request("thread/start", { cwd, model: "fixture", modelProvider: "fixture",
    approvalPolicy: "never", sandbox: "read-only", ephemeral: false });
  const threadId = thread.id;
  const first = await owner.request("turn/start", { threadId, input: [{ type: "text", text: "fixture anchor", text_elements: [] }] });
  const failure = await waitForCompleted(1);
  assert.equal(failure.turn.id, first.turn.id);
  assert.equal(failure.turn.error?.codexErrorInfo, "usageLimitExceeded");
  quotaExceeded = false;

  // The monitor discovers pauses from the owner's rollout. Only the fake local
  // provider is considered a subscription in this test.
  const tracker = new LocalCodexTokenTracker({ sessionRoot: path.join(home, "sessions"),
    counterPath: path.join(root, "counter.json"), officialModelProviders: ["fixture"] });
  let paused;
  try {
    tracker.setAutoResumeThreadIds([threadId]);
    const deadline = Date.now() + 5_000;
    do {
      paused = (await tracker.refresh()).autoResumeTasks?.[threadId];
      if (paused?.currentStatus === "quota-paused") break;
      await delay(100);
    } while (Date.now() < deadline);
  } finally {
    await tracker.stop();
  }
  assert.equal(paused?.currentStatus, "quota-paused", "Monitor must recognize the original task's actual quota failure");
  assert.equal(paused.quotaExceeded.turnId, first.turn.id);
  assert.match(paused.quotaExceeded.eventId, /^[0-9a-f]{32}$/);
  const pending = { threadId, turnId: paused.quotaExceeded.turnId, eventId: paused.quotaExceeded.eventId, message: "fixture resume" };
  const cancelled = await sendContinueThroughQueue(command, pending, () => false, client);
  assert.equal(cancelled.reason, "not-authorized");
  const delivered = await sendContinueThroughQueue(command, pending, () => true, client);
  assert.equal(delivered.ok, true);
  assert.equal(delivered.queued, true);
  assert.ok(delivered.queueId);
  const recovered = await waitForCompleted(2);
  assert.equal(recovered.threadId, threadId);
  assert.notEqual(recovered.turn.id, first.turn.id);
  assert.equal(recovered.turn.status, "completed");
  assert.equal(requests, 2);
  const { data } = await owner.request("thread/turns/list", { threadId, limit: 1, sortDirection: "desc", itemsView: "full" });
  const userMessage = data[0].items.find(item => item.type === "userMessage");
  assert.equal(userMessage?.content[0]?.text, pending.message);
  const obsolete = await sendContinueThroughQueue(command, pending, () => true, client);
  assert.equal(obsolete.reason, "not-authorized", "A new turn invalidates the old quota pause");
  assert.deepEqual((await owner.request("thread/queue/list", { threadId })).data, []);

  // Leaving a thread unloaded gives us a stable, user-owned queue entry.
  // A monitor started later must leave it in place and defer its own message.
  quotaExceeded = true;
  const third = await owner.request("turn/start", { threadId, input: [{ type: "text", text: "fixture limit again", text_elements: [] }] });
  assert.equal((await waitForCompleted(3)).turn.error?.codexErrorInfo, "usageLimitExceeded");
  await owner.stop();
  const writer = client();
  try {
    await writer.start();
    const userId = randomUUID();
    const { queuedSubmission } = await writer.request("thread/queue/add", { threadId, clientUserMessageId: userId,
      input: [{ type: "text", text: "user's existing follow-up", text_elements: [] }] });
    const deferred = await sendContinueThroughQueue(command, { ...pending, eventId: randomUUID().replaceAll("-", ""),
      turnId: third.turn.id }, () => true, client);
    assert.equal(deferred.reason, "desktop-queue-pending");
    const queue = await writer.request("thread/queue/list", { threadId });
    assert.deepEqual(queue.data.map(entry => [entry.id, entry.clientUserMessageId]), [[queuedSubmission.id, userId]]);
    assert.equal(requests, 3, "A queue writer must not start a turn on behalf of an unloaded owner");
  } finally {
    await writer.stop();
  }
  console.log("PASS: original desktop runtime resumed a real quota-failed fixture from a second process, with one accepted queue submission.");
}

try {
  await run();
} finally {
  await owner.stop();
  if (model.listening) {
    model.closeAllConnections();
    await new Promise(resolve => model.close(resolve));
  }
  assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
  assert.ok(path.basename(root).startsWith("codex-monitor-desktop-queue-"));
  await fs.rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
}
