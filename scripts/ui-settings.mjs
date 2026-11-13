import fs from "node:fs/promises";
import path from "node:path";
import { AUTO_RESUME_MESSAGE, normalizeAutoResumeMessage } from "./auto-resume.mjs";

export const UI_SETTINGS_SCHEMA_VERSION = 2;
export const UI_SETTINGS_FILE_NAME = "ui-settings.json";
// All 128 per-thread messages can contain 500 UTF-16 characters, including
// characters JSON escapes to six bytes. Keep the read/binding limit large
// enough to round-trip every settings object accepted by the normalizer.
export const MAX_UI_SETTINGS_BYTES = 512 * 1024;

const SOURCE_ID_PATTERN = /^[a-zA-Z0-9_-]{1,32}$/;
const METRIC_ID_PATTERN = /^[a-zA-Z0-9_-]{1,48}$/;
const THREAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VERSION_FIELDS = ["apiKeyMetricsVersion", "officialMetricsVersion", "unifiedMetricsVersion"];
const BOOLEAN_FIELDS = ["minimalMode", "countdownVisualization", "refreshEvery30Seconds", "englishUi", "updateNotifications", "autoResume", "autoResumeSharedMessage"];

const safeVersion = (value) => Number.isSafeInteger(Number(value)) && Number(value) >= 0
  ? Math.min(1000, Number(value))
  : 0;

export function normalizeUiSettings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const metrics = {};
  if (value.metrics && typeof value.metrics === "object" && !Array.isArray(value.metrics)) {
    for (const [sourceId, ids] of Object.entries(value.metrics).slice(0, 16)) {
      if (!SOURCE_ID_PATTERN.test(sourceId) || sourceId === "quota-token" || !Array.isArray(ids)) continue;
      metrics[sourceId] = [...new Set(ids
        .filter((id) => typeof id === "string" && METRIC_ID_PATTERN.test(id))
        .map((id) => ["session", "official"].includes(sourceId) && id === "currentStatus" ? "executionTime" : id))]
        .slice(0, 14);
    }
  }
  const metricOrder = Array.isArray(value.metricOrder)
    ? [...new Set(value.metricOrder.filter((key) => {
        if (typeof key !== "string" || key.length > 82) return false;
        const separator = key.indexOf(":");
        if (separator <= 0 || separator !== key.lastIndexOf(":")) return false;
        return key.slice(0, separator) !== "quota-token"
          && SOURCE_ID_PATTERN.test(key.slice(0, separator)) && METRIC_ID_PATTERN.test(key.slice(separator + 1));
      }).map((key) => key.replace(/^(session|official):currentStatus$/, "$1:executionTime")))].slice(0, 64)
    : [];
  const normalized = { schemaVersion: UI_SETTINGS_SCHEMA_VERSION, metrics, metricOrder };
  for (const field of VERSION_FIELDS) normalized[field] = safeVersion(value[field]);
  for (const field of BOOLEAN_FIELDS) normalized[field] = Boolean(value[field]);
  // Preserve the optional API-column layout for existing settings files. A genuinely
  // new installation has no settings object and the renderer starts with the
  // optional API columns hidden until the user enables them.
  normalized.showApiColumns = Object.prototype.hasOwnProperty.call(value, "showApiColumns")
    ? Boolean(value.showApiColumns)
    : true;
  normalized.showResetForecast = Object.prototype.hasOwnProperty.call(value, "showResetForecast")
    ? Boolean(value.showResetForecast)
    : true;
  normalized.autoResumeMessage = normalizeAutoResumeMessage(value.autoResumeMessage, AUTO_RESUME_MESSAGE);
  normalized.autoResumeThreads = {};
  if (value.autoResumeThreads && typeof value.autoResumeThreads === "object" && !Array.isArray(value.autoResumeThreads)) {
    for (const [threadId, config] of Object.entries(value.autoResumeThreads).slice(0, 128)) {
      const normalizedThreadId = String(threadId).toLowerCase();
      if (!THREAD_ID_PATTERN.test(normalizedThreadId) || !config || typeof config !== "object" || Array.isArray(config)) continue;
      normalized.autoResumeThreads[normalizedThreadId] = {
        enabled: config.enabled === true,
        message: normalizeAutoResumeMessage(config.message, AUTO_RESUME_MESSAGE),
      };
    }
  }
  return normalized;
}

