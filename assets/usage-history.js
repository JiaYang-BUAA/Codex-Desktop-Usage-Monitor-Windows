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
    .usage-history-panel{width:100%;font-size:11px;line-height:1.5;color:#334155}
    .usage-history-header,.usage-history-controls,.usage-history-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:9px}
    .usage-history-controls{justify-content:flex-start}.usage-history-header strong{font-size:14px}.usage-history-caption{font-size:10px;opacity:.72;margin:5px 0}
    .usage-history-card{border:1px solid color-mix(in srgb,currentColor 14%,transparent);border-radius:8px;padding:10px;margin-top:8px}
    .usage-history-chart{display:block;width:100%;height:108px;overflow:visible}.usage-history-chart text{fill:currentColor;font:9px system-ui}
    .usage-history-detail{min-height:30px;font-variant-numeric:tabular-nums;font-size:10px;margin-top:3px;overflow-wrap:anywhere}
    .usage-history-grid{stroke:currentColor;opacity:.12;stroke-dasharray:2 4}.usage-history-bar{fill:#3b82f6}.usage-history-line{stroke:#16a085;stroke-width:2;fill:none}.usage-history-dot{fill:#16a085}
    @media(prefers-color-scheme:dark){.usage-history-panel{color:#e2e8f0}.usage-history-bar{fill:#75a7fa}.usage-history-line{stroke:#62cfb5}.usage-history-dot{fill:#62cfb5}}
    :host([data-history-open="true"]) .usage-columns{display:none}
    .usage-history-empty{padding:26px 4px;opacity:.7;text-align:center}.usage-history-reset{stroke:currentColor;opacity:.45;stroke-dasharray:3 3}
    :host([data-history-open="true"]) .usage-activity{display:none}
    .usage-activity{--activity-0:#eee9f8;--activity-1:#d4c8ee;--activity-2:#ad97db;--activity-3:#8163b9;--activity-4:#50318a;
      --activity-missing:#e8e6ee;--activity-stripe:#d1cedc;box-sizing:border-box;width:min(100%,720px);margin-top:10px;
      padding:9px 10px;border:1px solid color-mix(in srgb,currentColor 15%,transparent);border-radius:8px;font-size:11px;line-height:1.5}
    .usage-chart-toolbar{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px}
    .usage-chart-nav{display:flex;align-items:center;gap:6px;font-variant-numeric:tabular-nums}
    .usage-chart-nav button{min-height:24px;min-width:26px;padding:1px 4px;font-size:14px;line-height:1}
    .usage-chart-nav button[aria-disabled="true"]{opacity:.35;cursor:default}
    .usage-chart-track{display:grid;grid-template-areas:"chart"}
    .usage-chart-slide{grid-area:chart;display:flex;flex-direction:column;min-width:0;padding:2px 2px 6px;box-sizing:border-box}
    .usage-chart-slide[inert]{visibility:hidden}
    .usage-chart-slide .usage-activity-detail{min-height:16px;margin-top:auto;padding-top:5px}
    .usage-stat-columns{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px;align-items:end;margin-top:10px;position:relative}
    .usage-stat-column{appearance:none;min-width:0;background:none;border:0;color:inherit;font:inherit;cursor:pointer;padding:0;text-align:center}
    .usage-stat-column:focus-visible{outline:1px solid currentColor;outline-offset:-1px;border-radius:3px}
    .usage-stat-column i{display:flex;height:110px;align-items:end;justify-content:center;border-bottom:1px solid color-mix(in srgb,currentColor 16%,transparent)}
    .usage-stat-column b{display:block;width:56%;max-width:34px;background:var(--activity-3);border-radius:3px 3px 0 0}
    .usage-stat-column b[data-level="missing"]{height:3px;border-radius:0}
    .usage-stat-date{font-size:10px;opacity:.76;display:block;margin-top:4px;white-space:nowrap}
    .usage-cache-plot{height:110px;position:relative;margin-top:10px;background:repeating-linear-gradient(to bottom,color-mix(in srgb,currentColor 14%,transparent) 0 1px,transparent 1px 25%)}
    .usage-cache-plot svg{position:absolute;inset:0;width:100%;height:100%;color:#14836e}
    .usage-cache-plot path{stroke:currentColor;stroke-width:2;vector-effect:non-scaling-stroke;fill:none}
    .usage-cache-plot circle{fill:currentColor}
    .usage-cache-plot .usage-stat-columns{height:100%;margin:0;align-items:stretch}
    .usage-cache-plot .usage-stat-column:hover{background:color-mix(in srgb,currentColor 6%,transparent)}
    .usage-cache-plot + .usage-stat-columns{margin-top:0;text-align:center}
    .usage-token-composition{display:flex;height:13px;margin-top:13px;border-radius:4px;overflow:hidden;background:var(--activity-missing)}
    .usage-token-cached{background:var(--activity-3)}.usage-token-input{background:#368fb1}.usage-token-output{background:#d29531}
    .usage-token-parts{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px 12px;margin:10px 0;font-variant-numeric:tabular-nums}
    .usage-token-parts dd{margin:0;text-align:right}.usage-token-parts i{display:inline-block;width:7px;height:7px;border-radius:2px;margin-right:5px}
    @media(prefers-color-scheme:dark){.usage-cache-plot svg{color:#75d0b9}}
    .usage-activity-title{display:flex;flex-wrap:wrap;align-items:baseline;gap:3px 10px}
    .usage-activity-title strong{font-size:12px}.usage-activity-meta,.usage-activity-key{opacity:.76}
    .usage-activity-grid{display:grid;gap:3px;margin-top:5px;padding:3px 2px}
    .usage-activity-row{display:grid;grid-template-columns:28px repeat(24,minmax(0,1fr));align-items:center;gap:2px}
    .usage-activity-axis{font-size:9px;text-align:center;opacity:.72}
    .usage-activity-axis span:nth-child(2){text-align:left}.usage-activity-axis span:last-child{text-align:right}
    .usage-activity-day{font-size:10px;font-variant-numeric:tabular-nums}
    .usage-activity-cell,.usage-activity-sample{border-radius:2px;border:0}
    .usage-activity-cell{appearance:none;width:100%;min-width:0;height:11px;padding:0;cursor:pointer}
    .usage-activity-cell:hover,.usage-activity-cell:focus-visible{outline:1px solid currentColor;outline-offset:1px}
    .usage-activity [data-level="0"]{background:var(--activity-0)}.usage-activity [data-level="1"]{background:var(--activity-1)}
    .usage-activity [data-level="2"]{background:var(--activity-2)}.usage-activity [data-level="3"]{background:var(--activity-3)}
    .usage-activity [data-level="4"]{background:var(--activity-4)}
    .usage-activity [data-level="missing"]{background:repeating-linear-gradient(135deg,var(--activity-missing) 0 3px,var(--activity-stripe) 3px 4px)}
    .usage-activity [data-level="future"]{background:transparent;border:1px dotted color-mix(in srgb,currentColor 20%,transparent)}
    .usage-activity-key{display:flex;flex-wrap:wrap;align-items:center;gap:4px;margin-top:4px;font-size:10px}
    .usage-activity-sample{display:inline-block;width:8px;height:8px}.usage-activity-sample[data-level="missing"]{margin-left:4px}
    .usage-activity-detail{margin:5px 0 0;font-size:10px;font-variant-numeric:tabular-nums}
    @media(prefers-color-scheme:dark){.usage-activity{--activity-0:#353041;--activity-1:#52446f;--activity-2:#7960a5;
      --activity-3:#ad91d9;--activity-4:#d5bffd;--activity-missing:#312e38;--activity-stripe:#494455}}
    @media(max-height:700px){.usage-stat-column i,.usage-cache-plot{height:84px}.usage-activity-cell{height:9px}}
  `;
  const activityHours = Array.from({ length: 24 }, (_, hour) => hour);

  function dailyRows(data, now) {
    const today = new Date(now);
    const rows = Array.from({ length: 7 }, (_, index) => ({
      day: new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6 + index),
      values: Array(24).fill(null),
      buckets: [],
    }));
    const byDay = new Map(rows.map(row => [+row.day, row]));
    for (const bucket of Array.isArray(data?.tokenBuckets) ? data.tokenBuckets : []) {
      if (!num(bucket?.start) || bucket.start < +rows[0].day || bucket.start > now
        || !num(bucket.totalTokens) || bucket.totalTokens < 0) continue;
      const at = new Date(bucket.start);
      const row = byDay.get(+new Date(at.getFullYear(), at.getMonth(), at.getDate()));
      if (!row) continue;
      const hour = at.getHours();
      row.values[hour] = (row.values[hour] ?? 0) + bucket.totalTokens;
      row.buckets.push(bucket);
    }
    return rows;
  }

  function heatmap(rows, now, english, text, formatDay, selectedIndex) {
    const recorded = rows.flatMap(row => row.values).filter(value => value !== null);
    const max = Math.max(1, ...recorded);
    const axis = activityHours.map(hour => `<span>${hour % 6 === 0 || hour === 23 ? hour : ""}</span>`).join("");
    const cells = rows.map(({ day, values }, index) => {
      const date = esc(formatDay(day));
      const hours = activityHours.map(hour => {
        const time = new Date(day);
        time.setHours(hour, 0, 0, 0);
        const value = values[hour];
        const future = +time > now;
        const skipped = time.getHours() !== hour;
        const level = value !== null
          ? (value === 0 ? 0 : 1 + [0.1, 0.35, 0.65].filter(cutoff => value / max > cutoff).length)
          : (future || skipped ? "future" : "missing");
        const detail = value !== null ? `${tokenDetail(value, english)} Token`
          : skipped ? text("本地时钟跳过此小时", "Hour skipped by local clock")
          : future ? text("时段未到", "Hour has not started") : text("无采集记录", "No record");
        const label = `${date} ${String(hour).padStart(2, "0")}:00 · ${esc(detail)}`;
        const slot = index * 24 + hour;
        return `<button type="button" class="usage-activity-cell" data-level="${level}" data-activity-slot="${slot}"
          tabindex="${String(slot) === selectedIndex ? 0 : -1}" title="${label}" aria-label="${label}"></button>`;
      }).join("");
      return `<div class="usage-activity-row"><span class="usage-activity-day">${date}</span>${hours}</div>`;
    }).join("");
    return `<div class="usage-activity-title"><strong>${text("小时活跃度", "Hourly activity")}</strong><span class="usage-activity-meta">${text(
      `${recorded.length} 个小时有记录`, `${recorded.length} recorded hours`)}</span></div>
      <div class="usage-activity-grid">
        <div class="usage-activity-row usage-activity-axis" aria-hidden="true"><span></span>${axis}</div>${cells}
      </div>
      <div class="usage-activity-key" aria-hidden="true">${text("少", "Low")}${[0,1,2,3,4].map(
        level => `<i class="usage-activity-sample" data-level="${level}"></i>`).join("")}${text("多", "High")}
        <i class="usage-activity-sample" data-level="missing"></i>${text("无记录", "No record")}</div>
      <p class="usage-activity-detail" aria-live="polite">${text("悬停或用方向键查看本地每小时的 Token。", "Hover or use the arrow keys to inspect hourly tokens.")}</p>`;
  }

  function sumField(buckets, key) {
    if (!buckets.length || buckets.some(bucket => !num(bucket[key]) || bucket[key] < 0)) return null;
    return buckets.reduce((sum, bucket) => sum + bucket[key], 0);
  }

  function dailyChart(rows, text, formatDay, formatTokens) {
    const totals = rows.map(row => sumField(row.buckets, "totalTokens"));
    const maximum = Math.max(1, ...totals);
    const bars = rows.map(({ day }, index) => {
      const value = totals[index];
      const date = esc(formatDay(day));
      const label = `${date} · ${value === null ? text("无采集记录", "No record") : formatTokens(value) + " Token"}`;
      const bar = value === null ? '<b data-level="missing"></b>'
        : `<b style="height:${value ? Math.max(2, value / maximum * 100) + "%" : "2px"}"></b>`;
      return `<button type="button" class="usage-stat-column" data-chart-point="${index}" aria-label="${esc(label)}" title="${esc(label)}">
        <i aria-hidden="true">${bar}</i><span class="usage-stat-date">${date}</span></button>`;
    });
    const sum = totals.some(value => value !== null) ? formatTokens(totals.reduce((total, value) => total + (value ?? 0), 0)) : "—";
    return `<div class="usage-activity-title"><strong>${text("每日 Token", "Daily tokens")}</strong>
      <span class="usage-activity-meta">${text("已采集合计", "Recorded total")} · ${sum}</span></div>
      <div class="usage-stat-columns">${bars.join("")}</div>
      <p class="usage-activity-detail" aria-live="polite">${text("悬停或聚焦柱形查看当天记录。", "Hover or focus a bar to inspect that day's records.")}</p>`;
  }

  function compositionChart(buckets, text, formatTokens) {
    const total = sumField(buckets, "totalTokens");
    const cached = sumField(buckets, "cachedInputTokens");
    const input = sumField(buckets, "inputTokens");
    const output = sumField(buckets, "outputTokens");
    const uncached = input !== null && cached !== null && cached <= input ? input - cached : null;
    const parts = [
      [text("缓存输入", "Cached input"), cached, "cached"],
      [text("未缓存输入", "Uncached input"), uncached, "input"],
      [text("输出", "Output"), output, "output"],
    ];
    const complete = total > 0 && parts.every(([, value]) => value !== null) && cached + uncached + output === total;
    const bar = complete ? `<div class="usage-token-composition" aria-hidden="true">${parts.map(([, value, color]) =>
      `<span class="usage-token-${color}" style="width:${value / total * 100}%"></span>`).join("")}</div>` : "";
    return `<div class="usage-activity-title"><strong>${text("Token 构成", "Token breakdown")}</strong></div>${bar}
      <dl class="usage-token-parts">${parts.map(([label, value, color]) => `<dt><i class="usage-token-${color}"></i>${label}</dt>
        <dd>${value === null ? "—" : formatTokens(value)}${complete ? " · " + (value / total * 100).toFixed(1) + "%" : ""}</dd>`).join("")}</dl>
      <p class="usage-activity-detail">${complete ? text("占比按近 7 天已记录的总 Token 计算。", "Shares of recorded tokens over 7 days.")
        : text("分项或合计不可核对时，显示已记录的数值。", "Recorded counts are shown when the breakdown cannot be reconciled.")}</p>`;
  }

  function cacheChart(rows, text, formatDay) {
    const dates = rows.map(row => esc(formatDay(row.day)));
    const rates = rows.map(({ buckets }) => {
      const input = sumField(buckets, "inputTokens");
      const cached = sumField(buckets, "cachedInputTokens");
      return input > 0 && cached !== null && cached <= input ? cached / input * 100 : null;
    });
    const floor = Math.min(98, Math.floor(Math.min(100, ...rates.filter(num)) / 2) * 2);
    let line = "", points = "", connected = false;
    const buttons = rates.map((rate, index) => {
      if (rate !== null) {
        const x = index * 100 + 50;
        const y = 80 - 76 * (rate - floor) / (100 - floor);
        line += `${connected ? "L" : "M"}${x},${y}`;
        points += `<circle cx="${x}" cy="${y}" r="3"/>`;
      }
      connected = rate !== null;
      const label = `${dates[index]} · ${rate === null ? text("无命中率记录", "No cache rate") : rate.toFixed(1) + "%"}`;
      return `<button type="button" class="usage-stat-column" data-chart-point="${index}" aria-label="${esc(label)}" title="${esc(label)}"></button>`;
    });
    return `<div class="usage-activity-title"><strong>${text("缓存命中率", "Cache hit rate")}</strong>
        <span class="usage-activity-meta">${line ? `${floor}%–100%` : text("暂无有效记录", "No valid records")}</span></div>
      <div class="usage-cache-plot"><svg viewBox="0 0 700 84" preserveAspectRatio="none" aria-hidden="true">
        <path d="${line}"/>${points}</svg><div class="usage-stat-columns">${buttons.join("")}</div></div>
      <div class="usage-stat-columns" aria-hidden="true">${dates.map(date => `<span class="usage-stat-date">${date}</span>`).join("")}</div>
      <p class="usage-activity-detail" aria-live="polite">${text("每日缓存输入 ÷ 全部输入。", "Daily cached input ÷ total input.")}</p>`;
  }

  function selectChart(card, index) {
    const track = card.querySelector(".usage-chart-track");
    const slides = Array.from(track.children);
    const selected = Math.max(0, Math.min(index, slides.length - 1));
    card.dataset.chart = String(selected);
    slides.forEach((slide, i) => { slide.toggleAttribute("inert", i !== selected); });
    card.querySelector("[data-chart-count]").textContent = `${selected + 1} / ${slides.length}`;
    card.querySelector('[data-chart-step="-1"]').setAttribute("aria-disabled", String(selected === 0));
    card.querySelector('[data-chart-step="1"]').setAttribute("aria-disabled", String(selected === slides.length - 1));
  }

  function renderCharts(host, data, english, enabled) {
    const shadow = host.shadowRoot;
    let card = shadow.querySelector(".usage-activity");
    if (!enabled) {
      card?.remove();
      return;
    }
    if (host.dataset.open !== "true" || host.dataset.historyOpen === "true") return;
    const now = Date.now();
    const currentHour = new Date(now);
    currentHour.setMinutes(0, 0, 0);
    const signature = JSON.stringify([data?.updatedAt, +currentHour, english]);
    if (card?.dataset.signature === signature) return;
    if (!card) {
      card = document.createElement("section");
      card.className = "usage-activity";
      card.innerHTML = `<div class="usage-chart-toolbar"><strong data-chart-heading></strong><div class="usage-chart-nav">
        <button type="button" class="usage-history-button" data-chart-step="-1">‹</button>
        <span data-chart-count aria-live="polite"></span>
        <button type="button" class="usage-history-button" data-chart-step="1">›</button></div></div>
        <div class="usage-chart-track"></div>`;
      shadow.querySelector(".usage-columns").after(card);
      card.addEventListener("focusin", showActivityDetail);
      card.addEventListener("mouseover", showActivityDetail);
      card.addEventListener("click", showActivityDetail);
      card.addEventListener("keydown", navigateActivity);
      for (const button of card.querySelectorAll("[data-chart-step]")) {
        button.addEventListener("click", () => {
          selectChart(card, Number(card.dataset.chart) + Number(button.dataset.chartStep));
          window.__CODEX_USAGE_MONITOR_STATE__?.ensure?.();
        });
      }
    }
    const text = (zh, en) => english ? en : zh;
    const heading = text("近 7 天用量图表", "Usage charts · 7 days");
    card.setAttribute("aria-label", heading);
    card.querySelector("[data-chart-heading]").textContent = heading;
    card.querySelector('[data-chart-step="-1"]').setAttribute("aria-label", text("上一张图表", "Previous chart"));
    card.querySelector('[data-chart-step="1"]').setAttribute("aria-label", text("下一张图表", "Next chart"));
    const focus = shadow.activeElement;
    const index = Number(card.dataset.chart || 0);
    const selectedHour = card.querySelector('[data-activity-slot][tabindex="0"]')?.dataset.activitySlot || "0";
    const formatDay = new Intl.DateTimeFormat(english ? "en" : "zh-CN", { month: "numeric", day: "numeric" }).format;
    const formatTokens = value => tokenDetail(value, english);
    const rows = dailyRows(data, now);
    const markup = [
      heatmap(rows, now, english, text, formatDay, selectedHour),
      dailyChart(rows, text, formatDay, formatTokens),
      compositionChart(rows.flatMap(row => row.buckets), text, formatTokens),
      cacheChart(rows, text, formatDay),
    ];
    const track = card.querySelector(".usage-chart-track");
    track.innerHTML = markup.map(content => `<section class="usage-chart-slide">${content}</section>`).join("");
    card.dataset.signature = signature;
    selectChart(card, index);
    if (focus?.dataset.activitySlot !== undefined) track.querySelector(`[data-activity-slot="${focus.dataset.activitySlot}"]`)?.focus({ preventScroll: true });
    if (focus?.dataset.chartPoint !== undefined) track.children[index]?.querySelector(`[data-chart-point="${focus.dataset.chartPoint}"]`)?.focus({ preventScroll: true });
  }

  function showActivityDetail(event) {
    const cell = event.target.closest("[data-activity-slot], [data-chart-point]");
    if (!cell) return;
    const card = cell.closest(".usage-chart-slide");
    card.querySelector(".usage-activity-detail").textContent = cell.getAttribute("aria-label");
    if (event.type === "focusin" && cell.hasAttribute("data-activity-slot")) {
      card.querySelector('[tabindex="0"]').tabIndex = -1;
      cell.tabIndex = 0;
    }
  }

  function navigateActivity(event) {
    const cell = event.target.closest("[data-activity-slot]");
    const steps = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 24, ArrowUp: -24 };
    if (!cell || !Object.hasOwn(steps, event.key)) return;
    event.preventDefault();
    const next = Number(cell.dataset.activitySlot) + steps[event.key];
    event.currentTarget.querySelector(`[data-activity-slot="${next}"]`)?.focus();
  }

  function render(host, data, english = false) {
    const shadow = host.shadowRoot;
    host._usageHistory = { data, english };
    const text = (zh,en) => english ? en : zh;
    const settingsButton = shadow.querySelector('.usage-column-meta [data-toggle-settings]');
    if (!shadow.querySelector('[data-history-style]')) { const style=document.createElement('style');style.dataset.historyStyle='';style.textContent=css;shadow.append(style); }
    if (settingsButton && !shadow.querySelector('[data-history-open]')) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = settingsButton.className;
      button.dataset.historyOpen = '';
      button.onclick = () => {
        host.dataset.historyOpen = 'true';
        const state = host._usageHistory;
        render(host, state.data, state.english);
        window.__CODEX_USAGE_MONITOR_STATE__?.ensure?.();
        shadow.querySelector('[data-history-close]')?.focus();
      };
      settingsButton.before(button);
    }
    const openButton=shadow.querySelector('[data-history-open]');
    if(openButton) {openButton.textContent=text('历史','History');openButton.setAttribute('aria-expanded',String(host.dataset.historyOpen==='true'));}
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
  registry.history={render, renderCharts};
})();
