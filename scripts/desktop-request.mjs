import { AUTO_RESUME_MESSAGE, normalizeAutoResumeMessage } from "./auto-resume.mjs";
import { AppServerRpc } from "./usage-client.mjs";

export { AUTO_RESUME_MESSAGE };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EVENT_ID_PATTERN = /^[0-9a-f]{32}$/i;

// The desktop's app-server consumes this durable queue in the process that
// already owns the thread. The short-lived writer must never resume a thread.
export async function sendContinueThroughQueue(command, { threadId, turnId, eventId, message }, canSubmit = () => true,
  createRpc = command => new AppServerRpc({ command, experimentalApi: true })) {
  if (!command) return { ok: false, reason: "desktop-request-client-unavailable" };
  const text = normalizeAutoResumeMessage(message);
  if (!UUID_PATTERN.test(threadId) || !UUID_PATTERN.test(turnId) || !EVENT_ID_PATTERN.test(eventId) || !text || !canSubmit())
    return { ok: false, reason: "not-authorized" };
  const rpc = createRpc(command);
  const clientUserMessageId = `codex-usage-monitor-${eventId.toLowerCase()}`;
  let submitted = false;
  try {
    await rpc.start();
    const queue = await rpc.request("thread/queue/list", { threadId, limit: 1 });
    if (!Array.isArray(queue?.data)) return { ok: false, reason: "desktop-request-client-unavailable" };
    const existing = queue.data[0];
    if (existing) {
      if (existing.clientUserMessageId === clientUserMessageId && typeof existing.id === "string" && existing.id)
        return { ok: true, queued: true, queueId: existing.id };
      return { ok: false, reason: "desktop-queue-pending" };
    }
    const latest = await rpc.request("thread/turns/list", { threadId, limit: 1, sortDirection: "desc", itemsView: "notLoaded" });
    const turn = latest?.data?.[0];
    if (turn?.id !== turnId || turn.status !== "failed" || turn.error?.codexErrorInfo !== "usageLimitExceeded" || !canSubmit())
      return { ok: false, reason: "not-authorized" };
    submitted = true;
    const result = await rpc.request("thread/queue/add", {
      threadId, input: [{ type: "text", text, text_elements: [] }], clientUserMessageId,
    });
    const item = result?.queuedSubmission;
    if (typeof item?.id === "string" && item.id && item.clientUserMessageId === clientUserMessageId)
      return { ok: true, queued: true, queueId: item.id };
    return { ok: false, reason: "desktop-send-unconfirmed" };
  } catch {
    return { ok: false, reason: submitted ? "desktop-send-unconfirmed" : "desktop-request-client-unavailable" };
  } finally {
    await rpc.stop().catch(() => {});
  }
}

const DESKTOP_REQUEST_CLIENT_LOOKUP = `
  function findDesktopRequestClient({ includeQueue = false } = {}) {
    const root = window.__codexRoot?._internalRoot?.current;
    if (!root) throw new Error("codex-desktop-react-root-not-found");
    const queue = [root];
    const seen = new WeakSet();
    let cursor = 0;
    let visited = 0;
    let request = null;
    let query = null;
    while (cursor < queue.length && visited < 200000) {
      const value = queue[cursor++];
      if (value == null || (typeof value !== "object" && typeof value !== "function") || seen.has(value)) continue;
      seen.add(value);
      visited += 1;
      try {
        if (!request && typeof value.sendRequest === "function"
          && value.hostId === "local"
          && value.requestPromises instanceof Map) request = value;
      } catch {}
      try {
        if (includeQueue && !query && typeof value.getQueryCache === "function") {
          const queries = value.getQueryCache().getAll();
          query = Array.isArray(queries) ? queries.find((candidate) => {
            const key = candidate?.queryKey;
            return Array.isArray(key)
              && key.includes("get-global-state")
              && JSON.stringify(key).includes("queued-follow-ups");
          }) : null;
        }
      } catch {}
      if (request && (!includeQueue || query)) break;
      let descriptors;
      try { descriptors = Object.getOwnPropertyDescriptors(value); }
      catch { continue; }
      for (const descriptor of Object.values(descriptors)) {
        if (!Object.prototype.hasOwnProperty.call(descriptor, "value")) continue;
        const child = descriptor.value;
        if (child != null && (typeof child === "object" || typeof child === "function")) queue.push(child);
      }
      if (value instanceof Map) {
        for (const [key, child] of value) queue.push(key, child);
      } else if (value instanceof Set) {
        for (const child of value) queue.push(child);
      }
    }
    if (!request) throw new Error("codex-desktop-request-client-not-found");
    return { request, query };
  }

`.trim();

const QUEUED_MESSAGE_IDS = `
  function queuedFollowUpIds(query, threadId) {
    const queuedByThread = query?.state?.data?.value;
    const queuedForThread = queuedByThread?.[threadId];
    return Array.isArray(queuedForThread)
      ? queuedForThread.map((item) => String(item?.id || "")).filter(Boolean)
      : [];
  }
`.trim();

