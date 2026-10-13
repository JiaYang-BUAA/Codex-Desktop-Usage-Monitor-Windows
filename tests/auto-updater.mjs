import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import {
  compareVersions,
  createAutoUpdater,
  selectReleaseAsset,
} from "../scripts/auto-updater.mjs";

assert.equal(compareVersions("2.1.3", "2.1.2"), 1);
assert.equal(compareVersions("2.1.0", "2.1.0"), 0);
assert.equal(compareVersions("2.0.9", "2.1.0"), -1);
assert.throws(() => compareVersions("2.1", "2.1.0"), /Invalid semantic version/);
assert.throws(() => compareVersions("02.1.0", "2.1.0"), /Invalid semantic version/);

const bytes = Buffer.from("trusted release package");
const digest = crypto.createHash("sha256").update(bytes).digest("hex");
const release = (overrides = {}) => ({
  draft: false,
  prerelease: false,
  tag_name: "v2.1.3",
  assets: [{
    name: "codex-usage-monitor-windows-2.1.3.zip",
    size: bytes.length,
    digest: `sha256:${digest}`,
    browser_download_url: "https://github.com/JiaYang-BUAA/Codex-Desktop-Usage-Monitor-Windows/releases/download/v2.1.3/codex-usage-monitor-windows-2.1.3.zip",
  }],
  ...overrides,
});

assert.equal(selectReleaseAsset(release(), "2.1.2").version, "2.1.3");
assert.equal(selectReleaseAsset(release({ draft: true }), "2.1.0"), null);
assert.equal(selectReleaseAsset(release({ prerelease: true }), "2.1.0"), null);
assert.equal(selectReleaseAsset(release({ tag_name: "v2.0.9" }), "2.1.0"), null);
assert.throws(() => selectReleaseAsset(release({ assets: [{ ...release().assets[0], digest: null }] }), "2.1.0"), /SHA-256/);
assert.throws(() => selectReleaseAsset(release({ assets: [{ ...release().assets[0], browser_download_url: "https://example.com/update.zip" }] }), "2.1.0"), /expected GitHub/);

