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
const accountKey = (value) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value) ? value : null;
// Older releases retried timeouts and generic send failures. Their delivery
// cannot be determined after an upgrade either.
function normalizeReason(value) {
  if (value === "desktop-queue-pending") return value;
  if (["desktop-request-client-unavailable", "codex-desktop-unavailable"].includes(value)) return "desktop-request-client-unavailable";
  return "desktop-send-unconfirmed";
}
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
        accountKey: accountKey(source.accountKey),
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
      const handled = { eventId: source.eventId.toLowerCase(), handledAt: safeTimestamp(source.handledAt) };
      if (source.queuedAfter) {
        const observedAt = safeTimestamp(source.queuedAfter.observedAt);
        if (observedAt !== null) {
          const turnId = String(source.queuedAfter.turnId || "");
          handled.queuedAfter = { observedAt, turnId: UUID_PATTERN.test(turnId) ? turnId.toLowerCase() : null };
        }
      }
      handledByThread[id.toLowerCase()] = handled;
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

function quotaWindows(usage) {
  const evidence = usage?.resumeQuota;
  if (!evidence || !accountKey(usage.resumeAccountKey) || evidence.accountKey !== usage.resumeAccountKey
    || !Array.isArray(evidence.windows)) return [];
  return evidence.windows;
}

function blockedWindows(windows, resetAt) {
  const ids = windows.filter(w => w.remainingPercent === 0).map(w => w.id);
  if (resetAt !== null) {
    const matching = windows.filter(w => {
      const at = metricResetAtMs(w.resetsAt);
      return at !== null && Math.abs(at - resetAt) <= 30 * 60_000;
    });
    // A zero in a different period does not identify the window the error
    // refers to. If reset times coincide, require all matching periods.
    if (!matching.length) return [];
    for (const w of matching) ids.push(w.id);
  }
  return [...new Set(ids)];
}

export function createAutoResumePending(usage, now = Date.now()) {
  const quota = usage?.quotaExceeded;
  const threadId = String(usage?.currentThreadId || "").toLowerCase();
  if (!quota || !EVENT_ID_PATTERN.test(String(quota.eventId || "")) || !UUID_PATTERN.test(threadId)) return null;
  let resetAt = safeTimestamp(quota.resetAt);
  const observedAt = safeTimestamp(quota.timestamp) || now;
  const key = usage.resumeAccountSince > 0 && observedAt >= usage.resumeAccountSince ? accountKey(usage.resumeAccountKey) : null;
  const metrics = key ? quotaWindows(usage) : [];
  if (resetAt === null) {
    resetAt = metrics
      .filter((metric) => metric.remainingPercent === 0)
      .map((metric) => metricResetAtMs(metric.resetsAt))
      .filter((value) => value !== null && value > now)
      .sort((left, right) => left - right)[0] || null;
  }
  return normalizePending({
    eventId: quota.eventId,
    threadId,
    turnId: quota.turnId,
    observedAt,
    accountKey: key,
    resetAt,
    blockedMetricIds: blockedWindows(metrics, resetAt),
    nextAttemptAt: observedAt + RECOVERY_BUFFER_MS,
  });
}

export function isAutoResumeQuotaRecovered(usage, pending, now = Date.now()) {
  if (!pending || now < pending.nextAttemptAt) return false;
  if (!pending.accountKey || pending.accountKey !== usage?.resumeAccountKey
    || usage?.sources?.official?.status !== "ready" || !pending.blockedMetricIds.length) return false;
  const readAt = safeTimestamp(usage?.resumeQuota?.observedAt);
  if (readAt === null || readAt <= pending.observedAt || readAt > now) return false;
  const windows = quotaWindows(usage);
  return windows.length > 0 && windows.every(w => w.remainingPercent > 0) &&
    pending.blockedMetricIds.every(id => windows.some(w => w.id === id));
}

function taskForThread(usage, threadId) {
  if (usage?.autoResumeTasks) return usage.autoResumeTasks[threadId];
  if (Object.hasOwn(usage || {}, "autoResumeTasks") || threadId !== usage?.currentThreadId?.toLowerCase()) return null;
  return { quotaExceeded: usage.quotaExceeded, currentStatus: usage.currentStatus ?? usage.currentTask?.currentStatus,
    timestamp: usage.currentTask?.timestamp ?? usage.timestamp, turnId: usage.currentTask?.turnId ?? usage.turnId };
}

