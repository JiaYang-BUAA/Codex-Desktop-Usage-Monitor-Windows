import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  compareVersions,
  createAutoUpdater,
  selectReleaseAsset,
} from "../scripts/auto-updater.mjs";

assert.equal(compareVersions("2.1.2", "2.1.1"), 1);
assert.equal(compareVersions("2.1.0", "2.1.0"), 0);
assert.equal(compareVersions("2.0.9", "2.1.0"), -1);
assert.throws(() => compareVersions("2.1", "2.1.0"), /Invalid semantic version/);
assert.throws(() => compareVersions("02.1.0", "2.1.0"), /Invalid semantic version/);

const bytes = Buffer.from("trusted release package");
const digest = crypto.createHash("sha256").update(bytes).digest("hex");
const release = (overrides = {}) => ({
  draft: false,
  prerelease: false,
  tag_name: "v2.1.2",
  assets: [{
    name: "codex-usage-monitor-windows-2.1.2.zip",
    size: bytes.length,
    digest: `sha256:${digest}`,
    browser_download_url: "https://github.com/JiaYang-BUAA/Codex-Desktop-Usage-Monitor-Windows/releases/download/v2.1.2/codex-usage-monitor-windows-2.1.2.zip",
  }],
  ...overrides,
});

assert.equal(selectReleaseAsset(release(), "2.1.1").version, "2.1.2");
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
      return { unref() {} };
    },
  });
  const result = await updater.check({ force: true });
  assert.deepEqual(result, { status: "installing", version: "2.1.2" });
  assert.equal(calls.length, 3);
  assert.equal(spawnCall.options.detached, true);
  assert.ok(spawnCall.args.includes("2.1.2"));
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
} finally {
  await fs.rm(temporaryRoot, { recursive: true, force: true });
}

console.log("Automatic updater tests passed.");