export function buildDesktopRequestProbeExpression() {
  return `(async () => {
    ${DESKTOP_REQUEST_CLIENT_LOOKUP}
    const { request } = findDesktopRequestClient();
    return { ok: true, method: "codex-desktop-internal-request", hostId: request.hostId };
  })()`;
}

function prepareDesktopAutoResumeExpression(threadId, eventId) {
  const key = JSON.stringify(`${threadId}:codex-usage-monitor-${eventId}`);
  return `(async () => {
    const attempts = window.__CODEX_USAGE_MONITOR_SEND_ATTEMPTS__ ||= new Map();
    const key = ${key};
    const existing = attempts.get(key);
    if (existing) {
      if (existing.result) return await existing.result;
      if (existing.prepare) return await existing.prepare;
      // Older monitors stored a single promise as soon as they started.
      try { return await existing; }
      catch { return {ok: false, reason: "desktop-send-unconfirmed"}; }
    }
    ${DESKTOP_REQUEST_CLIENT_LOOKUP}
    ${QUEUED_MESSAGE_IDS}
    const threadId = ${JSON.stringify(threadId)};
    const { request, query } = findDesktopRequestClient({ includeQueue: true });
    const options = { priority: "critical", source: "usage_monitor_auto_resume" };
    const entry = { request, query, options, before: queuedFollowUpIds(query, threadId) };
    attempts.set(key, entry);
    entry.prepare = (async () => {
      await request.sendRequest("thread/resume", { threadId }, options);
      return {prepared: true};
    })();
    try { return await entry.prepare; }
    catch (error) { attempts.delete(key); throw error; }
  })()`;
}

export function buildDesktopAutoResumeExpression({ threadId, eventId, message }) {
  const payload = {
    threadId,
    input: [{ type: "text", text: message }],
    clientUserMessageId: `codex-usage-monitor-${eventId}`,
  };
  return `(async () => {
    ${QUEUED_MESSAGE_IDS}
    const payload = ${JSON.stringify(payload)};
    const key = payload.threadId + ':' + payload.clientUserMessageId;
    const attempts = window.__CODEX_USAGE_MONITOR_SEND_ATTEMPTS__;
    const entry = attempts?.get(key);
    if (entry?.result) return await entry.result;
    if (!entry?.request) return { ok: false, reason: "desktop-request-client-unavailable" };
    const result = (async () => {
      try {
        const response = await entry.request.sendRequest("turn/start", payload, entry.options);
        const turnId = response?.turn?.id;
        if (typeof turnId !== "string" || !turnId.trim()) return { ok: false, reason: "desktop-send-unconfirmed" };
        let queuePreserved = null;
        try {
          const after = new Set(queuedFollowUpIds(entry.query, payload.threadId));
          queuePreserved = entry.before.every(id => after.has(id));
        } catch {}
        return { ok: true, method: "codex-desktop-internal-request", threadId: payload.threadId, turnId,
          queuedCount: entry.before.length, queuePreserved };
      } catch { return { ok: false, reason: "desktop-send-unconfirmed" }; }
    })();
    attempts.set(key, { result });
    return await result;
  })()`;
}

export async function probeDesktopRequestClient(session) {
  try {
    const result = await session.evaluate(buildDesktopRequestProbeExpression());
    return result?.ok ? result : { ok: false, reason: "desktop-request-client-unavailable" };
  } catch (error) {
    return { ok: false, reason: String(error?.message || "desktop-request-client-unavailable").slice(0, 160) };
  }
}

export async function sendContinueThroughDesktop(session, {
  threadId,
  eventId,
  message = AUTO_RESUME_MESSAGE,
} = {}, canSubmit = () => true) {
  const normalizedThreadId = String(threadId || "").toLowerCase();
  const normalizedEventId = String(eventId || "").toLowerCase();
  const normalizedMessage = normalizeAutoResumeMessage(message);
  if (!UUID_PATTERN.test(normalizedThreadId)) return { ok: false, reason: "invalid-auto-resume-thread-id" };
  if (!EVENT_ID_PATTERN.test(normalizedEventId)) return { ok: false, reason: "invalid-auto-resume-event-id" };
  if (!normalizedMessage) return { ok: false, reason: "invalid-auto-resume-message" };
  if (!canSubmit()) return { ok: false, reason: "not-authorized" };
  try {
    const prepared = await session.evaluate(prepareDesktopAutoResumeExpression(normalizedThreadId, normalizedEventId), 60000);
    if (!prepared?.prepared) {
      if (prepared?.ok || prepared?.reason === "desktop-send-unconfirmed") return prepared;
      return {ok: false, reason: "desktop-request-client-unavailable"};
    }
  } catch {
    // Preparation cannot submit a turn, even if its response is lost.
    return { ok: false, reason: "desktop-request-client-unavailable" };
  }
  if (!canSubmit()) return { ok: false, reason: "not-authorized" };
  try {
    const result = await session.evaluate(buildDesktopAutoResumeExpression({
      threadId: normalizedThreadId, eventId: normalizedEventId, message: normalizedMessage,
    }), 60000);
    if (result?.ok || result?.reason === "desktop-request-client-unavailable") return result;
  } catch { /* Losing the reply does not prove submission failed. */ }
  return { ok: false, reason: "desktop-send-unconfirmed" };
}
