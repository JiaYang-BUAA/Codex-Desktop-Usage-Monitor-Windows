import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { CombinedUsageClient } from "./usage-client.mjs";
import { createUiSettingsStore, MAX_UI_SETTINGS_BYTES } from "./ui-settings.mjs";
import { createAutoUpdater } from "./auto-updater.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const usageAssets = [
  "usage-constants.js",
  "usage-i18n.js",
  "usage-placement.js",
  "usage-inject.js",
].map((name) => path.join(root, "assets", name));
const HOST_ID = "codex-usage-monitor";
const STATE_KEY = "__CODEX_USAGE_MONITOR_STATE__";
const PERSISTED_SETTINGS_KEY = "__CODEX_USAGE_MONITOR_PERSISTED_SETTINGS__";
const SETTINGS_BINDING = "__codexUsageMonitorSaveSettings";
const CONFIGURATION_KEY = "__CODEX_USAGE_MONITOR_CONFIGURATION__";
const CONFIGURATION_BINDING = "__codexUsageMonitorConfigureSource";
const MAX_CONFIGURATION_BYTES = 131072;
const TARGET_ABSENCE_EXIT_MS = 60000;

function parseArgs(argv) {
  const options = {
    port: 9335,
    mode: "watch",
    timeoutMs: 30000,
    screenshot: null,
    monitorOnly: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--port") options.port = Number(argv[++i]);
    else if (arg === "--once") options.mode = "once";
    else if (arg === "--watch") options.mode = "watch";
    else if (arg === "--verify") options.mode = "verify";
    else if (arg === "--remove") options.mode = "remove";
    else if (arg === "--monitor-only") options.monitorOnly = true;
    else if (arg === "--timeout-ms") options.timeoutMs = Number(argv[++i]);
    else if (arg === "--screenshot") options.screenshot = path.resolve(argv[++i]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65535) throw new Error(`Invalid port: ${options.port}`);
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 250 || options.timeoutMs > 120000) throw new Error(`Invalid timeout: ${options.timeoutMs}`);
  return options;
}

class CdpSession {
  constructor(target, commandTimeoutMs) {
    this.target = target;
    this.commandTimeoutMs = commandTimeoutMs;
    this.ws = new WebSocket(target.webSocketDebuggerUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.closed = false;
  }

  async open() {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`CDP WebSocket open timed out after ${this.commandTimeoutMs} ms`)), this.commandTimeoutMs);
      this.ws.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      this.ws.addEventListener("error", (error) => { clearTimeout(timer); reject(error); }, { once: true });
    });
    this.ws.addEventListener("message", (event) => this.onMessage(event));
    this.ws.addEventListener("close", () => {
      this.closed = true;
      for (const waiter of this.pending.values()) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error("CDP socket closed"));
      }
      this.pending.clear();
    });
    await this.send("Runtime.enable");
    await this.send("Page.enable");
    return this;
  }

  onMessage(event) {
    let message;
    try { message = JSON.parse(String(event.data)); } catch { return; }
    if (message.id) {
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      clearTimeout(waiter.timer);
      if (message.error) waiter.reject(new Error(`${message.error.message} (${message.error.code})`));
      else waiter.resolve(message.result);
      return;
    }
    for (const listener of this.listeners.get(message.method) ?? []) listener(message.params ?? {});
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) ?? [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  send(method, params = {}) {
    if (this.closed) return Promise.reject(new Error("CDP session is closed"));
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        if (!this.pending.delete(id)) return;
        reject(new Error(`${method} timed out after ${this.commandTimeoutMs} ms`));
      }, this.commandTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.ws.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: false,
    });
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text;
      throw new Error(`Renderer evaluation failed: ${detail}`);
    }
    return result.result?.value;
  }

  async close() {
    for (const waiter of this.pending.values()) clearTimeout(waiter.timer);
    this.pending.clear();
    if (this.closed || this.ws.readyState === WebSocket.CLOSED) {
      this.closed = true;
      return;
    }
    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.closed = true;
        resolve();
      };
      const timer = setTimeout(finish, 500);
      this.ws.addEventListener("close", finish, { once: true });
      if (this.ws.readyState !== WebSocket.CLOSING) {
        try { this.ws.close(); } catch { finish(); }
      }
    });
  }
}

