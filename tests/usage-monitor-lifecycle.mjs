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
    ${withApproval ? '<button style="color: rgb(70, 80, 90)">替我审批</button>' : ""}
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
window.__CODEX_DREAM_SKIN_STATE__ = {
  usage: null,
  cleanup() {
    delete window.__CODEX_DREAM_SKIN_STATE__;
    return true;
  },
};
window.Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
  const value = (() => {
    if (this.id === "composer-wrapper" || this.matches(".composer-surface-chrome")) return { x: 100, y: 100, width: 700, height: 100 };
    if (this.id === "codex-usage-monitor") return { x: 234, y: 164, width: 220, height: 28 };
    if (this.matches('[contenteditable="true"]')) return { x: 112, y: 112, width: 676, height: 44 };
    const text = `${this.getAttribute?.("aria-label") || ""} ${this.textContent || ""}`;
    if (/添加/.test(text)) return { x: 108, y: 164, width: 28, height: 28 };
    if (/替我审批/.test(text)) return { x: 141, y: 164, width: 85, height: 28 };
    if (/更多操作/.test(text)) return { x: 141, y: 164, width: 85, height: 28 };
    if (/5\.6/.test(text)) return { x: 622, y: 164, width: 105, height: 28 };
    if (/听写/.test(text)) return { x: 728, y: 164, width: 28, height: 28 };
    if (/发送/.test(text)) return { x: 764, y: 164, width: 28, height: 28 };
    return { x: 0, y: 0, width: 0, height: 0 };
  })();
  return { ...value, right: value.x + value.width, bottom: value.y + value.height };
};

