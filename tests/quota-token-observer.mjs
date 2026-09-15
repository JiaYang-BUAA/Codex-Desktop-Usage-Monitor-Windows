import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createQuotaTokenObserver } from '../scripts/quota-token-observer.mjs';

function fixture(options) {
  const observer = createQuotaTokenObserver(options);
  let timestamp = 1;
  return { ...observer, observe: (remainingPercent, totalTokens, extra = {}) => observer.observeQuota({
    remainingPercent, totalTokens, timestamp: timestamp++, resetAt: 'week-1', ...extra,
  }) };
}

test('unchanged quota accumulates Tokens and minimum span hides noisy estimates', () => {
  const tracker = fixture();
  tracker.observe(80, 100);
  tracker.observe(80, 500);
  let summary = tracker.observe(79, 1100);
  assert.equal(summary.observedTokens, 1000);
  assert.equal(summary.estimatedFullTokens, null);
  summary = tracker.observe(77, 3100);
  assert.equal(summary.tokensPerPercentagePoint, 1000);
  assert.equal(summary.estimatedFullTokens, 100000);
  assert.equal(summary.bins[2].estimatedTokens, 10000);
});

test('ratios weight by actual quota span rather than averaging ratios', () => {
  const tracker = fixture();
  tracker.observe(80, 0);
  tracker.observe(79, 100);
  const summary = tracker.observe(75, 2100);
  assert.equal(summary.tokensPerPercentagePoint, 420);
  assert.equal(summary.bins[2].tokensPerPercentagePoint, 420);
});

test('cross-bin samples count overall without invented allocation', () => {
  const tracker = fixture();
  tracker.observe(92, 0);
  const summary = tracker.observe(87, 5000);
  assert.equal(summary.crossBinSamples, 1);
  assert.equal(summary.observedTokens, 5000);
  assert.equal(summary.observedBinCount, 0);
  assert.equal(summary.estimatedFullTokens, 100000);
});

test('zero-Token quota update waits for subsequent local Token evidence', () => {
  const tracker = fixture();
  tracker.observe(80, 0);
  assert.equal(tracker.observe(76, 0).sampleCount, 0);
  assert.equal(tracker.observe(76, 4000).estimatedFullTokens, 100000);
});

test('quota increase and counter regression cut uncertain intervals', () => {
  const tracker = fixture();
  tracker.observe(80, 0);
  tracker.observe(77, 3000);
  tracker.observe(79, 4000);
  tracker.observe(78, 100);
  const summary = tracker.observe(75, 3100);
  assert.equal(summary.observedTokens, 6000);
  assert.equal(summary.observedPercentagePoints, 6);
  assert.equal(summary.discontinuityCount, 2);
});

test('new weekly epoch and account separate history and reject out-of-order snapshots', () => {
  const tracker = fixture();
  tracker.observe(80, 0);
  tracker.observe(75, 5000);
  tracker.observe(100, 6000, { resetAt: 'week-2' });
  let summary = tracker.observe(97, 9000, { resetAt: 'week-2' });
  assert.equal(summary.observedTokens, 3000);
  summary = tracker.observeQuota({ remainingPercent: 70, totalTokens: 9500, timestamp: 1, resetAt: 'week-1' });
  assert.equal(summary.cycleCount, 2);
  assert.equal(summary.resetAt, 'week-2');
  summary = tracker.observe(90, 9500, { resetAt: 'week-2', sourceKey: 'another-account' });
  assert.equal(summary.observedTokens, 0);
});

test('source discontinuity prevents bridging missing data', () => {
  const tracker = fixture();
  tracker.observe(80, 0);
  tracker.markDiscontinuity('offline', 2);
  tracker.observe(70, 10000);
  assert.equal(tracker.observe(67, 13000).observedTokens, 3000);
});