function isValidDebuggerSocket(value, port) {
  try {
    const url = new URL(value);
    return url.protocol === "ws:"
      && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname.toLowerCase())
      && Number(url.port) === port
      && !url.username
      && !url.password;
  } catch {
    return false;
  }
}

async function getTargets(port) {
  for (const host of ["127.0.0.1", "[::1]", "localhost"]) {
    try {
      const response = await fetch(`http://${host}:${port}/json/list`, { redirect: "error", signal: AbortSignal.timeout(1000) });
      if (!response.ok) continue;
      const targets = await response.json();
      if (!Array.isArray(targets)) continue;
      return targets.filter((item) => item?.type === "page"
        && String(item.url).startsWith("app://")
        && isValidDebuggerSocket(item.webSocketDebuggerUrl, port));
    } catch {}
  }
  return [];
}

async function waitForTargets(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const targets = await getTargets(port);
    if (targets.length) return targets;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`No Codex renderer target on local port ${port} within ${timeoutMs} ms.`);
}

function isMonitorTarget(target) {
  try {
    const url = decodeURIComponent(String(target.url));
    return !url.includes("avatar-overlay");
  } catch {
    return !String(target.url).includes("avatar-overlay");
  }
}

async function readUsagePayload() {
  return (await Promise.all(usageAssets.map((asset) => fs.readFile(asset, "utf8")))).join("\n");
}

async function pathExists(targetPath) {
  try { return (await fs.stat(targetPath)).isFile(); } catch { return false; }
}

async function readConfigurationSummary() {
  const stateRoot = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "CodexUsageMonitor") : null;
  const summary = {
    account: { configured: false, baseUrl: "https://www.cctq.ai", userId: "", baselineConfigured: false, initialTokens: "0" },
    provider: { configured: false },
  };
  if (!stateRoot) return summary;
  const accountConfigPath = path.join(stateRoot, "account.json");
  const accountSecretPath = path.join(stateRoot, "account-token.dpapi");
  const accountCounterPath = path.join(stateRoot, "account-token-counter.json");
  const providerConfigPath = path.join(stateRoot, "provider.json");
  const providerSecretPath = path.join(stateRoot, "api-key.dpapi");
  try {
    const value = JSON.parse(await fs.readFile(accountConfigPath, "utf8"));
    if (value?.schemaVersion === 1) {
      summary.account = {
        configured: await pathExists(accountSecretPath),
        baseUrl: typeof value.baseUrl === "string" ? value.baseUrl : summary.account.baseUrl,
        userId: typeof value.userId === "string" ? value.userId : "",
        baselineConfigured: false,
        initialTokens: "0",
      };
    }
  } catch {}
  try {
    const text = await fs.readFile(accountCounterPath, "utf8");
    const initialTokens = text.match(/"initialTokens"\s*:\s*(\d+)/)?.[1];
    summary.account.baselineConfigured = /"baselineConfigured"\s*:\s*true/i.test(text) && Boolean(initialTokens);
    if (initialTokens) summary.account.initialTokens = initialTokens;
  } catch {}
  try {
    const value = JSON.parse(await fs.readFile(providerConfigPath, "utf8"));
    if (value?.schemaVersion === 1) summary.provider = { ...value, configured: await pathExists(providerSecretPath) };
  } catch {}
  return summary;
}

function updateExpression(value) {
  return `(() => { const state = window[${JSON.stringify(STATE_KEY)}]; return typeof state?.updateUsage === "function" ? state.updateUsage(${JSON.stringify(value)}) : false; })()`;
}

function removeExpression() {
  return `(() => { let removed = false; try { if (window[${JSON.stringify(STATE_KEY)}]?.cleanup?.()) removed = true; } catch {} document.getElementById(${JSON.stringify(HOST_ID)})?.remove(); return removed; })()`;
}