function isQuotaPause(task, usage) {
  const quota = task?.quotaExceeded;
  if (!EVENT_ID_PATTERN.test(String(quota?.eventId || ""))) return false;
  if (task.turnId && quota.turnId && String(task.turnId).toLowerCase() !== String(quota.turnId).toLowerCase()) return false;
  return task.currentStatus === "quota-paused" || (!Object.hasOwn(usage, "autoResumeTasks")
    && !task.currentStatus && quota.observedLive === true);
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
    this.publishedStatuses = "[]";
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

  statusForThread(threadId) {
    const normalized = String(threadId || "").toLowerCase();
    const id = UUID_PATTERN.test(normalized) ? normalized : null;
    const enabled = id ? this.threadSettings[id]?.enabled === true : false;
    const pending = id ? this.state.pendingByThread[id] : null;
    const detailForThread = id ? this.statusByThread.get(id) : null;
    const queued = this.state.handledByThread[id]?.queuedAfter;
    let reason = pending?.reason;
    if (pending && reason !== "desktop-send-unconfirmed" && (!pending.accountKey || pending.accountKey !== this.latestUsage?.resumeAccountKey))
      reason = "account-unconfirmed";
    return { enabled, status: "idle", resetAt: null,
      ...(enabled ? pending ? { status: "waiting", resetAt: pending.resetAt, ...(reason ? { reason } : {}) }
        : queued ? { status: "queued" } : detailForThread || {} : {}) };
  }

  publish(status, detail = {}) {
    const relatedThreadId = String(detail.threadId || this.currentThreadId || "").toLowerCase();
    if (status && UUID_PATTERN.test(relatedThreadId)) {
      const { threadId: _threadId, ...rest } = detail;
      this.statusByThread.set(relatedThreadId, { status, ...rest });
    }
    this.status = this.statusForThread(this.currentThreadId);
    const signature = JSON.stringify(Object.keys(this.threadSettings).filter(id => this.threadSettings[id].enabled)
      .map(id => [id, this.statusForThread(id)]));
    if (signature === this.publishedStatuses) return;
    this.publishedStatuses = signature;
    try { this.onStatusChange(this.status); } catch {}
  }

  settingsChanged(settings) {
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
    return this.enqueue(async () => {
      let changed = false;
      for (const id of this.statusByThread.keys()) {
        if (!next[id]?.enabled) this.statusByThread.delete(id);
      }
      for (const id of Object.keys(this.state.pendingByThread)) {
        if (next[id]?.enabled !== true) {
          const pending = this.state.pendingByThread[id];
          if (pending.reason === "desktop-send-unconfirmed") this.markHandled(id, pending.eventId);
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
    this.latestUsage = usage;
    this.currentThreadId = UUID_PATTERN.test(String(usage?.currentThreadId || ""))
      ? String(usage.currentThreadId).toLowerCase() : null;
    return this.enqueue(() => this.reconcile(usage));
  }

  async reconcile(usage = this.latestUsage) {
    if (!usage) return;
    for (const threadId of Object.keys(this.threadSettings)) {
      if (!this.threadSettings[threadId]?.enabled) continue;
      const task = taskForThread(usage, threadId);
      const handled = this.state.handledByThread[threadId];
      const previousTurn = handled?.queuedAfter;
      if (previousTurn && ["running", "completed", "paused", "quota-paused"].includes(task?.currentStatus)
        && Number(task.timestamp) > previousTurn.observedAt
        && UUID_PATTERN.test(String(task.turnId || ""))
        && (previousTurn.turnId ? task.turnId.toLowerCase() !== previousTurn.turnId
          : task.currentStatus !== "quota-paused" && Number(task.timestamp) > handled.handledAt)) {
        // The rollout advanced; only the receipt proved queuing. A different
        // user message may have started this later turn.
        delete handled.queuedAfter;
        await this.store.save(this.state);
      }
      let pending = this.state.pendingByThread[threadId];
      const quota = task?.quotaExceeded;
      const eventId = String(quota?.eventId || "").toLowerCase();
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
      if (!isQuotaPause(task, usage)) continue;
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
      if (!pending || pending.eventId !== eventId || pending.reason === "desktop-send-unconfirmed") continue;
      // Only adopt an unbound event if the account boundary covers its time.
      if (!pending.accountKey && usage.resumeAccountSince > 0 && pending.observedAt >= usage.resumeAccountSince
        && accountKey(usage.resumeAccountKey) && quotaWindows(usage).length) {
        pending.accountKey = usage.resumeAccountKey;
        pending.blockedMetricIds = [];
        await this.store.save(this.state);
      }
      if (pending.accountKey !== usage.resumeAccountKey) continue;
      const observed = blockedWindows(quotaWindows(usage), pending.blockedMetricIds.length ? null : pending.resetAt);
      const added = observed.filter(id => !pending.blockedMetricIds.includes(id));
      if (added.length) {
        pending.blockedMetricIds.push(...added);
        await this.store.save(this.state);
      }
      const message = this.threadSettings[threadId]?.message;
      const canSubmit = () => {
        const latest = this.latestUsage;
        const current = taskForThread(latest, threadId);
        return this.threadSettings[threadId]?.enabled === true && this.threadSettings[threadId].message === message && isQuotaPause(current, latest)
          && current.quotaExceeded.eventId.toLowerCase() === eventId && isAutoResumeQuotaRecovered(latest, pending, this.now());
      };
      if (!isAutoResumeQuotaRecovered(usage, pending, this.now()) || !canSubmit()) continue;
      // Persist the reservation before touching the transport. After a crash
      // or a lost acknowledgement the next process must not send it again.
      pending.reason = "desktop-send-unconfirmed";
      await this.store.save(this.state);
      let result;
      try {
        result = canSubmit()
          ? await this.sendContinue({ ...pending, message }, canSubmit)
          : { ok: false, reason: "not-authorized" };
      } catch { result = { ok: false, reason: "desktop-send-unconfirmed" }; }
      if (result?.ok) {
        delete this.state.pendingByThread[threadId];
        this.markHandled(threadId, eventId);
        if (result.queued === true) {
          this.state.handledByThread[threadId].queuedAfter = { turnId: pending.turnId, observedAt: pending.observedAt };
          this.statusByThread.delete(threadId);
        }
        await this.store.save(this.state);
        if (result.queued !== true) this.publish("sent", { threadId, sentAt: this.now(), resetAt: pending.resetAt });
      } else if (["desktop-request-client-unavailable", "desktop-queue-pending", "not-authorized"].includes(result?.reason)) {
        if (result.reason === "not-authorized") delete pending.reason;
        else {
          pending.reason = result.reason;
          pending.nextAttemptAt = this.now() + RETRY_DELAY_MS;
        }
        await this.store.save(this.state);
      }
    }
    this.publish();
  }

  async stop() {
    await this.queue.catch(() => {});
    await this.store.flush();
  }
}
