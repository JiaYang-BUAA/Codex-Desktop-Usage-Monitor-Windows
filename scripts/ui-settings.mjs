import fs from "node:fs/promises";
import path from "node:path";

export const UI_SETTINGS_SCHEMA_VERSION = 1;
export const UI_SETTINGS_FILE_NAME = "ui-settings.json";
export const MAX_UI_SETTINGS_BYTES = 64 * 1024;

const SOURCE_ID_PATTERN = /^[a-zA-Z0-9_-]{1,32}$/;
const METRIC_ID_PATTERN = /^[a-zA-Z0-9_-]{1,48}$/;
const VERSION_FIELDS = ["apiKeyMetricsVersion", "officialMetricsVersion", "unifiedMetricsVersion"];
const BOOLEAN_FIELDS = ["minimalMode", "countdownVisualization", "englishUi", "updateNotifications"];

const safeVersion = (value) => Number.isSafeInteger(Number(value)) && Number(value) >= 0
  ? Math.min(1000, Number(value))
  : 0;

export function normalizeUiSettings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const metrics = {};
  if (value.metrics && typeof value.metrics === "object" && !Array.isArray(value.metrics)) {
    for (const [sourceId, ids] of Object.entries(value.metrics).slice(0, 16)) {
      if (!SOURCE_ID_PATTERN.test(sourceId) || !Array.isArray(ids)) continue;
      metrics[sourceId] = [...new Set(ids
        .filter((id) => typeof id === "string" && METRIC_ID_PATTERN.test(id)))]
        .slice(0, 14);
    }
  }
  const normalized = { schemaVersion: UI_SETTINGS_SCHEMA_VERSION, metrics };
  for (const field of VERSION_FIELDS) normalized[field] = safeVersion(value[field]);
  for (const field of BOOLEAN_FIELDS) normalized[field] = Boolean(value[field]);
  return normalized;
}

export function resolveUiSettingsPath(environment = process.env) {
  if (environment.CODEX_USAGE_UI_SETTINGS_PATH) return path.resolve(environment.CODEX_USAGE_UI_SETTINGS_PATH);
  if (!environment.LOCALAPPDATA) throw new Error("LOCALAPPDATA is unavailable; cannot persist monitor UI settings.");
  return path.join(environment.LOCALAPPDATA, "CodexUsageMonitor", UI_SETTINGS_FILE_NAME);
}

export async function readUiSettingsFile(filePath) {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_UI_SETTINGS_BYTES) return null;
    return normalizeUiSettings(JSON.parse(await fs.readFile(filePath, "utf8")));
  } catch (error) {
    if (["ENOENT", "ENOTDIR", "SyntaxError"].includes(error?.code) || error instanceof SyntaxError) return null;
    throw error;
  }
}

export async function writeUiSettingsFile(filePath, value) {
  const normalized = normalizeUiSettings(value);
  if (!normalized) throw new TypeError("Invalid monitor UI settings payload.");
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await fs.rename(temporaryPath, filePath);
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
  }
  return normalized;
}

export async function createUiSettingsStore(filePath = resolveUiSettingsPath()) {
  let current = await readUiSettingsFile(filePath);
  let serialized = current ? JSON.stringify(current) : null;
  let pending = Promise.resolve();
  return {
    filePath,
    get current() { return current; },
    save(value) {
      const normalized = normalizeUiSettings(value);
      if (!normalized) return Promise.reject(new TypeError("Invalid monitor UI settings payload."));
      const nextSerialized = JSON.stringify(normalized);
      if (nextSerialized === serialized) return pending;
      current = normalized;
      serialized = nextSerialized;
      const write = pending.catch(() => {}).then(() => writeUiSettingsFile(filePath, normalized));
      pending = write;
      return write;
    },
    flush() { return pending; },
  };
}
