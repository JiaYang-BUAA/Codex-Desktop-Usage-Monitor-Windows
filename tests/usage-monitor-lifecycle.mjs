import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const payload = (await Promise.all([
  "usage-constants.js",
  "usage-i18n.js",
  "usage-placement.js",
  "usage-inject.js",
].map((name) => fs.readFile(path.join(root, "assets", name), "utf8")))).join("\n");

const composerMarkup = (withApproval = true) => `
  <div class="composer-surface-chrome" style="position: relative">
    <div contenteditable="true"></div>
    <button aria-label="添加文件等内容"></button>
    ${withApproval ? '<button style="color: rgb(70, 80, 90); font-size: 14px">替我审批</button>' : ""}
    <button>5.6 Sol 极高</button>
    <button aria-label="听写"></button>
    <button aria-label="发送"></button>
  </div>`;

const updatedComposerMarkup = () => `
  <div class="_ComposerLayoutRoot_2av5p_3" style="position: relative">
    <div class="_ComposerLayoutBody_2av5p_179">
      <div class="contents">
        <div class="_ComposerLayoutFooter_2av5p_335">
          <div contenteditable="true"></div>
          <button aria-label="添加文件等内容"></button>
          <button aria-label="权限"></button>
          <button>5.6 Sol 极高</button>
          <button aria-label="听写"></button>
          <button aria-label="发送"></button>
        </div>
      </div>
    </div>
  </div>`;

const dom = new JSDOM(`<!doctype html>
<html>
  <head></head>
  <body>
    <div id="composer-overflow-root" style="overflow: auto; width: 700px">
      <div id="composer-wrapper" style="position: relative">${composerMarkup()}</div>
    </div>
  </body>
</html>`, {
  pretendToBeVisual: true,
  runScripts: "outside-only",
  url: "https://codex.local/",
});

const { window } = dom;
window.document.hasFocus = () => true;
window.Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
  const value = (() => {
    if (this.id === "composer-wrapper" || this.matches('.composer-surface-chrome, [class*="ComposerLayoutRoot"]')) return { x: 100, y: 100, width: 700, height: 100 };
    if (this.id === "codex-usage-monitor") return { x: 234, y: 164, width: 380, height: 28 };
    if (this.matches('[contenteditable="true"]')) return { x: 112, y: 112, width: 676, height: 44 };
    const text = `${this.getAttribute?.("aria-label") || ""} ${this.textContent || ""}`;
    if (/添加/.test(text)) return { x: 108, y: 164, width: 28, height: 28 };
    if (/(?:替我审批|请求批准|完全访问(?:权限)?|自定义(?:\s*\(config\.toml\))?)/.test(text)) return { x: 141, y: 164, width: 85, height: 28 };
    if (/权限/.test(text)) return { x: 141, y: 164, width: 28, height: 28 };
    if (/5\.6/.test(text)) return { x: 622, y: 164, width: 105, height: 28 };
    if (/听写/.test(text)) return { x: 728, y: 164, width: 28, height: 28 };
    if (/发送/.test(text)) return { x: 764, y: 164, width: 28, height: 28 };
    return { x: 0, y: 0, width: 0, height: 0 };
  })();
  return { ...value, right: value.x + value.width, bottom: value.y + value.height };
};

const now = Date.now();
const usage = {
  schemaVersion: 2,
  nextRefreshAt: now + 60000,
  todayTokens: 128000,
  lifetimeTokens: 12000000,
  sources: {
    official: {
      id: "official", label: "官方订阅", accountType: "subscription", status: "ready", nextRefreshAt: now + 60000,
      metrics: [
        { id: "primaryRemaining", label: "5小时剩余", display: "5小时 75%", value: "75%", defaultVisible: true },
        { id: "secondaryRemaining", label: "7天剩余", display: "7天 44%", value: "44%", defaultVisible: false },
        { id: "primaryReset", label: "5小时重置", display: "重置 07-24 12:00", value: "07-24 12:00", defaultVisible: false },
        { id: "todayTokens", label: "今日 token", display: "今日 128k", value: "128,000", defaultVisible: true },
        { id: "lifetimeTokens", label: "累计 token", display: "累计 12m", value: "12,000,000", defaultVisible: false },
        { id: "currentTaskTokens", label: "当前任务累计 Token", display: "任务 3822万", value: "3822万", defaultVisible: false },
        { id: "lastTurnTokens", label: "上次对话消耗 Token", display: "上次 8万", value: "8万", defaultVisible: false },
      ],
    },
    "api-account": {
      id: "api-account", label: "API 账户", accountType: "api-account", status: "loading", nextRefreshAt: now + 60000,
      metrics: [
        { id: "balance", label: "账户余额", value: "¥20", display: "余额 ¥20", defaultVisible: true },
        { id: "usedQuota", label: "累计已用额度", value: "¥8", display: "已用 ¥8" },
        { id: "todayTokens", label: "今日 Token", value: "4万", display: "今日 4万" },
        { id: "totalTokens", label: "累计 Token", value: "36万", display: "累计 36万" },
        { id: "lastPromptTokens", label: "上次输入 Token", value: "12,500", display: "输入 1万" },
        { id: "lastCompletionTokens", label: "上次输出 Token", value: "800", display: "输出 800" },
        { id: "lastQuota", label: "上次消耗额度", value: "¥0.12", display: "消耗 ¥0.12" },
        { id: "lastModel", label: "上次响应模型名称", value: "gpt-5.6-sol", display: "模型 gpt-5.6-sol" },
        { id: "lastRequestAt", label: "上次请求时间", value: "2026-07-24 09:30", display: "请求 2026-07-24 09:30" },
        { id: "lastLatency", label: "上次响应耗时", value: "842ms", display: "耗时 842ms" },
      ],
    },
    acme: {
      id: "acme", label: "Acme API", accountType: "api-key", status: "error", error: "request failed", nextRefreshAt: now + 60000,
      metrics: [
        { id: "usedAmount", label: "已用额度", value: "¥5", display: "已用 ¥5", defaultVisible: true },
        { id: "quotaLimit", label: "限额", value: "不限", display: "限额 不限", defaultVisible: true },
        { id: "expiresAt", label: "到期时间", value: "永久", display: "到期 永久" },
      ],
    },
  },
};

