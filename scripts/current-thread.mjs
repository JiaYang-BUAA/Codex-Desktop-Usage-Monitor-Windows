export function selectCurrentCodexThread(rootDocument) {
  const attributes = [
    "data-above-composer-conversation-id",
    "data-conversation-id",
    "data-thread-id",
  ];
  const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  let auxiliaryConversationPresent = false;

  if (!rootDocument || typeof rootDocument.querySelectorAll !== "function") {
    return { threadId: null, auxiliaryConversationPresent };
  }

  for (const attribute of attributes) {
    const candidates = [];
    for (const node of rootDocument.querySelectorAll(`[${attribute}]`)) {
      const value = String(node.getAttribute(attribute) || "").trim();
      if (/^chatgpt\s*:/i.test(value)) {
        auxiliaryConversationPresent = true;
        continue;
      }
      const threadId = value.match(uuidPattern)?.[0]?.toLowerCase() || null;
      if (threadId) candidates.push({ node, threadId });
    }

    const visible = candidates.filter(({ node }) => {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    const host = rootDocument.getElementById?.("codex-usage-monitor") || null;
    const hostRect = host?.getBoundingClientRect?.() || null;
    const hostCenterX = hostRect && hostRect.width > 0 ? hostRect.left + (hostRect.width / 2) : null;
    const anchored = hostCenterX === null ? null : visible.map((candidate) => {
      const rect = candidate.node.getBoundingClientRect();
      const distance = hostCenterX < rect.left
        ? rect.left - hostCenterX
        : hostCenterX > rect.right
          ? hostCenterX - rect.right
          : 0;
      return { candidate, distance };
    }).sort((left, right) => left.distance - right.distance)[0]?.candidate || null;
    const active = anchored || visible.at(-1) || candidates.at(-1) || null;
    if (active) return { threadId: active.threadId, auxiliaryConversationPresent };
  }

  return { threadId: null, auxiliaryConversationPresent };
}

export function currentThreadSelectionExpression() {
  return `(${selectCurrentCodexThread.toString()})(document)`;
}

export function isMainCodexRendererTarget(target) {
  try {
    const url = new URL(String(target?.url || ""));
    return url.protocol === "app:"
      && url.pathname === "/index.html"
      && !url.searchParams.has("initialRoute");
  } catch {
    return false;
  }
}

export async function syncCurrentThread(session, usageClient) {
  const selection = await session.evaluate(currentThreadSelectionExpression());
  const threadId = typeof selection?.threadId === "string" ? selection.threadId : null;
  const auxiliaryConversationPresent = selection?.auxiliaryConversationPresent === true;

  if (threadId) {
    usageClient.setCurrentThreadId(threadId);
    return { threadId, auxiliaryConversationPresent, preserved: false };
  }

  if (auxiliaryConversationPresent) {
    return { threadId: null, auxiliaryConversationPresent, preserved: true };
  }

  usageClient.setCurrentThreadId(null);
  return { threadId: null, auxiliaryConversationPresent, preserved: false };
}