try {
  const result = window.eval(payload);
  assert.equal(result.installed, true);
  assert.equal(result.mode, "monitor-only");
  assert.equal(result.anchoredToApproval, true);
  assert.equal(window.document.documentElement.classList.contains("codex-dream-skin"), false);
  assert.equal(window.document.getElementById("codex-dream-skin-style"), null);
  assert.equal(window.document.getElementById("codex-dream-skin-chrome"), null);
  assert.equal(window.__CODEX_DREAM_SKIN_STATE__, undefined);

  let host = window.document.getElementById("codex-usage-monitor");
  const wrapper = window.document.getElementById("composer-wrapper");
  assert.equal(host.parentElement, wrapper);
  assert.ok(host.shadowRoot);
  const monitorStyle = host.shadowRoot.querySelector("style").textContent;
  assert.match(monitorStyle, /left:\s*var\(--usage-left/);
  assert.match(monitorStyle, /bottom:\s*8px/);
  assert.match(monitorStyle, /color:\s*var\(--usage-color,\s*currentColor\)/);
  assert.match(monitorStyle, /\.usage-secondary,\s*\.usage-today,\s*\.usage-extra\s*\{\s*opacity:\s*\.82/);
  assert.equal(host.style.getPropertyValue("--usage-left"), "134px");
  assert.equal(host.style.getPropertyValue("--usage-color"), "rgb(70, 80, 90)");
  assert.equal(host.dataset.anchor, "approval");
  assert.equal(host.shadowRoot.querySelector(".usage-primary").textContent, "状态 不可用");
  assert.equal(host.shadowRoot.querySelector(".usage-today").hidden, true);

  assert.equal(window.__CODEX_USAGE_MONITOR_STATE__.updateUsage({
    status: "ready",
    windows: [{ label: "30天", remainingPercent: 100, resetsAt: Math.floor(Date.now() / 1000) + 86400 }],
    todayTokens: 0,
    lifetimeTokens: 57839148,
    fetchedAt: Date.now(),
    schemaVersion: 2,
    sources: {
      official: {
        id: "official",
        label: "官方订阅",
        accountType: "subscription",
        status: "ready",
        metrics: [
          { id: "primaryRemaining", label: "30天 剩余", display: "30天 100%", detail: "30天 剩余 100%", defaultVisible: true },
          { id: "primaryReset", label: "30天 重置", display: "30天 1 天后重置", detail: "30天：1 天后重置", defaultVisible: false },
          { id: "secondaryRemaining", label: "周 剩余", display: "周 80%", detail: "周 剩余 80%", defaultVisible: false },
          { id: "secondaryReset", label: "周 重置", display: "周 2 天后重置", detail: "周：2 天后重置", defaultVisible: false },
          { id: "todayTokens", label: "今日 token", display: "今日 0", detail: "今日 token：0", defaultVisible: true },
          { id: "lifetimeTokens", label: "累计 token", display: "累计 58m", detail: "累计 token：58m", defaultVisible: false },
        ],
      },
      acme: {
        id: "acme",
        label: "Acme API",
        accountType: "api-key",
        status: "ready",
        nextRefreshAt: Date.now() + 90000,
        metrics: [
          { id: "usedAmount", label: "已用额度", value: "¥5", display: "已用 ¥5", detail: "已用额度：¥5", defaultVisible: true },
          { id: "quotaLimit", label: "限额", value: "不限", display: "限额 不限", detail: "限额：不限", defaultVisible: true },
          { id: "expiresAt", label: "到期时间", value: "永久", display: "到期 永久", detail: "到期时间：永久", defaultVisible: false },
        ],
      },
    },
  }), true);
  assert.equal(host.shadowRoot.querySelector(".usage-primary").textContent, "剩余 100%");
  assert.equal(host.shadowRoot.querySelector(".usage-secondary").textContent, "重置 1天后");
  assert.equal(host.shadowRoot.querySelector(".usage-today").hidden, true);
  assert.equal(host.dataset.status, "ready");
  host.shadowRoot.querySelector(".usage-summary").click();
  assert.equal(host.shadowRoot.querySelector(".usage-popover").hidden, false);
  assert.equal(host.shadowRoot.querySelectorAll(".usage-detail-row").length, 6);
  assert.equal(host.shadowRoot.querySelector('[data-metric="secondaryRemaining"]'), null);
  assert.equal(host.shadowRoot.querySelector('[data-metric="secondaryReset"]'), null);
  assert.deepEqual([...host.shadowRoot.querySelectorAll(".usage-detail-label")].map((item) => item.textContent), ["周期剩余", "重置时间", "今日 Token", "累计 Token", "请求状态", "下次刷新时间"]);
  assert.deepEqual([...host.shadowRoot.querySelectorAll(".usage-detail-value")].slice(0, 5).map((item) => item.textContent), ["100%", "1天后", "0万", "5784万", "正常"]);
  assert.deepEqual([...host.shadowRoot.querySelectorAll(".usage-detail-select input")].filter((item) => item.checked).map((item) => item.dataset.metric), ["primaryRemaining", "primaryReset"]);
  const thresholdUsage = JSON.parse(JSON.stringify(window.__CODEX_USAGE_MONITOR_STATE__.usage));
  const thresholdLifetime = thresholdUsage.sources.official.metrics.find((item) => item.id === "lifetimeTokens");
  thresholdLifetime.value = "120,000,000";
  thresholdLifetime.display = "累计 120m";
  window.__CODEX_USAGE_MONITOR_STATE__.updateUsage(thresholdUsage);
  assert.equal([...host.shadowRoot.querySelectorAll(".usage-detail-row")].find((row) => row.querySelector(".usage-detail-label").textContent === "累计 Token").querySelector(".usage-detail-value").textContent, "1.20亿");
  let lifetimeInput = host.shadowRoot.querySelector('[data-metric="lifetimeTokens"]');
  lifetimeInput.checked = true;
  lifetimeInput.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.equal(host.shadowRoot.querySelector(".usage-today").textContent, "累计 1.20亿");
  lifetimeInput = host.shadowRoot.querySelector('[data-metric="lifetimeTokens"]');
  lifetimeInput.checked = false;
  lifetimeInput.dispatchEvent(new window.Event("change", { bubbles: true }));
  host.shadowRoot.querySelector('[data-source="api-key"]').click();
  assert.equal(host.dataset.source, "acme");
  assert.equal(host.shadowRoot.querySelector('[data-source="api-key"]').textContent, "API Key");
  assert.equal(host.shadowRoot.querySelector(".usage-primary").textContent, "已用 ¥5");
  assert.equal(host.shadowRoot.querySelector(".usage-secondary").textContent, "限额 不限");
  assert.equal(host.shadowRoot.querySelectorAll(".usage-metric-option").length, 0);
  assert.equal(host.shadowRoot.querySelectorAll(".usage-detail-row").length, 5);
  assert.equal(host.shadowRoot.querySelectorAll(".usage-detail-select input").length, 5);
  assert.deepEqual([...host.shadowRoot.querySelectorAll(".usage-detail-select input")].filter((item) => item.checked).map((item) => item.dataset.metric), ["usedAmount", "quotaLimit"]);
  assert.deepEqual([...host.shadowRoot.querySelectorAll(".usage-detail-label")].map((item) => item.textContent), ["已用额度", "限额", "到期时间", "请求状态", "下次刷新时间"]);
  assert.deepEqual([...host.shadowRoot.querySelectorAll(".usage-detail-value")].slice(0, 4).map((item) => item.textContent), ["¥5", "不限", "永久", "正常"]);
  assert.match(host.shadowRoot.querySelectorAll(".usage-detail-value")[4].textContent, /^\d+秒后$/);
  assert.equal(window.__CODEX_USAGE_MONITOR_STATE__.updateUsage({
    schemaVersion: 2,
    sources: {
      acme: {
        id: "acme",
        label: "Acme API",
        accountType: "api-key",
        status: "loading",
        metrics: [],
      },
    },
  }), true);
  assert.equal(host.dataset.status, "loading");
  assert.equal(host.shadowRoot.querySelector(".usage-primary").textContent, "已用 ¥5");
  assert.equal(host.shadowRoot.querySelector(".usage-secondary").textContent, "限额 不限");
  assert.deepEqual([...host.shadowRoot.querySelectorAll(".usage-detail-value")].slice(0, 3).map((item) => item.textContent), ["¥5", "不限", "永久"]);
  assert.equal(host.shadowRoot.querySelectorAll(".usage-detail-value")[3].textContent, "请求中");
  assert.equal(window.__CODEX_USAGE_MONITOR_STATE__.updateUsage({
    schemaVersion: 2,
    sources: {
      acme: {
        id: "acme",
        label: "Acme API",
        accountType: "api-key",
        status: "ready",
        nextRefreshAt: Date.now() + 90000,
        metrics: [
          { id: "usedAmount", label: "已用额度", value: "¥5", display: "已用 ¥5", detail: "已用额度：¥5", defaultVisible: true },
          { id: "quotaLimit", label: "限额", value: "不限", display: "限额 不限", detail: "限额：不限", defaultVisible: true },
          { id: "expiresAt", label: "到期时间", value: "永久", display: "到期 永久", detail: "到期时间：永久", defaultVisible: false },
        ],
      },
    },
  }), true);
  assert.equal(host.dataset.status, "ready");
  const expiryInput = host.shadowRoot.querySelector('[data-metric="expiresAt"]');
  expiryInput.checked = true;
  expiryInput.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.equal(host.shadowRoot.querySelector(".usage-today").textContent, "到期 永久");
  assert.equal(host.shadowRoot.querySelector(".usage-today").hidden, false);
  for (const id of ["requestStatus", "nextRefreshAt"]) {
    const input = host.shadowRoot.querySelector(`[data-metric="${id}"]`);
    assert.equal(input.disabled, false);
    input.checked = true;
    input.dispatchEvent(new window.Event("change", { bubbles: true }));
  }
  assert.deepEqual([...host.shadowRoot.querySelectorAll(".usage-detail-select input")].filter((item) => item.checked).map((item) => item.dataset.metric), ["usedAmount", "quotaLimit", "expiresAt", "requestStatus", "nextRefreshAt"]);
  assert.deepEqual([...host.shadowRoot.querySelectorAll(".usage-extra-item")].map((item) => item.textContent).slice(0, 1), ["状态正常"]);
  assert.match(host.shadowRoot.querySelectorAll(".usage-extra-item")[1].textContent, /^刷新\d+秒$/);
  assert.deepEqual(JSON.parse(window.localStorage.getItem("codex-usage-monitor-settings-v1")), {
    source: "acme",
    metrics: {
      official: ["primaryRemaining", "primaryReset"],
      acme: ["usedAmount", "quotaLimit", "expiresAt", "requestStatus", "nextRefreshAt"],
    },
    apiKeyMetricsVersion: 1,
    officialMetricsVersion: 1,
  });

  wrapper.innerHTML = composerMarkup();
  await new Promise((resolve) => setTimeout(resolve, 250));
  window.__CODEX_USAGE_MONITOR_STATE__.ensure();
  host = window.document.getElementById("codex-usage-monitor");
  assert.equal(host.parentElement, wrapper);
  assert.equal(host.dataset.source, "acme");
  assert.equal(host.shadowRoot.querySelector(".usage-primary").textContent, "已用¥5");
  assert.equal(host.shadowRoot.querySelector(".usage-today").textContent, "到期永久");
  assert.equal(host.shadowRoot.querySelectorAll(".usage-extra-item").length, 2);

  wrapper.innerHTML = composerMarkup(false);
  await new Promise((resolve) => setTimeout(resolve, 250));
  window.__CODEX_USAGE_MONITOR_STATE__.ensure();
  host = window.document.getElementById("codex-usage-monitor");
  assert.equal(host.dataset.anchor, "control");
  assert.equal(host.hidden, false);

  assert.equal(window.__CODEX_USAGE_MONITOR_STATE__.cleanup(), true);
  assert.equal(window.document.getElementById("codex-usage-monitor"), null);
  assert.equal(window.__CODEX_USAGE_MONITOR_STATE__, undefined);
  assert.equal(window.__CODEX_USAGE_MONITOR__, undefined);
} finally {
  dom.window.close();
}

console.log("PASS: monitor-only cleanup, source switching, fixed API status rows, approval anchoring, usage refresh, replacement recovery, and cleanup lifecycle.");
