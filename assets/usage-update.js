(() => {
  const registry = window.__CODEX_USAGE_MONITOR_MODULES__ ||= {};
  const RELEASE_URL = "https://github.com/JiaYang-BUAA/Codex-Desktop-Usage-Monitor-Windows/releases/latest";
  const API_URL = "https://api.github.com/repos/JiaYang-BUAA/Codex-Desktop-Usage-Monitor-Windows/releases/latest";
  const CACHE_KEY = "codex-usage-monitor-update-v1";

  const compareVersions = (left, right) => {
    const a = String(left).replace(/^v/i, "").split(".").map((part) => Number(part) || 0);
    const b = String(right).replace(/^v/i, "").split(".").map((part) => Number(part) || 0);
    for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
      if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) > (b[index] || 0) ? 1 : -1;
    }
    return 0;
  };

  const checkForUpdate = async ({ currentVersion, intervalMs, force = false }) => {
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null"); } catch {}
    const now = Date.now();
    if (!force && cached && Number(cached.checkedAt) + intervalMs > now) return cached;
    try {
      const response = await fetch(API_URL, {
        headers: { Accept: "application/vnd.github+json" },
        credentials: "omit",
        referrerPolicy: "no-referrer",
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const latestVersion = String(payload?.tag_name || "").replace(/^v/i, "");
      const value = {
        checkedAt: now,
        latestVersion,
        available: /^\d+\.\d+\.\d+$/.test(latestVersion) && compareVersions(latestVersion, currentVersion) > 0,
        url: typeof payload?.html_url === "string" && payload.html_url.startsWith("https://github.com/") ? payload.html_url : RELEASE_URL,
      };
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(value)); } catch {}
      return value;
    } catch {
      return cached || { checkedAt: now, latestVersion: null, available: false, url: RELEASE_URL };
    }
  };

  registry.update = Object.freeze({ checkForUpdate, RELEASE_URL });
})();
