(() => {
  const registry = window.__CODEX_USAGE_MONITOR_MODULES__ ||= {};
  const num = v => typeof v === "number" && Number.isFinite(v);
  const esc = v => String(v).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const compact = n => new Intl.NumberFormat(undefined,{notation:"compact",maximumFractionDigits:1}).format(n);
  const tokenDetail = (n, english) => english ? n.toLocaleString()
    : n >= 100000000 ? `${(n / 100000000).toFixed(2)}亿`
      : n >= 10000 ? `${Math.round(n / 10000)}万` : String(Math.round(n));
  const dateLabel = (at, hourly) => new Date(at).toLocaleString(undefined, hourly ? {hour:"2-digit",minute:"2-digit"} : {month:"2-digit",day:"2-digit"});
  const css = `.usage-history-button{font:inherit;color:inherit;border:1px solid color-mix(in srgb,currentColor 20%,transparent);background:transparent;border-radius:6px;padding:5px 9px;cursor:pointer;min-height:28px}
    .usage-history-button:hover,.usage-history-button[aria-pressed="true"]{background:color-mix(in srgb,currentColor 10%,transparent)}
    .usage-history-button:focus-visible,.usage-history-chart [tabindex]:focus-visible{outline:2px solid #3b82f6;outline-offset:2px}
    .usage-history-panel{width:410px;max-width:calc(100vw - 70px);font-size:11px;line-height:1.5;color:#334155}
    .usage-history-header,.usage-history-controls,.usage-history-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:9px}
    .usage-history-controls{justify-content:flex-start}.usage-history-header strong{font-size:14px}.usage-history-caption{font-size:10px;opacity:.72;margin:5px 0}
    .usage-history-card{border:1px solid color-mix(in srgb,currentColor 14%,transparent);border-radius:8px;padding:10px;margin-top:8px}
    .usage-history-chart{display:block;width:100%;height:108px;overflow:visible}.usage-history-chart text{fill:currentColor;font:9px system-ui}
    .usage-history-detail{min-height:30px;font-variant-numeric:tabular-nums;font-size:10px;margin-top:3px;overflow-wrap:anywhere}
    .usage-history-grid{stroke:currentColor;opacity:.12;stroke-dasharray:2 4}.usage-history-bar{fill:#3b82f6}.usage-history-line{stroke:#16a085;stroke-width:2;fill:none}.usage-history-dot{fill:#16a085}
    @media(prefers-color-scheme:dark){.usage-history-panel{color:#e2e8f0}.usage-history-bar{fill:#75a7fa}.usage-history-line{stroke:#62cfb5}.usage-history-dot{fill:#62cfb5}}
    :host([data-history-open="true"]) .usage-columns{display:none}
    :host([data-history-open="true"]) .usage-popover{max-height:min(550px,calc(100vh - 100px))}
    .usage-history-empty{padding:26px 4px;opacity:.7;text-align:center}.usage-history-reset{stroke:currentColor;opacity:.45;stroke-dasharray:3 3}
  `;
  function render(host, data, english = false) {
    const shadow = host.shadowRoot;
    host._usageHistory = { data, english };
    const text = (zh,en) => english ? en : zh;
    const footer = shadow.querySelector('.usage-column-footer');
    if (!shadow.querySelector('[data-history-style]')) { const style=document.createElement('style');style.dataset.historyStyle='';style.textContent=css;shadow.append(style); }
    if (footer && !footer.querySelector('[data-history-open]')) {
      const button=document.createElement('button');button.type='button';button.className='usage-history-button';button.dataset.historyOpen='';
      button.onclick=()=>{host.dataset.historyOpen='true';const s=host._usageHistory;render(host,s.data,s.english);shadow.querySelector('.usage-popover').scrollTop=0;window.__CODEX_USAGE_MONITOR_STATE__?.ensure?.();shadow.querySelector('[data-history-close]')?.focus();};
      footer.insertBefore(button,footer.querySelector('.usage-column-meta'));
    }
    const openButton=shadow.querySelector('[data-history-open]');
    if(openButton) {openButton.textContent=text('用量历史','Usage history');openButton.setAttribute('aria-expanded',String(host.dataset.historyOpen==='true'));}
    let panel=shadow.querySelector('.usage-history-panel');
    if(host.dataset.historyOpen!=='true') {if(panel) panel.hidden=true;return;}
    if(!panel){panel=document.createElement('section');panel.className='usage-history-panel';shadow.querySelector('.usage-popover').prepend(panel);}
    panel.hidden=false;
    const range=['1','7','30'].includes(host.dataset.historyRange)?host.dataset.historyRange:'1';
    const windowKey=host.dataset.historyWindow==='primary'?'primary':'secondary';
    const now=Date.now();const today=new Date(now);today.setHours(0,0,0,0);
    const start=new Date(today);start.setDate(start.getDate()-Number(range)+1);
    const signature=JSON.stringify([data?.updatedAt,data?.error,range,windowKey,english,today.getTime(),Math.floor(now/60000)]);
    if(panel.dataset.signature===signature)return;
    panel.dataset.signature=signature;
    const focused=shadow.activeElement;
    const focusKey=focused?.getAttribute?.('data-history-choice');
    const focusPoint=focused?.getAttribute?.('data-history-focus');
    const focusClose=focused?.hasAttribute?.('data-history-close');
    const hourly=range==='1'; const buckets=[];
    for(let i=0;i<(hourly?24:Number(range));i++) {const d=new Date(start);hourly?d.setHours(i):d.setDate(d.getDate()+i);const end=new Date(d);hourly?end.setHours(end.getHours()+1):end.setDate(end.getDate()+1);buckets.push({start:+d,end:+end,total:0,known:false});}
    for(const b of (Array.isArray(data?.tokenBuckets)?data.tokenBuckets:[]).slice(-800)) {if(!num(b.start)||!num(b.totalTokens)||b.totalTokens<0)continue;const bucket=buckets.find(v=>b.start>=v.start&&b.start<v.end);if(bucket){bucket.total+=b.totalTokens;bucket.known=true;}}
    const total=buckets.reduce((n,b)=>n+b.total,0);const max=Math.max(1,...buckets.map(b=>b.total));
    const W=376,H=108,L=35,R=370,T=12,B=86;const plotW=R-L;
    const button=(label,kind,value,selected)=>`<button type="button" class="usage-history-button" data-history-choice="${kind}:${value}" aria-pressed="${selected}">${label}</button>`;
    const grid=`<line class="usage-history-grid" x1="${L}" y1="${T}" x2="${R}" y2="${T}"/><line class="usage-history-grid" x1="${L}" y1="${B}" x2="${R}" y2="${B}"/>`;
    let tokenSvg=grid+`<text x="0" y="16">${esc(compact(max))}</text><text x="18" y="${B}">0</text>`;
    for(const [i,b] of buckets.entries()) {const x=L+i*plotW/buckets.length+2,w=Math.max(2,plotW/buckets.length-4),height=(B-T)*b.total/max;
      const label=`${dateLabel(b.start,hourly)} · ${b.known?tokenDetail(b.total,english)+' Token':text('无记录','No record')}`;
      if(b.known)tokenSvg+=`<rect class="usage-history-bar" tabindex="0" role="img" aria-label="${esc(label)}" data-history-detail="${esc(label)}" data-history-focus="token:${b.start}" x="${x}" y="${B-Math.max(1,height)}" width="${w}" height="${Math.max(1,height)}" rx="2"><title>${esc(label)}</title></rect>`;
      else if(b.start<=now)tokenSvg+=`<path d="M${x},${B}h${w}" stroke="currentColor" opacity=".25"><title>${esc(label)}</title></path>`;
    }
    tokenSvg+=`<text x="${L}" y="104">${esc(dateLabel(+start,hourly))}</text><text x="${R}" y="104" text-anchor="end">${esc(dateLabel(buckets.at(-1).start,hourly))}</text>`;
    const samples=(Array.isArray(data?.quotaSamples)?data.quotaSamples:[]).slice(-10000).filter(s=>num(s.at)&&s.at>=+start&&s.at<=now).sort((a,b)=>a.at-b.at);
    const valueKey=windowKey+'Remaining',resetKey=windowKey+'ResetsAt';
    const valid=s=>num(s?.[valueKey])&&s[valueKey]>=0&&s[valueKey]<=100;
    const end=hourly?buckets.at(-1).end:Math.max(+start+3600000,now);
    const x=at=>L+(at-start)/(end-start)*plotW,y=p=>B-p/100*(B-T);
    let quotaSvg=grid+'<text x="0" y="16">100%</text><text x="12" y="86">0%</text>',paths=[],part=[],resets=[];
    let prev=null;
    for(const s of samples){if(!valid(s)){if(part.length)paths.push(part);part=[];prev=null;continue;}const reset=prev&&s[resetKey]!==prev[resetKey];if(prev&&(s.at-prev.at>600000||reset)){if(part.length)paths.push(part);part=[];}if(reset)resets.push(s);part.push(s);prev=s;}
    if(part.length)paths.push(part);
    const stride=Math.max(1,Math.ceil(samples.length/300));
    for(const segment of paths){const points=segment.filter((s,i)=>i===0||i===segment.length-1||i%stride===0);let d='';for(const [i,s]of points.entries())d+=i?`H${x(s.at).toFixed(2)}V${y(s[valueKey]).toFixed(2)}`:`M${x(s.at).toFixed(2)},${y(s[valueKey]).toFixed(2)}`;quotaSvg+=`<path class="usage-history-line" d="${d}"/>`;for(const s of points){const label=`${new Date(s.at).toLocaleString()} · ${s[valueKey].toFixed(1)}%`;quotaSvg+=`<circle class="usage-history-dot" cx="${x(s.at)}" cy="${y(s[valueKey])}" r="2.5" tabindex="0" role="img" aria-label="${esc(label)}" data-history-detail="${esc(label)}" data-history-focus="quota:${windowKey}:${s.at}"><title>${esc(label)}</title></circle>`;}}
    for(const s of resets.slice(-30))quotaSvg+=`<line class="usage-history-reset" x1="${x(s.at)}" x2="${x(s.at)}" y1="${T}" y2="${B}"><title>${text('重置时间变化','Reset time changed')}</title></line>`;
    quotaSvg+=`<text x="${L}" y="104">${esc(dateLabel(+start,hourly))}</text><text x="${R}" y="104" text-anchor="end">${esc(dateLabel(hourly?end-60000:end,hourly))}</text>`;
    const known=samples.filter(valid);const last=known.at(-1);
    panel.innerHTML=`<div class="usage-history-header"><strong>${text('用量历史','Usage history')}</strong><button type="button" data-history-close class="usage-history-button">${text('返回','Back')}</button></div>
      <div class="usage-history-controls">${['1','7','30'].map(v=>button(v==='1'?text('今日','Today'):v+text(' 天',' days'),'range',v,range===v)).join('')}</div>
      <div class="usage-history-card"><div class="usage-history-heading"><strong>${text('Token · 本机记录','Tokens · local records')}</strong><span>${esc(compact(total))}</span></div>${buckets.some(b=>b.known)?`<svg class="usage-history-chart" viewBox="0 0 ${W} ${H}" aria-label="${text('Token 用量柱状图','Token usage bar chart')}">${tokenSvg}</svg>`:`<div class="usage-history-empty">${text('此时段暂无已采集的 Token 记录','No collected token records in this period')}</div>`}<div class="usage-history-detail">${text('悬停或键盘聚焦查看数值；短横线表示无记录。','Hover or focus for values; dashes mean no records.')}</div></div>
      <div class="usage-history-card"><div class="usage-history-heading"><strong>${text('额度剩余','Quota remaining')}</strong><span>${last?last[valueKey].toFixed(1)+'%':'--'}</span></div><div class="usage-history-controls">${button(text('5 小时','5 hours'),'window','primary',windowKey==='primary')}${button(text('7 天','7 days'),'window','secondary',windowKey==='secondary')}</div>${known.length?`<svg class="usage-history-chart" viewBox="0 0 ${W} ${H}" aria-label="${text('额度剩余阶梯图','Remaining quota step chart')}">${quotaSvg}</svg>`:`<div class="usage-history-empty">${text('暂无此周期的额度记录','No quota samples for this window')}</div>`}<div class="usage-history-detail">${text('从启用后开始记录；断线留空，虚线标记重置时间变化。','Recorded since enabled; gaps stay blank, dashed markers indicate reset-time changes.')}</div></div>
      <p class="usage-history-caption">${text('本机时区 · 仅已采集记录，可能不完整；Token 不含其他设备用量。','Local timezone · collected records may be incomplete; tokens exclude other devices.')}</p>${data?.error?`<p class="usage-history-caption">${esc(data.error)}</p>`:''}`;
    panel.querySelector('[data-history-close]').onclick=()=>{host.dataset.historyOpen='false';const s=host._usageHistory;render(host,s.data,s.english);window.__CODEX_USAGE_MONITOR_STATE__?.ensure?.();shadow.querySelector('[data-history-open]')?.focus();};
    panel.querySelectorAll('[data-history-choice]').forEach(b=>b.onclick=()=>{const[k,v]=b.dataset.historyChoice.split(':');host.dataset[k==='range'?'historyRange':'historyWindow']=v;render(host,host._usageHistory.data,english);panel.querySelector(`[data-history-choice="${k}:${v}"]`)?.focus();});
    for(const node of panel.querySelectorAll('[data-history-detail]')){const show=()=>{node.closest('.usage-history-card').querySelector('.usage-history-detail').textContent=node.dataset.historyDetail;};node.onmouseenter=show;node.onfocus=show;}
    if(focusKey)panel.querySelector(`[data-history-choice="${focusKey}"]`)?.focus();
    else if(focusPoint)panel.querySelector(`[data-history-focus="${focusPoint}"]`)?.focus();
    else if(focusClose)panel.querySelector('[data-history-close]')?.focus();
  }
  registry.history={render};
})();
