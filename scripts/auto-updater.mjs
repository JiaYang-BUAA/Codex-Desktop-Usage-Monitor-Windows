import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const MAX_RELEASE_BYTES = 64 * 1024 * 1024;
export const RELEASE_API_URL = "https://api.github.com/repos/JiaYang-BUAA/Codex-Desktop-Usage-Monitor-Windows/releases/latest";
const REPOSITORY_PATH = "/JiaYang-BUAA/Codex-Desktop-Usage-Monitor-Windows";
const VERSION_PATTERN = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;
const DIGEST_PATTERN = /^sha256:([a-f0-9]{64})$/i;

export function compareVersions(left, right) {
  const parse = (value) => {
    const normalized = String(value).replace(/^v/i, "");
    if (!VERSION_PATTERN.test(normalized)) throw new TypeError(`Invalid semantic version: ${value}`);
    return normalized.split(".").map(Number);
  };
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

export function selectReleaseAsset(release, currentVersion) {
  if (!release || typeof release !== "object" || release.draft || release.prerelease) return null;
  const tag = String(release.tag_name || "");
  const version = tag.replace(/^v/, "");
  if (tag !== `v${version}` || !VERSION_PATTERN.test(version) || compareVersions(version, currentVersion) <= 0) return null;
  const name = `codex-usage-monitor-windows-${version}.zip`;
  const matches = Array.isArray(release.assets) ? release.assets.filter((asset) => asset?.name === name) : [];
  if (matches.length !== 1) throw new Error("The release does not contain exactly one expected Windows package.");
  const asset = matches[0];
  const size = Number(asset.size);
  const digestMatch = String(asset.digest || "").match(DIGEST_PATTERN);
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_RELEASE_BYTES) throw new Error("The release package size is invalid.");
  if (!digestMatch) throw new Error("The release package has no valid GitHub SHA-256 digest.");
  const url = new URL(String(asset.browser_download_url || ""));
  const expectedPath = `${REPOSITORY_PATH}/releases/download/v${version}/${name}`;
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.pathname !== expectedPath || url.search || url.hash || url.username || url.password) {
    throw new Error("The release package URL is not the expected GitHub asset URL.");
  }
  return { version, name, size, sha256: digestMatch[1].toLowerCase(), url: url.href };
}

function isAllowedDownloadUrl(value, initial = false) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) return false;
  if (url.hostname === "github.com") return url.pathname.startsWith(`${REPOSITORY_PATH}/releases/download/`);
  if (initial) return false;
  return ["release-assets.githubusercontent.com", "objects.githubusercontent.com"].includes(url.hostname);
}

async function fetchReleaseAsset(fetchImpl, asset, signal) {
  let url = asset.url;
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    if (!isAllowedDownloadUrl(url, redirects === 0)) throw new Error("Release download redirected outside GitHub asset hosts.");
    const response = await fetchImpl(url, {
      headers: { Accept: "application/octet-stream", "User-Agent": "codex-usage-monitor-auto-updater" },
      redirect: "manual",
      signal,
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Release download returned an empty redirect.");
      url = new URL(location, url).href;
      continue;
    }
    if (!response.ok || !response.body) throw new Error(`Release download failed with HTTP ${response.status}.`);
    if (!isAllowedDownloadUrl(response.url || url, false)) throw new Error("Release download ended outside GitHub asset hosts.");
    return response;
  }
  throw new Error("Release download returned too many redirects.");
}

async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await fs.rename(temporary, filePath);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

async function readState(filePath) {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size > 64 * 1024) return {};
    const value = JSON.parse(await fs.readFile(filePath, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return {};
    throw error;
  }
}

async function downloadAsset(fetchImpl, asset, destination) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  const handle = await fs.open(destination, "wx");
  const hash = crypto.createHash("sha256");
  let bytes = 0;
  try {
    const response = await fetchReleaseAsset(fetchImpl, asset, controller.signal);
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > asset.size || bytes > MAX_RELEASE_BYTES) throw new Error("Release download exceeded the declared size limit.");
      hash.update(chunk);
      await handle.write(chunk);
    }
    if (bytes !== asset.size) throw new Error("Release download size does not match GitHub metadata.");
    const actual = hash.digest("hex");
    if (actual !== asset.sha256) throw new Error("Release package SHA-256 does not match GitHub metadata.");
  } finally {
    clearTimeout(timer);
    await handle.close();
  }
}