window.localStorage.setItem("codex-usage-monitor-settings-v1", JSON.stringify({
  metrics: {
    official: ["primaryRemaining", "primaryReset"],
    "api-account": ["balance"],
    acme: ["usedAmount", "quotaLimit"],
  },
  minimalMode: false,
  countdownVisualization: false,
}));
window.__CODEX_USAGE_MONITOR_CONFIGURATION__ = {
  account: { configured: true, baseUrl: "https://www.cctq.ai", userId: "10530", baselineConfigured: true, initialTokens: "123456" },
  provider: {
    configured: true, schemaVersion: 1, id: "cctq", label: "CCTQ API", baseUrl: "https://www.cctq.ai",
    requests: { usagePath: "/api/usage/token/", statusPath: "/api/status" },
    auth: { header: "Authorization", scheme: "Bearer" },
    response: {
      usageRoot: "data", statusRoot: "data", used: "total_used", limit: "total_granted",
      unlimited: "unlimited_quota", expiresAt: "expires_at", quotaPerUnit: "quota_per_unit",
      currency: "quota_display_type", defaultQuotaPerUnit: 500000, defaultCurrency: "CNY",
    },
  },
};
const configurationPayloads = [];
window.__codexUsageMonitorConfigureSource = (value) => configurationPayloads.push(JSON.parse(value));

