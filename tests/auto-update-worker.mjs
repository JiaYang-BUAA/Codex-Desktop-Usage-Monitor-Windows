import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { runAutoUpdateWorker } from "../scripts/auto-update-worker.mjs";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex update worker "));
const version = "9.8.7";
const statePath = path.join(root, "update-state.json");
const pending = { schemaVersion: 1, status: "installing", currentVersion: "3.1.6", latestVersion: version };
const writeState = value => fs.writeFile(statePath, JSON.stringify(value));
const readState = async () => JSON.parse(await fs.readFile(statePath, "utf8"));
try {
  for (const scenario of ["zero-without-state", "nonzero", "signal", "missing-executable", "script-error", "installed", "newer-state"]) {
    await writeState(pending);
    const result = await runAutoUpdateWorker({
      statePath, version, powerShell: "fixture", args: ["fixture script.ps1"],
      spawnImpl(command, args, options) {
        assert.equal(options.detached, false);
        assert.equal(options.windowsHide, true);
        assert.equal(options.stdio, "ignore");
        const child = new EventEmitter();
        setImmediate(async () => {
          if (scenario === "script-error") await writeState({ ...pending, status: "error", error: "SHA-256 failed" });
          if (scenario === "installed") await writeState({ status: "installed", currentVersion: version });
          if (scenario === "newer-state") await writeState({ ...pending, latestVersion: "9.8.8" });
          if (scenario === "missing-executable") child.emit("error", new Error("ENOENT"));
          child.emit("close", ["nonzero", "script-error"].includes(scenario) ? 17 : 0, scenario === "signal" ? "SIGTERM" : null);
        });
        return child;
      },
    });
    assert.equal(result, scenario === "installed");
    const state = await readState();
    if (scenario === "installed") assert.equal(state.status, "installed");
    else if (scenario === "newer-state") assert.equal(state.latestVersion, "9.8.8");
    else {
      assert.equal(state.status, "error");
      assert.match(state.error, {
        "zero-without-state": /code 0 without confirming installation/,
        nonzero: /code 17/,
        signal: /SIGTERM/,
        "missing-executable": /could not start.*ENOENT/,
        "script-error": /SHA-256 failed/,
      }[scenario]);
    }
  }

  if (process.platform === "win32") {
    const updaterUrl = new URL("../scripts/auto-updater.mjs", import.meta.url).href;
    const workerPath = fileURLToPath(new URL("../scripts/auto-update-worker.mjs", import.meta.url));
    for (const shell of ["pwsh.exe", "powershell.exe"]) {
      const fixture = path.join(root, shell);
      const fixtureState = path.join(fixture, "state", "update-state.json");
      await fs.mkdir(path.join(fixture, "scripts"), { recursive: true });
      await fs.writeFile(path.join(fixture, "VERSION"), "3.1.6\n");
      await fs.copyFile(workerPath, path.join(fixture, "scripts", "auto-update-worker.mjs"));
      await fs.writeFile(path.join(fixture, "scripts", "auto-update.ps1"), `\ufeffparam([string]$ArchivePath, [string]$ExpectedSha256, [string]$Version, [int]$Port)
Start-Sleep -Milliseconds 1500
$statePath = Join-Path (Split-Path -Parent (Split-Path -Parent $ArchivePath)) 'update-state.json'
[IO.File]::WriteAllText("$ArchivePath.executed", 'executed')
[IO.File]::WriteAllText($statePath, (@{status='installed'; currentVersion=$Version} | ConvertTo-Json))
exit 0
`);
      const bytes = Buffer.from("fixture package");
      const digest = crypto.createHash("sha256").update(bytes).digest("hex");
      const release = { tag_name: `v${version}`, assets: [{
        name: `codex-usage-monitor-windows-${version}.zip`, size: bytes.length, digest: `sha256:${digest}`,
        browser_download_url: `https://github.com/JiaYang-BUAA/Codex-Desktop-Usage-Monitor-Windows/releases/download/v${version}/codex-usage-monitor-windows-${version}.zip`,
      }] };
      const parentCode = `import {createAutoUpdater} from ${JSON.stringify(updaterUrl)};
const updater = createAutoUpdater({root:${JSON.stringify(fixture)}, port:9335,
settingsStore:{current:{updateNotifications:true}}, statePath:${JSON.stringify(fixtureState)},
environment:{CODEX_USAGE_POWERSHELL_PATH:${JSON.stringify(shell)}},
fetchImpl:async url => String(url).includes('api.github.com') ? new Response(${JSON.stringify(JSON.stringify(release))}) : new Response('fixture package')});
const result = await updater.check({force:true});
if(result.status !== 'installing') process.exitCode=1;`;
      const parent = spawn(process.execPath, ["--input-type=module", "-e", parentCode], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      let stderr = "";
      parent.stderr.on("data", data => { stderr += data; });
      const exitCode = await new Promise((resolve, reject) => { parent.once("error", reject); parent.once("close", resolve); });
      assert.equal(exitCode, 0, stderr);
      // The parent is already gone while the installer is still sleeping.
      assert.equal(JSON.parse(await fs.readFile(fixtureState, "utf8")).status, "installing");
      const deadline = Date.now() + 12000;
      let state;
      do {
        await delay(100);
        state = JSON.parse(await fs.readFile(fixtureState, "utf8"));
      } while (state.status === "installing" && Date.now() < deadline);
      assert.equal(state.status, "installed", JSON.stringify(state));
      assert.equal(state.currentVersion, version);
      const files = await fs.readdir(path.join(fixture, "state", "updates"));
      assert.ok(files.some(name => name.endsWith(".executed")));
    }
  }
  console.log("PASS: update worker failure states and installation after parent exit (both Windows PowerShell runtimes).");
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