function settingsSeedExpression(value) {
  return `(() => { const value = ${JSON.stringify(value)}; if (value && typeof value === "object") window[${JSON.stringify(PERSISTED_SETTINGS_KEY)}] = value; else delete window[${JSON.stringify(PERSISTED_SETTINGS_KEY)}]; return true; })()`;
}

function configurationSeedExpression(value) {
  return `(() => { window[${JSON.stringify(CONFIGURATION_KEY)}] = ${JSON.stringify(value)}; return true; })()`;
}

function configurationResultExpression(requestId, result) {
  return `(() => window[${JSON.stringify(STATE_KEY)}]?.configurationResult?.(${JSON.stringify(requestId)}, ${JSON.stringify(result)}) || false)()`;
}

function readSettingsExpression() {
  return `(() => window[${JSON.stringify(STATE_KEY)}]?.getSettings?.() || null)()`;
}

async function registerSettingsBinding(session, settingsStore, onSettingsChanged = null) {
  session.on("Runtime.bindingCalled", ({ name, payload }) => {
    if (name !== SETTINGS_BINDING || typeof payload !== "string" || Buffer.byteLength(payload, "utf8") > MAX_UI_SETTINGS_BYTES) return;
    let value;
    try { value = JSON.parse(payload); } catch { return; }
    settingsStore.save(value)
      .then((saved) => onSettingsChanged?.(saved))
      .catch((error) => console.error(`[usage-monitor] UI settings save failed: ${error.message}`));
  });
  await session.send("Runtime.addBinding", { name: SETTINGS_BINDING });
}

function runPanelConfiguration(request) {
  const powerShell = process.env.CODEX_USAGE_POWERSHELL_PATH || "pwsh.exe";
  const script = path.join(root, "scripts", "configure-from-panel.ps1");
  return new Promise((resolve) => {
    const child = spawn(powerShell, ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let outputTooLarge = false;
    const collect = (target, chunk) => {
      const next = target + String(chunk);
      if (Buffer.byteLength(next, "utf8") > MAX_CONFIGURATION_BYTES) outputTooLarge = true;
      return outputTooLarge ? target : next;
    };
    child.stdout.on("data", (chunk) => { stdout = collect(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = collect(stderr, chunk); });
    const timer = setTimeout(() => { try { child.kill(); } catch {} }, 120000);
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ ok: false, message: "无法启动本机配置服务。" });
    });
    child.on("close", () => {
      clearTimeout(timer);
      if (outputTooLarge) { resolve({ ok: false, message: "配置服务返回内容过大。" }); return; }
      const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      try {
        const result = JSON.parse(lines.at(-1) || "");
        resolve(result && typeof result === "object" ? result : { ok: false, message: "配置服务返回无效。" });
      } catch {
        resolve({ ok: false, message: stderr.trim() ? "配置服务执行失败。" : "配置服务没有返回结果。" });
      }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify(request));
  });
}

function startMonitorReplacement(port) {
  const powerShell = process.env.CODEX_USAGE_POWERSHELL_PATH || "pwsh.exe";
  const script = path.join(root, "scripts", "start-monitor.ps1");
  try {
    const child = spawn(powerShell, ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-Port", String(port), "-Replace"], {
      detached: true, windowsHide: true, stdio: "ignore",
    });
    child.unref();
  } catch {}
}

async function registerConfigurationBinding(session, port) {
  session.on("Runtime.bindingCalled", ({ name, payload }) => {
    if (name !== CONFIGURATION_BINDING || typeof payload !== "string" || Buffer.byteLength(payload, "utf8") > MAX_CONFIGURATION_BYTES) return;
    let request;
    try { request = JSON.parse(payload); } catch { return; }
    const requestId = typeof request?.requestId === "string" ? request.requestId : "";
    if (!/^[a-z0-9-]{8,64}$/.test(requestId) || !["api-account", "api-key"].includes(request?.type)) return;
    runPanelConfiguration(request).then(async (result) => {
      await session.evaluate(configurationResultExpression(requestId, result)).catch(() => {});
      if (result?.ok) setTimeout(() => startMonitorReplacement(port), 750);
    }).catch(() => {});
  });
  await session.send("Runtime.addBinding", { name: CONFIGURATION_BINDING });
}

