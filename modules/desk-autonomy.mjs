// Pure, versioned lifecycle. Paper observations are never actual fills or execution permission.
export const POLICY = 'desk-forward-v1';
const iso = n => new Date(n).toISOString();
const finite = n => typeof n === 'number' && Number.isFinite(n);
const positive = n => finite(n) && n > 0;
export function observable(plan, asset, now) {
  if (!asset?.ready || !asset.quote?.ready || !asset.quote.independent || !plan || Date.parse(plan.expiresAt) <= now) return false;
  if (now-Date.parse(plan.capturedAt)>35000 || Date.parse(plan.capturedAt)>now+2000) return false;
  if (![plan.low,plan.high,plan.stop,plan.target,plan.invalidation].every(positive) || plan.low>plan.high || !finite(plan.costPct) || plan.costPct<0 || plan.costPct>=100) return false;
  const long=plan.direction==='LONG';
  if (!long && plan.direction!=='SHORT') return false;
  if (long ? plan.stop>=plan.low || plan.invalidation>=plan.low || plan.target<=plan.high : plan.stop<=plan.high || plan.invalidation<=plan.high || plan.target>=plan.low) return false;
  const entry=long?plan.high:plan.low, sign=long?1:-1, cost=entry*plan.costPct/100;
  return ((plan.target-entry)*sign-cost)/((entry-plan.stop)*sign+cost)>=2;
}
export function volatility(asset, now) {
  const rows=asset?.timeframes?.['1h']?.candles ?? asset?.timeframes?.['1h']?.recentCandles;
  // An aggregate 2h bar is valid only with both contiguous fully closed 1h bars.
  const candles=Array.isArray(rows)?rows.filter(r=>r.confirmed!==false).map(r=>({at:Date.parse(r.ts),o:r.o,h:r.h,l:r.l,c:r.c})).filter(r=>[r.at,r.o,r.h,r.l,r.c].every(finite)&&r.at+3600000<=now).sort((a,b)=>a.at-b.at):[];
  function aggregate(hours) {
    const groups=new Map();
    for(const r of candles){const t=Math.floor(r.at/(hours*3600000))*hours*3600000; const g=groups.get(t)||[];g.push(r);groups.set(t,g);}
    const bars=[...groups.entries()].filter(([t,g])=>g.length===hours&&g.every((r,i)=>r.at===t+i*3600000)).map(([at,g])=>({at,h:Math.max(...g.map(r=>r.h)),l:Math.min(...g.map(r=>r.l)),c:g.at(-1).c}));
    if(bars.length<15||bars.at(-1).at+hours*3600000<now-hours*3600000-60000)return null;
    const last=bars.slice(-15);if(last.some((r,i)=>i&&r.at-last[i-1].at!==hours*3600000))return null;
    return last.slice(1).reduce((n,r,i)=>n+Math.max(r.h-r.l,Math.abs(r.h-last[i].c),Math.abs(r.l-last[i].c)),0)/14;
  }
  const atr2h=aggregate(2),atr4h=aggregate(4);
  return {checkedAt:iso(now),atr2h,atr4h,threshold:atr2h&&atr4h?(atr2h+atr4h)/2:null,basis:'已收盘 2h/4h 真波幅均值（各14根）',profitabilityValidated:false};
}
export function createRecord(plan, now) {
  return {policy:POLICY,plan:structuredClone(plan),createdAt:iso(now),status:'WAITING',entry:null,exit:null,lastQuoteAt:null,gaps:0,uncertain:false,events:[{at:iso(now),type:'CREATED'}],review:null};
}
export function advance(record, quote, now, reviewPassed=false) {
  if(!['WAITING','OPEN'].includes(record.status))return record;
  const r=structuredClone(record),p=r.plan,long=p.direction==='LONG',sign=long?1:-1;
  const emit=(type,extra={})=>{r.events=[...r.events,{at:iso(now),type,...extra}].slice(-80);};
  const close=(status,reason,price=null)=>{
    r.status=status;r.closedAt=iso(now);r.review=reason;emit(status,{reason});
    if(price!==null&&r.entry){const cost=r.entry.price*p.costPct/100;const risk=(r.entry.price-p.stop)*sign+cost;const pnl=(price-r.entry.price)*sign-cost;
      r.exit={price,at:iso(now),netPerUnit:pnl,netR: risk>0?pnl/risk:null,costPerUnit:cost,costBasis:'冻结往返成本情景；资金费率和实际成交未知',fillBasis:'观测到的欧易对手价，不假定按止损价成交'};
      if(r.uncertain){r.observedOutcome=status;r.status='UNRESOLVED';r.review='持有期间存在采样空档，触达先后无法证明；排除胜率';}
    }
    return r;
  };
  if(r.status==='WAITING'&&Date.parse(p.expiresAt)<=now)return close('EXPIRED','未入场，事件到期；不算亏损');
  if(!quote?.ready||!quote.independent||![quote.bid,quote.ask,quote.last].every(positive)||quote.bid>quote.ask||now-Date.parse(quote.bookAt)>10000||now-Date.parse(quote.tradeAt)>20000||Date.parse(quote.bookAt)>now+2000){
    if(r.status==='OPEN'&&!r.uncertain){r.uncertain=true;r.gaps++;emit('DATA_GAP');}return r;
  }
  const stamp=Date.parse(quote.bookAt);
  if(r.lastQuoteAt&&stamp<=Date.parse(r.lastQuoteAt))return r;
  if(r.status==='OPEN'&&r.lastQuoteAt&&stamp-Date.parse(r.lastQuoteAt)>20000){r.uncertain=true;r.gaps++;emit('DATA_GAP');}
  r.lastQuoteAt=quote.bookAt;
  const entry=long?quote.ask:quote.bid,exit=long?quote.bid:quote.ask;
  if(r.status==='WAITING'){
    if(long?exit<=p.invalidation||quote.last<=p.invalidation:exit>=p.invalidation||quote.last>=p.invalidation)return close('INVALIDATED','入场前结构失效；不算交易亏损');
    if(long?exit>=p.target:exit<=p.target)return close('MISSED','入场前第一目标已到达');
    if(entry>=p.low&&entry<=p.high&&reviewPassed){r.status='OPEN';r.entry={price:entry,at:quote.bookAt,modelReviewAt:iso(now),basis:'规则模型模拟入场；新闻/实际成本终审未替代人工'};emit('PAPER_ENTRY',{price:entry});}
    return r;
  }
  if(now-Date.parse(r.entry.at)>14*86400000)return close('TIME_EXIT','模拟持有满14天，按当前对手价退出',exit);
  // Respect the nearest frozen structural protection; never move it to manufacture reward/risk.
  if(long?exit<=p.invalidation:exit>=p.invalidation)return close('LOSS','触及冻结保护/止损；检查结构失效、执行成本与环境',exit);
  if(long?exit>=p.target:exit<=p.target)return close('WIN','触及冻结第一目标',exit);
  return r;
}
export function statistics(rows) {
  const closed=rows.filter(r=>['WIN','LOSS','TIME_EXIT'].includes(r.status)&&finite(r.exit?.netR));
  const values=closed.map(r=>r.exit.netR),wins=values.filter(x=>x>0),losses=values.filter(x=>x<0);
  let equity=0,peak=0,maxDrawdownR=0;for(const r of [...closed].sort((a,b)=>Date.parse(a.closedAt)-Date.parse(b.closedAt))){equity+=r.exit.netR;peak=Math.max(peak,equity);maxDrawdownR=Math.max(maxDrawdownR,peak-equity);}
  return {policy:POLICY,sampleSize:closed.length,wins:wins.length,losses:losses.length,winRate:closed.length?wins.length/closed.length:null,
    averageNetR:values.length?values.reduce((a,b)=>a+b,0)/values.length:null,profitFactor:losses.length?wins.reduce((a,b)=>a+b,0)/Math.abs(losses.reduce((a,b)=>a+b,0)):null,
    maxDrawdownR,unresolved:rows.filter(r=>r.status==='UNRESOLVED'||r.uncertain).length,waiting:rows.filter(r=>r.status==='WAITING').length,open:rows.filter(r=>r.status==='OPEN').length,
    notEntered:rows.filter(r=>['EXPIRED','INVALIDATED','MISSED','SUPERSEDED'].includes(r.status)).length,
    limitation:'规则模型前向模拟；报价采样不能证明中间未触线，不是实盘胜率；多方案有相关性，不能视为组合收益'};
}
export function ingestTape(previous, venue, now) {
  const old=previous||{ids:[],buckets:[],segments:0};
  if(venue.status!=='ok'||!venue.tradeFresh)return {...old,status:'unavailable',checkedAt:iso(now)};
  const seen=new Set(old.ids),fresh=venue.trades.filter(t=>!seen.has(String(t.id)));
  const overlap=venue.trades.some(t=>seen.has(String(t.id)));
  const gap=old.checkedAt&&(!overlap||now-Date.parse(old.checkedAt)>75000);
  const buckets=new Map((gap?[]:old.buckets).filter(b=>b.at>=now-4*3600000).map(b=>[b.at,{...b}]));
  for(const t of fresh){const at=Math.floor(t.ts/60000)*60000;const b=buckets.get(at)||{at,buy:0,sell:0,count:0,first:t.price,last:t.price};b[t.side]+=t.notional;b.count++;b.last=t.price;buckets.set(at,b);}
  return {status:'sampled',checkedAt:iso(now),lastTradeAt:iso(venue.trades.at(-1).ts),ids:venue.trades.map(t=>String(t.id)),buckets:[...buckets.values()].sort((a,b)=>a.at-b.at).slice(-241),
    segments:old.segments+(gap?1:0),overlap:!!overlap,continuousCoverageVerified:false,limitation:'后台 REST 去重采样；不是全量逐笔。缺口重启累计区间'};
}
