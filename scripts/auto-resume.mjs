import fs from "node:fs/promises";
import path from "node:path";

export const AUTO_RESUME_MESSAGE = "继续";
export const MAX_AUTO_RESUME_MESSAGE_LENGTH = 500;
export const AUTO_RESUME_STATE_FILE_NAME = "auto-resume-state.json";
const RETRY_DELAY_MS = 30_000;
const RECOVERY_BUFFER_MS = 5_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EVENT_ID_PATTERN = /^[0-9a-f]{32}$/i;
const WINDOW_METRIC_IDS = new Set(["primaryRemaining", "secondaryRemaining"]);

export function normalizeAutoResumeMessage(value, fallback = null) {
  if (typeof value !== "string") return fallback;
  const message = value.trim();
  if (!message || message.length > MAX_AUTO_RESUME_MESSAGE_LENGTH || /[\u0000-\u001f\u007f]/.test(message)) return fallback;
  return message;
}

const safeTimestamp = (value) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;
const metricResetAtMs = (value) => {
  const number = safeTimestamp(value);
  return number === null ? null : number < 1_000_000_000_000 ? number * 1000 : number;
};
const metricRemaining = (metric) => {
  const match = String(metric?.value ?? "").match(/(-?\d+(?:\.\d+)?)\s*%/);
  return match ? Math.max(0, Math.min(100, Number(match[1]))) : null;
};

const FAILURE_REASONS = new Set(["desktop-request-client-unavailable", "desktop-send-timeout", "desktop-send-failed"]);
const normalizeReason = (value) => FAILURE_REASONS.has(value) ? value : "desktop-send-failed";
function normalizePending(source) {
  if (source && EVENT_ID_PATTERN.test(String(source.eventId || ""))
    && UUID_PATTERN.test(String(source.threadId || ""))) {
    const resetAt = safeTimestamp(source.resetAt);
    const observedAt = safeTimestamp(source.observedAt);
    if (observedAt !== null) {
      return {
        eventId: String(source.eventId).toLowerCase(),
        threadId: String(source.threadId).toLowerCase(),
        turnId: UUID_PATTERN.test(String(source.turnId || "")) ? String(source.turnId).toLowerCase() : null,
        observedAt,
        resetAt,
        blockedMetricIds: [...new Set((Array.isArray(source.blockedMetricIds) ? source.blockedMetricIds : [])
          .filter((id) => WINDOW_METRIC_IDS.has(id)))],
        nextAttemptAt: safeTimestamp(source.nextAttemptAt) || observedAt,
        ...(source.reason ? { reason: normalizeReason(source.reason) } : {}),
      };
    }
  }
  return null;
}

export function normalizeAutoResumeState(value) {
  const pendingByThread = {};
  const handledByThread = {};
  const entries = value?.pendingByThread && typeof value.pendingByThread === "object"
    ? Object.entries(value.pendingByThread) : [];
  for (const [id, source] of entries.slice(0, 128)) {
    const pending = normalizePending(source);
    if (pending && pending.threadId === id.toLowerCase()) pendingByThread[pending.threadId] = pending;
  }
  const legacyPending = normalizePending(value?.pending);
  if (legacyPending && (legacyPending.nextAttemptAt === legacyPending.resetAt
    || legacyPending.nextAttemptAt === legacyPending.resetAt + RECOVERY_BUFFER_MS)) {
    legacyPending.nextAttemptAt = legacyPending.observedAt + RECOVERY_BUFFER_MS;
  }
  if (legacyPending && !pendingByThread[legacyPending.threadId]) pendingByThread[legacyPending.threadId] = legacyPending;
  for (const [id, source] of Object.entries(value?.handledByThread || {}).slice(-128)) {
    if (UUID_PATTERN.test(id) && EVENT_ID_PATTERN.test(String(source?.eventId || ""))) {
      handledByThread[id.toLowerCase()] = { eventId: source.eventId.toLowerCase(), handledAt: safeTimestamp(source.handledAt) };
    }
  }
  // Version 1 did not record the handled event's thread; retain its fingerprint for deduplication.
  const legacyHandledEventId = String(value?.legacyHandledEventId || value?.lastHandledEventId || "").toLowerCase();
  return { schemaVersion: 2, pendingByThread, handledByThread,
    legacyHandledEventId: EVENT_ID_PATTERN.test(legacyHandledEventId) ? legacyHandledEventId : null };
}