try {
  assert.match(payload, /const observerTarget = document\.documentElement \|\| document;/);
  const result = window.eval(payload);
  assert.equal(result.installed, true);
  assert.equal(window.localStorage.getItem("codex-usage-monitor-settings-v1"), null);
  let host = window.document.getElementById("codex-usage-monitor");
  assert.ok(host?.shadowRoot);
  assert.equal(host.parentElement, window.document.body);
  assert.equal(window.document.getElementById("composer-overflow-root").contains(host), false);
  assert.equal(host.dataset.anchor, "approval");
  assert.equal(host.style.getPropertyValue("--usage-color"), "rgb(70, 80, 90)");
  assert.equal(host.style.getPropertyValue("--usage-font-size"), "14px");
  assert.equal(host.style.getPropertyValue("--usage-left"), "234px");
  assert.equal(host.style.getPropertyValue("--usage-top"), "164px");
  const initialMonitorLeft = host.style.getPropertyValue("--usage-left");
  const quickComposer = window.document.createElement("div");
  quickComposer.className = "composer-surface-chrome quick-chat-composer";
  quickComposer.innerHTML = '<div contenteditable="true"></div><button>快速聊天</button><button>发送</button>';
  window.document.getElementById("composer-wrapper").parentElement.insertBefore(quickComposer, window.document.getElementById("composer-wrapper"));
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(host.style.getPropertyValue("--usage-left"), initialMonitorLeft);
  window.document.getElementById("composer-wrapper").innerHTML = composerMarkup();
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(host.dataset.anchor, "approval");
  assert.equal(host.style.getPropertyValue("--usage-left"), initialMonitorLeft);
  quickComposer.remove();
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(window.__CODEX_USAGE_MONITOR_STATE__.diagnose().ok, true);
  const approvalButton = [...window.document.querySelectorAll("button")]
    .find((button) => button.textContent.includes("替我审批"));
  assert.ok(approvalButton);
  window.dispatchEvent(new window.Event("blur"));
  assert.equal(host.hidden, true);
  assert.equal(window.__CODEX_USAGE_MONITOR_STATE__.diagnose().reason, "window-not-focused");
  window.dispatchEvent(new window.Event("focus"));
  assert.equal(host.hidden, false);
  assert.equal(window.__CODEX_USAGE_MONITOR_STATE__.diagnose().ok, true);
  for (const label of ["请求批准", "替我审批", "完全访问权限", "完全访问", "自定义 (config.toml)", "自定义"]) {
    approvalButton.textContent = label;
    await new Promise((resolve) => setTimeout(resolve, 250));
    host = window.document.getElementById("codex-usage-monitor");
    assert.ok(host?.shadowRoot);
    assert.equal(host.hidden, false);
    assert.equal(host.dataset.anchor, "approval");
    assert.equal(host.style.getPropertyValue("--usage-left"), initialMonitorLeft);
  }
  assert.equal(host.shadowRoot.querySelector(".usage-dot"), null);
  assert.doesNotMatch(host.shadowRoot.querySelector("style").textContent, /\.usage-source-switch/);
  assert.match(host.shadowRoot.querySelector("style").textContent, /ready[^}]+#22c55e/);
  assert.match(host.shadowRoot.querySelector("style").textContent, /loading[^}]+#facc15/);
  assert.match(host.shadowRoot.querySelector("style").textContent, /stale[^}]+#fb3f4f/);
  assert.match(host.shadowRoot.querySelector("style").textContent, /usage-status[^}]+#a1a1aa/);
  assert.match(host.shadowRoot.querySelector("style").textContent, /usage-summary-item \+ \.usage-summary-item::before\s*\{[\s\S]*?top:\s*calc\(50% \+ 1px\);[\s\S]*?background:\s*currentColor;[\s\S]*?translateY\(-50%\)/);
  assert.match(host.shadowRoot.querySelector("style").textContent, /height:\s*14px;[\s\S]*?opacity:\s*\.40;/);
  assert.match(host.shadowRoot.querySelector("style").textContent, /\.usage-popover\s*\{[\s\S]*?background:\s*Canvas;/);
  assert.match(host.shadowRoot.querySelector("style").textContent, /:host\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?top:\s*var\(--usage-top/);
  assert.match(host.shadowRoot.querySelector("style").textContent, /\.usage-column\s*\{[\s\S]*?box-sizing:\s*border-box;[\s\S]*?width:\s*100%;/);
  assert.doesNotMatch(host.shadowRoot.querySelector("style").textContent, /usage-column \+ \.usage-column\s*\{[^}]*border-left/);
  assert.match(host.shadowRoot.querySelector("style").textContent, /\.usage-column-subsection-title\s*\{\s*margin-top:\s*5px;/);
  assert.match(host.shadowRoot.querySelector("style").textContent, /\.usage-column-subsection\[data-status="ready"\] \.usage-status\s*\{\s*background:\s*#22c55e;/);
  assert.match(host.shadowRoot.querySelector("style").textContent, /\.usage-detail-label\s*\{[\s\S]*?color:\s*inherit;[\s\S]*?font-weight:\s*650;/);
  assert.match(host.shadowRoot.querySelector("style").textContent, /usage-detail-select input\s*\{[\s\S]*?appearance:\s*none;[\s\S]*?width:\s*13px;[\s\S]*?height:\s*13px;/);
  assert.doesNotMatch(host.shadowRoot.querySelector("style").textContent, /usage-popover-footer/);
  assert.doesNotMatch(host.shadowRoot.querySelector("style").textContent, /:host\(\[data-density="(?:dense|packed)"\]\)\s*\{[^}]*font-size/);
  assert.match(host.shadowRoot.querySelector("style").textContent, /\.usage-summary\s*\{[\s\S]*?font-size:\s*var\(--usage-font-size,\s*11px\);/);
  assert.doesNotMatch(host.shadowRoot.querySelector("style").textContent, /:host\(\[data-density="(?:dense|packed)"\]\) \.usage-summary\s*\{[^}]*font-size/);
  assert.match(host.shadowRoot.querySelector("style").textContent, /\.usage-summary-items\s*\{[^}]*height:\s*100%;[^}]*line-height:\s*1;/);
  assert.match(host.shadowRoot.querySelector("style").textContent, /\.usage-summary-item\s*\{[^}]*display:\s*inline-flex;[^}]*align-items:\s*center;[^}]*height:\s*100%;/);
  assert.match(host.shadowRoot.querySelector("style").textContent, /data-density="packed"[^}]+\.usage-summary-item:nth-child\(2\)\s*\{\s*padding-left:\s*0;/);
  assert.match(host.shadowRoot.querySelector("style").textContent, /data-density="packed"[^}]+\.usage-summary-item:nth-child\(2\)::before\s*\{\s*display:\s*none;/);
  assert.match(host.shadowRoot.querySelector("style").textContent, /\.usage-mode-switches\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);[\s\S]*?width:\s*100%;/);
  assert.match(host.shadowRoot.querySelector("style").textContent, /\.usage-mode-toggle\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) 24px;/);
  assert.match(host.shadowRoot.querySelector("style").textContent, /\.usage-refresh-ring\s*\{[\s\S]*?top:\s*0;[\s\S]*?width:\s*13px;[\s\S]*?border:\s*1\.5px solid currentColor;[\s\S]*?background:\s*transparent;/);
  assert.match(host.shadowRoot.querySelector("style").textContent, /\.usage-refresh-ring::before\s*\{[\s\S]*?top:\s*-3px;[\s\S]*?width:\s*3px;[\s\S]*?height:\s*3px;[\s\S]*?background:\s*currentColor/);
  assert.match(host.shadowRoot.querySelector("style").textContent, /\.usage-refresh-ring::after\s*\{[\s\S]*?width:\s*1\.5px;[\s\S]*?height:\s*calc\(50% \+ \.5px\);[\s\S]*?background:\s*#22c55e;[\s\S]*?transform:\s*rotate\(var\(--usage-refresh-progress\)\);[\s\S]*?transform-origin:\s*50% 100%;/);

  assert.equal(window.__CODEX_USAGE_MONITOR_STATE__.updateUsage(usage), true);
  assert.equal(host.shadowRoot.querySelectorAll(".usage-summary-item").length, 5);
  assert.notEqual(host.dataset.density, "normal");
  assert.deepEqual([...host.shadowRoot.querySelectorAll(".usage-summary-item")].map((item) => item.textContent), ["5时75%", "重置07-24 12:00", "余额¥20", "已用¥5", "限额不限"]);

  host.shadowRoot.querySelector(".usage-summary").click();
  assert.equal(host.shadowRoot.querySelector(".usage-popover").hidden, false);
  const columns = [...host.shadowRoot.querySelectorAll(".usage-column")];
  assert.equal(columns.length, 3);
  assert.deepEqual(columns.map((column) => column.querySelector(".usage-column-heading").textContent), ["官方订阅", "API 账户", "API Key"]);
  assert.deepEqual(columns.map((column) => column.dataset.status), ["ready", "loading", "error"]);
  assert.deepEqual(columns.map((column) => column.querySelectorAll(".usage-detail-row").length), [7, 8, 4]);
  const taskSection = columns[0].querySelector(".usage-column-subsection");
  assert.ok(taskSection);
  assert.equal(taskSection.querySelector(".usage-column-heading").textContent, "本次任务相关");
  assert.equal(taskSection.querySelector(".usage-status").getAttribute("aria-label"), "正常");
  assert.equal(columns[0].querySelector(":scope > .usage-column-rows").querySelectorAll(".usage-detail-row").length, 5);
  assert.equal(taskSection.querySelectorAll(".usage-detail-row").length, 2);
  assert.equal(columns[0].querySelector('[data-metric="primaryRemaining"]').closest(".usage-detail-row").querySelector(".usage-detail-label").textContent, "5小时剩余");
  assert.equal(columns[0].querySelector('[data-metric="secondaryRemaining"]').closest(".usage-detail-row").querySelector(".usage-detail-label").textContent, "7天剩余");
  assert.equal(columns[0].querySelector('[data-metric="todayTokens"]').closest(".usage-detail-row").querySelector(".usage-detail-value").textContent, "13万");
  assert.equal(columns[0].querySelector('[data-metric="lifetimeTokens"]').closest(".usage-detail-row").querySelector(".usage-detail-value").textContent, "1200万");
  assert.equal(columns[0].querySelector('[data-metric="currentTaskTokens"]').closest(".usage-detail-row").querySelector(".usage-detail-value").textContent, "3822万");
  assert.equal(columns[0].querySelector('[data-metric="lastTurnTokens"]').closest(".usage-detail-row").querySelector(".usage-detail-value").textContent, "8万");
  assert.equal(columns[0].querySelector('[data-metric="requestStatus"]'), null);
  const usageWithoutTaskMetrics = structuredClone(usage);
  usageWithoutTaskMetrics.sources.official.metrics = usageWithoutTaskMetrics.sources.official.metrics
    .filter((metric) => !["currentTaskTokens", "lastTurnTokens"].includes(metric.id));
  assert.equal(window.__CODEX_USAGE_MONITOR_STATE__.updateUsage(usageWithoutTaskMetrics), true);
  const unavailableTaskSection = host.shadowRoot.querySelector('.usage-column-subsection[data-status="unavailable"]');
  assert.ok(unavailableTaskSection);
  assert.equal(unavailableTaskSection.querySelector(".usage-status").getAttribute("aria-label"), "暂无数据");
  assert.deepEqual([...unavailableTaskSection.querySelectorAll(".usage-detail-value")].map((item) => item.textContent), ["--", "--"]);
  assert.equal(window.__CODEX_USAGE_MONITOR_STATE__.updateUsage(usage), true);
  assert.deepEqual(columns.map((column) => column.querySelector(".usage-status").getAttribute("aria-label")), ["正常", "请求中", "请求失败"]);
  const limitedUsage = structuredClone(usage);
  limitedUsage.sources.acme.status = "rate-limited";
  limitedUsage.sources.acme.error = "Acme API 请求受限（HTTP 429），稍后自动重试";
  assert.equal(window.__CODEX_USAGE_MONITOR_STATE__.updateUsage(limitedUsage), true);
  assert.equal(host.shadowRoot.querySelector('.usage-column[data-status="rate-limited"] .usage-status').getAttribute("aria-label"), "请求受限");
  assert.equal(host.shadowRoot.querySelector('[data-source="acme"][data-metric="requestStatus"]')?.closest(".usage-detail-row")?.querySelector(".usage-detail-value")?.textContent, "请求受限");
  assert.equal(window.__CODEX_USAGE_MONITOR_STATE__.updateUsage(usage), true);
  assert.equal(host.shadowRoot.querySelectorAll('input[type="checkbox"]:checked').length, 5);
  assert.deepEqual([...columns[2].querySelectorAll(".usage-column-brand > *")].map((item) => item.textContent), ["Codex Usage Monitor for Windows v2.1.2", "—— Designed by +羊 and Codex"]);
  assert.match(host.shadowRoot.querySelector("style").textContent, /\.usage-column-brand\s*\{[\s\S]*?align-self:\s*flex-end;[\s\S]*?width:\s*fit-content;[\s\S]*?font-weight:\s*450;[\s\S]*?opacity:\s*\.55;/);
  assert.match(host.shadowRoot.querySelector("style").textContent, /\.usage-brand-product\s*\{[^}]*font-size:\s*12px;/);
  assert.match(host.shadowRoot.querySelector("style").textContent, /\.usage-brand-credit\s*\{\s*font-size:\s*9px;\s*font-weight:\s*450;\s*text-align:\s*right;/);
  assert.equal(columns[0].querySelector(".usage-column-meta"), null);
  assert.equal(columns[1].querySelector(".usage-column-meta"), null);
  assert.equal(columns[2].querySelector(".usage-column-meta span:first-child").textContent, "最多显示 8 项");
  assert.match(host.shadowRoot.querySelector("style").textContent, /\.usage-column-meta\s*\{[\s\S]*?justify-content:\s*flex-end;/);
  assert.match(host.shadowRoot.querySelector(".usage-refresh-countdown").textContent, /^刷新 \d+秒后$/);
  assert.deepEqual([...host.shadowRoot.querySelectorAll(".usage-mode-toggle")].map((item) => item.textContent), ["极简模式", "倒计时可视化", "English UI", "自动更新"]);
  assert.equal(host.shadowRoot.querySelectorAll('.usage-mode-toggle input[type="checkbox"]').length, 4);
  assert.equal(host.shadowRoot.querySelector('.usage-column-footer').firstElementChild.className, "usage-mode-switches");
  assert.equal(host.shadowRoot.querySelector('.usage-column-footer').lastElementChild.className, "usage-column-meta");
  assert.equal(columns[2].querySelector(".usage-column-footer").nextElementSibling, columns[2].querySelector(".usage-column-brand"));
  assert.deepEqual([...host.shadowRoot.querySelectorAll(".usage-config-trigger")].map((button) => button.textContent), ["配置", "配置"]);
  host.shadowRoot.querySelector('[data-configure-source="api-account"]').click();
  let accountForm = host.shadowRoot.querySelector('[data-config-source="api-account"]');
  assert.ok(accountForm);
  assert.equal(accountForm.querySelector('[data-config-field="baseUrl"]').value, "https://www.cctq.ai");
  assert.equal(accountForm.querySelector('[data-config-field="userId"]').value, "10530");
  assert.equal(accountForm.querySelector('[data-config-field="token"]').type, "password");
  assert.equal(accountForm.querySelector('[data-config-field="token"]').closest(".usage-config-field").querySelector(".usage-config-label").textContent, "访问令牌（Access Token）");
  assert.match(accountForm.querySelector('[data-config-field="token"]').closest(".usage-config-field").querySelector(".usage-config-hint").textContent, /不显示已保存的凭据/);
  assert.equal(accountForm.querySelector('[data-config-field="initialTokens"]').value, "123456");
  assert.match(accountForm.querySelector('[data-config-field="initialTokens"]').closest(".usage-config-field").querySelector(".usage-config-hint").textContent, /完整整数/);
  accountForm.requestSubmit();
  assert.equal(configurationPayloads.length, 1);
  assert.equal(configurationPayloads[0].type, "api-account");
  assert.equal(configurationPayloads[0].token, "");
  assert.equal(configurationPayloads[0].initialTokens, "123456");
  assert.equal(window.__CODEX_USAGE_MONITOR_STATE__.configurationResult(configurationPayloads[0].requestId, {
    ok: true,
    configuration: window.__CODEX_USAGE_MONITOR_CONFIGURATION__,
  }), true);
  assert.match(host.shadowRoot.querySelector(".usage-config-status").textContent, /安全保存/);
  host.shadowRoot.querySelector('[data-configure-source="api-account"]').click();
  host.shadowRoot.querySelector('[data-configure-source="acme"]').click();
  const configuredProviderForm = host.shadowRoot.querySelector('[data-config-source="acme"]');
  assert.equal(configuredProviderForm.querySelector('[data-config-field="preset"]'), null);
  assert.equal(configuredProviderForm.querySelector('[data-config-field="apiKey"]').type, "password");
  assert.equal(configuredProviderForm.querySelector(".usage-config-disclosure > summary").textContent, "连接设置");
  assert.equal(configuredProviderForm.querySelector(".usage-config-disclosure").open, false);
  assert.doesNotMatch(configuredProviderForm.textContent, /CCTQ/);
  configuredProviderForm.requestSubmit();
  assert.equal(configurationPayloads.length, 2);
  assert.equal(configurationPayloads[1].type, "api-key");
  assert.equal(configurationPayloads[1].preset, undefined);
  assert.equal(configurationPayloads[1].provider.label, "API Key");
  assert.equal(window.__CODEX_USAGE_MONITOR_STATE__.configurationResult(configurationPayloads[1].requestId, {
    ok: true,
    configuration: window.__CODEX_USAGE_MONITOR_CONFIGURATION__,
  }), true);
  host.shadowRoot.querySelector('[data-configure-source="acme"]').click();
  assert.equal(host.shadowRoot.querySelector(".usage-summary").firstElementChild.className, "usage-refresh-ring");
  assert.equal(host.shadowRoot.querySelector(".usage-refresh-ring").hidden, true);

  host.shadowRoot.querySelector('input[data-setting="minimalMode"]').click();
  assert.equal(JSON.parse(window.localStorage.getItem("codex-usage-monitor-settings-v2")).minimalMode, true);
  assert.equal(host.dataset.density, "normal");
  assert.equal(host.shadowRoot.querySelector(".usage-column-meta span:first-child").textContent, "极简最多 14 项");
  assert.deepEqual([...host.shadowRoot.querySelectorAll(".usage-summary-item")].map((item) => item.textContent), ["75%", "07-24 12:00", "¥20", "¥5", "不限"]);
  const minimalExtraSelectors = [
    'input[data-source="official"][data-metric="todayTokens"]',
    'input[data-source="official"][data-metric="lifetimeTokens"]',
    'input[data-source="api-account"][data-metric="totalTokens"]',
    'input[data-source="api-account"][data-metric="todayTokens"]',
    'input[data-source="api-account"][data-metric="usedQuota"]',
    'input[data-source="api-account"][data-metric="lastQuota"]',
    'input[data-source="api-account"][data-metric="lastModel"]',
    'input[data-source="api-account"][data-metric="lastRequestAt"]',
    'input[data-source="api-account"][data-metric="lastLatency"]',
  ];
  for (const [index, selector] of minimalExtraSelectors.entries()) {
    host.shadowRoot.querySelector(selector).click();
    if (index === 2) assert.equal(host.shadowRoot.querySelectorAll(".usage-summary-item").length, 8);
    if (index === 2) assert.equal(host.dataset.density, "normal");
  }
  assert.equal(host.shadowRoot.querySelectorAll(".usage-summary-item").length, 14);
  assert.equal(host.dataset.density, "packed");
  const fifteenth = host.shadowRoot.querySelector('input[data-source="acme"][data-metric="expiresAt"]');
  assert.equal(fifteenth.disabled, true);
  fifteenth.checked = true;
  fifteenth.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.equal(host.shadowRoot.querySelectorAll(".usage-summary-item").length, 14);
  for (const selector of minimalExtraSelectors) {
    const input = host.shadowRoot.querySelector(selector);
    input.checked = false;
    input.dispatchEvent(new window.Event("change", { bubbles: true }));
  }
  assert.deepEqual(JSON.parse(window.localStorage.getItem("codex-usage-monitor-settings-v2")).metrics["api-account"], ["balance"]);
  host.shadowRoot.querySelector('input[data-setting="minimalMode"]').click();
  assert.notEqual(host.dataset.density, "normal");

  host.shadowRoot.querySelector('input[data-setting="countdownVisualization"]').click();
  assert.equal(JSON.parse(window.localStorage.getItem("codex-usage-monitor-settings-v2")).countdownVisualization, true);
  assert.equal(host.shadowRoot.querySelector(".usage-refresh-ring").hidden, false);
  const realDateNow = window.Date.now;
  let ringNow = realDateNow();
  window.Date.now = () => ringNow;
  const firstCycleUsage = structuredClone(usage);
  firstCycleUsage.nextRefreshAt = ringNow + 60000;
  assert.equal(window.__CODEX_USAGE_MONITOR_STATE__.updateUsage(firstCycleUsage), true);
  assert.equal(host.shadowRoot.querySelector(".usage-refresh-ring").style.getPropertyValue("--usage-refresh-progress"), "0deg");
  ringNow += 30000;
  assert.equal(window.__CODEX_USAGE_MONITOR_STATE__.updateUsage(firstCycleUsage), true);
  assert.equal(host.shadowRoot.querySelector(".usage-refresh-ring").style.getPropertyValue("--usage-refresh-progress"), "180deg");
  ringNow += 30000;
  const reverseCycleUsage = structuredClone(usage);
  reverseCycleUsage.nextRefreshAt = ringNow + 60000;
  assert.equal(window.__CODEX_USAGE_MONITOR_STATE__.updateUsage(reverseCycleUsage), true);
  assert.equal(host.shadowRoot.querySelector(".usage-refresh-ring").style.getPropertyValue("--usage-refresh-progress"), "0deg");
  ringNow += 60000;
  assert.equal(window.__CODEX_USAGE_MONITOR_STATE__.updateUsage(reverseCycleUsage), true);
  assert.equal(host.shadowRoot.querySelector(".usage-refresh-ring").style.getPropertyValue("--usage-refresh-progress"), "360deg");
  window.Date.now = realDateNow;
  assert.equal(window.__CODEX_USAGE_MONITOR_STATE__.updateUsage(usage), true);

  const densityToggle = host.shadowRoot.querySelector('input[data-source="api-account"][data-metric="balance"]');
  assert.equal(densityToggle.checked, true);
  densityToggle.click();
  assert.deepEqual(JSON.parse(window.localStorage.getItem("codex-usage-monitor-settings-v2")).metrics["api-account"], []);
  assert.equal(host.shadowRoot.querySelectorAll(".usage-summary-item").length, 4);
  assert.equal(host.dataset.density, "normal");
  host.shadowRoot.querySelector('input[data-source="api-account"][data-metric="balance"]').click();
  assert.equal(host.shadowRoot.querySelectorAll(".usage-summary-item").length, 5);
  assert.notEqual(host.dataset.density, "normal");

  const stableInput = host.shadowRoot.querySelector('[data-source="api-account"][data-metric="totalTokens"]');
  stableInput.focus();
  await new Promise((resolve) => setTimeout(resolve, 1100));
  assert.equal(host.shadowRoot.querySelector('[data-source="api-account"][data-metric="totalTokens"]'), stableInput);
  stableInput.blur();

  for (const selector of [
    '[data-source="api-account"][data-metric="totalTokens"]',
    '[data-source="api-account"][data-metric="todayTokens"]',
    '[data-source="acme"][data-metric="expiresAt"]',
  ]) {
    const input = host.shadowRoot.querySelector(selector);
    input.checked = true;
    input.dispatchEvent(new window.Event("change", { bubbles: true }));
  }
  assert.equal(host.shadowRoot.querySelectorAll(".usage-summary-item").length, 8);
  assert.equal(host.dataset.density, "packed");
  const ninth = host.shadowRoot.querySelector('[data-source="api-account"][data-metric="lastModel"]');
  assert.equal(ninth.disabled, true);
  ninth.checked = true;
  ninth.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.equal(host.shadowRoot.querySelectorAll(".usage-summary-item").length, 8);

  const balance = host.shadowRoot.querySelector('input[data-source="api-account"][data-metric="balance"]');
  balance.checked = false;
  balance.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.equal(host.shadowRoot.querySelectorAll(".usage-summary-item").length, 7);
  assert.equal(host.shadowRoot.querySelector('[data-source="api-account"][data-metric="lastModel"]').disabled, false);

  const saved = JSON.parse(window.localStorage.getItem("codex-usage-monitor-settings-v2"));
  assert.equal(saved.unifiedMetricsVersion, 1);
  assert.equal(saved.source, undefined);
  assert.deepEqual(saved.metrics["api-account"], ["totalTokens", "todayTokens"]);
  assert.equal(window.__CODEX_USAGE_MONITOR_STATE__.diagnose().ok, true);
  assert.match(window.__CODEX_USAGE_MONITOR_STATE__.diagnose().strategy, /composer|editable/);

  host.shadowRoot.querySelector('input[data-setting="englishUi"]').click();
  assert.deepEqual(
    [...host.shadowRoot.querySelectorAll(".usage-column")].map((column) => column.querySelector(".usage-column-heading").textContent),
    ["Official Subscription", "API Account", "API Key"],
  );
  assert.equal(host.shadowRoot.querySelector(".usage-column-subsection-title .usage-column-heading").textContent, "Current Task");
  assert.equal(host.shadowRoot.querySelector('input[data-metric="primaryRemaining"]').closest(".usage-detail-row").querySelector(".usage-detail-label").textContent, "5-hour remaining");
  assert.equal(host.shadowRoot.querySelector('input[data-source="official"][data-metric="todayTokens"]').closest(".usage-detail-row").querySelector(".usage-detail-value").textContent, "128K");
  assert.equal(host.shadowRoot.querySelector('input[data-source="official"][data-metric="lifetimeTokens"]').closest(".usage-detail-row").querySelector(".usage-detail-value").textContent, "12M");
  assert.equal(host.shadowRoot.querySelector('input[data-source="official"][data-metric="currentTaskTokens"]').closest(".usage-detail-row").querySelector(".usage-detail-value").textContent, "38.22M");
  assert.equal(host.shadowRoot.querySelector('input[data-source="official"][data-metric="lastTurnTokens"]').closest(".usage-detail-row").querySelector(".usage-detail-value").textContent, "80K");
  assert.equal(host.shadowRoot.querySelector('input[data-source="api-account"][data-metric="todayTokens"]').closest(".usage-detail-row").querySelector(".usage-detail-value").textContent, "40K");
  assert.equal(host.shadowRoot.querySelector('input[data-source="api-account"][data-metric="totalTokens"]').closest(".usage-detail-row").querySelector(".usage-detail-value").textContent, "360K");
  host.shadowRoot.querySelector('input[data-setting="englishUi"]').click();

  window.document.getElementById("composer-wrapper").innerHTML = composerMarkup();
  await new Promise((resolve) => setTimeout(resolve, 250));
  window.__CODEX_USAGE_MONITOR_STATE__.ensure();
  host = window.document.getElementById("codex-usage-monitor");
  assert.ok(host?.shadowRoot);
  assert.equal(host.shadowRoot.querySelectorAll(".usage-summary-item").length, 7);
  assert.equal(host.shadowRoot.querySelector(".usage-refresh-ring").hidden, false);

  window.document.getElementById("composer-wrapper").innerHTML = updatedComposerMarkup();
  await new Promise((resolve) => setTimeout(resolve, 250));
  window.__CODEX_USAGE_MONITOR_STATE__.ensure();
  host = window.document.getElementById("codex-usage-monitor");
  assert.ok(host?.shadowRoot);
  assert.equal(host.hidden, false);
  assert.equal(host.dataset.anchor, "control-gap");
  assert.equal(window.__CODEX_USAGE_MONITOR_STATE__.diagnose().ok, true);
  assert.equal(window.__CODEX_USAGE_MONITOR_STATE__.diagnose().strategy, "explicit-editable");
  assert.ok(window.__CODEX_USAGE_MONITOR_STATE__.diagnose().availableWidth > 300);

  window.document.getElementById("composer-wrapper").replaceChildren();
  assert.equal(window.__CODEX_USAGE_MONITOR_STATE__.ensure(), null);
  assert.equal(window.__CODEX_USAGE_MONITOR_STATE__.diagnose().ok, false);
  assert.equal(window.__CODEX_USAGE_MONITOR_STATE__.diagnose().reason, "visible-editable-not-found");
  window.document.getElementById("composer-wrapper").innerHTML = composerMarkup();
  assert.ok(window.__CODEX_USAGE_MONITOR_STATE__.ensure()?.shadowRoot);
  assert.equal(window.__CODEX_USAGE_MONITOR_STATE__.diagnose().ok, true);

  const reinjected = window.eval(payload);
  assert.equal(reinjected.installed, true);
  assert.equal(window.__CODEX_USAGE_MONITOR_STATE__.diagnose().ok, true);

  assert.equal(window.__CODEX_USAGE_MONITOR_STATE__.cleanup(), true);
  assert.equal(window.document.getElementById("codex-usage-monitor"), null);
  assert.equal(window.__CODEX_USAGE_MONITOR_MODULES__, undefined);

  const persistedPayloads = [];
  window.__codexUsageMonitorSaveSettings = (value) => persistedPayloads.push(JSON.parse(value));
  window.localStorage.clear();
  delete window.__CODEX_USAGE_MONITOR_PERSISTED_SETTINGS__;
  window.__CODEX_USAGE_MONITOR_CONFIGURATION__ = {
    account: { configured: false, baseUrl: "https://www.cctq.ai", userId: "", baselineConfigured: false, initialTokens: "0" },
    provider: { configured: false },
  };
  window.__CODEX_USAGE_MONITOR__ = usage;
  assert.equal(window.eval(payload).installed, true);
  host = window.document.getElementById("codex-usage-monitor");
  host.shadowRoot.querySelector(".usage-summary").click();
  host.shadowRoot.querySelector('[data-configure-source="acme"]').click();
  const beginnerForm = host.shadowRoot.querySelector('[data-config-source="acme"]');
  assert.equal(beginnerForm.querySelector('[data-config-field="preset"]'), null);
  assert.equal(beginnerForm.querySelector('[data-config-field="baseUrl"]').value, "");
  assert.equal(beginnerForm.querySelector('[data-config-field="usagePath"]').value, "");
  assert.equal(beginnerForm.querySelector(".usage-config-disclosure > summary").textContent, "高级设置（通常无需修改）");
  assert.doesNotMatch(beginnerForm.textContent, /CCTQ/);
  for (const [name, value] of [["apiKey", "test-key"], ["baseUrl", "https://api.example.com"], ["usagePath", "/v1/usage"], ["authHeader", ""]]) {
    const input = beginnerForm.querySelector(`[data-config-field="${name}"]`);
    input.value = value;
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  }
  beginnerForm.requestSubmit();
  assert.equal(beginnerForm.querySelector(".usage-config-disclosure").open, true);
  assert.match(beginnerForm.querySelector('[data-config-error="authHeader"]').textContent, /不能为空/);
  host.shadowRoot.querySelector('[data-configure-source="acme"]').click();
  host.shadowRoot.querySelector(".usage-summary").click();
  assert.deepEqual(
    [...host.shadowRoot.querySelectorAll(".usage-summary-item")].map((item) => item.dataset.metric),
    ["secondaryRemaining", "currentTaskTokens"],
  );
  assert.deepEqual(
    [...host.shadowRoot.querySelectorAll('input[data-source="official"]:checked')].map((item) => item.dataset.metric),
    ["secondaryRemaining", "currentTaskTokens"],
  );
  assert.equal(host.shadowRoot.querySelectorAll('input[data-source="api-account"]:checked, input[data-source="acme"]:checked').length, 0);
  assert.ok(persistedPayloads.length >= 1);
  assert.deepEqual(persistedPayloads.at(-1).metrics, {});

  assert.equal(window.__CODEX_USAGE_MONITOR_STATE__.cleanup(), true);
  window.localStorage.clear();
  window.__CODEX_USAGE_MONITOR_PERSISTED_SETTINGS__ = {
    schemaVersion: 1,
    metrics: { official: ["lifetimeTokens"] },
    apiKeyMetricsVersion: 0,
    officialMetricsVersion: 0,
    unifiedMetricsVersion: 1,
    minimalMode: true,
    countdownVisualization: false,
    englishUi: false,
    updateNotifications: false,
  };
  window.__CODEX_USAGE_MONITOR__ = usage;
  assert.equal(window.eval(payload).installed, true);
  host = window.document.getElementById("codex-usage-monitor");
  assert.deepEqual(
    [...host.shadowRoot.querySelectorAll(".usage-summary-item")].map((item) => item.dataset.metric),
    ["lifetimeTokens"],
  );
  assert.equal(host.dataset.minimal, "true");
  host.shadowRoot.querySelector('input[data-source="official"][data-metric="secondaryRemaining"]').click();
  assert.deepEqual(persistedPayloads.at(-1).metrics.official, ["lifetimeTokens", "secondaryRemaining"]);
  assert.equal(window.__CODEX_USAGE_MONITOR_STATE__.cleanup(), true);
  delete window.__codexUsageMonitorSaveSettings;
  delete window.__CODEX_USAGE_MONITOR_PERSISTED_SETTINGS__;
} finally {
  dom.window.close();
}

console.log("PASS: unified panel, defaults, persistent settings bridge, replacement recovery, and cleanup lifecycle.");