const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-auto-updater-"));
try {
  await fs.writeFile(path.join(temporaryRoot, "VERSION"), "2.1.0\n");
  const statePath = path.join(temporaryRoot, "state", "update-state.json");
  const settingsStore = { current: { updateNotifications: true } };
  const calls = [];
  let spawnCall = null;
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), redirect: options?.redirect });
    if (String(url).includes("api.github.com")) return new Response(JSON.stringify(release()), { status: 200, headers: { "content-type": "application/json" } });
    if (String(url).startsWith("https://github.com/")) {
      return new Response(null, { status: 302, headers: { location: "https://release-assets.githubusercontent.com/trusted-package" } });
    }
    if (String(url).startsWith("https://release-assets.githubusercontent.com/")) return new Response(bytes, { status: 200 });
    throw new Error(`Unexpected request: ${url}`);
  };
  const updater = createAutoUpdater({
    root: temporaryRoot,
    port: 9345,
    settingsStore,
    fetchImpl,
    statePath,
    spawnImpl: (command, args, options) => {
      spawnCall = { command, args, options };
      assert.equal(JSON.parse(readFileSync(statePath, "utf8")).status, "installing");
      const child = new EventEmitter();
      child.unref = () => {};
      queueMicrotask(() => child.emit("spawn"));
      return child;
    },
  });
  const result = await updater.check({ force: true });
  assert.deepEqual(result, { status: "installing", version: "2.1.3" });
  assert.equal(calls.length, 3);
  assert.equal(spawnCall.options.detached, true);
  assert.equal(spawnCall.command, process.execPath);
  assert.equal(spawnCall.args[0], path.join(temporaryRoot, "scripts", "auto-update-worker.mjs"));
  assert.equal(spawnCall.args[1], statePath);
  assert.ok(spawnCall.args.includes("2.1.3"));
  assert.ok(spawnCall.args.includes("9345"));
  assert.equal(JSON.parse(await fs.readFile(statePath, "utf8")).status, "installing");

  calls.length = 0;
  assert.equal((await updater.check()).status, "not-due");
  assert.equal(calls.length, 0);

  settingsStore.current = { updateNotifications: false };
  assert.equal((await updater.check({ force: true })).status, "disabled");

  settingsStore.current = { updateNotifications: true };
  spawnCall = null;
  const badUpdater = createAutoUpdater({
    root: temporaryRoot,
    port: 9345,
    settingsStore,
    statePath: path.join(temporaryRoot, "bad-state.json"),
    fetchImpl: async (url) => String(url).includes("api.github.com")
      ? new Response(JSON.stringify(release()), { status: 200 })
      : new Response(Buffer.from("tampered"), { status: 200 }),
    spawnImpl: () => { throw new Error("must not spawn"); },
  });
  const badResult = await badUpdater.check({ force: true });
  assert.equal(badResult.status, "error");
  assert.match(badResult.error, /size|SHA-256/);
  assert.equal(spawnCall, null);

  const launchFailureState = path.join(temporaryRoot, "launch-failure.json");
  const launchFailure = createAutoUpdater({
    root: temporaryRoot, port: 9345, settingsStore, fetchImpl, statePath: launchFailureState,
    spawnImpl: () => {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit("error", new Error("worker launch failed")));
      return child;
    },
  });
  assert.equal((await launchFailure.check({ force: true })).status, "error");
  assert.match(JSON.parse(await fs.readFile(launchFailureState, "utf8")).error, /worker launch failed/);
  // The first successful mock launch retains its archive; the failed launch must not.
  assert.equal((await fs.readdir(path.join(temporaryRoot, "state", "updates"))).length, 1);
  assert.equal((await fs.readdir(path.join(temporaryRoot, "updates"))).length, 0);

  const fixtureUpdater = (name, fetchImpl, extra = {}) => createAutoUpdater({
    root: temporaryRoot, port: 9345,
    settingsStore: { current: { updateNotifications: true } },
    statePath: path.join(temporaryRoot, `${name}.json`),
    fetchImpl,
    spawnImpl: () => { throw new Error("A rejected or cancelled update must not launch a worker."); },
    ...extra,
  });

  let timedOutBodyCancelled = false;
  const bodyTimeout = fixtureUpdater("metadata-timeout", async () => new Response(new ReadableStream({
    // Headers arrive successfully, but the server never finishes the body.
    cancel() { timedOutBodyCancelled = true; },
  })), { metadataTimeoutMs: 20 });
  const timeoutResult = await bodyTimeout.check();
  assert.equal(timeoutResult.status, "error");
  assert.match(timeoutResult.error, /metadata timed out/);
  assert.equal(timedOutBodyCancelled, true);

  let oversizedReads = 0;
  let oversizedBodyCancelled = false;
  const oversized = fixtureUpdater("metadata-oversized", async () => new Response(new ReadableStream({
    pull(controller) {
      oversizedReads += 1;
      controller.enqueue(new Uint8Array(600 * 1024));
    },
    cancel() { oversizedBodyCancelled = true; },
  }, { highWaterMark: 0 })));
  const oversizedResult = await oversized.check();
  assert.equal(oversizedResult.status, "error");
  assert.match(oversizedResult.error, /size limit/);
  assert.equal(oversizedReads, 2, "a body without Content-Length is stopped at the byte limit");
  assert.equal(oversizedBodyCancelled, true);

  let declaredBodyCancelled = false;
  const declaredOversize = fixtureUpdater("metadata-declared-oversized", async () => new Response(new ReadableStream({
    cancel() { declaredBodyCancelled = true; },
  }), { headers: { "content-length": String(1024 * 1024 + 1) } }));
  assert.match((await declaredOversize.check()).error, /metadata is too large/);
  assert.equal(declaredBodyCancelled, true);

  for (const action of ["disable", "stop"]) {
    for (const stage of ["metadata", "metadata-body", "download", "download-body"]) {
      const settings = { current: { updateNotifications: true } };
      let announceStarted;
      const started = new Promise(resolve => { announceStarted = resolve; });
      let requestSignal;
      let bodyCancelled = false;
      let workerLaunches = 0;
      const cancellable = fixtureUpdater(`${action}-${stage}`, async (url, options) => {
        const metadataRequest = String(url).includes("api.github.com");
        if ((metadataRequest && stage === "metadata-body") || (!metadataRequest && stage === "download-body")) {
          requestSignal = options.signal;
          return new Response(new ReadableStream({
            pull() { announceStarted(); },
            cancel() { bodyCancelled = true; },
          }, { highWaterMark: 0 }));
        }
        if ((metadataRequest && stage === "metadata") || (!metadataRequest && stage === "download")) {
          requestSignal = options.signal;
          announceStarted();
          // Deliberately ignore AbortSignal in this mock: cancellation must
          // release the updater even when the pending request never resolves.
          return new Promise(() => {});
        }
        return metadataRequest ? new Response(JSON.stringify(release())) : new Response(bytes);
      }, {
        settingsStore: settings,
        spawnImpl: () => { workerLaunches += 1; throw new Error("must not spawn"); },
      });
      const checking = cancellable.check();
      await started;
      if (action === "disable") {
        settings.current.updateNotifications = false;
        cancellable.settingsChanged(settings.current);
      } else {
        cancellable.stop();
      }
      assert.deepEqual(await checking, { status: "cancelled" }, `${action} cancels ${stage}`);
      assert.equal(requestSignal.aborted, true);
      assert.equal(workerLaunches, 0);
      if (stage.endsWith("-body")) assert.equal(bodyCancelled, true);
      assert.equal((await cancellable.check()).status, "disabled");
      assert.equal((await fs.readdir(path.join(temporaryRoot, "updates"))).length, 0,
        "cancelled downloads do not retain a partial archive");
    }
  }

  const toggledSettings = { current: { updateNotifications: true } };
  let announceInitial;
  let announceRetry;
  const initialStarted = new Promise(resolve => { announceInitial = resolve; });
  const retryStarted = new Promise(resolve => { announceRetry = resolve; });
  let toggleRequests = 0;
  const toggled = fixtureUpdater("quick-toggle", async () => {
    toggleRequests += 1;
    if (toggleRequests === 1) { announceInitial(); return new Promise(() => {}); }
    announceRetry();
    return new Response(JSON.stringify(release({ tag_name: "v2.1.0" })));
  }, { settingsStore: toggledSettings });
  const initialCheck = toggled.check();
  await initialStarted;
  toggledSettings.current.updateNotifications = false;
  toggled.settingsChanged(toggledSettings.current);
  toggledSettings.current.updateNotifications = true;
  toggled.settingsChanged(toggledSettings.current);
  assert.equal((await initialCheck).status, "cancelled");
  let retryDeadline;
  try {
    await Promise.race([retryStarted, new Promise((_, reject) => {
      retryDeadline = setTimeout(() => reject(new Error("Re-enabling must retry after cancellation settles.")), 2000);
    })]);
  } finally { clearTimeout(retryDeadline); }
  assert.equal((await toggled.check()).status, "up-to-date");
  assert.equal(toggleRequests, 2);
} finally {
  await fs.rm(temporaryRoot, { recursive: true, force: true });
}

console.log("Automatic updater tests passed.");