export function resolveAutoResumeStatePath(environment = process.env) {
  if (environment.CODEX_USAGE_AUTO_RESUME_STATE_PATH) return path.resolve(environment.CODEX_USAGE_AUTO_RESUME_STATE_PATH);
  if (!environment.LOCALAPPDATA) throw new Error("LOCALAPPDATA is unavailable; cannot persist auto-resume state.");
  return path.join(environment.LOCALAPPDATA, "CodexUsageMonitor", AUTO_RESUME_STATE_FILE_NAME);
}

export async function createAutoResumeStateStore(filePath = resolveAutoResumeStatePath()) {
  let current = normalizeAutoResumeState(null);
  try {
    const stat = await fs.stat(filePath);
    if (stat.isFile() && stat.size > 0 && stat.size <= 256 * 1024) {
      current = normalizeAutoResumeState(JSON.parse(await fs.readFile(filePath, "utf8")));
    }
  } catch (error) {
    if (!["ENOENT", "ENOTDIR"].includes(error?.code) && !(error instanceof SyntaxError)) throw error;
  }
  let pendingWrite = Promise.resolve();
  return {
    filePath,
    get current() { return current; },
    save(value) {
      current = normalizeAutoResumeState(value);
      const snapshot = current;
      pendingWrite = pendingWrite.catch(() => {}).then(async () => {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
        try {
          await fs.writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
          await fs.rename(temporaryPath, filePath);
        } finally {
          await fs.rm(temporaryPath, { force: true }).catch(() => {});
        }
      });
      return pendingWrite;
    },
    flush() { return pendingWrite; },
  };
}

function officialWindowMetrics(usage) {
  return (Array.isArray(usage?.sources?.official?.metrics) ? usage.sources.official.metrics : [])
    .filter((metric) => WINDOW_METRIC_IDS.has(metric?.id));
}

export function createAutoResumePending(usage, now = Date.now()) {
  const quota = usage?.quotaExceeded;
  const threadId = String(usage?.currentThreadId || "").toLowerCase();
  if (!quota || !EVENT_ID_PATTERN.test(String(quota.eventId || "")) || !UUID_PATTERN.test(threadId)) return null;
  let resetAt = safeTimestamp(quota.resetAt);
  const metrics = officialWindowMetrics(usage);
  if (resetAt === null) {
    resetAt = metrics
      .filter((metric) => metricRemaining(metric) === 0)
      .map((metric) => metricResetAtMs(metric.resetsAt))
      .filter((value) => value !== null && value > now)
      .sort((left, right) => left - right)[0] || null;
  }
  const closest = metrics
    .map((metric) => ({ id: metric.id, distance: Math.abs((metricResetAtMs(metric.resetsAt) || 0) - resetAt) }))
    .filter((item) => item.distance <= 30 * 60 * 1000)
    .sort((left, right) => left.distance - right.distance)[0] || null;
  const blockedMetricIds = [...new Set([
    ...metrics.filter((metric) => metricRemaining(metric) === 0).map((metric) => metric.id),
    ...(closest ? [closest.id] : []),
  ])];
  return normalizePending({
      eventId: quota.eventId,
      threadId,
      turnId: quota.turnId,
      observedAt: safeTimestamp(quota.timestamp) || now,
      resetAt,
      blockedMetricIds,
      nextAttemptAt: (safeTimestamp(quota.timestamp) || now) + RECOVERY_BUFFER_MS,
  });
}

