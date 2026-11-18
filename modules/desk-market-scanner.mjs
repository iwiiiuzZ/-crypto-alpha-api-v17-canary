// Closed-bar market events. These are observations, not trade permission.
export const SCANNER_POLICY='closed-market-events-v1';
const TF={'15m':900000,'1h':3600000,'4h':14400000};
const mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
export function scanMarketFrame(asset,timeframe,frame,now){
 const ms=TF[timeframe],blocked=reason=>({asset,timeframe,reason,events:[]});
 if(!ms||frame?.status!=='ok'||frame.quality?.passed!==true||frame.dataFreshness?.state==='stale-on-error')return blocked('FRAME_NOT_VERIFIED');
 const rows=(frame.recentCandles||[]).filter(c=>c.confirmed===true&&Date.parse(c.ts)+ms<=now).slice(-80);
 if(rows.length<35)return blocked('INSUFFICIENT_CLOSED_BARS');
 if(rows.some((r,i)=>![r.o,r.h,r.l,r.c,r.volume].every(Number.isFinite)||r.l<=0||r.volume<0||r.h<Math.max(r.o,r.c)||r.l>Math.min(r.o,r.c)||(i&&Date.parse(r.ts)-Date.parse(rows[i-1].ts)!==ms)))return blocked('INVALID_OR_GAPPED_BARS');
 const last=rows.at(-1),expected=Math.floor(now/ms)*ms-ms;
 if(Date.parse(last.ts)!==expected)return blocked('LATEST_CLOSED_BAR_MISSING');
 const prior=rows.slice(-21,-1),atr=mean(rows.slice(-15,-1).map((r,i)=>Math.max(r.h-r.l,Math.abs(r.h-rows[rows.length-16+i].c),Math.abs(r.l-rows[rows.length-16+i].c))));
 if(!(atr>0))return blocked('ATR_UNAVAILABLE');
 const avgVolume=mean(prior.map(r=>r.volume)),volumeRatio=avgVolume>0?last.volume/avgVolume:null;
 const resistance=Math.max(...prior.map(r=>r.h)),support=Math.min(...prior.map(r=>r.l)),previous=rows.at(-2),events=[];
 const add=(kind,direction,evidence)=>events.push({id:[SCANNER_POLICY,asset,timeframe,kind,last.ts].join(':'),asset,timeframe,kind,direction,barAt:last.ts,confirmedAt:new Date(Date.parse(last.ts)+ms).toISOString(),observedAt:new Date(now).toISOString(),price:last.c,evidence,scope:'MARKET_OBSERVATION',executionPermission:false});
 for(const [direction,boundary,hit] of [['UP',resistance,last.c>resistance+.1*atr&&previous.c<=resistance],['DOWN',support,last.c<support-.1*atr&&previous.c>=support]])if(hit)add(volumeRatio>=2?'VOLUME_BREAKOUT':'STRUCTURE_BREAKOUT',direction,{boundary,atr,volumeRatio,lookbackBars:20});
 const range=last.h-last.l,body=Math.abs(last.c-last.o),upper=last.h-Math.max(last.o,last.c),lower=Math.min(last.o,last.c)-last.l;
 if(range>=atr&&upper>=Math.max(body*2,range*.6))add('UPPER_WICK','DOWN',{wick:upper,range,atr,volumeRatio});
 if(range>=atr&&lower>=Math.max(body*2,range*.6))add('LOWER_WICK','UP',{wick:lower,range,atr,volumeRatio});
 if(range>=2.5*atr&&volumeRatio>=2&&!events.some(e=>e.kind.includes('BREAKOUT')))add('RANGE_VOLUME_SHOCK',last.c>=last.o?'UP':'DOWN',{range,atr,volumeRatio});
 // Wilder RSI calculated from the same closed candles. Pivot becomes observable
 // only after two right-hand bars close; no lookahead or intrabar repainting.
 const rsi=Array(rows.length).fill(null);let gain=0,loss=0;
 for(let i=1;i<rows.length;i++){const d=rows[i].c-rows[i-1].c;if(i<=14){gain+=Math.max(d,0)/14;loss+=Math.max(-d,0)/14;}else{gain=(gain*13+Math.max(d,0))/14;loss=(loss*13+Math.max(-d,0))/14;}if(i>=14)rsi[i]=loss===0?(gain===0?50:100):100-100/(1+gain/loss);}
 for(const high of [true,false]){
  const pivots=[];for(let i=16;i<rows.length-2;i++){const v=high?rows[i].h:rows[i].l;if([-2,-1,1,2].every(k=>high?v>rows[i+k].h:v<rows[i+k].l))pivots.push(i);}
  const b=pivots.at(-1),a=pivots.at(-2);
  if(b!==rows.length-3||a===undefined||b-a<3)continue;
  const priceDelta=(high?rows[b].h-rows[a].h:rows[a].l-rows[b].l),rsiDelta=high?rsi[a]-rsi[b]:rsi[b]-rsi[a];
  if(priceDelta>=.1*atr&&rsiDelta>=5)add(high?'BEARISH_DIVERGENCE':'BULLISH_DIVERGENCE',high?'DOWN':'UP',{indicator:'RSI14',firstPivotAt:rows[a].ts,secondPivotAt:rows[b].ts,firstRsi:rsi[a],secondRsi:rsi[b],priceDelta,atr,confirmationBars:2});
 }
 return {asset,timeframe,reason:null,barAt:last.ts,atr,volumeRatio,events};
}
export function scanMarket(snapshot,now){
 const frames=[];for(const [symbol,asset] of Object.entries(snapshot.assets||{}))for(const timeframe of Object.keys(TF))frames.push(scanMarketFrame(symbol.replace(/USDT$/,''),timeframe,asset.timeframes?.[timeframe],now));
 return {policy:SCANNER_POLICY,checkedAt:new Date(now).toISOString(),cadenceSeconds:60,continuous:true,frames,events:frames.flatMap(f=>f.events)};
}
export const EVENT_LABELS={STRUCTURE_BREAKOUT:'结构突破',VOLUME_BREAKOUT:'放量突破',UPPER_WICK:'长上影线',LOWER_WICK:'长下影线',RANGE_VOLUME_SHOCK:'放量大幅波动',BEARISH_DIVERGENCE:'顶背离（RSI）',BULLISH_DIVERGENCE:'底背离（RSI）'};
