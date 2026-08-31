import { AUTO_RESUME_MESSAGE, normalizeAutoResumeMessage } from "./auto-resume.mjs";

export { AUTO_RESUME_MESSAGE };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EVENT_ID_PATTERN = /^[0-9a-f]{32}$/i;

const DESKTOP_REQUEST_CLIENT_LOOKUP = `
  function findDesktopRequestClient() {
    const root = window.__codexRoot?._internalRoot?.current;
    if (!root) throw new Error("codex-desktop-react-root-not-found");
    const queue = [root];
    const seen = new WeakSet();
    let cursor = 0;
    let visited = 0;
    while (cursor < queue.length && visited < 200000) {
      const value = queue[cursor++];
      if (value == null || (typeof value !== "object" && typeof value !== "function") || seen.has(value)) continue;
      seen.add(value);
      visited += 1;
      try {
        if (typeof value.sendRequest === "function"
          && value.hostId === "local"
          && value.requestPromises instanceof Map) return value;
      } catch {}
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
    throw new Error("codex-desktop-request-client-not-found");
  }
`.trim();

const DESKTOP_QUEUED_FOLLOW_UP_LOOKUP = `
  function findDesktopQueuedFollowUpsQuery() {
    const root = window.__codexRoot?._internalRoot?.current;
    if (!root) return null;
    const queue = [root];
    const seen = new WeakSet();
    let cursor = 0;
    let visited = 0;
    while (cursor < queue.length && visited < 200000) {
      const value = queue[cursor++];
      if (value == null || (typeof value !== "object" && typeof value !== "function") || seen.has(value)) continue;
      seen.add(value);
      visited += 1;
      try {
        if (typeof value.getQueryCache === "function") {
          const queries = value.getQueryCache().getAll();
          const query = Array.isArray(queries) ? queries.find((candidate) => {
            const key = candidate?.queryKey;
            return Array.isArray(key)
              && key.includes("get-global-state")
              && JSON.stringify(key).includes("queued-follow-ups");
          }) : null;
          if (query) return query;
        }
      } catch {}
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
    return null;
  }

  function queuedFollowUpIds(threadId) {
    const query = findDesktopQueuedFollowUpsQuery();
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
    const request = findDesktopRequestClient();
    return { ok: true, method: "codex-desktop-internal-request", hostId: request.hostId };
  })()`;
}

export function buildDesktopAutoResumeExpression({ threadId, eventId, message }) {
  const payload = {
    threadId,
    input: [{ type: "text", text: message }],
    approvalPolicy: "never",
    clientUserMessageId: `codex-usage-monitor-${eventId}`,
  };
  return `(async () => {
    ${DESKTOP_REQUEST_CLIENT_LOOKUP}
    ${DESKTOP_QUEUED_FOLLOW_UP_LOOKUP}
    const request = findDesktopRequestClient();
    const payload = ${JSON.stringify(payload)};
    const options = { priority: "critical", source: "usage_monitor_auto_resume" };
    const queuedMessageIds = queuedFollowUpIds(payload.threadId);
    await request.sendRequest("thread/resume", { threadId: payload.threadId }, options);
    const result = await request.sendRequest("turn/start", payload, options);
    const turnId = String(result?.turn?.id || "");
    if (!turnId) throw new Error("codex-desktop-turn-id-missing");
    const queuedAfterStart = new Set(queuedFollowUpIds(payload.threadId));
    const queuePreserved = queuedMessageIds.every((id) => queuedAfterStart.has(id));
    if (!queuePreserved) throw new Error("codex-desktop-native-queue-changed-during-auto-resume");
    return {
      ok: true,
      method: "codex-desktop-internal-request",
      threadId: payload.threadId,
      turnId,
      queuedCount: queuedMessageIds.length,
      queuePreserved,
    };
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
} = {}) {
  const normalizedThreadId = String(threadId || "").toLowerCase();
  const normalizedEventId = String(eventId || "").toLowerCase();
  const normalizedMessage = normalizeAutoResumeMessage(message);
  if (!UUID_PATTERN.test(normalizedThreadId)) return { ok: false, reason: "invalid-auto-resume-thread-id" };
  if (!EVENT_ID_PATTERN.test(normalizedEventId)) return { ok: false, reason: "invalid-auto-resume-event-id" };
  if (!normalizedMessage) return { ok: false, reason: "invalid-auto-resume-message" };
  try {
    const result = await session.evaluate(buildDesktopAutoResumeExpression({
      threadId: normalizedThreadId,
      eventId: normalizedEventId,
      message: normalizedMessage,
    }));
    return result?.ok ? result : { ok: false, reason: "desktop-turn-start-failed" };
  } catch (error) {
    return { ok: false, reason: String(error?.message || "desktop-turn-start-failed").slice(0, 160) };
  }
}
