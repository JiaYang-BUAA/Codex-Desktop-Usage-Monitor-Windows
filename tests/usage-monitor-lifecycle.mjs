import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const payload = await fs.readFile(path.join(root, "assets", "usage-inject.js"), "utf8");

const composerMarkup = (withApproval = true) => `
  <div class="composer-surface-chrome" style="position: relative">
    <div contenteditable="true"></div>
    <button aria-label="添加文件等内容"></button>
    ${withApproval ? '<button style="color: rgb(70, 80, 90); font-size: 14px">替我审批</button>' : ""}
    <button>5.6 Sol 极高</button>
    <button aria-label="听写"></button>
    <button aria-label="发送"></button>
  </div>`;

const dom = new JSDOM(`<!doctype html>
<html class="codex-dream-skin" data-dream-shell="light">
  <head><style id="codex-dream-skin-style">html { color: pink; }</style></head>
  <body>
    <div id="codex-dream-skin-chrome"></div>
    <div id="composer-wrapper" style="position: relative">${composerMarkup()}</div>
  </body>
</html>`, {
  pretendToBeVisual: true,
  runScripts: "outside-only",
  url: "https://codex.local/",
});

const { window } = dom;
window.__CODEX_DREAM_SKIN_STATE__ = { cleanup() { delete window.__CODEX_DREAM_SKIN_STATE__; return true; } };
window.Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
  const value = (() => {
    if (this.id === "composer-wrapper" || this.matches(".composer-surface-chrome")) return { x: 100, y: 100, width: 700, height: 100 };
    if (this.id === "codex-usage-monitor") return { x: 234, y: 164, width: 380, height: 28 };
    if (this.matches('[contenteditable="true"]')) return { x: 112, y: 112, width: 676, height: 44 };
    const text = `${this.getAttribute?.("aria-label") || ""} ${this.textContent || ""}`;
    if (/添加/.test(text)) return { x: 108, y: 164, width: 28, height: 28 };
    if (/(?:替我审批|请求批准|完全访问(?:权限)?|自定义(?:\s*\(config\.toml\))?)/.test(text)) return { x: 141, y: 164, width: 85, height: 28 };
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

try {
  const result = window.eval(payload);
  assert.equal(result.installed, true);
  let host = window.document.getElementById("codex-usage-monitor");
  assert.ok(host?.shadowRoot);
  assert.equal(host.parentElement.id, "composer-wrapper");
  assert.equal(host.dataset.anchor, "approval");
  assert.equal(host.style.getPropertyValue("--usage-color"), "rgb(70, 80, 90)");
  assert.equal(host.style.getPropertyValue("--usage-font-size"), "14px");
  const approvalButton = [...window.document.querySelectorAll("button")]
    .find((button) => button.textContent.includes("替我审批"));
  assert.ok(approvalButton);
  const initialMonitorLeft = host.style.getPropertyValue("--usage-left");
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
  assert.match(host.shadowRoot.querySelector("style").textContent, /\.usage-mode-switches\s*\{[\s\S]*?display:\s*flex;/);
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
  assert.deepEqual(columns.map((column) => column.querySelector(".usage-column-title span:last-child").textContent), ["官方订阅", "API 账户", "API Key"]);
  assert.deepEqual(columns.map((column) => column.dataset.status), ["ready", "loading", "error"]);
  assert.deepEqual(columns.map((column) => column.querySelectorAll(".usage-detail-row").length), [7, 8, 4]);
  const taskSection = columns[0].querySelector(".usage-column-subsection");
  assert.ok(taskSection);
  assert.equal(taskSection.querySelector(".usage-column-title span:last-child").textContent, "本次任务相关");
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
  assert.deepEqual(columns.map((column) => column.querySelector(".usage-status").getAttribute("aria-label")), ["正常", "请求中", "请求失败"]);
  const limitedUsage = structuredClone(usage);
  limitedUsage.sources.acme.status = "rate-limited";
  limitedUsage.sources.acme.error = "Acme API 请求受限（HTTP 429），稍后自动重试";
  assert.equal(window.__CODEX_USAGE_MONITOR_STATE__.updateUsage(limitedUsage), true);
  assert.equal(host.shadowRoot.querySelector('.usage-column[data-status="rate-limited"] .usage-status').getAttribute("aria-label"), "请求受限");
  assert.equal(host.shadowRoot.querySelector('[data-source="acme"][data-metric="requestStatus"]')?.closest(".usage-detail-row")?.querySelector(".usage-detail-value")?.textContent, "请求受限");
  assert.equal(window.__CODEX_USAGE_MONITOR_STATE__.updateUsage(usage), true);
  assert.equal(host.shadowRoot.querySelectorAll('input[type="checkbox"]:checked').length, 5);
  assert.deepEqual([...columns[2].querySelectorAll(".usage-column-brand span")].map((item) => item.textContent), ["Codex Usage Monitor for Windows v1.8.4", "—— Designed by +羊 and Codex"]);
  assert.match(host.shadowRoot.querySelector("style").textContent, /\.usage-column-brand\s*\{[\s\S]*?align-self:\s*flex-end;[\s\S]*?width:\s*fit-content;[\s\S]*?font-weight:\s*450;[\s\S]*?opacity:\s*\.55;/);
  assert.match(host.shadowRoot.querySelector("style").textContent, /\.usage-brand-product\s*\{\s*font-size:\s*12px;/);
  assert.match(host.shadowRoot.querySelector("style").textContent, /\.usage-brand-credit\s*\{\s*font-size:\s*9px;\s*font-weight:\s*450;\s*text-align:\s*right;/);
  assert.equal(columns[0].querySelector(".usage-column-meta"), null);
  assert.equal(columns[1].querySelector(".usage-column-meta"), null);
  assert.equal(columns[2].querySelector(".usage-column-meta span:first-child").textContent, "最多显示 8 项");
  assert.match(host.shadowRoot.querySelector("style").textContent, /\.usage-column-meta\s*\{[\s\S]*?justify-content:\s*flex-end;/);
  assert.match(host.shadowRoot.querySelector(".usage-refresh-countdown").textContent, /^刷新 \d+秒后$/);
  assert.deepEqual([...host.shadowRoot.querySelectorAll(".usage-mode-toggle")].map((item) => item.textContent), ["极简模式", "倒计时可视化"]);
  assert.equal(host.shadowRoot.querySelectorAll('.usage-mode-toggle input[type="checkbox"]').length, 2);
  assert.equal(host.shadowRoot.querySelector('.usage-column-footer').firstElementChild.className, "usage-mode-switches");
  assert.equal(host.shadowRoot.querySelector('.usage-column-footer').lastElementChild.className, "usage-column-meta");
  assert.equal(columns[2].querySelector(".usage-column-footer").nextElementSibling, columns[2].querySelector(".usage-column-brand"));
  assert.equal(host.shadowRoot.querySelector(".usage-summary").firstElementChild.className, "usage-refresh-ring");
  assert.equal(host.shadowRoot.querySelector(".usage-refresh-ring").hidden, true);

  host.shadowRoot.querySelector('input[data-setting="minimalMode"]').click();
  assert.equal(JSON.parse(window.localStorage.getItem("codex-usage-monitor-settings-v1")).minimalMode, true);
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
  assert.deepEqual(JSON.parse(window.localStorage.getItem("codex-usage-monitor-settings-v1")).metrics["api-account"], ["balance"]);
  host.shadowRoot.querySelector('input[data-setting="minimalMode"]').click();
  assert.notEqual(host.dataset.density, "normal");

  host.shadowRoot.querySelector('input[data-setting="countdownVisualization"]').click();
  assert.equal(JSON.parse(window.localStorage.getItem("codex-usage-monitor-settings-v1")).countdownVisualization, true);
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
  assert.deepEqual(JSON.parse(window.localStorage.getItem("codex-usage-monitor-settings-v1")).metrics["api-account"], []);
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

  const saved = JSON.parse(window.localStorage.getItem("codex-usage-monitor-settings-v1"));
  assert.equal(saved.unifiedMetricsVersion, 1);
  assert.equal(saved.source, undefined);
  assert.deepEqual(saved.metrics["api-account"], ["totalTokens", "todayTokens"]);

  window.document.getElementById("composer-wrapper").innerHTML = composerMarkup();
  await new Promise((resolve) => setTimeout(resolve, 250));
  window.__CODEX_USAGE_MONITOR_STATE__.ensure();
  host = window.document.getElementById("codex-usage-monitor");
  assert.ok(host?.shadowRoot);
  assert.equal(host.shadowRoot.querySelectorAll(".usage-summary-item").length, 7);
  assert.equal(host.shadowRoot.querySelector(".usage-refresh-ring").hidden, false);

  assert.equal(window.__CODEX_USAGE_MONITOR_STATE__.cleanup(), true);
  assert.equal(window.document.getElementById("codex-usage-monitor"), null);
} finally {
  dom.window.close();
}

console.log("PASS: unified three-column panel, per-source status, global selection limit, aggregated summary, replacement recovery, and cleanup lifecycle.");
