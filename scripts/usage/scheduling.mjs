export const LOCAL_TOKEN_ACTIVE_SCAN_MS = 2000;
export const LOCAL_TOKEN_IDLE_SCAN_MS = 12000;
export const LOCAL_TOKEN_ACTIVE_WINDOW_MS = 15000;

export function localTokenNextScanDelay({
  now,
  lastActivityAt,
  activeScanMs = LOCAL_TOKEN_ACTIVE_SCAN_MS,
  idleScanMs = LOCAL_TOKEN_IDLE_SCAN_MS,
  activeWindowMs = LOCAL_TOKEN_ACTIVE_WINDOW_MS,
}) {
  const active = Number.isFinite(lastActivityAt) && now - lastActivityAt <= activeWindowMs;
  return active ? Math.max(500, activeScanMs) : Math.max(1000, idleScanMs);
}