// Each renderer reads the same persisted state, but its next click can arrive
// before another window's change has been broadcast back to it.
export function mergeUiSettingsEdit(current, snapshot, edit) {
  if (!current || !edit) return normalizeUiSettings(snapshot);
  const next = normalizeUiSettings(current);
  const { key, threadId } = edit;
  if (key === "layout") {
    // A refresh may migrate the selection layout or trim it to the display limit.
    // A layout computed before a newer metric selection will be recomputed
    // when that window receives the authoritative settings.
    if (JSON.stringify([next.metricOrder, next.metrics, next.minimalMode]) === edit.base) {
      next.metrics = snapshot.metrics;
      next.metricOrder = snapshot.metricOrder;
      for (const version of VERSION_FIELDS) next[version] = Math.max(next[version], safeVersion(snapshot[version]));
    }
  } else if (key === "metric") {
    const { source, metric, checked } = edit;
    if (!SOURCE_ID_PATTERN.test(source) || !METRIC_ID_PATTERN.test(metric) || typeof checked !== "boolean" || !Object.hasOwn(snapshot.metrics || {}, source)) return next;
    const selected = Object.hasOwn(next.metrics, source) ? next.metrics[source] : snapshot.metrics[source];
    if (!Array.isArray(selected)) return next;
    const ids = selected.filter(id => id !== metric);
    const id = source + ":" + metric;
    next.metricOrder = next.metricOrder.filter(item => item !== id);
    if (checked) {
      ids.push(metric);
      next.metricOrder.push(id);
    }
    next.metrics[source] = ids;
  } else if (key === "forgetThread") {
    const config = next.autoResumeThreads[threadId];
    if (THREAD_ID_PATTERN.test(threadId) && config && !config.enabled && config.message === edit.message) delete next.autoResumeThreads[threadId];
  } else if (key === "threadEnabled" || key === "threadMessage" || key === "legacyResume") {
    if (!THREAD_ID_PATTERN.test(threadId) || !Object.hasOwn(snapshot.autoResumeThreads || {}, threadId)) return next;
    if (key === "legacyResume" && (!next.autoResume || next.autoResumeThreads[threadId])) return next;
    const source = snapshot.autoResumeThreads[threadId];
    const config = next.autoResumeThreads[threadId] || { enabled: false, message: next.autoResumeMessage };
    if (key === "threadMessage") config.message = normalizeAutoResumeMessage(source.message);
    else {
      config.enabled = source.enabled === true;
      next.autoResume = false;
    }
    next.autoResumeThreads[threadId] = config;
    if (Object.keys(next.autoResumeThreads).length > 128) {
      const removable = Object.keys(next.autoResumeThreads).find(id => id !== threadId &&
        !next.autoResumeThreads[id].enabled && next.autoResumeThreads[id].message === AUTO_RESUME_MESSAGE &&
        next.autoResumeMessage === AUTO_RESUME_MESSAGE);
      if (!removable) throw new RangeError("autoResumeCapacity");
      delete next.autoResumeThreads[removable];
    }
  } else if (key === "autoResumeMessage") {
    next.autoResumeMessage = normalizeAutoResumeMessage(snapshot.autoResumeMessage);
  } else if (key === "autoResumeSharedMessage") {
    if (next.autoResumeSharedMessage && !snapshot.autoResumeSharedMessage) {
      for (const config of Object.values(next.autoResumeThreads)) config.message = next.autoResumeMessage;
    }
    next.autoResumeSharedMessage = snapshot.autoResumeSharedMessage === true;
  } else if ([...BOOLEAN_FIELDS, "showApiColumns", "showResetForecast"].includes(key) && key !== "autoResume") {
    next[key] = snapshot[key] === true;
  }
  return normalizeUiSettings(next);
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
      const write = pending.catch(() => {}).then(() => writeUiSettingsFile(filePath, normalized)).catch((error) => {
        // A failed attempt is not a persisted value. Let the same settings be
        // retried after a transient filesystem error, without invalidating a
        // newer save already queued behind this one.
        if (pending === write) serialized = null;
        throw error;
      });
      pending = write;
      return write;
    },
    flush() { return pending; },
  };
}
