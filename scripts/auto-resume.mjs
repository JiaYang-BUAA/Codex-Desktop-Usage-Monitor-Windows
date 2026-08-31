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

export function normalizeAutoResumeState(value) {
  const lastHandledEventId = EVENT_ID_PATTERN.test(String(value?.lastHandledEventId || ""))
    ? String(value.lastHandledEventId).toLowerCase()
    : null;
  const source = value?.pending;
  let pending = null;
  if (source && EVENT_ID_PATTERN.test(String(source.eventId || ""))
    && UUID_PATTERN.test(String(source.threadId || ""))) {
    const resetAt = safeTimestamp(source.resetAt);
    const observedAt = safeTimestamp(source.observedAt);
    if (resetAt !== null && observedAt !== null) {
      pending = {
        eventId: String(source.eventId).toLowerCase(),
        threadId: String(source.threadId).toLowerCase(),
        turnId: UUID_PATTERN.test(String(source.turnId || "")) ? String(source.turnId).toLowerCase() : null,
        observedAt,
        resetAt,
        blockedMetricIds: [...new Set((Array.isArray(source.blockedMetricIds) ? source.blockedMetricIds : [])
          .filter((id) => WINDOW_METRIC_IDS.has(id)))],
        nextAttemptAt: safeTimestamp(source.nextAttemptAt) || resetAt,
      };
    }
  }
  return { schemaVersion: 1, pending, lastHandledEventId };
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
    if (stat.isFile() && stat.size > 0 && stat.size <= 16 * 1024) {
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
  if (resetAt === null) return null;
  const closest = metrics
    .map((metric) => ({ id: metric.id, distance: Math.abs((metricResetAtMs(metric.resetsAt) || 0) - resetAt) }))
    .filter((item) => item.distance <= 30 * 60 * 1000)
    .sort((left, right) => left.distance - right.distance)[0] || null;
  const blockedMetricIds = closest
    ? [closest.id]
    : metrics.filter((metric) => metricRemaining(metric) === 0).map((metric) => metric.id);
  return normalizeAutoResumeState({
    pending: {
      eventId: quota.eventId,
      threadId,
      turnId: quota.turnId,
      observedAt: safeTimestamp(quota.timestamp) || now,
      resetAt,
      blockedMetricIds,
      nextAttemptAt: resetAt + RECOVERY_BUFFER_MS,
    },
  }).pending;
}

export function isAutoResumeQuotaRecovered(usage, pending, now = Date.now()) {
  if (!pending || now < pending.resetAt + RECOVERY_BUFFER_MS || now < pending.nextAttemptAt) return false;
  const official = usage?.sources?.official;
  if (official?.status !== "ready") return false;
  const metrics = officialWindowMetrics(usage);
  const ids = pending.blockedMetricIds.length ? pending.blockedMetricIds : metrics.map((metric) => metric.id);
  if (!ids.length) return false;
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
    this.activationAtByThread = new Map();
    this.currentThreadId = null;
    this.latestUsage = null;
    this.status = { enabled: false, status: this.state.pending ? "waiting" : "idle", resetAt: this.state.pending?.resetAt || null };
    this.queue = Promise.resolve();
  }

  enqueue(action) {
    this.queue = this.queue.catch(() => {}).then(action);
    return this.queue;
  }

  publish(status, detail = {}) {
    const enabled = this.currentThreadId ? this.threadSettings[this.currentThreadId]?.enabled === true : false;
    const visiblePending = this.state.pending?.threadId === this.currentThreadId ? this.state.pending : null;
    const relatedThreadId = String(detail.threadId || visiblePending?.threadId || "").toLowerCase();
    const { threadId: _threadId, ...visibleDetail } = detail;
    const visible = relatedThreadId === this.currentThreadId;
    this.status = { enabled, status: visible ? status : "idle", resetAt: visiblePending?.resetAt || visibleDetail.resetAt || null, ...visibleDetail };
    try { this.onStatusChange(this.status); } catch {}
  }

  settingsChanged(settings) {
    return this.enqueue(async () => {
      const previous = this.threadSettings;
      const next = {};
      if (settings?.autoResumeThreads && typeof settings.autoResumeThreads === "object" && !Array.isArray(settings.autoResumeThreads)) {
        for (const [threadId, config] of Object.entries(settings.autoResumeThreads).slice(0, 128)) {
          const id = String(threadId).toLowerCase();
          if (!UUID_PATTERN.test(id) || !config || typeof config !== "object" || Array.isArray(config)) continue;
          next[id] = {
            enabled: config.enabled === true,
            message: normalizeAutoResumeMessage(config.message, AUTO_RESUME_MESSAGE),
          };
          if (next[id].enabled && previous[id]?.enabled !== true) this.activationAtByThread.set(id, this.now());
        }
      }
      this.threadSettings = next;
      if (this.state.pending && this.threadSettings[this.state.pending.threadId]?.enabled !== true) {
        this.state.pending = null;
        await this.store.save(this.state);
      }
      this.publish(this.state.pending ? "waiting" : "idle");
      if (this.latestUsage) await this.reconcile();
    });
  }

  observeUsage(usage) {
    this.latestUsage = usage;
    this.currentThreadId = UUID_PATTERN.test(String(usage?.currentThreadId || ""))
      ? String(usage.currentThreadId).toLowerCase()
      : null;
    return this.enqueue(() => this.reconcile());
  }

  async reconcile() {
    if (!this.latestUsage) return;
    const usage = this.latestUsage;
    const pending = this.state.pending;
    this.publish(pending ? "waiting" : "idle");
    if (pending && String(usage.currentThreadId || "").toLowerCase() === pending.threadId) {
      const currentEventId = String(usage.quotaExceeded?.eventId || "").toLowerCase();
      if (currentEventId !== pending.eventId) {
        this.state.pending = null;
        await this.store.save(this.state);
        this.publish("idle");
        return;
      }
    }
    if (!this.state.pending) {
      const quota = usage.quotaExceeded;
      const enabled = this.currentThreadId && this.threadSettings[this.currentThreadId]?.enabled === true;
      const activationAt = this.activationAtByThread.get(this.currentThreadId) ?? Number.POSITIVE_INFINITY;
      if (quota?.observedLive === true
        && enabled
        && Number(quota.timestamp) >= activationAt
        && quota.eventId !== this.state.lastHandledEventId) {
        const nextPending = createAutoResumePending(usage, this.now());
        if (nextPending) {
          this.state.pending = nextPending;
          await this.store.save(this.state);
          this.publish("waiting");
        }
      }
    }
    if (!this.state.pending || !isAutoResumeQuotaRecovered(usage, this.state.pending, this.now())) return;
    const attempt = this.state.pending;
    this.state.pending = null;
    this.state.lastHandledEventId = attempt.eventId;
    await this.store.save(this.state);
    this.publish("sending", { threadId: attempt.threadId, resetAt: attempt.resetAt });
    let result;
    const message = this.threadSettings[attempt.threadId]?.message || AUTO_RESUME_MESSAGE;
    try { result = await this.sendContinue({ ...attempt, message }); }
    catch (error) { result = { ok: false, reason: error?.message || "desktop-send-failed" }; }
    if (result?.ok) {
      this.publish("sent", { threadId: attempt.threadId, sentAt: this.now(), resetAt: attempt.resetAt });
      return;
    }
    this.state.lastHandledEventId = null;
    this.state.pending = { ...attempt, nextAttemptAt: this.now() + RETRY_DELAY_MS };
    await this.store.save(this.state);
    this.publish("waiting", { reason: String(result?.reason || "desktop-send-failed").slice(0, 80) });
  }

  async stop() {
    await this.queue.catch(() => {});
    await this.store.flush();
  }
}
