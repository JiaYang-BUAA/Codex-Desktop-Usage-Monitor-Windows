import fs from 'node:fs';
import path from 'node:path';

const nonnegativeInteger = value => Number.isSafeInteger(value) && value >= 0;
const validObservation = value => value && Number.isFinite(value.timestamp)
  && Number.isFinite(value.remainingPercent) && value.remainingPercent >= 0 && value.remainingPercent <= 100
  && nonnegativeInteger(value.totalTokens) && typeof value.resetAt === 'string' && value.resetAt.length > 0
  && typeof value.sourceKey === 'string' && value.sourceKey.length > 0;
function validState(value) {
  if (!value || value.version !== 1 || !Number.isFinite(value.startedAt) || !nonnegativeInteger(value.totalTokens)
    || !Array.isArray(value.tokenEvents) || !Array.isArray(value.cycles) || !Array.isArray(value.observations)) return false;
  const identities = new Set();
  let tokenSum = 0;
  for (const event of value.tokenEvents) {
    if (!event || typeof event.identity !== 'string' || !event.identity || identities.has(event.identity)
      || !Number.isFinite(event.timestamp) || event.timestamp < value.startedAt || !nonnegativeInteger(event.tokens) || event.tokens === 0
      || ['inputTokens', 'cachedInputTokens', 'outputTokens'].some(key => event[key] != null && !nonnegativeInteger(event[key]))
      || (event.model != null && typeof event.model !== 'string')) return false;
    identities.add(event.identity);
    tokenSum += event.tokens;
  }
  if (!Number.isSafeInteger(tokenSum) || tokenSum !== value.totalTokens) return false;
  if (value.observations.some((item, index) => !validObservation(item) || (index > 0 && item.timestamp <= value.observations[index - 1].timestamp))) return false;
  return value.cycles.every(cycle => cycle && typeof cycle.resetAt === 'string' && cycle.resetAt
    && typeof cycle.sourceKey === 'string' && cycle.sourceKey && Number.isFinite(cycle.startedAt)
    && (cycle.anchor === null || validObservation(cycle.anchor)) && Array.isArray(cycle.samples) && Array.isArray(cycle.breaks)
    && cycle.breaks.every(cut => cut && typeof cut.reason === 'string' && Number.isFinite(cut.timestamp))
    && cycle.samples.every(sample => {
      if (!sample || !validObservation(sample.from) || !validObservation(sample.to)
        || sample.from.resetAt !== cycle.resetAt || sample.to.resetAt !== cycle.resetAt
        || sample.from.sourceKey !== cycle.sourceKey || sample.to.sourceKey !== cycle.sourceKey
        || sample.to.timestamp <= sample.from.timestamp || sample.tokens <= 0 || sample.percentagePoints <= 0
        || sample.tokens !== sample.to.totalTokens - sample.from.totalTokens
        || sample.percentagePoints !== sample.from.remainingPercent - sample.to.remainingPercent
        || (sample.invalidReason != null && typeof sample.invalidReason !== 'string')) return false;
      const upper = Math.ceil(sample.from.remainingPercent / 10) * 10;
      return sample.binUpper === (upper > 0 && sample.to.remainingPercent >= upper - 10 ? upper : null);
    }));
}

