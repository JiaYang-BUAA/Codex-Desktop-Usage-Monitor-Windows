import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { normalizeUsageView, toOfficialUsageSource } from "../scripts/usage-client.mjs";

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
    if (/(?:发送|停止)/.test(text)) return { x: 764, y: 164, width: 28, height: 28 };
    return { x: 0, y: 0, width: 0, height: 0 };
  })();
  return { ...value, right: value.x + value.width, bottom: value.y + value.height };
};

const now = Date.now();
const currentThreadId = "019fb3b1-2638-7bb0-9a90-ec83b5bca0f2";
const otherThreadId = "019fb3b1-2638-7bb0-9a90-ec83b5bca0f4";
const primaryResetsAt = new Date(2026, 6, 24, 12, 0).getTime() / 1000;
const secondaryResetsAt = new Date(2026, 6, 30, 7, 0).getTime() / 1000;
const usage = {
  schemaVersion: 2,
  currentThreadId,
  nextRefreshAt: now + 60000,
  autoResume: { enabled: false, status: "idle", resetAt: null },
  todayTokens: 128000,
  lifetimeTokens: 12000000,
  sources: {
    session: {
      id: "session", label: "本会话", accountType: "session", status: "ready", nextRefreshAt: now + 60000,
      metrics: [
        { id: "executionTime", label: "执行总耗时", display: "耗时 11分31秒", value: "11分31秒", durationMs: 691323, running: false, estimated: false, incomplete: false, sampledAt: new Date(now).toISOString(), defaultVisible: false },
        { id: "autoResume", label: "额度恢复续跑", display: "续跑 --", value: "--", defaultVisible: false },
        { id: "currentTaskTokens", label: "当前会话累计 Token", display: "会话 3822万", value: "3822万", defaultVisible: true },
        { id: "lastTurnTokens", label: "上次回答消耗 Token", display: "上次回答 8万", value: "8万", defaultVisible: false },
        { id: "cacheHitRate", label: "缓存命中率", display: "缓存 95.3%", value: "95.3%", defaultVisible: false },
        { id: "contextCompactions", label: "自动压缩上下文次数", display: "压缩 3", value: "3", defaultVisible: false },
      ],
    },
    official: {
      id: "official", label: "官方订阅", accountType: "subscription", status: "ready", nextRefreshAt: now + 60000,
      metrics: [
        { id: "primaryRemaining", label: "5小时剩余", display: "5小时 75%", value: "75%", resetsAt: primaryResetsAt, defaultVisible: true },
        { id: "secondaryRemaining", label: "7天剩余", display: "7天 44%", value: "44%", resetsAt: secondaryResetsAt, defaultVisible: false },
        { id: "primaryReset", label: "5小时重置", display: "重置 07-24 12:00", value: "07-24 12:00", defaultVisible: false },
        { id: "todayTokens", label: "今日 token", display: "今日 128k", value: "128,000", defaultVisible: true },
        { id: "last7DaysTokens", label: "近7天 Token", display: "近7天 240万", value: "240万", defaultVisible: false },
        { id: "lifetimeTokens", label: "累计 token", display: "累计 12m", value: "12,000,000", defaultVisible: false },
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
    "reset-forecast": {
      id: "reset-forecast", label: "重置概率预测（仅供参考）", accountType: "forecast", status: "ready", nextRefreshAt: now + 300000,
      resetMethod: "banked",
      latestActivity: {
        text: "Codex 使用额度已面向所有付费套餐重置。",
        createdAt: now - 3600000,
        sourceUrl: "https://x.com/thsottiaux/status/2094588317245509959",
      },
      metrics: [
        { id: "probability12h", label: "12小时内", value: "33.5%", display: "12h 33.5%" },
        { id: "probability24h", label: "24小时内", value: "55.8%", display: "24h 55.8%" },
        { id: "probability48h", label: "48小时内", value: "72.0%", display: "48h 72.0%" },
        { id: "probability72h", label: "72小时内", value: "85.2%", display: "72h 85.2%" },
      ],
    },
  },
};

window.localStorage.setItem("codex-usage-monitor-settings-v1", JSON.stringify({
  metrics: {
    official: ["primaryRemaining", "currentTaskTokens"],
    "api-account": ["balance"],
    acme: ["usedAmount", "quotaLimit"],
  },
  minimalMode: false,
  countdownVisualization: false,
  autoResume: false,
  unifiedMetricsVersion: 1,
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
  assert.equal(host.hidden, false);
  assert.equal(window.__CODEX_USAGE_MONITOR_STATE__.diagnose().ok, true);
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
  assert.match(host.shadowRoot.querySelector("style").textContent, /\.usage-popover\s*\{[\s\S]*?width:\s*max-content;/);
  assert.match(host.shadowRoot.querySelector("style").textContent, /:host\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?top:\s*var\(--usage-top/);
  assert.match(host.shadowRoot.querySelector("style").textContent, /\.usage-column\s*\{[\s\S]*?box-sizing:\s*border-box;[\s\S]*?width:\s*100%;/);
  assert.doesNotMatch(host.shadowRoot.querySelector("style").textContent, /usage-column \+ \.usage-column\s*\{[^}]*border-left/);
  assert.match(host.shadowRoot.querySelector("style").textContent, /\.usage-columns\s*\{[\s\S]*?grid-template-columns:\s*var\(--usage-column-widths, repeat\(var\(--usage-column-count, 4\), minmax\(230px, 1fr\)\)\);/);
  assert.match(host.shadowRoot.querySelector("style").textContent, /\.usage-popover\s*\{[\s\S]*?overflow-x:\s*hidden;/);
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
  assert.match(host.shadowRoot.querySelector("style").textContent, /\.usage-mode-switches\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);[\s\S]*?grid-auto-flow:\s*row;[\s\S]*?width:\s*100%;/);
  assert.doesNotMatch(host.shadowRoot.querySelector("style").textContent, /\.usage-mode-toggle-api/);
  assert.match(host.shadowRoot.querySelector("style").textContent, /\.usage-mode-toggle\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) 24px;/);
  assert.match(host.shadowRoot.querySelector("style").textContent, /\.usage-inline-toggle\s*\{[^}]*width:\s*24px;[^}]*height:\s*14px;/);
  assert.match(host.shadowRoot.querySelector("style").textContent, /\.usage-summary-toggle\s*\{\s*flex:\s*0 0 24px;/);
  assert.match(host.shadowRoot.querySelector("style").textContent, /\.usage-mode-toggle input:checked \+ \.usage-toggle-track,\s*\.usage-inline-toggle input:checked \+ \.usage-toggle-track\s*\{[^}]*border-color:\s*#86efac;[^}]*background:\s*#86efac;/);
  assert.match(host.shadowRoot.querySelector("style").textContent, /\.usage-mode-toggle input:checked \+ \.usage-toggle-track::after,\s*\.usage-inline-toggle input:checked \+ \.usage-toggle-track::after\s*\{[^}]*background:\s*#166534;[^}]*transform:\s*translateX\(10px\);/);
  assert.match(host.shadowRoot.querySelector("style").textContent, /\.usage-settings-trigger\s*\{[^}]*border:\s*1px solid currentColor;/);
  assert.match(host.shadowRoot.querySelector("style").textContent, /@media \(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.usage-toggle-track::after\s*\{\s*transition:\s*none;/);
  assert.match(host.shadowRoot.querySelector("style").textContent, /\.usage-refresh-ring\s*\{[\s\S]*?top:\s*0;[\s\S]*?width:\s*13px;[\s\S]*?border:\s*1\.5px solid currentColor;[\s\S]*?background:\s*transparent;/);
  assert.match(host.shadowRoot.querySelector("style").textContent, /\.usage-refresh-ring::before\s*\{[\s\S]*?top:\s*-3px;[\s\S]*?width:\s*3px;[\s\S]*?height:\s*3px;[\s\S]*?background:\s*currentColor/);
  assert.match(host.shadowRoot.querySelector("style").textContent, /\.usage-refresh-ring::after\s*\{[\s\S]*?width:\s*1\.5px;[\s\S]*?height:\s*calc\(50% \+ \.5px\);[\s\S]*?background:\s*#22c55e;[\s\S]*?transform:\s*rotate\(var\(--usage-refresh-progress\)\);[\s\S]*?transform-origin:\s*50% 100%;/);

  assert.equal(window.__CODEX_USAGE_MONITOR_STATE__.updateUsage(usage), true);
  assert.notEqual(host.dataset.density, "normal");
  assert.deepEqual([...host.shadowRoot.querySelectorAll(".usage-summary-item")].map((item) => item.textContent), ["会话3822万", "5时75%", "余额¥20", "已用¥5", "限额不限"]);

  host.shadowRoot.querySelector(".usage-summary").click();
  assert.equal(host.shadowRoot.querySelector(".usage-popover").hidden, false);
  const columns = [...host.shadowRoot.querySelectorAll(".usage-column")];
  assert.equal(columns.length, 6);
  assert.equal(host.dataset.columnCount, "6");
  assert.equal(host.style.getPropertyValue("--usage-column-widths"), "230px 230px 160px 400px 230px 170px");
  assert.equal(host.style.getPropertyValue("--usage-popover-width"), "1460px");
  assert.equal(host.style.getPropertyValue("--usage-popover-shift"), "-698px");
  assert.deepEqual(columns.map((column) => column.querySelector(".usage-column-heading").textContent), ["本会话", "官方订阅", "重置概率预测（仅供参考）", "额度对应 Token", "API 账户", "API Key"]);
  assert.deepEqual(columns.map((column) => column.dataset.status), ["ready", "ready", "ready", "loading", "loading", "error"]);
  assert.deepEqual(columns.map((column) => column.querySelectorAll(".usage-detail-row").length), [7, 6, 4, 1, 8, 4]);
  const tiboActivity = columns[2].querySelector(".usage-tibo-activity");
  assert.equal(tiboActivity.querySelector(".usage-tibo-activity-label").textContent, "Tibo 最新动态");
  assert.equal(host.shadowRoot.querySelector(".usage-reset-method").textContent, "预告方式：发放重置卡");
  assert.equal(tiboActivity.querySelector(".usage-tibo-activity-text").textContent, "Codex 使用额度已面向所有付费套餐重置。");
  assert.equal(tiboActivity.querySelector(".usage-tibo-activity-link").textContent, "打开 X");
  assert.equal(tiboActivity.querySelector(".usage-tibo-activity-link").href, "https://x.com/thsottiaux/status/2094588317245509959");
  assert.match(tiboActivity.querySelector(".usage-tibo-activity-time").textContent, /^发布于 \d{2}-\d{2} \d{2}:\d{2}$/);
  assert.match(host.shadowRoot.querySelector("style").textContent, /\.usage-tibo-activity-text\s*\{[\s\S]*?-webkit-line-clamp:\s*3;/);
  assert.deepEqual([...columns[0].querySelectorAll('input[data-source="session"][data-metric]')].map((input) => input.dataset.metric), ["currentTaskTokens", "lastTurnTokens", "cacheHitRate", "lastTurnCacheHitRate", "contextCompactions", "executionTime", "autoResume"]);
  assert.equal(columns[0].querySelector('[data-metric="executionTime"]').closest(".usage-detail-row").querySelector(".usage-detail-label").textContent, "执行总耗时");
  assert.equal(columns[0].querySelector('[data-metric="executionTime"]').closest(".usage-detail-row").querySelector(".usage-detail-value").textContent, "11分31秒");
  assert.equal(host.shadowRoot.querySelector('[data-metric="currentStatus"]'), null);
  assert.equal(columns[0].querySelector('[data-metric="currentTaskTokens"]').closest(".usage-detail-row").querySelector(".usage-detail-label").textContent, "当前会话累计 Token");
  assert.equal(columns[0].querySelector('[data-metric="currentTaskTokens"]').closest(".usage-detail-row").querySelector(".usage-detail-value").textContent, "3822万");
  assert.equal(columns[0].querySelector('[data-metric="lastTurnTokens"]').closest(".usage-detail-row").querySelector(".usage-detail-label").textContent, "上次回答消耗 Token");
  assert.equal(columns[0].querySelector('[data-metric="lastTurnTokens"]').closest(".usage-detail-row").querySelector(".usage-detail-value").textContent, "8万");
  assert.equal(columns[0].querySelector('[data-metric="cacheHitRate"]').closest(".usage-detail-row").querySelector(".usage-detail-label").textContent, "总缓存命中率");
  assert.equal(columns[0].querySelector('[data-metric="cacheHitRate"]').closest(".usage-detail-row").querySelector(".usage-detail-value").textContent, "95.3%");
  assert.equal(columns[0].querySelector('[data-metric="lastTurnCacheHitRate"]').closest(".usage-detail-row").querySelector(".usage-detail-label").textContent, "上次回答缓存命中率");
  const quotaUsage = structuredClone(usage);
  quotaUsage.sources["quota-token"] = {
    id: "quota-token", accountType: "quota-token", status: "ready",
    metrics: [
      { id: "wholeEstimateTokens", label: "推算 100% 周额度 Token", value: "≈4000万", detail: "按已观测比例外推；覆盖 5 个百分点" },
      ...Array.from({ length: 10 }, (_, index) => ({ id: `band${100-index*10}To${90-index*10}Tokens`,
        label: `${100-index*10}%→${90-index*10}%`, value: "≈400万", detail: "实测 200万 / 5 个百分点" })),
    ],
  };
  quotaUsage.sources.session.metrics.push({ id: "lastTurnCacheHitRate", label: "上次回答缓存命中率", value: "97.24%" });
  assert.equal(window.__CODEX_USAGE_MONITOR_STATE__.updateUsage(quotaUsage), true);
  const quotaColumn = host.shadowRoot.querySelector('.usage-column[data-source="quota-token"]');
  const bandColumns = [...quotaColumn.querySelectorAll('.usage-quota-bands > .usage-column-rows')];
  assert.deepEqual(bandColumns.map(column => column.querySelectorAll('.usage-detail-row').length), [5, 5]);
  assert.equal(bandColumns[0].querySelector('input').dataset.metric, "band100To90Tokens");
  assert.equal(bandColumns[1].querySelector('input').dataset.metric, "band50To40Tokens");
  assert.equal(quotaColumn.querySelector('[data-metric="band80To70Tokens"]').closest(".usage-detail-row").querySelector(".usage-quota-detail").textContent, "实测 200万 / 5 个百分点");
  assert.equal(quotaColumn.querySelector('[data-metric="wholeEstimateTokens"]').closest(".usage-detail-row").querySelector(".usage-detail-value").textContent, "≈4000万");
  assert.match(quotaColumn.querySelector(".usage-quota-note").textContent, /非官方上限/);
  assert.equal(host.shadowRoot.querySelector('[data-metric="lastTurnCacheHitRate"]').closest(".usage-detail-row").querySelector(".usage-detail-value").textContent, "97.24%");
  assert.equal(window.__CODEX_USAGE_MONITOR_STATE__.updateUsage(usage), true);

  assert.equal(columns[0].querySelector('[data-metric="contextCompactions"]').closest(".usage-detail-row").querySelector(".usage-detail-label").textContent, "自动压缩上下文次数");
  assert.equal(columns[0].querySelector('[data-metric="contextCompactions"]').closest(".usage-detail-row").querySelector(".usage-detail-value").textContent, "3");
  assert.equal(columns[1].querySelector('[data-metric="primaryRemaining"]').closest(".usage-detail-row").querySelector(".usage-detail-label").textContent, "5小时剩余");
  assert.equal(columns[1].querySelector('[data-metric="secondaryRemaining"]').closest(".usage-detail-row").querySelector(".usage-detail-label").textContent, "7天剩余");
  assert.equal(columns[1].querySelector('[data-metric="primaryRemaining"]').closest(".usage-detail-row").querySelector(".usage-detail-value").textContent, "07-24 12:00重置 · 75%");
  assert.equal(columns[1].querySelector('[data-metric="secondaryRemaining"]').closest(".usage-detail-row").querySelector(".usage-detail-value").textContent, "07-30 07:00重置 · 44%");
  assert.equal(columns[1].querySelector('[data-metric="todayTokens"]').closest(".usage-detail-row").querySelector(".usage-detail-value").textContent, "13万");
  assert.equal(columns[1].querySelector('[data-metric="last7DaysTokens"]').closest(".usage-detail-row").querySelector(".usage-detail-value").textContent, "240万");
  assert.equal(columns[1].querySelector('[data-metric="lifetimeTokens"]').closest(".usage-detail-row").querySelector(".usage-detail-value").textContent, "1200万");
  assert.equal(columns[1].querySelector('[data-metric="requestStatus"]'), null);
  const usageWithoutTaskMetrics = structuredClone(usage);
  usageWithoutTaskMetrics.sources.session.status = "unavailable";
  usageWithoutTaskMetrics.sources.session.metrics = [];
  assert.equal(window.__CODEX_USAGE_MONITOR_STATE__.updateUsage(usageWithoutTaskMetrics), true);
  const unavailableSessionColumn = host.shadowRoot.querySelector('.usage-column[data-status="unavailable"]');
  assert.ok(unavailableSessionColumn);
  assert.equal(unavailableSessionColumn.querySelector(".usage-status").getAttribute("aria-label"), "暂无数据");
  assert.deepEqual([...unavailableSessionColumn.querySelectorAll(".usage-detail-value")].map((item) => item.textContent), ["--", "--", "--", "--", "--", "--"]);
  assert.equal(window.__CODEX_USAGE_MONITOR_STATE__.updateUsage(usage), true);
  assert.deepEqual(columns.map((column) => column.querySelector(".usage-status").getAttribute("aria-label")), ["正常", "正常", "正常", "请求中", "请求中", "请求失败"]);
  const limitedUsage = structuredClone(usage);
  limitedUsage.sources.acme.status = "rate-limited";
  limitedUsage.sources.acme.error = "Acme API 请求受限（HTTP 429），稍后自动重试";
  assert.equal(window.__CODEX_USAGE_MONITOR_STATE__.updateUsage(limitedUsage), true);
  assert.equal(host.shadowRoot.querySelector('.usage-column[data-status="rate-limited"] .usage-status').getAttribute("aria-label"), "请求受限");
  assert.equal(host.shadowRoot.querySelector('[data-source="acme"][data-metric="requestStatus"]')?.closest(".usage-detail-row")?.querySelector(".usage-detail-value")?.textContent, "请求受限");
  assert.equal(window.__CODEX_USAGE_MONITOR_STATE__.updateUsage(usage), true);
  assert.equal(host.shadowRoot.querySelectorAll('input[data-metric]:checked').length, 5);
  assert.deepEqual([...columns[1].querySelectorAll(".usage-column-brand > *")].map((item) => item.textContent), ["Codex Usage Monitor for Windows v3.1.0", "—— Designed by +羊 and Codex"]);
  assert.match(host.shadowRoot.querySelector("style").textContent, /\.usage-column-brand\s*\{[\s\S]*?align-self:\s*flex-end;[\s\S]*?width:\s*fit-content;[\s\S]*?margin:\s*0 8px 0 0;[\s\S]*?font-weight:\s*450;[\s\S]*?opacity:\s*\.55;/);
  assert.match(host.shadowRoot.querySelector("style").textContent, /\.usage-brand-product\s*\{[^}]*font-size:\s*12px;/);
  assert.match(host.shadowRoot.querySelector("style").textContent, /\.usage-brand-credit\s*\{\s*font-size:\s*9px;\s*font-weight:\s*450;\s*text-align:\s*right;/);
  assert.equal(columns[0].querySelector(".usage-column-meta"), null);
  assert.equal(columns[1].querySelector(".usage-column-meta span:first-of-type").textContent, "最多显示 8 项");
  assert.equal(columns[2].querySelector(".usage-column-meta"), null);
  assert.match(host.shadowRoot.querySelector("style").textContent, /\.usage-column-meta\s*\{[\s\S]*?justify-content:\s*flex-end;/);
  assert.match(host.shadowRoot.querySelector(".usage-refresh-countdown").textContent, /^刷新 \d+秒后$/);
  assert.equal(host.shadowRoot.querySelector(".usage-mode-switches").hidden, true);
  assert.equal(host.shadowRoot.querySelector("[data-toggle-settings]").textContent, "设置");
  host.shadowRoot.querySelector("[data-toggle-settings]").click();
  assert.equal(host.shadowRoot.querySelector(".usage-mode-switches").hidden, false);
  assert.deepEqual([...host.shadowRoot.querySelectorAll(".usage-mode-toggle")].map((item) => item.textContent), ["极简模式", "倒计时可视化", "English UI", "自动更新", "API 栏", "重置概率预测栏", "额度对应 Token 栏"]);
  assert.equal(host.shadowRoot.querySelectorAll('.usage-mode-toggle input[type="checkbox"]').length, 7);
  assert.equal(host.shadowRoot.querySelectorAll(".usage-mode-switches > .usage-mode-toggle").length, 7);
  assert.equal(host.shadowRoot.querySelector(".usage-mode-toggle-api"), null);
  assert.equal(host.shadowRoot.querySelector('input[data-setting="autoResume"]').checked, false);
  assert.equal(host.shadowRoot.querySelector('input[data-setting="autoResume"]').title, "自动续跑已启用");
  assert.equal(host.shadowRoot.querySelector('input[data-setting="autoResume"]').closest(".usage-column").querySelector(".usage-column-heading").textContent, "本会话");
  assert.equal(host.shadowRoot.querySelector('[data-setting-text="autoResumeMessage"]').value, "继续");
  assert.equal(host.shadowRoot.querySelector('[data-setting-text="autoResumeMessage"]').closest(".usage-auto-resume-field").querySelector(".usage-auto-resume-label").textContent, "续跑发送内容");
  assert.equal(host.shadowRoot.querySelectorAll('.usage-column:nth-child(2) .usage-mode-toggle input[type="checkbox"]').length, 7);
  const autoResumeMetric = host.shadowRoot.querySelector('input[data-source="session"][data-metric="autoResume"]');
  assert.equal(autoResumeMetric.checked, false);
  assert.equal(autoResumeMetric.closest(".usage-detail-row").nextElementSibling.className, "usage-auto-resume-field");
  autoResumeMetric.click();
  let summaryResume = host.shadowRoot.querySelector('.usage-summary-item[data-metric="autoResume"]');
  assert.equal(summaryResume.textContent, "续跑");
  assert.equal(summaryResume.querySelector('input[data-summary-setting="autoResume"]').checked, false);
  summaryResume.querySelector('input[data-summary-setting="autoResume"]').click();
  assert.equal(JSON.parse(window.localStorage.getItem("codex-usage-monitor-settings-v2")).autoResumeThreads[currentThreadId].enabled, true);
  assert.equal(host.shadowRoot.querySelector(".usage-popover").hidden, false);
  assert.equal(host.shadowRoot.querySelector('.usage-detail-row input[data-setting="autoResume"]').checked, true);
  summaryResume = host.shadowRoot.querySelector('.usage-summary-item[data-metric="autoResume"]');
  summaryResume.querySelector('input[data-summary-setting="autoResume"]').click();
  assert.equal(JSON.parse(window.localStorage.getItem("codex-usage-monitor-settings-v2")).autoResumeThreads[currentThreadId].enabled, false);
  assert.equal(host.shadowRoot.querySelector(".usage-popover").hidden, false);
  host.shadowRoot.querySelector('input[data-setting="minimalMode"]').click();
  summaryResume = host.shadowRoot.querySelector('.usage-summary-item[data-metric="autoResume"]');
  assert.equal(summaryResume.textContent, "");
  assert.ok(summaryResume.querySelector('input[data-summary-setting="autoResume"]'));
  host.shadowRoot.querySelector('input[data-setting="minimalMode"]').click();
  assert.equal(host.shadowRoot.querySelector('.usage-summary-item[data-metric="autoResume"]').textContent, "续跑");
  host.shadowRoot.querySelector('input[data-source="session"][data-metric="autoResume"]').click();
  assert.equal(host.shadowRoot.querySelector('.usage-column-footer').firstElementChild.className, "usage-mode-switches");
  assert.equal(host.shadowRoot.querySelector('.usage-column-footer').lastElementChild.className, "usage-column-meta");
  assert.equal(columns[1].querySelector(".usage-column-footer").nextElementSibling, columns[1].querySelector(".usage-column-brand"));
  host.shadowRoot.querySelector('input[data-setting="showApiColumns"]').click();
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.deepEqual([...host.shadowRoot.querySelectorAll(".usage-column-heading")].map((item) => item.textContent), ["本会话", "官方订阅", "重置概率预测（仅供参考）", "额度对应 Token"]);
  assert.equal(host.shadowRoot.querySelector(".usage-columns").style.getPropertyValue("--usage-column-count"), "4");
  assert.equal(host.style.getPropertyValue("--usage-column-widths"), "230px 230px 160px 400px");
  assert.equal(host.style.getPropertyValue("--usage-popover-width"), "1060px");
  assert.equal(host.style.getPropertyValue("--usage-popover-shift"), "-298px");
  assert.equal(host.shadowRoot.querySelector('.usage-column[data-status="ready"] + .usage-column .usage-column-footer') !== null, true);
  assert.equal(JSON.parse(window.localStorage.getItem("codex-usage-monitor-settings-v2")).showApiColumns, false);
  host.shadowRoot.querySelector('input[data-setting="showResetForecast"]').click();
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.deepEqual([...host.shadowRoot.querySelectorAll(".usage-column-heading")].map((item) => item.textContent), ["本会话", "官方订阅", "额度对应 Token"]);
  assert.equal(host.style.getPropertyValue("--usage-column-widths"), "230px 230px 400px");
  assert.equal(host.style.getPropertyValue("--usage-popover-width"), "900px");
  assert.equal(host.style.getPropertyValue("--usage-popover-shift"), "-138px");
  host.shadowRoot.querySelector('input[data-setting="showApiColumns"]').click();
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.deepEqual([...host.shadowRoot.querySelectorAll(".usage-column-heading")].map((item) => item.textContent), ["本会话", "官方订阅", "额度对应 Token", "API 账户", "API Key"]);
  assert.equal(host.style.getPropertyValue("--usage-column-widths"), "230px 230px 400px 230px 170px");
  assert.equal(host.style.getPropertyValue("--usage-popover-width"), "1300px");
  assert.equal(host.style.getPropertyValue("--usage-popover-shift"), "-538px");
  assert.equal(JSON.parse(window.localStorage.getItem("codex-usage-monitor-settings-v2")).showApiColumns, true);
  host.shadowRoot.querySelector('input[data-setting="showResetForecast"]').click();
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(host.shadowRoot.querySelectorAll(".usage-column").length, 6);
  assert.equal(host.style.getPropertyValue("--usage-column-widths"), "230px 230px 160px 400px 230px 170px");
  assert.equal(JSON.parse(window.localStorage.getItem("codex-usage-monitor-settings-v2")).showResetForecast, true);
  host.shadowRoot.querySelector('input[data-setting="showQuotaToken"]').click();
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.equal(host.shadowRoot.querySelector('.usage-column[data-source="quota-token"]'), null);
  assert.equal(host.style.getPropertyValue("--usage-column-widths"), "230px 230px 160px 230px 170px");
  assert.equal(JSON.parse(window.localStorage.getItem("codex-usage-monitor-settings-v2")).showQuotaToken, false);
  host.shadowRoot.querySelector('input[data-setting="showQuotaToken"]').click();
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.ok(host.shadowRoot.querySelector('.usage-column[data-source="quota-token"]'));
  assert.equal(JSON.parse(window.localStorage.getItem("codex-usage-monitor-settings-v2")).showQuotaToken, true);
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
  assert.equal(host.shadowRoot.querySelector(".usage-column-meta span:first-of-type").textContent, "极简最多 14 项");
  assert.deepEqual([...host.shadowRoot.querySelectorAll(".usage-summary-item")].map((item) => item.textContent), ["3822万", "75%", "¥20", "¥5", "不限"]);
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

  const proUsage = structuredClone(usage);
  proUsage.sources.official = toOfficialUsageSource(normalizeUsageView({
    rateLimits: { limitId: "codex", planType: "pro", primary: { usedPercent: 56, windowDurationMins: 10080, resetsAt: secondaryResetsAt } },
    rateLimitsByLimitId: { codex_bengalfox: { limitId: "codex_bengalfox", primary: { usedPercent: 0, windowDurationMins: 300, resetsAt: primaryResetsAt } } },
  }, null));
  window.__CODEX_USAGE_MONITOR_STATE__.updateUsage(proUsage);
  const primaryCheckbox = () => host.shadowRoot.querySelector('input[data-source="official"][data-metric="primaryRemaining"]');
  const primarySummary = () => host.shadowRoot.querySelector('.usage-summary-item[data-source="official"][data-metric="primaryRemaining"]');
  assert.ok(primaryCheckbox(), "Pro retains the 5h row and checkbox");
  assert.equal(primaryCheckbox().checked, true, "saved selection survives");
  assert.equal(primaryCheckbox().closest('.usage-detail-row').querySelector('.usage-detail-value').textContent, "--");
  assert.equal(primarySummary().textContent, "5时--");
  host.shadowRoot.querySelector('input[data-setting="minimalMode"]').click();
  assert.equal(primarySummary().textContent, "--");
  host.shadowRoot.querySelector('input[data-setting="minimalMode"]').click();
  window.__CODEX_USAGE_MONITOR_STATE__.updateUsage(usage);
  assert.equal(primarySummary().textContent, "5时75%", "other plans resume their normal value");

  const resumeMessageInput = host.shadowRoot.querySelector('[data-setting-text="autoResumeMessage"]');
  resumeMessageInput.value = "请继续完成当前任务";
  resumeMessageInput.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.equal(JSON.parse(window.localStorage.getItem("codex-usage-monitor-settings-v2")).autoResumeThreads[currentThreadId].message, "请继续完成当前任务");
  host.shadowRoot.querySelector('input[data-setting="autoResume"]').click();
  assert.equal(JSON.parse(window.localStorage.getItem("codex-usage-monitor-settings-v2")).autoResumeThreads[currentThreadId].enabled, true);

  const otherUsage = structuredClone(usage);
  otherUsage.currentThreadId = otherThreadId;
  assert.equal(window.__CODEX_USAGE_MONITOR_STATE__.updateUsage(otherUsage), true);
  assert.equal(host.shadowRoot.querySelector('input[data-setting="autoResume"]').checked, false);
  host.shadowRoot.querySelector('input[data-setting="autoResume"]').click();
  const otherMessageInput = host.shadowRoot.querySelector('[data-setting-text="autoResumeMessage"]');
  otherMessageInput.value = "继续 B";
  otherMessageInput.dispatchEvent(new window.Event("change", { bubbles: true }));
  const independentSettings = JSON.parse(window.localStorage.getItem("codex-usage-monitor-settings-v2"));
  assert.equal(independentSettings.autoResumeThreads[currentThreadId].enabled, true);
  assert.equal(independentSettings.autoResumeThreads[currentThreadId].message, "请继续完成当前任务");
  assert.equal(independentSettings.autoResumeThreads[otherThreadId].enabled, true);
  assert.equal(independentSettings.autoResumeThreads[otherThreadId].message, "继续 B");
  assert.equal(window.__CODEX_USAGE_MONITOR_STATE__.updateUsage(usage), true);
  assert.equal(host.shadowRoot.querySelector('input[data-setting="autoResume"]').checked, true);
  assert.equal(host.shadowRoot.querySelector('[data-setting-text="autoResumeMessage"]').value, "请继续完成当前任务");

  const sharedSelector = 'input[data-setting="autoResumeSharedMessage"]';
  window.__CODEX_USAGE_MONITOR_STATE__.updateUsage({ ...usage, autoResume: {status: "waiting", reason: "desktop-send-timeout"} });
  assert.equal(host.shadowRoot.querySelector('.usage-auto-resume-error').textContent, "续跑发送超时，等待重试");
  window.__CODEX_USAGE_MONITOR_STATE__.updateUsage(usage);
  assert.equal(host.shadowRoot.querySelector('.usage-auto-resume-error'), null);
  assert.equal(host.shadowRoot.querySelector(sharedSelector).checked, false);
  host.shadowRoot.querySelector(sharedSelector).click();
  const sharedMessageInput = host.shadowRoot.querySelector('[data-setting-text="autoResumeMessage"]');
  sharedMessageInput.value = "所有对话继续";
  sharedMessageInput.dispatchEvent(new window.Event("change", { bubbles: true }));
  window.__CODEX_USAGE_MONITOR_STATE__.updateUsage({ ...usage, currentThreadId: otherThreadId });
  assert.equal(host.shadowRoot.querySelector('[data-setting-text="autoResumeMessage"]').value, "所有对话继续");
  host.shadowRoot.querySelector('input[data-setting="autoResume"]').click();
  assert.equal(JSON.parse(window.localStorage.getItem("codex-usage-monitor-settings-v2")).autoResumeThreads[otherThreadId].message, "继续 B");
  host.shadowRoot.querySelector('input[data-setting="autoResume"]').click();
  host.shadowRoot.querySelector(sharedSelector).click();
  assert.equal(host.shadowRoot.querySelector('[data-setting-text="autoResumeMessage"]').value, "所有对话继续");
  const retainedSettings = JSON.parse(window.localStorage.getItem("codex-usage-monitor-settings-v2"));
  assert.equal(retainedSettings.autoResumeThreads[currentThreadId].message, "所有对话继续");
  assert.equal(retainedSettings.autoResumeThreads[otherThreadId].message, "所有对话继续");
  const independentMessage = host.shadowRoot.querySelector('[data-setting-text="autoResumeMessage"]');
  independentMessage.value = "B 单独修改";
  independentMessage.dispatchEvent(new window.Event("change", { bubbles: true }));
  window.__CODEX_USAGE_MONITOR_STATE__.updateUsage(usage);
  assert.equal(host.shadowRoot.querySelector('[data-setting-text="autoResumeMessage"]').value, "所有对话继续");
  const currentMessage = host.shadowRoot.querySelector('[data-setting-text="autoResumeMessage"]');
  currentMessage.value = "请继续完成当前任务";
  currentMessage.dispatchEvent(new window.Event("change", { bubbles: true }));
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
  assert.deepEqual(
    [...host.shadowRoot.querySelectorAll(".usage-summary-item")].map((item) => `${item.dataset.source}:${item.dataset.metric}`),
    [
      "session:currentTaskTokens",
      "official:primaryRemaining",
      "acme:usedAmount",
      "acme:quotaLimit",
      "api-account:balance",
      "api-account:totalTokens",
      "api-account:todayTokens",
      "acme:expiresAt",
    ],
  );
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
  assert.equal(saved.unifiedMetricsVersion, 2);
  assert.equal(saved.source, undefined);
  assert.deepEqual(saved.metrics["api-account"], ["totalTokens", "todayTokens"]);
  assert.deepEqual(saved.metricOrder, [
    "session:currentTaskTokens",
    "official:primaryRemaining",
    "acme:usedAmount",
    "acme:quotaLimit",
    "api-account:totalTokens",
    "api-account:todayTokens",
    "acme:expiresAt",
  ]);
  assert.equal(window.__CODEX_USAGE_MONITOR_STATE__.diagnose().ok, true);
  assert.match(window.__CODEX_USAGE_MONITOR_STATE__.diagnose().strategy, /composer|editable/);

  host.shadowRoot.querySelector('input[data-setting="englishUi"]').click();
  assert.deepEqual(
    [...host.shadowRoot.querySelectorAll(".usage-column")].map((column) => column.querySelector(".usage-column-heading").textContent),
    ["Session", "Official Subscription", "Reset Probability (FYI)", "Quota to Tokens", "API Account", "API Key"],
  );
  assert.equal(host.shadowRoot.querySelector(".usage-tibo-activity-label").textContent, "Latest from Tibo");
  assert.equal(host.shadowRoot.querySelector(".usage-reset-method").textContent, "Announced type: Reset credit");
  assert.equal(host.shadowRoot.querySelector(".usage-tibo-activity-link").textContent, "Open X");
  assert.equal(host.shadowRoot.querySelector('input[data-metric="primaryRemaining"]').closest(".usage-detail-row").querySelector(".usage-detail-label").textContent, "5-hour remaining");
  assert.equal(host.shadowRoot.querySelector('input[data-metric="primaryRemaining"]').closest(".usage-detail-row").querySelector(".usage-detail-value").textContent, "resets 07-24 12:00 · 75%");
  assert.equal(host.shadowRoot.querySelector('input[data-metric="secondaryRemaining"]').closest(".usage-detail-row").querySelector(".usage-detail-value").textContent, "resets 07-30 07:00 · 44%");
  assert.equal(host.shadowRoot.querySelector('input[data-source="official"][data-metric="todayTokens"]').closest(".usage-detail-row").querySelector(".usage-detail-value").textContent, "128K");
  assert.equal(host.shadowRoot.querySelector('input[data-source="official"][data-metric="lifetimeTokens"]').closest(".usage-detail-row").querySelector(".usage-detail-value").textContent, "12M");
  assert.equal(host.shadowRoot.querySelector('input[data-source="session"][data-metric="currentTaskTokens"]').closest(".usage-detail-row").querySelector(".usage-detail-label").textContent, "Current session tokens");
  assert.equal(host.shadowRoot.querySelector('input[data-source="session"][data-metric="executionTime"]').closest(".usage-detail-row").querySelector(".usage-detail-label").textContent, "Total execution time");
  assert.equal(host.shadowRoot.querySelector('input[data-source="session"][data-metric="executionTime"]').closest(".usage-detail-row").querySelector(".usage-detail-value").textContent, "11m31s");
  assert.equal(host.shadowRoot.querySelector('input[data-source="session"][data-metric="autoResume"]').closest(".usage-detail-row").querySelector(".usage-detail-label").textContent, "Resume after reset");
  assert.equal(host.shadowRoot.querySelector('[data-setting-text="autoResumeMessage"]').closest(".usage-auto-resume-field").querySelector(".usage-auto-resume-label").textContent, "Resume message");
  assert.equal(host.shadowRoot.querySelector('[data-setting-text="autoResumeMessage"]').value, "请继续完成当前任务");
  assert.equal(host.shadowRoot.querySelector('input[data-source="session"][data-metric="currentTaskTokens"]').closest(".usage-detail-row").querySelector(".usage-detail-value").textContent, "38.22M");
  assert.equal(host.shadowRoot.querySelector('input[data-source="session"][data-metric="lastTurnTokens"]').closest(".usage-detail-row").querySelector(".usage-detail-label").textContent, "Last answer tokens");
  assert.equal(host.shadowRoot.querySelector('input[data-source="session"][data-metric="cacheHitRate"]').closest(".usage-detail-row").querySelector(".usage-detail-label").textContent, "Total cache hit rate");
  assert.equal(host.shadowRoot.querySelector('input[data-source="official"][data-metric="last7DaysTokens"]').closest(".usage-detail-row").querySelector(".usage-detail-label").textContent, "Tokens in last 7 days");
  assert.equal(host.shadowRoot.querySelector('input[data-source="official"][data-metric="last7DaysTokens"]').closest(".usage-detail-row").querySelector(".usage-detail-value").textContent, "2.4M");
  assert.equal(host.shadowRoot.querySelector('input[data-source="session"][data-metric="lastTurnTokens"]').closest(".usage-detail-row").querySelector(".usage-detail-value").textContent, "80K");
  assert.equal(host.shadowRoot.querySelector('input[data-source="session"][data-metric="contextCompactions"]').closest(".usage-detail-row").querySelector(".usage-detail-label").textContent, "Automatic context compactions");
  assert.equal(host.shadowRoot.querySelector('input[data-source="session"][data-metric="contextCompactions"]').closest(".usage-detail-row").querySelector(".usage-detail-value").textContent, "3");
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

  // Goal/plan mode chips occupy the old permission-adjacent anchor.
  const modeComposer = window.document.querySelector('.composer-surface-chrome');
  const modeChips = [];
  for (const specs of [[['计划模式', 228, 80]], [['目标', 228, 110]], [['计划模式', 228, 80], ['目标', 312, 90]]]) {
    for (const chip of modeChips.splice(0)) chip.remove();
    for (const [label, x, width] of specs) {
      const chip = window.document.createElement('button');
      chip.textContent = label;
      chip.getBoundingClientRect = () => ({ x, y: 164, width, height: 28, right: x + width, bottom: 192 });
      modeComposer.append(chip);
      modeChips.push(chip);
    }
    window.__CODEX_USAGE_MONITOR_STATE__.ensure();
    assert.equal(host.hidden, false, 'mode chips should use the available gap to their right');
    assert.equal(host.dataset.anchor, 'right-control-gap');
    const left = Number.parseFloat(host.style.getPropertyValue('--usage-left'));
    const width = Number.parseFloat(host.style.getPropertyValue('--usage-max-width'));
    assert.equal(left, Math.max(...specs.map(([, x, width]) => x + width)) + 8);
    assert.ok(left + width <= 622 - 8, 'monitor must not overlap the model selector');
  }
  for (const chip of modeChips) chip.remove();
  window.__CODEX_USAGE_MONITOR_STATE__.ensure();
  assert.equal(host.dataset.anchor, 'approval');
  assert.equal(host.style.getPropertyValue('--usage-left'), '234px');

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

  // Both desktop modes share the layout and data-codex-composer attribute.
  // ChatGPT Work must remain supported under the same global ChatGPT mode.
  const savedModeSettings = JSON.stringify(window.__CODEX_USAGE_MONITOR_STATE__.getSettings());
  const placementModule = window.__CODEX_USAGE_MONITOR_MODULES__.placement;
  const chatEditable = window.document.querySelector('#composer-wrapper [contenteditable="true"]');
  const modeSwitch = window.document.createElement("button");
  modeSwitch.setAttribute("aria-haspopup", "menu");
  modeSwitch.setAttribute("aria-label", "切换模式，当前模式：Codex");
  modeSwitch.textContent = "Codex";
  modeSwitch.getBoundingClientRect = () => ({ x: 10, y: 10, width: 100, height: 30, right: 110, bottom: 40 });
  window.document.body.appendChild(modeSwitch);
  host.shadowRoot.querySelector(".usage-summary").click();
  modeSwitch.textContent = "ChatGPT";
  modeSwitch.setAttribute("aria-label", "切换模式，当前模式：ChatGPT");
  chatEditable.setAttribute("aria-label", "使用 ChatGPT Work");
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.ok(window.document.getElementById("codex-usage-monitor"), "ChatGPT Work must stay mounted");
  chatEditable.setAttribute("aria-label", "给 ChatGPT 发送消息");
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(window.document.getElementById("codex-usage-monitor"), null);
  assert.equal(window.__CODEX_USAGE_MONITOR_STATE__.diagnose().reason, "chatgpt-composer");
  window.__CODEX_USAGE_MONITOR_STATE__.updateUsage(usage);
  assert.equal(window.document.getElementById("codex-usage-monitor"), null, "usage refresh must not remount in ChatGPT");
  assert.equal(window.eval(payload).installed, false, "fresh injection in ChatGPT must stay hidden");
  modeSwitch.firstChild.data = "Codex";
  modeSwitch.setAttribute("aria-label", "Switch mode, current mode: Codex");
  chatEditable.setAttribute("aria-label", "随心输入");
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.ok(window.document.getElementById("codex-usage-monitor")?.shadowRoot);
  modeSwitch.firstChild.data = "ChatGPT";
  modeSwitch.setAttribute("aria-label", "Switch mode, current mode: ChatGPT");
  chatEditable.setAttribute("aria-label", "Message ChatGPT");
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(window.document.getElementById("codex-usage-monitor"), null);
  modeSwitch.remove();

  chatEditable.removeAttribute("aria-label");
  chatEditable.setAttribute("data-codex-composer", "true");
  for (const [attribute, label] of [["aria-label", "给 ChatGPT 发送消息"], ["placeholder", "Message ChatGPT"]]) {
    chatEditable.setAttribute(attribute, label);
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(window.document.getElementById("codex-usage-monitor"), null);
    assert.equal(window.__CODEX_USAGE_MONITOR_STATE__.diagnose().reason, "chatgpt-composer");
    chatEditable.removeAttribute(attribute);
  }
  const wrapper = window.document.getElementById("composer-wrapper");
  wrapper.setAttribute("data-conversation-id", "chatgpt:test-conversation");
  assert.equal(window.__CODEX_USAGE_MONITOR_STATE__.ensure(), null);
  chatEditable.setAttribute("aria-label", "Use ChatGPT Work");
  assert.ok(window.__CODEX_USAGE_MONITOR_STATE__.ensure(), "explicit Work metadata wins over a shared ChatGPT namespace");
  chatEditable.removeAttribute("aria-label");
  wrapper.removeAttribute("data-conversation-id");
  assert.ok(window.__CODEX_USAGE_MONITOR_STATE__.ensure());
  const chatSide = window.document.createElement("div");
  chatSide.innerHTML = composerMarkup().replace('contenteditable="true"', 'contenteditable="true" aria-label="Message ChatGPT"');
  window.document.body.prepend(chatSide);
  assert.ok(window.__CODEX_USAGE_MONITOR_STATE__.ensure(), "a ChatGPT side composer must not hide the main Codex monitor");
  const placement = placementModule.findPlacement("codex-usage-monitor");
  assert.ok(wrapper.contains(placement.composer), "fresh selection must exclude the ChatGPT side composer");
  chatSide.remove();
  assert.equal(JSON.stringify(window.__CODEX_USAGE_MONITOR_STATE__.getSettings()), savedModeSettings);

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
  assert.deepEqual([...host.shadowRoot.querySelectorAll(".usage-column-heading")].map((item) => item.textContent), ["本会话", "官方订阅", "重置概率预测（仅供参考）", "额度对应 Token"]);
  host.shadowRoot.querySelector("[data-toggle-settings]").click();
  assert.equal(host.shadowRoot.querySelector('input[data-setting="showApiColumns"]').checked, false);
  assert.equal(host.shadowRoot.querySelector('input[data-setting="showResetForecast"]').checked, true);
  host.shadowRoot.querySelector('input[data-setting="showApiColumns"]').click();
  assert.equal(host.shadowRoot.querySelectorAll(".usage-column").length, 6);
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
    ["currentTaskTokens", "secondaryRemaining"],
  );
  assert.deepEqual(
    [...host.shadowRoot.querySelectorAll('input[data-source="session"]:checked, input[data-source="official"]:checked')].map((item) => `${item.dataset.source}:${item.dataset.metric}`),
    ["session:currentTaskTokens", "official:secondaryRemaining"],
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
    unifiedMetricsVersion: 2,
    minimalMode: true,
    countdownVisualization: false,
    englishUi: false,
    updateNotifications: false,
    autoResume: false,
  };
  window.__CODEX_USAGE_MONITOR__ = usage;
  assert.equal(window.eval(payload).installed, true);
  host = window.document.getElementById("codex-usage-monitor");
  assert.deepEqual(
    [...host.shadowRoot.querySelectorAll(".usage-summary-item")].map((item) => item.dataset.metric),
    ["currentTaskTokens", "lifetimeTokens"],
  );
  assert.equal(host.dataset.minimal, "true");
  host.shadowRoot.querySelector('input[data-source="official"][data-metric="secondaryRemaining"]').click();
  assert.deepEqual(persistedPayloads.at(-1).metrics.official, ["lifetimeTokens", "secondaryRemaining"]);
  assert.equal(window.__CODEX_USAGE_MONITOR_STATE__.cleanup(), true);
  delete window.__codexUsageMonitorSaveSettings;
  delete window.__CODEX_USAGE_MONITOR_PERSISTED_SETTINGS__;
  // Migrate a selected old status in place, then exercise the real one-second
  // updater with a deterministic clock (without waiting a minute in tests).
  window.localStorage.clear();
  window.__CODEX_USAGE_MONITOR_PERSISTED_SETTINGS__ = {
    metrics: { session: ["currentStatus"], official: ["secondaryRemaining"] },
    metricOrder: ["session:currentStatus", "official:secondaryRemaining"], unifiedMetricsVersion: 2,
  };
  const originalNow = window.Date.now;
  const originalInterval = window.setInterval;
  let clockNow = now;
  let tick;
  window.Date.now = () => clockNow;
  window.setInterval = (callback, delay, ...args) => {
    if (delay === 1000) tick = callback;
    return originalInterval.call(window, callback, delay, ...args);
  };
  const timedUsage = (overrides = {}) => ({ ...usage, sources: { ...usage.sources, session: {
    ...usage.sources.session, metrics: usage.sources.session.metrics.map((metric) => metric.id === "executionTime"
      ? { ...metric, durationMs: 3600000, estimated: true, running: true, sampledAt: new Date(now).toISOString(), ...overrides } : metric),
  } } });
  try {
    window.__CODEX_USAGE_MONITOR__ = timedUsage();
    assert.equal(window.eval(payload).installed, true);
    host = window.document.getElementById("codex-usage-monitor");
    const monitor = window.__CODEX_USAGE_MONITOR_STATE__;
    assert.deepEqual(Array.from(monitor.getSettings().metrics.session), ["executionTime"]);
    assert.deepEqual(Array.from(monitor.getSettings().metricOrder), ["session:executionTime", "official:secondaryRemaining"]);
    assert.equal(host.shadowRoot.querySelector('[data-metric="currentStatus"]'), null);
    const durationDetail = () => host.shadowRoot.querySelector('[data-duration-value]');
    const durationSummary = () => host.shadowRoot.querySelector('.usage-summary-item[data-metric="executionTime"]');
    assert.equal(durationDetail().textContent, "≈1时00分00秒");
    assert.equal(durationSummary().textContent, "耗时 ≈1时00分00秒");
    const unchangedInput = host.shadowRoot.querySelector('[data-setting-text="autoResumeMessage"]');
    clockNow += 2500;
    tick();
    assert.equal(durationDetail().textContent, "≈1时00分02秒");
    assert.equal(durationSummary().textContent, "耗时 ≈1时00分02秒");
    assert.equal(host.shadowRoot.querySelector('[data-setting-text="autoResumeMessage"]'), unchangedInput, "clock does not rebuild controls");
    clockNow = now + 86400000;
    tick();
    assert.equal(durationDetail().textContent, "≈1时01分00秒+", "stale feed cannot count an entire offline day");
    assert.match(durationDetail().title, /记录不完整/);
    monitor.updateUsage(timedUsage({ durationMs: 3599000, estimated: false, running: false }));
    assert.equal(durationDetail().textContent, "59分59秒", "official duration replaces estimate");
    clockNow += 5000;
    tick();
    assert.equal(durationDetail().textContent, "59分59秒", "completed execution remains frozen");
    host.shadowRoot.querySelector('[data-setting="englishUi"]').click();
    assert.equal(durationDetail().textContent, "59m59s");
    host.shadowRoot.querySelector('[data-setting="minimalMode"]').click();
    assert.equal(durationSummary().textContent, "59m59s", "minimal mode omits the label only");
    monitor.updateUsage(timedUsage({ durationMs: 0, estimated: false, incomplete: true, running: false }));
    assert.equal(durationDetail().textContent, "0s+");
    monitor.updateUsage({ ...usage, currentThreadId: otherThreadId, sources: { ...usage.sources,
      session: { ...usage.sources.session, status: "loading", metrics: [] },
    } });
    assert.equal(durationDetail().textContent, "--", "thread switches cannot inherit prior execution time");
    assert.equal(durationSummary().textContent, "--");
    window.__CODEX_USAGE_MONITOR_BACKEND__ = { pid: 123, at: clockNow, phase: "connected" };
    tick();
    assert.equal(host.dataset.backend, "connected");
    assert.equal(host.shadowRoot.querySelector('.usage-backend-warning').hidden, true);
    const preservedData = JSON.stringify(monitor.usage);
    clockNow += 31000;
    tick();
    assert.equal(host.dataset.backend, "disconnected");
    assert.equal(host.shadowRoot.querySelector('.usage-backend-warning').textContent, "Monitor disconnected");
    assert.equal(host.shadowRoot.querySelector('.usage-backend-warning').hidden, false);
    assert.match(host.shadowRoot.querySelector('.usage-backend-notice').textContent, /desktop shortcut/);
    assert.match(host.shadowRoot.querySelector('.usage-summary').getAttribute('aria-label'), /outdated/);
    assert.equal(JSON.stringify(monitor.usage), preservedData, "disconnect warning preserves last data, not fabricated zeroes");
    window.__CODEX_USAGE_MONITOR_BACKEND__.at = clockNow;
    tick();
    assert.equal(host.dataset.backend, "connected");
    assert.equal(host.shadowRoot.querySelector('.usage-backend-notice').hidden, true);
    assert.doesNotMatch(host.shadowRoot.querySelector('.usage-summary').getAttribute('aria-label'), /disconnected/);
  } finally {
    window.__CODEX_USAGE_MONITOR_STATE__.cleanup();
    window.Date.now = originalNow;
    window.setInterval = originalInterval;
    delete window.__CODEX_USAGE_MONITOR_BACKEND__;
    delete window.__CODEX_USAGE_MONITOR_PERSISTED_SETTINGS__;
  }
} finally {
  dom.window.close();
}

console.log("PASS: unified panel, defaults, persistent settings bridge, replacement recovery, and cleanup lifecycle.");