export function isAutoResumeQuotaRecovered(usage, pending, now = Date.now()) {
  if (!pending || now < pending.nextAttemptAt) return false;
  const official = usage?.sources?.official;
  if (official?.status !== "ready") return false;
  const fetchedAt = safeTimestamp(official.fetchedAt) || Date.parse(official.fetchedAt);
  if (!Number.isFinite(fetchedAt) || fetchedAt <= pending.observedAt || fetchedAt > now) return false;
  const metrics = officialWindowMetrics(usage);
  const ids = pending.blockedMetricIds.length ? pending.blockedMetricIds : metrics.map((metric) => metric.id);
  if (!ids.length) return false;
  if (metrics.some((metric) => metricRemaining(metric) === 0)) return false;
  return ids.every((id) => {
    const metric = metrics.find((item) => item.id === id);
    const remaining = metricRemaining(metric);
    return remaining !== null && remaining > 0;
  });
}

export class AutoResumeController {
  constructor({ store, sendContinue, now = () => Date.now(), onStatusChange = () => {} }) {
    this.store = store;
    this.sendContinue = sendContinue;
    this.now = now;
    this.onStatusChange = onStatusChange;
    this.state = normalizeAutoResumeState(store?.current);
    this.threadSettings = {};
    this.statusByThread = new Map();
    this.currentThreadId = null;
    this.latestUsage = null;
    this.status = { enabled: false, status: "idle", resetAt: null };
    this.queue = Promise.resolve();
  }

  enqueue(action) {
    this.queue = this.queue.catch(() => {}).then(action);
    return this.queue;
  }

  markHandled(threadId, eventId) {
    delete this.state.handledByThread[threadId];
    this.state.handledByThread[threadId] = { eventId, handledAt: this.now() };
    const ids = Object.keys(this.state.handledByThread);
    for (const id of ids.slice(0, Math.max(0, ids.length - 128))) delete this.state.handledByThread[id];
  }

  publish(status, detail = {}) {
    const relatedThreadId = String(detail.threadId || this.currentThreadId || "").toLowerCase();
    if (status && UUID_PATTERN.test(relatedThreadId)) {
      const { threadId: _threadId, ...rest } = detail;
      this.statusByThread.set(relatedThreadId, { status, ...rest });
    }
    const enabled = this.currentThreadId ? this.threadSettings[this.currentThreadId]?.enabled === true : false;
    const pending = this.state.pendingByThread[this.currentThreadId];
    const detailForThread = this.statusByThread.get(this.currentThreadId);
    this.status = { enabled, status: "idle", resetAt: null,
      ...(enabled ? pending ? { status: "waiting", resetAt: pending.resetAt, ...(pending.reason ? { reason: pending.reason } : {}) }
        : detailForThread || {} : {}) };
    try { this.onStatusChange(this.status); } catch {}
  }

  settingsChanged(settings) {
    return this.enqueue(async () => {
      const next = {};
      if (settings?.autoResumeThreads && typeof settings.autoResumeThreads === "object" && !Array.isArray(settings.autoResumeThreads)) {
        for (const [threadId, config] of Object.entries(settings.autoResumeThreads).slice(0, 128)) {
          const id = String(threadId).toLowerCase();
          if (!UUID_PATTERN.test(id) || !config || typeof config !== "object" || Array.isArray(config)) continue;
          next[id] = {
            enabled: config.enabled === true,
            message: normalizeAutoResumeMessage(settings.autoResumeSharedMessage === true
              ? settings.autoResumeMessage : config.message, AUTO_RESUME_MESSAGE),
          };
        }
      }
      this.threadSettings = next;
      let changed = false;
      for (const id of Object.keys(this.state.pendingByThread)) {
        if (next[id]?.enabled !== true) {
          delete this.state.pendingByThread[id];
          this.statusByThread.delete(id);
          changed = true;
        }
      }
      if (changed) await this.store.save(this.state);
      this.publish();
      if (this.latestUsage) await this.reconcile();
    });
  }