async function applyMonitor(session, usage, settingsStore) {
  // Read the current asset for every renderer load so an updated package is never replaced by stale source.
  if (settingsStore) await session.evaluate(settingsSeedExpression(settingsStore.current));
  await session.evaluate(configurationSeedExpression(await readConfigurationSummary()));
  const result = await session.evaluate(await readUsagePayload());
  if (usage) await session.evaluate(updateExpression(usage));
  if (settingsStore && !settingsStore.current) {
    const rendererSettings = await session.evaluate(readSettingsExpression());
    if (rendererSettings) await settingsStore.save(rendererSettings);
  }
  return result || { installed: false, mode: "monitor-only", anchoredToApproval: false };
}

async function updateMonitor(session, usage, settingsStore) {
  const updated = await session.evaluate(updateExpression(usage));
  return updated ? updated : applyMonitor(session, usage, settingsStore);
}

async function removeFromSession(session) {
  return session.evaluate(removeExpression());
}

async function verifySession(session) {
  return session.evaluate(`(() => { const host = document.getElementById(${JSON.stringify(HOST_ID)}); const health = window[${JSON.stringify(STATE_KEY)}]?.diagnose?.() || null; return { installed: Boolean(host?.shadowRoot), anchor: host?.dataset?.anchor || null, status: host?.dataset?.status || null, strategy: host?.dataset?.placementStrategy || health?.strategy || null, reason: health?.reason || null }; })()`);
}

async function syncCurrentThread(session, usageClient) {
  const threadId = await session.evaluate(`(() => {
    const attributes = ["data-above-composer-conversation-id", "data-conversation-id", "data-thread-id"];
    for (const attribute of attributes) {
      const nodes = [...document.querySelectorAll(\`[\${attribute}]\`)];
      const active = nodes.filter((node) => {
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }).at(-1) || nodes.at(-1) || null;
      const value = active?.getAttribute(attribute) || "";
      const match = value.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
      if (match) return match;
    }
    return null;
  })()`);
  usageClient.setCurrentThreadId(threadId);
}

async function capture(session, targetPath) {
  const result = await session.send("Page.captureScreenshot", { format: "png" });
  await fs.writeFile(targetPath, Buffer.from(result.data, "base64"));
}

async function closeSessions(sessions) {
  await Promise.all([...sessions.values()].map(({ session }) => session.close().catch(() => {})));
  sessions.clear();
}

async function runOnce(options) {
  const targets = await waitForTargets(options.port, options.timeoutMs);
  const settingsStore = options.mode === "remove" ? null : await createUiSettingsStore();
  const results = [];
  for (const target of targets) {
    if (!isMonitorTarget(target)) {
      results.push({ targetId: target.id, auxiliary: true, skipped: true });
      continue;
    }
    const session = new CdpSession(target, Math.min(options.timeoutMs, 10000));
    await session.open();
    try {
      if (options.mode === "remove") {
        results.push({ targetId: target.id, removed: await removeFromSession(session) });
        continue;
      }
      await registerSettingsBinding(session, settingsStore);
      const applied = await applyMonitor(session, null, settingsStore);
      if (options.screenshot) await capture(session, options.screenshot);
      const verified = await verifySession(session);
      results.push({ targetId: target.id, title: target.title, applied, verified });
    } finally {
      await session.close();
    }
  }
  const monitorResults = results.filter((item) => !item.auxiliary);
  const verified = options.mode === "verify"
    ? monitorResults.length > 0 && monitorResults.every((item) => item.verified?.installed)
    : true;
  console.log(JSON.stringify({ mode: options.mode, monitorOnly: true, port: options.port, verified, targets: results }, null, 2));
  if (settingsStore) await settingsStore.flush();
  if (options.mode === "verify" && !verified) process.exitCode = 1;
}

