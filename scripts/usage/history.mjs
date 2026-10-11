import { readFileSync, writeFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const HOUR = 3600000;
const RETENTION = 31 * 24 * HOUR;
const validCount = (v) => Number.isSafeInteger(v) && v >= 0;
const percent = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100 ? v : null;

// Stores aggregates and hashed event identities only, never conversation text.
export class UsageHistory {
  constructor({ filePath = null, now = () => Date.now() } = {}) {
    this.filePath = filePath;
    this.now = now;
    this.buckets = new Map();
    this.seen = new Map();
    this.quotaSamples = [];
    this.updatedAt = null;
    this.error = null;
    this.dirty = false;
    this.lastSave = 0;
    this.cached = null;
    this.lastPrune = 0;
    if (filePath) {
      try {
        if (statSync(filePath).size > 24 * 1024 * 1024) throw new Error("oversize");
        const data = JSON.parse(readFileSync(filePath, "utf8"));
        if (data.schemaVersion !== 1) throw new Error("schema");
        if (!Array.isArray(data.tokenBuckets) || !Array.isArray(data.seen) || !Array.isArray(data.quotaSamples)
          || (data.tokenBuckets.length > 0 && data.seen.length === 0)) throw new Error("incomplete");
        for (const b of (data.tokenBuckets || []).slice(-800)) {
          if (Number.isFinite(b.start) && validCount(b.totalTokens)) this.buckets.set(b.start, {
            start: b.start, totalTokens: b.totalTokens,
            inputTokens: validCount(b.inputTokens) ? b.inputTokens : null,
            cachedInputTokens: validCount(b.cachedInputTokens) ? b.cachedInputTokens : null,
            outputTokens: validCount(b.outputTokens) ? b.outputTokens : null,
          });
        }
        for (const pair of (data.seen || []).slice(-200000)) {
          if (Array.isArray(pair) && /^[a-f0-9]{32}$/.test(pair[0]) && Number.isFinite(pair[1])) this.seen.set(...pair);
        }
        this.quotaSamples = (data.quotaSamples || []).slice(-10000).filter(s => Number.isFinite(s.at)).map(s => ({
          at: s.at, primaryRemaining: percent(s.primaryRemaining), secondaryRemaining: percent(s.secondaryRemaining),
          primaryResetsAt: Number.isFinite(s.primaryResetsAt) ? s.primaryResetsAt : null,
          secondaryResetsAt: Number.isFinite(s.secondaryResetsAt) ? s.secondaryResetsAt : null,
        })).sort((a,b) => a.at-b.at);
        this.updatedAt = Number.isFinite(data.updatedAt) ? data.updatedAt : null;
      } catch (e) {
        if (e.code !== "ENOENT") this.error = "历史文件不可读，当前仅显示本次采集记录";
      }
    }
    this.prune(true);
  }
  changed(at = this.now()) { this.dirty = true; this.cached = null; this.updatedAt = at; }
  prune(force = false) {
    const now = this.now();
    if (!force && now - this.lastPrune < HOUR) return;
    this.lastPrune = now;
    const cutoff = now - RETENTION;
    for (const [key,b] of this.buckets) if (b.start < cutoff || b.start > now + HOUR) { this.buckets.delete(key); this.changed(); }
    for (const [key,at] of this.seen) if (at < cutoff || at > now + HOUR) { this.seen.delete(key); this.changed(); }
    if (this.seen.size < 200000 && this.error === "历史记录已达容量上限，部分新增 Token 暂未计入") { this.error = null; this.cached = null; }
    const samples = this.quotaSamples.filter(s => s.at >= cutoff && s.at <= now).slice(-10000);
    if (samples.length !== this.quotaSamples.length) { this.quotaSamples = samples; this.changed(); }
  }
  recordToken(event, identity) {
    const now = this.now();
    this.prune();
    if (!Number.isFinite(event.timestamp) || event.timestamp < now - RETENTION || event.timestamp > now || !validCount(event.tokens) || !event.tokens) return false;
    const key = createHash("sha256").update(identity).digest("hex").slice(0,32);
    if (this.seen.has(key)) return false;
    if (this.seen.size >= 200000) { this.error = "历史记录已达容量上限，部分新增 Token 暂未计入"; this.cached = null; return false; }
    const date = new Date(event.timestamp); date.setMinutes(0,0,0);
    const start = date.getTime();
    const bucket = this.buckets.get(start) || { start, totalTokens: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
    if (!Number.isSafeInteger(bucket.totalTokens + event.tokens)) return false;
    bucket.totalTokens += event.tokens;
    for (const field of ["inputTokens", "cachedInputTokens", "outputTokens"]) {
      bucket[field] = validCount(bucket[field]) && validCount(event[field]) && Number.isSafeInteger(bucket[field] + event[field]) ? bucket[field] + event[field] : null;
    }
    this.buckets.set(start,bucket);
    this.seen.set(key,event.timestamp);
    this.changed(now);
    return true;
  }
  recordQuota(view) {
    const at = view?.quotaObservedAt;
    if (!Number.isFinite(at) || at > this.now() || at < this.now()-RETENTION) return;
    const previous = this.quotaSamples.at(-1);
    if (previous && at <= previous.at) return;
    const windows = Array.isArray(view.windows) ? view.windows : [];
    const main = windows.filter(w => !w.limitId || w.limitId === "codex");
    const primary = main.find(w => w.windowDurationMins === 300);
    const secondary = main.find(w => w.windowDurationMins === 10080);
    const sample = { at,
      primaryRemaining: view.planType === "pro" ? null : percent(primary?.remainingPercent),
      secondaryRemaining: percent(secondary?.remainingPercent),
      primaryResetsAt: Number.isFinite(primary?.resetsAt) ? primary.resetsAt : null,
      secondaryResetsAt: Number.isFinite(secondary?.resetsAt) ? secondary.resetsAt : null,
    };
    if (sample.primaryRemaining === null && sample.secondaryRemaining === null) return;
    const keys = ["primaryRemaining", "secondaryRemaining", "primaryResetsAt", "secondaryResetsAt"];
    if (previous && keys.every(k => previous[k] === sample[k]) && at-previous.at < 300000) return;
    this.quotaSamples.push(sample);
    if (this.quotaSamples.length > 10000) this.quotaSamples.shift();
    this.changed(at);
  }
  snapshot() {
    this.prune();
    return this.cached ||= { schemaVersion: 1, updatedAt: this.updatedAt, tokenScope: "local",
      tokenBuckets: [...this.buckets.values()].sort((a,b) => a.start-b.start).map(b => ({...b})),
      quotaSamples: this.quotaSamples.slice(), error: this.error };
  }
  flush(force = false) {
    if (!this.filePath || !this.dirty || (!force && this.now()-this.lastSave < 30000)) return;
    try {
      mkdirSync(path.dirname(this.filePath),{recursive:true});
      const temp = `${this.filePath}.${process.pid}.tmp`;
      writeFileSync(temp,JSON.stringify({...this.snapshot(),seen:[...this.seen]}));
      renameSync(temp,this.filePath);
      this.lastSave = this.now(); this.dirty = false;
    } catch { this.error = "历史记录保存失败，重启后可能丢失本次记录"; this.cached = null; }
  }
}
