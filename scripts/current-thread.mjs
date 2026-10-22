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
      // Desktop keeps previously opened pages mounted. Their empty task
      // markers have no geometry, just like the active main/side-chat markers.
      if (node.closest?.('[data-app-shell-active-page="false"], [aria-hidden="true"], [inert]')) continue;
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
    // Empty composer markers are hidden in both the main task and side chat.
    // Within the active page the main task is mounted first; the side-chat marker must not
    // replace it when neither marker has a measurable rectangle.
    const active = anchored || visible.at(-1) || candidates[0] || null;
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
    const initialRoute = url.searchParams.get("initialRoute");
    // Popped-out local tasks use the normal renderer with an initial route.
    // Keep auxiliary shells (avatar, quick chat, browser prewarm) excluded.
    const taskRoute = /^\/local\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/?$/i;
    return url.protocol === "app:"
      && url.hostname === "-"
      && url.pathname === "/index.html"
      && (initialRoute === null || taskRoute.test(initialRoute));
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

// Keep the selection on its renderer, never on the shared usage collector.
export async function syncWindowThread(session, windowState) {
  const previous = windowState.threadId ?? null;
  const selection = await syncCurrentThread(session, {
    setCurrentThreadId: (threadId) => { windowState.threadId = threadId; },
  });
  return { ...selection, changed: previous !== (windowState.threadId ?? null) };
}