async function runWatch(options) {
  const sessions = new Map();
  const settingsStore = await createUiSettingsStore();
  const autoUpdater = createAutoUpdater({ root, port: options.port, settingsStore });
  let latestUsage = null;
  let stopping = false;
  let targetsMissingSince = null;
  let usageStartPromise = Promise.resolve();
  const usageClient = new CombinedUsageClient({
    refreshMs: 60000,
    onUpdate: (usage) => {
      latestUsage = usage;
      for (const entry of sessions.values()) {
        updateMonitor(entry.session, usage, settingsStore).catch((error) => console.error(`[usage-monitor] update failed: ${error.message}`));
      }
    },
  });

  const attach = async (target) => {
    if (!isMonitorTarget(target)) return;
    const previous = sessions.get(target.id);
    if (previous && !previous.session.closed) return;
    if (previous) sessions.delete(target.id);
    const session = new CdpSession(target, 10000);
    try {
      await session.open();
      const entry = { session, target };
      sessions.set(target.id, entry);
      session.ws.addEventListener("close", () => {
        if (sessions.get(target.id)?.session === session) sessions.delete(target.id);
      }, { once: true });
      session.on("Page.loadEventFired", () => {
        applyMonitor(session, latestUsage, settingsStore)
          .then(() => syncCurrentThread(session, usageClient))
          .catch((error) => console.error(`[usage-monitor] renderer reload failed: ${error.message}`));
      });
      await registerSettingsBinding(session, settingsStore, (value) => autoUpdater.settingsChanged(value));
      await registerConfigurationBinding(session, options.port);
      await applyMonitor(session, latestUsage, settingsStore);
      autoUpdater.settingsChanged(settingsStore.current);
      await syncCurrentThread(session, usageClient);
    } catch (error) {
      if (sessions.get(target.id)?.session === session) sessions.delete(target.id);
      await session.close().catch(() => {});
      throw error;
    }
  };

  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await usageStartPromise.catch(() => {});
    autoUpdater.stop();
    await usageClient.stop().catch(() => {});
    await settingsStore.flush().catch(() => {});
    await closeSessions(sessions);
  };
  process.once("SIGINT", () => { stop().finally(() => process.exit(0)); });
  process.once("SIGTERM", () => { stop().finally(() => process.exit(0)); });

  try {
    // Inject the monitor as soon as the renderer appears. The first account usage
    // request can take several seconds and must not delay the UI.
    usageStartPromise = usageClient.start().catch((error) => {
      console.error(`[usage-monitor] initial usage refresh failed: ${error.message}`);
    });
    autoUpdater.start();
    while (!stopping) {
      const targets = await getTargets(options.port);
      const monitorTargets = targets.filter(isMonitorTarget);
      if (monitorTargets.length) targetsMissingSince = null;
      else if (targetsMissingSince === null) targetsMissingSince = Date.now();
      else if (Date.now() - targetsMissingSince >= TARGET_ABSENCE_EXIT_MS) {
        console.log(`[usage-monitor] no Codex renderer target for ${TARGET_ABSENCE_EXIT_MS} ms; exiting`);
        break;
      }
      const activeIds = new Set(monitorTargets.map((target) => target.id));
      for (const [id, entry] of sessions) {
        if (!activeIds.has(id)) {
          await entry.session.close().catch(() => {});
          sessions.delete(id);
        }
      }
      for (const target of monitorTargets) {
        try { await attach(target); } catch (error) { console.error(`[usage-monitor] target attach failed: ${error.message}`); }
      }
      for (const entry of sessions.values()) {
        try { await syncCurrentThread(entry.session, usageClient); } catch {}
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  } finally {
    await stop();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.mode === "watch") await runWatch(options);
  else await runOnce(options);
  return options.mode;
}

function scheduleOneShotExit(code) {
  // A real Electron CDP endpoint can occasionally keep the WebSocket handle alive
  // after close(). One-shot probes must still release the PowerShell startup mutex.
  setTimeout(() => process.exit(code), 50);
}

main().then((mode) => {
  if (mode !== "watch") scheduleOneShotExit(process.exitCode ?? 0);
}).catch((error) => {
  console.error(`[usage-monitor] ${error.message}`);
  scheduleOneShotExit(1);
});