// Ingest only confirmed official-subscription events. Pair each quota reading
// with a completed local log scan before observing it. An optional totalTokens
// override must be an independent monotonic ledger, never an upstream total.
export function createQuotaTokenObserver({ statePath = null, minPercentagePoints = 3, startedAt = Date.now(), maxObservationGapMs = 300000 } = {}) {
  if (!Number.isFinite(minPercentagePoints) || minPercentagePoints <= 0) throw new Error('Invalid minimum quota span');
  if (!Number.isFinite(startedAt) || !Number.isFinite(maxObservationGapMs) || maxObservationGapMs <= 0) throw new Error('Invalid observation clock options');
  let state = { version: 1, startedAt, totalTokens: 0, tokenEvents: [], cycles: [], observations: [] };
  let loadError = null;
  if (statePath && fs.existsSync(statePath)) {
    try {
      const saved = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      if (!validState(saved)) {
        throw new Error('Unsupported quota observation state');
      }
      state = { ...state, ...saved };
    } catch {
      // Preserve unreadable evidence and fail closed instead of overwriting it.
      loadError = 'observation-state-unreadable';
    }
  }
  const tokenIdentities = new Set(state.tokenEvents.map(event => event.identity));
  const current = () => state.cycles.at(-1) ?? null;
  const persist = () => {
    if (!statePath || loadError) return;
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    const temporary = `${statePath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(state), 'utf8');
    fs.renameSync(temporary, statePath);
  };
  const breakCycle = (cycle, reason, timestamp) => {
    cycle.breaks.push({ reason, timestamp });
    cycle.anchor = null;
  };
  function markDiscontinuity(reason = 'source-unavailable', timestamp = Date.now()) {
    if (loadError || !current() || !current().anchor) return;
    breakCycle(current(), reason, timestamp);
    persist();
  }
  function ingestToken({ identity, timestamp, tokens, inputTokens = null, cachedInputTokens = null, outputTokens = null, model = null } = {}) {
    if (loadError) return false;
    const time = typeof timestamp === 'number' ? timestamp : Date.parse(timestamp);
    if (typeof identity !== 'string' || !identity || tokenIdentities.has(identity)
      || !Number.isFinite(time) || time < state.startedAt || !Number.isSafeInteger(tokens) || tokens <= 0
      || !Number.isSafeInteger(state.totalTokens + tokens)) return false;
    const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
    tokenIdentities.add(identity);
    state.totalTokens += tokens;
    state.tokenEvents.push({ identity, timestamp: time, tokens, inputTokens: count(inputTokens),
      cachedInputTokens: count(cachedInputTokens), outputTokens: count(outputTokens), model: typeof model === 'string' ? model : null });
    const last = state.observations.at(-1);
    if (last && time <= last.timestamp) {
      // A late event cannot be attributed to a future quota drop. Invalidate
      // overlapping evidence, retain it for audit, and restart pairing.
      for (const cycle of state.cycles) {
        for (const sample of cycle.samples) {
          if (time >= sample.from.timestamp && time <= sample.to.timestamp) sample.invalidReason = 'late-token-event';
        }
      }
      if (current()?.anchor) breakCycle(current(), 'late-token-event', last.timestamp);
    }
    // Buffered until observeQuota/flush; parent can ingest a whole scan cheaply.
    return true;
  }
  function observeQuota({ remainingPercent, resetAt, timestamp = Date.now(), totalTokens = state.totalTokens, continuity = true, sourceKey = 'official' } = {}) {
    if (loadError) return getSummary();
    const time = typeof timestamp === 'number' ? timestamp : Date.parse(timestamp);
    if (!Number.isFinite(remainingPercent) || remainingPercent < 0 || remainingPercent > 100
      || !Number.isSafeInteger(totalTokens) || totalTokens < 0 || !Number.isFinite(time)
      || resetAt == null || resetAt === '' || !sourceKey) {
      markDiscontinuity('invalid-observation', Number.isFinite(time) ? time : Date.now());
      return getSummary();
    }
    const observation = { remainingPercent, resetAt: String(resetAt), timestamp: time, totalTokens, sourceKey: String(sourceKey) };
    const last = state.observations.at(-1);
    // A delayed RPC response must not move the current epoch backwards.
    if (last && time <= last.timestamp) return getSummary();
    let cycle = current();
    if (!cycle || cycle.resetAt !== observation.resetAt || cycle.sourceKey !== observation.sourceKey) {
      cycle = { resetAt: observation.resetAt, sourceKey: observation.sourceKey, startedAt: time, samples: [], breaks: [], anchor: null };
      state.cycles.push(cycle);
    }
    const previous = last?.resetAt === observation.resetAt && last?.sourceKey === observation.sourceKey ? last : null;
    if (!continuity) breakCycle(cycle, 'source-discontinuity', time);
    else if (previous && time - previous.timestamp > maxObservationGapMs) breakCycle(cycle, 'observation-gap', time);
    else if (previous && remainingPercent > previous.remainingPercent) breakCycle(cycle, 'quota-increased', time);
    else if (previous && totalTokens < previous.totalTokens) breakCycle(cycle, 'token-counter-regressed', time);
    if (!cycle.anchor) cycle.anchor = observation;
    else {
      const percentagePoints = cycle.anchor.remainingPercent - remainingPercent;
      const tokens = totalTokens - cycle.anchor.totalTokens;
      // Keep the same anchor while quota is unchanged, or while Tokens lag a
      // quota update. Never treat an unmatched drop as zero-Token capacity.
      if (percentagePoints > 0 && tokens > 0) {
        const upper = Math.ceil(cycle.anchor.remainingPercent / 10) * 10;
        const binUpper = upper > 0 && remainingPercent >= upper - 10 ? upper : null;
        cycle.samples.push({ from: cycle.anchor, to: observation, percentagePoints, tokens, binUpper });
        cycle.anchor = observation;
      }
    }
    // Raw observations retain the evidence used by each interval and each cut.
    state.observations.push(observation);
    persist();
    return getSummary();
  }
  function getSummary() {
    const cycle = current();
    const samples = (cycle?.samples ?? []).filter(sample => !sample.invalidReason);
    const observedTokens = samples.reduce((sum, sample) => sum + sample.tokens, 0);
    const observedPercentagePoints = samples.reduce((sum, sample) => sum + sample.percentagePoints, 0);
    const ready = observedPercentagePoints >= minPercentagePoints && observedTokens > 0;
    const overallRate = observedPercentagePoints > 0 ? observedTokens / observedPercentagePoints : null;
    const bins = Array.from({ length: 10 }, (_, index) => {
      const upper = 100 - index * 10;
      const rows = samples.filter(sample => sample.binUpper === upper);
      const tokens = rows.reduce((sum, sample) => sum + sample.tokens, 0);
      const span = rows.reduce((sum, sample) => sum + sample.percentagePoints, 0);
      const rate = span >= minPercentagePoints && tokens > 0 ? tokens / span : null;
      return { upper, lower: upper - 10, observedTokens: tokens, observedPercentagePoints: span,
        sampleCount: rows.length, tokensPerPercentagePoint: rate, estimatedTokens: rate === null ? null : rate * 10 };
    });
    const missingBinCount = bins.filter(bin => bin.tokensPerPercentagePoint === null).length;
    // Missing/undersampled bins explicitly use the current cycle's overall rate.
    const estimatedFullTokens = ready ? bins.reduce((sum, bin) => sum + (bin.tokensPerPercentagePoint ?? overallRate) * 10, 0) : null;
    const stale = Boolean(cycle?.breaks.length && (!samples.length || cycle.breaks.at(-1).timestamp >= samples.at(-1).to.timestamp));
    return { status: loadError ? 'error' : stale ? 'stale' : ready ? 'ready' : cycle ? 'collecting' : 'waiting', error: loadError,
      resetAt: cycle?.resetAt ?? null, observedTokens, observedPercentagePoints,
      tokensPerPercentagePoint: ready ? overallRate : null, estimatedFullTokens,
      estimateMethod: missingBinCount === 10 ? 'observed-average' : 'bins-with-average-fill',
      minPercentagePoints, maxObservationGapMs, bins, missingBinCount, observedBinCount: 10 - missingBinCount,
      sampleCount: samples.length, crossBinSamples: samples.filter(sample => sample.binUpper === null).length,
      discontinuityCount: cycle?.breaks.length ?? 0, lastDiscontinuity: cycle?.breaks.at(-1)?.reason ?? null,
      segmentCount: cycle ? cycle.breaks.length + 1 : 0, invalidSampleCount: (cycle?.samples.length ?? 0) - samples.length, estimateStale: stale,
      cycleCount: state.cycles.length, updatedAt: state.observations.at(-1)?.timestamp ?? null,
      trackingStartedAt: state.startedAt, localTotalTokens: state.totalTokens,
      coverage: 'local-official-subscription', isEstimate: true };
  }
  return { ingestToken, observeQuota, getSummary, markDiscontinuity, flush: persist };
}
