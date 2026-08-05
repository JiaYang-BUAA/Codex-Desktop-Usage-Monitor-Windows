(() => {
  const registry = window.__CODEX_USAGE_MONITOR_MODULES__ ||= {};
  const COMPOSER_SELECTORS = Object.freeze([
    ".composer-surface-chrome",
    '[data-testid="composer"]',
    '[data-testid*="composer-"]',
  ]);
  const EDITABLE_SELECTOR = 'textarea, [contenteditable="true"]';
  const CONTROL_SELECTOR = 'button, [role="button"]';
  const APPROVAL_PATTERN = /(?:替我审批|请求批准|完全访问(?:权限)?|自定义(?:\s*\(config\.toml\))?|approve|approval|full access|custom\s*\(config\.toml\))/i;

  const box = (node) => {
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
  };
  const isVisible = (node) => {
    const rect = node?.getBoundingClientRect();
    return Boolean(rect && rect.width > 0 && rect.height > 0);
  };
  const controlText = (node) => `${node?.getAttribute?.("aria-label") || ""} ${node?.getAttribute?.("title") || ""} ${node?.textContent || ""}`.trim();
  const isApprovalControl = (node) => APPROVAL_PATTERN.test(controlText(node));
  const composerSelector = COMPOSER_SELECTORS.join(", ");

  const findPlacement = (hostId) => {
    const composers = [...document.querySelectorAll(composerSelector)].filter(isVisible);
    const editables = [...document.querySelectorAll(EDITABLE_SELECTOR)]
      .filter((node) => isVisible(node) && !node.closest(`#${hostId}`));
    const nearestComposer = (editable) => {
      const explicit = editable.closest(composerSelector);
      if (explicit && isVisible(explicit)) return { composer: explicit, strategy: "explicit-editable" };
      let current = editable.parentElement;
      for (let depth = 0; current && depth < 6; depth += 1, current = current.parentElement) {
        const rect = box(current);
        if (rect && rect.height >= 56 && rect.height <= 260 && current.querySelectorAll(CONTROL_SELECTOR).length >= 2) {
          return { composer: current, strategy: `editable-ancestor-${depth + 1}` };
        }
      }
      return null;
    };
    const match = editables.map(nearestComposer).find(Boolean)
      || (composers.length ? { composer: composers.at(-1), strategy: "explicit-composer" } : null);
    if (!match) {
      return {
        composer: null,
        strategy: "none",
        reason: editables.length ? "composer-not-found-for-editable" : "visible-editable-not-found",
        editableCount: editables.length,
        composerCount: composers.length,
      };
    }
    return { ...match, reason: null, editableCount: editables.length, composerCount: composers.length };
  };

  const configurePosition = (host, composer, hostId) => {
    const composerBox = box(composer);
    if (!composerBox) return { ok: false, reason: "composer-box-unavailable" };
    const controls = [...composer.querySelectorAll(CONTROL_SELECTOR)]
      .filter((node) => isVisible(node) && !node.closest(`#${hostId}`));
    const approval = controls.find(isApprovalControl) || null;
    const controlBoxes = controls.map((node) => ({ node, rect: box(node) })).filter((item) => item.rect);
    const bottomCenter = controlBoxes.reduce((maximum, item) => Math.max(maximum, item.rect.y + item.rect.height / 2), -Infinity);
    const bottomRow = controlBoxes
      .filter((item) => Math.abs(item.rect.y + item.rect.height / 2 - bottomCenter) <= 14)
      .sort((left, right) => left.rect.x - right.rect.x);
    const anchor = approval || bottomRow[0]?.node || null;
    const anchorBox = box(anchor);
    const rowCenter = anchorBox ? anchorBox.y + anchorBox.height / 2 : composerBox.bottom - 22;
    const controlsToRight = controls
      .map((node) => ({ node, rect: box(node) }))
      .filter(({ node, rect }) => rect && node !== anchor && rect.x >= (anchorBox?.right ?? composerBox.x)
        && Math.abs(rect.y + rect.height / 2 - rowCenter) <= 14);
    const anchorRight = anchorBox?.right ?? composerBox.x + 12;
    const placementX = anchorRight + 8;
    const rightBoundary = controlsToRight.reduce((minimum, value) => Math.min(minimum, value.rect.x), composerBox.right);
    const available = Math.max(0, Math.floor(rightBoundary - placementX - 8));
    const reference = anchor || controls.find((node) => /(?:\b5\.\d|model|极高|high)/i.test(controlText(node))) || controls[0];
    if (reference) {
      const referenceStyle = getComputedStyle(reference);
      host.style.setProperty("--usage-color", referenceStyle.color);
      if (referenceStyle.fontSize) host.style.setProperty("--usage-font-size", referenceStyle.fontSize);
      const surface = getComputedStyle(composer).backgroundColor;
      host.style.setProperty("--usage-surface", surface && surface !== "rgba(0, 0, 0, 0)" ? surface : "rgba(255, 255, 255, .96)");
    }
    const hostHeight = box(host)?.height || 28;
    const placementY = Math.max(8, Math.min(window.innerHeight - hostHeight - 8, rowCenter - hostHeight / 2));
    host.style.setProperty("--usage-left", `${Math.round(placementX)}px`);
    host.style.setProperty("--usage-top", `${Math.round(placementY)}px`);
    host.style.setProperty("--usage-max-width", `${available}px`);
    const popoverWidth = Math.max(280, Math.min(720, window.innerWidth - 24));
    const popoverShift = Math.min(0, window.innerWidth - 12 - placementX - popoverWidth);
    host.style.setProperty("--usage-popover-width", `${popoverWidth}px`);
    host.style.setProperty("--usage-popover-shift", `${Math.max(12 - placementX, popoverShift)}px`);
    host.dataset.anchor = approval ? "approval" : anchor ? "control" : "composer-left";
    host.dataset.compact = String(available < 210);
    host.hidden = available < 104;
    return {
      ok: available >= 104,
      reason: available >= 104 ? null : "insufficient-composer-width",
      anchor: host.dataset.anchor,
      availableWidth: available,
      controlCount: controls.length,
    };
  };

  registry.placement = Object.freeze({ box, findPlacement, configurePosition });
})();