export function createAutoUpdater({
  root,
  port,
  settingsStore,
  fetchImpl = fetch,
  spawnImpl = spawn,
  now = () => Date.now(),
  environment = process.env,
  intervalMs = UPDATE_CHECK_INTERVAL_MS,
  statePath = environment.LOCALAPPDATA ? path.join(environment.LOCALAPPDATA, "CodexUsageMonitor", "update-state.json") : null,
} = {}) {
  if (!root || !Number.isInteger(port) || !settingsStore || !statePath) throw new TypeError("Auto updater configuration is incomplete.");
  let timer = null;
  let inFlight = null;
  let lastEnabled = Boolean(settingsStore.current?.updateNotifications);

  const writeStatus = async (status, extra = {}) => writeJsonAtomic(statePath, {
    schemaVersion: 1,
    checkedAt: new Date(now()).toISOString(),
    status,
    currentVersion: String((await fs.readFile(path.join(root, "VERSION"), "utf8")).trim()),
    ...extra,
  });

  const check = async ({ force = false } = {}) => {
    if (!settingsStore.current?.updateNotifications) return { status: "disabled" };
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const currentVersion = (await fs.readFile(path.join(root, "VERSION"), "utf8")).trim();
      const previous = await readState(statePath);
      const checkedAt = Date.parse(String(previous.checkedAt || ""));
      if (!force && Number.isFinite(checkedAt) && checkedAt + intervalMs > now()) return { status: "not-due" };
      await writeStatus("checking");
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        let response;
        try {
          response = await fetchImpl(RELEASE_API_URL, {
            headers: { Accept: "application/vnd.github+json", "User-Agent": "codex-usage-monitor-auto-updater" },
            credentials: "omit",
            redirect: "error",
            signal: controller.signal,
          });
        } finally { clearTimeout(timeout); }
        if (!response.ok) throw new Error(`GitHub release check failed with HTTP ${response.status}.`);
        const declaredLength = Number(response.headers.get("content-length"));
        if (Number.isFinite(declaredLength) && declaredLength > 1024 * 1024) throw new Error("GitHub release metadata is too large.");
        const releaseText = await response.text();
        if (Buffer.byteLength(releaseText, "utf8") > 1024 * 1024) throw new Error("GitHub release metadata is too large.");
        const asset = selectReleaseAsset(JSON.parse(releaseText), currentVersion);
        if (!asset) {
          await writeStatus("up-to-date");
          return { status: "up-to-date" };
        }
        const updateDirectory = path.join(path.dirname(statePath), "updates");
        await fs.mkdir(updateDirectory, { recursive: true });
        const archivePath = path.join(updateDirectory, `${asset.name}.${process.pid}.${now()}.download`);
        try {
          await downloadAsset(fetchImpl, asset, archivePath);
          const powerShell = environment.CODEX_USAGE_POWERSHELL_PATH || "pwsh.exe";
          const script = path.join(root, "scripts", "auto-update.ps1");
          const args = ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script,
            "-ArchivePath", archivePath, "-ExpectedSha256", asset.sha256, "-Version", asset.version, "-Port", String(port)];
          const child = spawnImpl(powerShell, args, { detached: true, windowsHide: true, stdio: "ignore" });
          child.unref?.();
          await writeStatus("installing", { latestVersion: asset.version });
          return { status: "installing", version: asset.version };
        } catch (error) {
          await fs.rm(archivePath, { force: true }).catch(() => {});
          throw error;
        }
      } catch (error) {
        const message = String(error?.message || "Update failed").slice(0, 500);
        await writeStatus("error", { error: message }).catch(() => {});
        console.error(`[usage-monitor] automatic update failed: ${message}`);
        return { status: "error", error: message };
      }
    })().finally(() => { inFlight = null; });
    return inFlight;
  };

  return {
    check,
    start() {
      check().catch(() => {});
      timer = setInterval(() => check().catch(() => {}), Math.min(intervalMs, 60 * 60 * 1000));
      timer.unref?.();
    },
    settingsChanged(value) {
      const enabled = Boolean(value?.updateNotifications);
      if (enabled && !lastEnabled) check({ force: true }).catch(() => {});
      lastEnabled = enabled;
    },
    stop() { if (timer) clearInterval(timer); timer = null; },
  };
}
