import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

async function recordFailure(statePath, version, message) {
  const state = JSON.parse(await fs.readFile(statePath, "utf8"));
  // Preserve the installer's own diagnostic and any newer update state.
  if (state.status !== "installing" || state.latestVersion !== version) return state;
  const value = { ...state, status: "error", error: message.slice(0, 500) };
  const temporary = `${statePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await fs.rename(temporary, statePath);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
  return value;
}

export async function runAutoUpdateWorker({ statePath, version, powerShell, args, spawnImpl = spawn }) {
  // Windows can silently skip a PowerShell script when PowerShell itself is
  // detached. Only this Node worker is detached; keep its installer attached.
  const result = await new Promise((resolve) => {
    try {
      const child = spawnImpl(powerShell, args, { detached: false, windowsHide: true, stdio: "ignore" });
      child.once("error", (error) => resolve({ error: String(error.message || error) }));
      child.once("close", (code, signal) => resolve({ code, signal }));
    } catch (error) {
      resolve({ error: String(error.message || error) });
    }
  });
  const state = JSON.parse(await fs.readFile(statePath, "utf8"));
  if (!result.error && result.code === 0 && state.status === "installed" && state.currentVersion === version) return true;
  const message = result.error
    ? `Update installer could not start: ${result.error}`
    : `Update installer exited with ${result.signal ? `signal ${result.signal}` : `code ${result.code}`}${result.code === 0 ? " without confirming installation" : ""}.`;
  await recordFailure(statePath, version, message);
  return false;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [statePath, version, powerShell, ...args] = process.argv.slice(2);
  runAutoUpdateWorker({ statePath, version, powerShell, args }).then((installed) => {
    process.exitCode = installed ? 0 : 1;
  }).catch((error) => {
    console.error(`[usage-monitor] update worker failed: ${error.message}`);
    process.exitCode = 1;
  });
}
