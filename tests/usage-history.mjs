import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { UsageHistory } from '../scripts/usage/history.mjs';
import { LocalCodexTokenTracker, UsageClient } from '../scripts/usage-client.mjs';

const temp=await fs.mkdtemp(path.join(os.tmpdir(),'usage-history-'));
let now=Date.now();
const at=now-3600000;
try {
  const filePath=path.join(temp,'history.json');
  const store=new UsageHistory({filePath,now:()=>now});
  const event={timestamp:at,tokens:120,inputTokens:100,cachedInputTokens:70,outputTokens:20};
  assert.equal(store.recordToken(event,'turn:1'),true);
  assert.equal(store.recordToken(event,'turn:1'),false);
  assert.equal(store.snapshot().tokenBuckets[0].totalTokens,120);
  store.flush(true);
  const restored=new UsageHistory({filePath,now:()=>now});
  assert.equal(restored.recordToken(event,'turn:1'),false,'restart must not double count');
  restored.recordToken({...event,tokens:80,outputTokens:null},'turn:2');
  assert.equal(restored.snapshot().tokenBuckets[0].totalTokens,200);
  assert.equal(restored.snapshot().tokenBuckets[0].outputTokens,null,'missing components remain unknown');
  const quota={quotaObservedAt:now,planType:'pro',windows:[{limitId:'codex',windowDurationMins:300,remainingPercent:55,resetsAt:123},{limitId:'codex',windowDurationMins:10080,remainingPercent:0,resetsAt:456}]};
  restored.recordQuota(quota);
  restored.recordQuota({...quota,quotaObservedAt:null});
  restored.recordQuota(quota);
  assert.equal(restored.snapshot().quotaSamples.length,1);
  assert.equal(restored.snapshot().quotaSamples[0].primaryRemaining,null);
  assert.equal(restored.snapshot().quotaSamples[0].secondaryRemaining,0,'real zero must remain zero');
  now+=60000;
  restored.recordQuota({...quota,quotaObservedAt:now,windows:[{limitId:'spark',windowDurationMins:10080,remainingPercent:90}]});
  assert.equal(restored.snapshot().quotaSamples.length,1,'model-specific pool must not replace main');
  restored.recordQuota({...quota,quotaObservedAt:now,windows:[{limitId:'codex',windowDurationMins:10080,remainingPercent:99,resetsAt:999}]});
  assert.equal(restored.snapshot().quotaSamples.length,2,'reset/change sample retained');
  now+=32*86400000;
  assert.equal(restored.snapshot().tokenBuckets.length,0);
  assert.equal(restored.snapshot().quotaSamples.length,0);

  // Integration with existing incremental parser: unchanged scans and tracker restart.
  now=Date.now();
  const sessions=path.join(temp,'sessions');await fs.mkdir(sessions);
  const stamp=new Date(now-1000).toISOString();
  const id='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const log=[{timestamp:stamp,type:'session_meta',payload:{id,model_provider:'openai'}},{timestamp:stamp,type:'turn_context',payload:{turn_id:'turn-a',model_provider:'openai'}},{timestamp:stamp,type:'event_msg',payload:{type:'token_count',info:{last_token_usage:{total_tokens:120,input_tokens:100,cached_input_tokens:70,output_tokens:20},total_token_usage:{total_tokens:120,input_tokens:100,cached_input_tokens:70}}}}].map(v=>JSON.stringify(v)).join('\n')+'\n';
  await fs.writeFile(path.join(sessions,`rollout-${id}.jsonl`),log);
  const integration=new UsageHistory({now:()=>now});
  for(let i=0;i<2;i++){
    const tracker=new LocalCodexTokenTracker({sessionRoot:sessions,counterPath:path.join(temp,'counter.json'),officialModelProviders:['openai'],history:integration,now:()=>now});
    await tracker.refresh();await tracker.refresh();await tracker.stop();
  }
  assert.equal(integration.snapshot().tokenBuckets.reduce((s,b)=>s+b.totalTokens,0),120);
  const client=new UsageClient({command:'unused',onUpdate:()=>{}});
  client.rateLimits={rateLimits:{limitId:'codex',secondary:{usedPercent:20,windowDurationMins:10080}}};
  client.ensureConnected=async()=>({request:async method=>{if(method==='account/rateLimits/read')throw new Error('offline');return {};}});
  await client.refresh();
  assert.equal(client.view.quotaObservedAt,null,'cached quota must not become a new observation on read failure');

  const dom=new JSDOM('<div id="host"></div>',{runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window,host=w.document.getElementById('host');
  host.attachShadow({mode:'open'}).innerHTML='<div class="usage-popover"><div class="usage-columns"><div class="usage-column-footer"></div></div></div>';
  w.eval(await fs.readFile(new URL('../assets/usage-history.js',import.meta.url),'utf8'));
  const today=new Date();today.setHours(1,0,0,0);const sampleTime=Math.min(+today,Date.now()-60000);
  const data={updatedAt:now,tokenBuckets:[{start:sampleTime,totalTokens:500}],quotaSamples:[{at:sampleTime,secondaryRemaining:0,secondaryResetsAt:1},{at:sampleTime+1000,secondaryRemaining:100,secondaryResetsAt:2}]};
  const render=w.__CODEX_USAGE_MONITOR_MODULES__.history.render;
  render(host,data,false);host.shadowRoot.querySelector('[data-history-open]').click();
  assert.equal(host.dataset.historyOpen,'true');
  assert.equal(host.shadowRoot.querySelectorAll('svg').length,2);
  assert.match(host.shadowRoot.querySelector('.usage-history-panel').textContent,/本机记录/);
  const choice=host.shadowRoot.querySelector('[data-history-choice="range:7"]');choice.click();
  assert.equal(host.dataset.historyRange,'7');
  render(host,{...data,updatedAt:now+1},false);
  assert.equal(host.shadowRoot.querySelector('[data-history-choice="range:7"]').getAttribute('aria-pressed'),'true');
  host.shadowRoot.querySelector('[data-history-choice="window:primary"]').click();
  assert.match(host.shadowRoot.querySelector('.usage-history-panel').textContent,/暂无此周期/);
  host.shadowRoot.querySelector('[data-history-close]').click();assert.equal(host.dataset.historyOpen,'false');
  dom.window.close();
  console.log('Usage history persistence, dedup, retention, quota freshness and chart interaction tests passed.');
} finally {await fs.rm(temp,{recursive:true,force:true});}