test('persistence resumes only monotonic ledger and preserves corrupt evidence', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-token-test-'));
  const statePath = path.join(directory, 'observations.json');
  try {
    const tracker = fixture({ statePath });
    tracker.observe(80, 0);
    tracker.observe(77, 3000);
    const resumed = createQuotaTokenObserver({ statePath });
    assert.equal(resumed.getSummary().observedTokens, 3000);
    assert.equal(resumed.observeQuota({ remainingPercent: 74, totalTokens: 6000, timestamp: 3, resetAt: 'week-1' }).observedTokens, 6000);
    const saved = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    assert.equal(saved.observations.length, 3);
    fs.writeFileSync(statePath, '{broken');
    const damaged = fixture({ statePath });
    assert.equal(damaged.observe(80, 0).status, 'error');
    assert.equal(fs.readFileSync(statePath, 'utf8'), '{broken');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('local official ledger ignores pre-start history and deduplicates across restarts', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-token-ledger-'));
  const statePath = path.join(directory, 'observations.json');
  try {
    const tracker = createQuotaTokenObserver({ statePath, startedAt: 100 });
    assert.equal(tracker.ingestToken({ identity: 'historical', timestamp: 99, tokens: 999999 }), false);
    tracker.observeQuota({ remainingPercent: 80, resetAt: 'week-1', timestamp: 100 });
    assert.equal(tracker.ingestToken({ identity: 'event-1', timestamp: 101, tokens: 3000, inputTokens: 2500, cachedInputTokens: 2000, outputTokens: 500, model: 'model-a' }), true);
    assert.equal(tracker.ingestToken({ identity: 'event-1', timestamp: 101, tokens: 3000 }), false);
    assert.equal(tracker.observeQuota({ remainingPercent: 77, resetAt: 'week-1', timestamp: 102 }).observedTokens, 3000);
    const resumed = createQuotaTokenObserver({ statePath });
    assert.equal(resumed.ingestToken({ identity: 'event-1', timestamp: 101, tokens: 3000 }), false);
    resumed.ingestToken({ identity: 'event-2', timestamp: 103, tokens: 3000 });
    assert.equal(resumed.observeQuota({ remainingPercent: 74, resetAt: 'week-1', timestamp: 104 }).observedTokens, 6000);
    assert.equal(JSON.parse(fs.readFileSync(statePath, 'utf8')).tokenEvents[0].cachedInputTokens, 2000);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('five-minute polling gap cuts pairing but continuous flat polling retains Tokens', () => {
  const tracker = fixture({ maxObservationGapMs: 300000 });
  tracker.observe(80, 0, { timestamp: 100 });
  tracker.observe(80, 1000, { timestamp: 200100 });
  tracker.observe(80, 2000, { timestamp: 400100 });
  assert.equal(tracker.observe(77, 3000, { timestamp: 600100 }).observedTokens, 3000);
  let summary = tracker.observe(70, 10000, { timestamp: 1000100 });
  assert.equal(summary.observedTokens, 3000);
  assert.equal(summary.lastDiscontinuity, 'observation-gap');
  assert.equal(summary.status, 'stale');
  summary = tracker.observe(67, 13000, { timestamp: 1000200 });
  assert.equal(summary.status, 'ready');
  assert.equal(summary.observedTokens, 6000);
});

test('source unavailability labels retained estimate stale until a new valid sample', () => {
  const tracker = fixture();
  tracker.observe(80, 0);
  tracker.observe(77, 3000);
  tracker.markDiscontinuity('offline', 3);
  assert.equal(tracker.getSummary().status, 'stale');
  assert.equal(tracker.getSummary().estimateStale, true);
  assert.equal(tracker.observe(73, 7000, { timestamp: 4 }).status, 'stale');
  assert.equal(tracker.observe(70, 10000, { timestamp: 5 }).status, 'ready');
});

test('late backlog invalidates overlap and never enters the next quota interval', () => {
  const tracker = createQuotaTokenObserver({ startedAt: 0 });
  tracker.observeQuota({ remainingPercent: 80, resetAt: 'week-1', timestamp: 100 });
  tracker.ingestToken({ identity: 'first', timestamp: 110, tokens: 3000 });
  tracker.observeQuota({ remainingPercent: 77, resetAt: 'week-1', timestamp: 120 });
  tracker.ingestToken({ identity: 'late', timestamp: 115, tokens: 5000 });
  let summary = tracker.getSummary();
  assert.equal(summary.invalidSampleCount, 1);
  assert.equal(summary.observedTokens, 0);
  assert.equal(summary.status, 'stale');
  tracker.observeQuota({ remainingPercent: 76, resetAt: 'week-1', timestamp: 130 });
  tracker.ingestToken({ identity: 'new', timestamp: 140, tokens: 3000 });
  summary = tracker.observeQuota({ remainingPercent: 73, resetAt: 'week-1', timestamp: 150 });
  assert.equal(summary.observedTokens, 3000);
  assert.equal(summary.localTotalTokens, 11000);
});

test('syntactically valid but malformed nested state is preserved and rejected', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-token-schema-'));
  const statePath = path.join(directory, 'observations.json');
  try {
    const tracker = fixture({ statePath });
    tracker.observe(80, 0);
    tracker.observe(77, 3000);
    const baseline = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    for (const mutate of [
      value => { value.tokenEvents = [null]; },
      value => { value.totalTokens = 1; },
      value => { value.observations[0].remainingPercent = -1; },
      value => { value.cycles[0].samples[0].tokens = 999999; },
      value => { value.cycles[0].anchor = {}; },
    ]) {
      const damaged = structuredClone(baseline);
      mutate(damaged);
      const text = JSON.stringify(damaged);
      fs.writeFileSync(statePath, text);
      assert.equal(createQuotaTokenObserver({ statePath }).getSummary().status, 'error');
      assert.equal(fs.readFileSync(statePath, 'utf8'), text);
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