  observeUsage(usage) {
    return this.enqueue(async () => {
      this.latestUsage = usage;
      this.currentThreadId = UUID_PATTERN.test(String(usage?.currentThreadId || ""))
        ? String(usage.currentThreadId).toLowerCase() : null;
      await this.reconcile();
    });
  }

  async reconcile() {
    if (!this.latestUsage) return;
    const usage = this.latestUsage;
    const snapshots = usage.autoResumeTasks && typeof usage.autoResumeTasks === "object" ? usage.autoResumeTasks : {};
    const hasTaskMap = Object.hasOwn(usage, "autoResumeTasks");
    for (const [threadId, settings] of Object.entries(this.threadSettings)) {
      if (!settings.enabled) continue;
      const task = snapshots[threadId] || (!hasTaskMap && threadId === this.currentThreadId ? {
        quotaExceeded: usage.quotaExceeded,
        currentStatus: usage.currentStatus ?? usage.currentTask?.currentStatus,
        timestamp: usage.currentTask?.timestamp ?? usage.timestamp,
      } : null);
      let pending = this.state.pendingByThread[threadId];
      const quota = task?.quotaExceeded;
      const eventId = String(quota?.eventId || "").toLowerCase();
      const affirmed = task?.currentStatus === "quota-paused"
        || (!hasTaskMap && !task?.currentStatus && quota?.observedLive === true);
      const superseded = pending && ["running", "completed", "paused"].includes(task?.currentStatus)
        && Number(task.timestamp) >= pending.observedAt;
      if (superseded) {
        this.markHandled(threadId, pending.eventId);
        delete this.state.pendingByThread[threadId];
        this.statusByThread.delete(threadId);
        await this.store.save(this.state);
        continue;
      }
      // Missing/truncated task data preserves a wait but is never permission to send.
      if (!affirmed || !EVENT_ID_PATTERN.test(eventId)) continue;
      if (UUID_PATTERN.test(String(task.turnId || "")) && UUID_PATTERN.test(String(quota.turnId || ""))
        && task.turnId.toLowerCase() !== quota.turnId.toLowerCase()) continue;
      if (pending && pending.eventId !== eventId && Number(quota.timestamp) < pending.observedAt) continue;
      if ((!pending || pending.eventId !== eventId)
        && this.state.handledByThread[threadId]?.eventId !== eventId
        && this.state.legacyHandledEventId !== eventId) {
        pending = createAutoResumePending({ ...usage, currentThreadId: threadId, quotaExceeded: quota }, this.now());
        if (pending) {
          this.state.pendingByThread[threadId] = pending;
          await this.store.save(this.state);
        }
      }
      if (!pending || pending.eventId !== eventId || !isAutoResumeQuotaRecovered(usage, pending, this.now())) continue;
      const attempt = pending;
      delete this.state.pendingByThread[threadId];
      this.markHandled(threadId, attempt.eventId);
      await this.store.save(this.state);
      this.publish("sending", { threadId, resetAt: attempt.resetAt });
      let result;
      try { result = await this.sendContinue({ ...attempt, message: settings.message || AUTO_RESUME_MESSAGE }); }
      catch { result = { ok: false, reason: "desktop-send-failed" }; }
      if (result?.ok) {
        this.publish("sent", { threadId, sentAt: this.now(), resetAt: attempt.resetAt });
      } else {
        delete this.state.handledByThread[threadId];
        this.state.pendingByThread[threadId] = { ...attempt, nextAttemptAt: this.now() + RETRY_DELAY_MS,
          reason: normalizeReason(result?.reason) };
        await this.store.save(this.state);
        this.publish();
      }
    }
    this.publish();
  }

  async stop() {
    await this.queue.catch(() => {});
    await this.store.flush();
  }
}
