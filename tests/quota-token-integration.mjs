import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LocalCodexTokenTracker, toQuotaTokenSource } from '../scripts/usage-client.mjs';
import { createQuotaTokenObserver } from '../scripts/quota-token-observer.mjs';

function row(timestamp, type, payload) { return JSON.stringify({ timestamp: new Date(timestamp).toISOString(), type, payload }); }
function token(timestamp, total, amount) {
  return row(timestamp, 'event_msg', { type: 'token_count', info: {
    total_token_usage: { total_tokens: total },
    last_token_usage: { total_tokens: amount, input_tokens: amount - 100, cached_input_tokens: amount - 200, output_tokens: 100 },
  } });
}
function uuid(timestamp, suffix) {
  const prefix = timestamp.toString(16).padStart(12, '0');
  return `${prefix.slice(0, 8)}-${prefix.slice(8)}-7000-8000-${String(suffix).padStart(12, '0')}`;
}

test('actual official callback feeds independent ledger, excludes API, and survives reread/restart', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'quota-token-integration-'));
  try {
    const sessionRoot = path.join(directory, 'sessions');
    const counterPath = path.join(directory, 'daily-counter.json');
    const statePath = path.join(directory, 'quota-observations.json');
    mkdirSync(sessionRoot);
    const day = new Date(); day.setHours(0, 0, 0, 0);
    const baselineAt = day.getTime() + 1000;
    const officialId = uuid(baselineAt, 1);
    const apiId = uuid(baselineAt, 2);
    const officialFile = path.join(sessionRoot, `rollout-official-${officialId}.jsonl`);
    writeFileSync(officialFile, [
      row(baselineAt, 'session_meta', { id: officialId, model_provider: 'openai' }),
      row(baselineAt, 'turn_context', { turn_id: uuid(baselineAt, 11) }),
      token(baselineAt + 1000, 3000, 3000), '',
    ].join('\n'));
    writeFileSync(path.join(sessionRoot, `rollout-api-${apiId}.jsonl`), [
      row(baselineAt, 'session_meta', { id: apiId, model_provider: 'custom-api' }),
      row(baselineAt, 'turn_context', { turn_id: uuid(baselineAt, 12) }),
      token(baselineAt + 1000, 900000, 900000), '',
    ].join('\n'));
    let observer = createQuotaTokenObserver({ statePath, startedAt: baselineAt });
    observer.observeQuota({ remainingPercent: 80, resetAt: 'week-1', timestamp: baselineAt });
    const received = [];
    const makeTracker = () => new LocalCodexTokenTracker({ sessionRoot, counterPath,
      officialModelProviders: ['openai'], now: () => baselineAt + 10000,
      onOfficialToken: event => { received.push(event); observer.ingestToken(event); },
    });
    const tracker = makeTracker();
    assert.equal((await tracker.refresh()).status, 'ready');
    assert.equal(received.length, 1);
    assert.equal(received[0].tokens, 3000);
    assert.equal(received[0].inputTokens, 2900);
    assert.equal(received[0].cachedInputTokens, 2800);
    let summary = observer.observeQuota({ remainingPercent: 77, resetAt: 'week-1', timestamp: baselineAt + 2000 });
    assert.equal(summary.observedTokens, 3000);
    assert.equal(summary.estimatedFullTokens, 100000);
    await tracker.refresh();
    assert.equal(observer.getSummary().localTotalTokens, 3000);
    observer = createQuotaTokenObserver({ statePath });
    const restarted = makeTracker();
    await restarted.refresh();
    assert.equal(observer.getSummary().localTotalTokens, 3000);
    assert.equal(observer.getSummary().estimateStale, false, 'already-seen historical records cannot invalidate a sample');
    appendFileSync(officialFile, `${token(baselineAt + 3000, 6000, 3000)}\n`);
    await restarted.refresh();
    summary = observer.observeQuota({ remainingPercent: 74, resetAt: 'week-1', timestamp: baselineAt + 4000 });
    assert.equal(summary.observedTokens, 6000);
    assert.equal(summary.observedPercentagePoints, 6);
    const persisted = JSON.parse(readFileSync(statePath, 'utf8'));
    assert.equal(persisted.tokenEvents.length, 2);
    assert.equal(persisted.tokenEvents.some(event => event.tokens === 900000), false);
    const source = toQuotaTokenSource(summary, baselineAt + 5000, 60000);
    assert.equal(source.id, 'quota-token');
    assert.equal(source.status, 'ready');
    assert.equal(source.metrics.length, 13);
    assert.equal(source.metrics.find(metric => metric.id === 'wholeEstimateTokens').value, '≈10万');
    assert.equal(source.metrics.find(metric => metric.id === 'band80To70Tokens').value, '≈1万');
    assert.equal(source.metrics.find(metric => metric.id === 'band100To90Tokens').value, '--');
    observer.markDiscontinuity('official-source-unavailable', baselineAt + 5000);
    const stale = toQuotaTokenSource(observer.getSummary());
    assert.equal(stale.status, 'stale');
    assert.match(stale.metrics[0].detail, /中断/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('source serializer keeps unobserved values unknown and corrupt-state error visible', () => {
  const observer = createQuotaTokenObserver();
  const waiting = toQuotaTokenSource(observer.getSummary());
  assert.equal(waiting.status, 'loading');
  assert.equal(waiting.metrics[0].value, '--');
  assert.equal(waiting.metrics[2].value, '--');
  const error = toQuotaTokenSource({ ...observer.getSummary(), error: 'observation-state-unreadable' });
  assert.equal(error.status, 'error');
  assert.match(error.error, /原文件/);
});

test('official callback receives previous-day usage before daily counter filtering', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'quota-token-midnight-'));
  try {
    const sessionRoot = path.join(directory, 'sessions');
    mkdirSync(sessionRoot);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const midnight = today.getTime();
    const threadId = uuid(midnight - 60000, 1);
    writeFileSync(path.join(sessionRoot, `rollout-midnight-${threadId}.jsonl`), [
      row(midnight - 60000, 'session_meta', { id: threadId, model_provider: 'openai' }),
      row(midnight - 60000, 'turn_context', { turn_id: uuid(midnight - 60000, 2) }),
      token(midnight - 30000, 3000, 3000), '',
    ].join('\n'));
    const observer = createQuotaTokenObserver({ startedAt: midnight - 60000 });
    observer.observeQuota({ remainingPercent: 80, resetAt: 'week-1', timestamp: midnight - 60000 });
    const tracker = new LocalCodexTokenTracker({ sessionRoot, counterPath: path.join(directory, 'counter.json'),
      officialModelProviders: ['openai'], now: () => midnight + 10000, onOfficialToken: event => observer.ingestToken(event) });
    tracker.setCurrentThreadId(threadId);
    const local = await tracker.refresh();
    assert.equal(local.todayTokens, 0);
    const summary = observer.observeQuota({ remainingPercent: 77, resetAt: 'week-1', timestamp: midnight + 10000 });
    assert.equal(summary.localTotalTokens, 3000);
    assert.equal(summary.observedTokens, 3000);
    assert.equal(summary.status, 'ready');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
