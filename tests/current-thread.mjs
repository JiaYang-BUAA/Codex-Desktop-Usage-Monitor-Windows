import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  currentThreadSelectionExpression,
  isMainCodexRendererTarget,
  selectCurrentCodexThread,
  syncCurrentThread,
} from "../scripts/current-thread.mjs";

const codexThreadId = "019fb3b1-2638-7bb0-9a90-ec83b5bca0f2";
const chatGptThreadId = "019fb3b1-2638-7bb0-9a90-ec83b5bca5e774";

assert.equal(isMainCodexRendererTarget({ url: "app://-/index.html" }), true);
assert.equal(isMainCodexRendererTarget({ url: "app://-/index.html?theme=dark" }), true);
assert.equal(isMainCodexRendererTarget({ url: "app://-/index.html?initialRoute=%2Fchatgpt%2Fquick-chat-prewarm" }), false);
assert.equal(isMainCodexRendererTarget({ url: "app://-/index.html?initialRoute=%2Favatar-overlay" }), false);
assert.equal(isMainCodexRendererTarget({ url: "https://chatgpt.com/" }), false);
assert.equal(isMainCodexRendererTarget({ url: "not a url" }), false);

function createDom(markup) {
  return new JSDOM(`<!doctype html><body>${markup}</body>`, { runScripts: "outside-only" });
}

{
  const otherThreadId = "01a0f260-c8d0-7890-8c72-81e0efc8ace9";
  const dom = createDom(`
    <div data-app-shell-active-page="false"><div data-above-composer-conversation-id="${codexThreadId}"></div></div>
    <div data-app-shell-active-page="true"><div data-above-composer-conversation-id="${otherThreadId}"></div></div>
  `);
  try {
    const pages = dom.window.document.querySelectorAll('[data-app-shell-active-page]');
    assert.equal(selectCurrentCodexThread(dom.window.document).threadId, otherThreadId);
    assert.equal(JSON.parse(JSON.stringify(dom.window.eval(currentThreadSelectionExpression()))).threadId, otherThreadId);
    pages[0].setAttribute('data-app-shell-active-page', 'true');
    pages[1].setAttribute('data-app-shell-active-page', 'false');
    assert.equal(selectCurrentCodexThread(dom.window.document).threadId, codexThreadId, 'switching cached pages changes task');
    pages[0].setAttribute('data-app-shell-active-page', 'false');
    assert.equal(selectCurrentCodexThread(dom.window.document).threadId, null, 'no active task must not read cached pages');
    pages[0].setAttribute('data-app-shell-active-page', 'true');
    pages[0].setAttribute('inert', '');
    assert.equal(selectCurrentCodexThread(dom.window.document).threadId, null);
    pages[0].removeAttribute('inert');
    pages[0].setAttribute('aria-hidden', 'true');
    assert.equal(selectCurrentCodexThread(dom.window.document).threadId, null);
    pages[0].removeAttribute('aria-hidden');
    const calls = [];
    const session = { evaluate: expression => dom.window.eval(expression) };
    const client = { setCurrentThreadId: id => calls.push(id) };
    await syncCurrentThread(session, client);
    pages[0].setAttribute('data-app-shell-active-page', 'false');
    pages[1].setAttribute('data-app-shell-active-page', 'true');
    await syncCurrentThread(session, client);
    assert.deepEqual(calls, [codexThreadId, otherThreadId], 'backend switches to the active task');
  } finally { dom.window.close(); }
}

{
  const dom = createDom(`
    <div data-above-composer-conversation-id="${codexThreadId}"></div>
    <div data-above-composer-conversation-id="chatgpt:${chatGptThreadId}"></div>
  `);
  try {
    assert.deepEqual(selectCurrentCodexThread(dom.window.document), {
      threadId: codexThreadId,
      auxiliaryConversationPresent: true,
    });
    assert.deepEqual(JSON.parse(JSON.stringify(dom.window.eval(currentThreadSelectionExpression()))), {
      threadId: codexThreadId,
      auxiliaryConversationPresent: true,
    });
  } finally {
    dom.window.close();
  }
}

{
  const sideThreadId = "01a0244b-039c-7301-9aa1-33ad7fef9b93";
  const dom = createDom(`
    <div id="codex-usage-monitor"></div>
    <div id="main-marker" data-above-composer-conversation-id="${codexThreadId}"></div>
    <div id="side-marker" data-above-composer-conversation-id="${sideThreadId}"></div>
  `);
  try {
    dom.window.document.getElementById("codex-usage-monitor").getBoundingClientRect = () => ({
      left: 220, right: 370, top: 700, bottom: 728, width: 150, height: 28,
    });
    dom.window.document.getElementById("main-marker").getBoundingClientRect = () => ({
      left: 100, right: 600, top: 600, bottom: 632, width: 500, height: 32,
    });
    dom.window.document.getElementById("side-marker").getBoundingClientRect = () => ({
      left: 650, right: 950, top: 600, bottom: 632, width: 300, height: 32,
    });
    assert.deepEqual(selectCurrentCodexThread(dom.window.document), {
      threadId: codexThreadId,
      auxiliaryConversationPresent: false,
    });
  } finally {
    dom.window.close();
  }
}

{
  const sideThreadId = "01a0e0de-7c51-7bf0-b364-3bc4a5292696";
  const dom = createDom(`
    <div id="codex-usage-monitor"></div>
    <div data-above-composer-conversation-id="${codexThreadId}"></div>
    <div data-above-composer-conversation-id="${sideThreadId}"></div>
  `);
  try {
    // Codex hides empty composer markers even while both task panes exist.
    assert.deepEqual(selectCurrentCodexThread(dom.window.document), {
      threadId: codexThreadId,
      auxiliaryConversationPresent: false,
    });
  } finally {
    dom.window.close();
  }
}

{
  const dom = createDom(`<div data-conversation-id="CHATGPT: ${chatGptThreadId}"></div>`);
  try {
    assert.deepEqual(selectCurrentCodexThread(dom.window.document), {
      threadId: null,
      auxiliaryConversationPresent: true,
    });
  } finally {
    dom.window.close();
  }
}

{
  const dom = createDom(`<div data-thread-id="thread/${codexThreadId}"></div>`);
  const calls = [];
  const usageClient = {
    currentThreadId: null,
    setCurrentThreadId(value) {
      calls.push(value);
      this.currentThreadId = value;
    },
  };
  const session = { evaluate: (expression) => dom.window.eval(expression) };
  try {
    assert.deepEqual(await syncCurrentThread(session, usageClient), {
      threadId: codexThreadId,
      auxiliaryConversationPresent: false,
      preserved: false,
    });
    assert.deepEqual(calls, [codexThreadId]);

    dom.window.document.body.innerHTML = `<div data-thread-id="chatgpt:${chatGptThreadId}"></div>`;
    assert.deepEqual(await syncCurrentThread(session, usageClient), {
      threadId: null,
      auxiliaryConversationPresent: true,
      preserved: true,
    });
    assert.deepEqual(calls, [codexThreadId]);
    assert.equal(usageClient.currentThreadId, codexThreadId);

    dom.window.document.body.replaceChildren();
    assert.deepEqual(await syncCurrentThread(session, usageClient), {
      threadId: null,
      auxiliaryConversationPresent: false,
      preserved: false,
    });
    assert.deepEqual(calls, [codexThreadId, null]);
  } finally {
    dom.window.close();
  }
}

console.log("PASS: current Codex task selection stays anchored to the main Composer across side-chat transitions.");
