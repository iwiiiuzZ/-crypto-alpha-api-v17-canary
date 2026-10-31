import assert from 'node:assert/strict';
import vm from 'node:vm';
import {fixture,market,plan} from './v24-fixtures.mjs';
let passed=0,failed=0;
async function test(name,fn){try{await fn();passed++;}catch(e){failed++;console.error(name,e.stack);}}

function pullbackMarket(f,{shallow=false,short=false}={}) {
 const m=market(f.now()),a=m.assets.ETHUSDT,rows=a.timeframes['15m'].recentCandles;
 rows.forEach(c=>Object.assign(c,{o:85,h:90,l:80,c:85,volume:100}));
 const at=(i,o,h,l,c)=>Object.assign(rows.at(i),{o,h,l,c});
 at(-7,85,95,84,92);at(-6,92,110,91,108);at(-5,108,120,107,118);
 if(shallow){at(-4,118,119,113,114);at(-3,114,114.5,112,113);at(-2,113,114.2,112.5,113.6);at(-1,113.6,116,113,115);}
 else{at(-4,118,119,107,108);at(-3,108,108.5,100,101);at(-2,101,104,100.5,103);at(-1,103,110,102,109.5);}
 // A key control must actually break. Revisit the confirmed location afterwards, without assuming a fill.
 a.ticker.last=shallow?113.2:103;a.ticker.bid=a.ticker.last-0.01;a.ticker.ask=a.ticker.last+0.01;
 a.timeframes['15m'].indicators.atr14=shallow?4:10;
 a.timeframes['1h'].indicators.ema20=shallow?112:100;
 a.timeframes['1h'].trend='DOWN';a.timeframes['1h'].structure='LH_LL';
 // Retest control is set by the pullback's final segment, not its whole impulse candle.
 if(!shallow){at(-4,110,110.5,107,108);at(-3,108,108.5,100,101);at(-1,103,112,102,111.5);}
 else{at(-4,115,115.5,113,114);at(-1,113.6,116,113,116);}
 if(short)mirror(m);
 return m;
}
function mirror(m){for(const a of Object.values(m.assets)){
 a.ticker.last=200-a.ticker.last;a.ticker.bid=a.ticker.last-0.01;a.ticker.ask=a.ticker.last+0.01;
 for(const tf of Object.values(a.timeframes)){
  tf.recentCandles.forEach(c=>{const {o,h,l,c:close}=c;Object.assign(c,{o:200-o,h:200-l,l:200-h,c:200-close});});
  const {support20,support50,resistance20,resistance50}=tf.levels;
  tf.levels={support20:200-resistance20,support50:200-resistance50,resistance20:200-support20,resistance50:200-support50};
  if(tf.indicators.ema20)tf.indicators.ema20=200-tf.indicators.ema20;
  tf.trend=tf.trend==='DOWN'?'UP':'DOWN';tf.structure=tf.structure==='LH_LL'?'HH_HL':'LH_LL';
 }
}}
function compressionMarket(f,short=false){
 const m=market(f.now()),a=m.assets.ETHUSDT,r=a.timeframes['15m'].recentCandles;
 r.forEach((c,i)=>Object.assign(c,i<8?{o:95,h:104,l:86,c:95,volume:100}:{o:98,h:100,l:96,c:98,volume:70}));
 Object.assign(r[16],{o:99,h:106,l:99,c:104,volume:160});
 for(let i=17;i<24;i++)Object.assign(r[i],{o:104,h:105,l:102,c:103,volume:90});
 Object.assign(r[18],{o:102,h:103,l:100.5,c:102});
 Object.assign(r[22],{o:103,h:105,l:102,c:104});
 Object.assign(r[23],{o:104,h:105,l:102,c:104});
 a.ticker.last=104;a.ticker.bid=103.99;a.ticker.ask=104.01;a.timeframes['15m'].indicators.atr14=5;
 if(short)mirror(m);return m;
}
for(const shallow of [false,true])for(const short of [false,true])await test(`A${shallow?2:1} ${short?'short':'long'} real detector and protected trigger`,()=>{
 const f=fixture(),m=pullbackMarket(f,{shallow,short}),a=m.assets.ETHUSDT;
 const seeds=f.t.trendPullbackSeeds(a);assert.equal(seeds.length,1);assert.equal(seeds[0].submodel,shallow?'A2':'A1');
 assert.equal(seeds[0].direction,short?'SHORT':'LONG');
 const check=f.t.opportunityAssessment(seeds[0],a,m.assets.BTCUSDT);
 assert.equal(check.progress.state,'STRUCTURE_READY');assert.ok(check.candidate,JSON.stringify(check));
 assert.ok(check.netRR>=2);assert.equal(check.candidate.openNowAllowed,false);
});
for(const short of [false,true])await test(`B2 ${short?'short':'long'} compression expansion and shallow retest`,()=>{
 const f=fixture(),m=compressionMarket(f,short),a=m.assets.ETHUSDT,seeds=f.t.compressionSeeds(a);
 assert.equal(seeds.length,1);assert.equal(seeds[0].submodel,'B2');
 const r=f.t.opportunityAssessment(seeds[0],a,m.assets.BTCUSDT);assert.ok(r.candidate,JSON.stringify(r));
 assert.ok(r.candidate.netRR>=2);assert.equal(seeds[0].compression.boxEndAt,a.timeframes['15m'].recentCandles[15].ts);
});
await test('uncompressed breakout cannot be mislabeled B2',()=>{const f=fixture(),m=compressionMarket(f),a=m.assets.ETHUSDT;
 a.timeframes['15m'].recentCandles.slice(0,8).forEach(c=>Object.assign(c,{o:98,h:100,l:96,c:98}));assert.equal(f.t.compressionSeeds(a).length,0);});
await test('deep pullback has meaningful location requirement',()=>{const f=fixture(),m=pullbackMarket(f);delete m.assets.ETHUSDT.timeframes['1h'].indicators.ema20;assert.equal(f.t.trendPullbackSeeds(m.assets.ETHUSDT).length,0);});
await test('A confirmation may span candles and persists after a valid trigger',()=>{const f=fixture(),m=pullbackMarket(f),a=m.assets.ETHUSDT,s=f.t.trendPullbackSeeds(a)[0];
 const before=JSON.stringify(s);assert.equal(f.t.pullbackProgress(s,a).state,'STRUCTURE_READY');
 f.advance(900000);const rows=a.timeframes['15m'].recentCandles;
 rows.push({...rows.at(-1),ts:new Date(Date.parse(rows.at(-1).ts)+900000).toISOString(),o:108,h:109,l:102.5,c:106});
 assert.equal(f.t.pullbackProgress(s,a).state,'STRUCTURE_READY');assert.equal(JSON.stringify(s),before);});
await test('A observation before trigger does not fabricate an entry',()=>{const f=fixture(),m=pullbackMarket(f),a=m.assets.ETHUSDT;
 a.timeframes['15m'].recentCandles.at(-1).c=104;const s=f.t.trendPullbackSeeds(a)[0];const r=f.t.opportunityAssessment(s,a,m.assets.BTCUSDT);assert.equal(r.candidate,null);assert.equal(r.progress.state,'WAIT_PULLBACK_SHIFT');});
await test('impulse origin break invalidates instead of waiting indefinitely',()=>{const f=fixture(),m=pullbackMarket(f),a=m.assets.ETHUSDT,s=f.t.trendPullbackSeeds(a)[0];a.timeframes['15m'].recentCandles.at(-1).l=s.impulseOrigin;assert.equal(f.t.pullbackProgress(s,a).state,'INVALIDATED');});
await test('A fixed observation expires',()=>{const f=fixture(),m=pullbackMarket(f),a=m.assets.ETHUSDT,s=f.t.trendPullbackSeeds(a)[0];f.advance(3*3600000);assert.equal(f.t.pullbackProgress(s,a).state,'EXPIRED');});
await test('unconfirmed, future, stale or mixed-source bars cannot create A/B2 signal',()=>{
 for(const factory of [pullbackMarket,compressionMarket])for(const bad of ['future','stale','source']){const f=fixture(),m=factory(f),a=m.assets.ETHUSDT;
  if(bad==='future')a.timeframes['15m'].recentCandles.forEach(c=>c.ts=new Date(f.now()+900000).toISOString());
  if(bad==='stale')a.timeframes['15m'].dataFreshness.state='stale-on-error';
  if(bad==='source')a.timeframes['1h'].source='SPOT';
  assert.equal(factory===pullbackMarket?f.t.trendPullbackSeeds(a).length:f.t.compressionSeeds(a).length,0);
 }
});
await test('nearer impulse target cannot be skipped for a flattering RR',()=>{const f=fixture(),m=pullbackMarket(f),a=m.assets.ETHUSDT,s=f.t.trendPullbackSeeds(a)[0];
 a.ticker.last=109;a.ticker.bid=108.99;a.ticker.ask=109.01;const r=f.t.opportunityAssessment(s,a,m.assets.BTCUSDT);assert.equal(r.target,120);assert.equal(r.failedGate,'FIRST_TARGET_NET_RR_BELOW_2');assert.ok(r.rrQualifiedEntryZone.max<109);});
await test('realistic target cannot be invented for a breakout',()=>{const f=fixture(),m=compressionMarket(f),a=m.assets.ETHUSDT,s=f.t.compressionSeeds(a)[0];
 a.timeframes['1h'].levels={};a.timeframes['4h'].levels={};const r=f.t.opportunityAssessment(s,a,m.assets.BTCUSDT);assert.equal(r.failedGate,'FIRST_REALISTIC_TARGET_MISSING');});
await test('single BTC pullback is a warning; opposing two timeframes still block',()=>{const f=fixture(),m=compressionMarket(f),a=m.assets.ETHUSDT,s=f.t.compressionSeeds(a)[0],b=m.assets.BTCUSDT;
 b.timeframes['1h'].trend='DOWN';b.timeframes['1h'].structure='LH_LL';assert.ok(f.t.opportunityAssessment(s,a,b).candidate);
 b.timeframes['4h'].trend='DOWN';b.timeframes['4h'].structure='LH_LL';assert.equal(f.t.opportunityAssessment(s,a,b).failedGate,'BTC_SYSTEMIC_CONFLICT');});
await test('snapshot audit retains original six plus two even when none complete',()=>{const f=fixture(),m=market(f.now()),r=f.t.buildOpportunityScan(m.assets.ETHUSDT,m.assets.BTCUSDT);
 assert.deepEqual(Array.from(r.models,x=>x.submodel),['A1','A2','B1','B2','C1','C2','D1','D2']);assert.equal(r.measuredWinRate,null);assert.equal(r.openNowAllowed,false);assert.ok(r.models.every(x=>x.failedGate));});
for(const factory of [pullbackMarket,compressionMarket])await test(`${factory.name} persists, notifies and retains existing plan`,async()=>{
 const f=fixture(),m=factory(f);f.setMarket(m);f.setPrices([m.assets.ETHUSDT.ticker.last,m.assets.ETHUSDT.ticker.last]);f.put('scanner:active-plan',plan(f));
 const result=await f.t.runScanner(f.env),records=f.get('scanner:observations:v23').records;
 assert.ok(records.some(r=>r.submodel===(factory===pullbackMarket?'A1':'B2')));assert.equal(f.get('scanner:active-plan').planId,'old-plan');
 assert.ok(records.some(r=>r.state==='MARKET_CANDIDATE'),JSON.stringify(records.map(r=>({model:r.submodel,state:r.state,reason:r.reason}))));
 assert.ok(f.pushes.some(p=>p.title.includes(factory===pullbackMarket?'A1':'B2')));assert.ok(result.observations.opportunityAudit);
 const ids=records.map(r=>r.observationId);f.advance(60000);await f.t.runScanner(f.env);
 assert.deepEqual(f.get('scanner:observations:v23').records.map(r=>r.observationId),ids);
});
await test('all grades and horizons accept a 2 floor; under 2 rejected',()=>{const f=fixture();for(const t of Object.values(f.t.LEGACY_CONFIG.minimumNetRR))assert.deepEqual(Object.values(t),[2,2,2]);
 const p=plan(f);assert.equal(p.minNetRR,2);assert.equal(f.t.effectivePlanMinNetRR({...p,minNetRR:2.5}),2.5);
 assert.equal(f.t.effectivePlanMinNetRR({minNetRR:1.5}),2);assert.equal(f.t.effectivePlanMinNetRR({minNetRR:2.8}),2);
 assert.throws(()=>f.t.normalizeTradingPlan({...p,sourceAnalysisAt:new Date(f.now()).toISOString(),minNetRR:1.99999}),/at least configured 2/);
});
await test('gross 2R is not net 2R and exact raw boundary is respected',()=>{const f=fixture(),p={direction:'LONG',stopLoss:90,takeProfits:[{price:120}],estimatedRoundTripCostPct:0.15};
 assert.ok(f.t.planNetRR(p,100)<2);p.estimatedRoundTripCostPct=0;assert.equal(f.t.planNetRR(p,100),2);p.takeProfits[0].price=119.99999;assert.ok(f.t.planNetRR(p,100)<2);
});
await test('RR-qualified entry boundary solves long and short after costs',()=>{for(const short of [false,true]){const f=fixture(),m=pullbackMarket(f,{short}),a=m.assets.ETHUSDT,s=f.t.trendPullbackSeeds(a)[0],r=f.t.opportunityAssessment(s,a,m.assets.BTCUSDT);
 const cap=short?r.rrQualifiedEntryZone.min:r.rrQualifiedEntryZone.max;
 const ratio=f.t.planNetRR({direction:s.direction,stopLoss:r.stopLoss,takeProfits:[{price:r.target}],estimatedRoundTripCostPct:0.15},cap);
 assert.ok(ratio>1.99999999,ratio);}});

function flow(f,{buy=true,flat=false,stale=false}={}){const rows=Array.from({length:30},(_,i)=>({size:(buy?1:-1)*10,price:flat?'100':String(100+(buy?1:-1)*i/10),create_time_ms:f.now()-(29-i)*1000-(stale?180000:0)}));
 return f.t.parseGateLargeTrades(rows,1,1);}
await test('actual executed-trade window includes its own price response',()=>{const f=fixture(),r=flow(f);assert.equal(r.sampleTradeCount,30);assert.ok(r.priceResponse.changePct>0);assert.equal(r.priceResponse.first,100);});
await test('buy and sell order-flow shocks require executed trades; walls alone insufficient',()=>{for(const buy of [true,false]){const f=fixture(),a=market(f.now()).assets.ETHUSDT;a.capitalFlow.largeTrades=flow(f,{buy});
 const r=f.t.dynamicMarketContext(a);assert.equal(r.flowDirection,buy?'BUY':'SELL');assert.equal(r.status,'REASSESS');assert.equal(r.standaloneDirection,false);assert.equal(r.newsCause,'UNVERIFIED');}
 const f=fixture(),a=market(f.now()).assets.ETHUSDT;a.capitalFlow.orderBook={largestBidWall:{notionalUsdEstimate:1e10}};assert.equal(f.t.dynamicMarketContext(a).status,'NORMAL_OR_INCONCLUSIVE');});
await test('large buys with poor price advance are not automatically bullish',()=>{const f=fixture(),a=market(f.now()).assets.ETHUSDT;a.capitalFlow.largeTrades=flow(f,{flat:true});assert.match(f.t.dynamicMarketContext(a).priceResponseClassification,/POOR_ADVANCE/);});
await test('stale and future trade windows cannot create a flow shock',()=>{const f=fixture(),a=market(f.now()).assets.ETHUSDT;for(const offset of [-180000,60000]){a.capitalFlow.largeTrades=flow(f);a.capitalFlow.largeTrades.sampleEndAt=new Date(f.now()+offset).toISOString();assert.equal(f.t.dynamicMarketContext(a).flowDirection,null);}});
await test('volume and volatility shock is a reassessment, not news attribution',()=>{const f=fixture(),a=market(f.now()).assets.ETHUSDT;a.timeframes['15m'].recentCandles.forEach(c=>c.volume=100);Object.assign(a.timeframes['15m'].recentCandles.at(-1),{h:130,l:95,c:125,volume:300});
 const r=f.t.dynamicMarketContext(a);assert.ok(r.flags.includes('CLOSED_CANDLE_VOLUME_VOLATILITY_SHOCK'));assert.equal(r.headlineFeedAvailable,false);assert.equal(r.headlineFeedLocation,"snapshot.newsContext");assert.equal(r.openNowAllowed,false);});
// V26 changes the old noisy flow push contract: raw flow still rescans, but is quiet.
await test('small flow change still rescans all models without a pre-saved plan or push',async()=>{const f=fixture(),m=market(f.now());m.assets.ETHUSDT.capitalFlow.largeTrades=flow(f);f.setMarket(m);await f.t.runScanner(f.env);
 assert.ok(f.get('scanner:discovery').opportunityAudit);assert.equal(f.get('scanner:active-plan'),null);assert.equal(f.pushes.length,0);});
await test('material closed-candle shock retries failed provider and deduplicates',async()=>{const f=fixture(),a=market(f.now()).assets.ETHUSDT;
 a.timeframes['15m'].recentCandles.forEach(c=>c.volume=100);Object.assign(a.timeframes['15m'].recentCandles.at(-1),{o:100,h:130,l:95,c:125,volume:300});
 const r=f.t.dynamicMarketContext(a);f.setPushFailures(1);let state=await f.t.processDynamicAlert(f.env,r,null,Infinity);assert.ok(state.pending);f.advance(120000);state=await f.t.processDynamicAlert(f.env,r,state,Infinity);assert.equal(f.pushes.length,1);
 state=await f.t.processDynamicAlert(f.env,r,state,Infinity);assert.equal(f.pushes.length,1);});
await test('effort/result uses the identical trade window, not three hours of candles',()=>{
 const f=fixture(),a=market(f.now()).assets.ETHUSDT;a.capitalFlow.largeTrades=flow(f,{flat:true});
 a.capitalFlow.periods={'15m':{activeBuyUsdEstimate:0,activeSellUsdEstimate:10000,activeNetFlowUsdEstimate:-10000}};
 a.timeframes['15m'].recentCandles[0].c=999;
 const e=f.t.buildEffortVsResult(a);assert.equal(e.classification,'BUY_ABSORPTION_CANDIDATE');assert.equal(e.priceChangeAtr,0);
 assert.equal(e.windowStartAt,a.capitalFlow.largeTrades.sampleStartAt);
 a.capitalFlow.largeTrades.sampleEndAt=new Date(f.now()-180000).toISOString();assert.equal(f.t.buildEffortVsResult(a).status,'unavailable');
});
await test('existing persisted plans use the new 2R floor without changing their stop',()=>{
 const f=fixture(),m=market(f.now()),p=plan(f);delete p.rrPolicyVersion;p.minNetRR=1.5;
 p.takeProfits=[{price:111.5,allocationPct:100}];const originalStop=p.stopLoss;
 const verify={confirmed:true,rule:'TWO_INDEPENDENT_CURRENT_OKX_SAMPLES_INSIDE_ZONE',samples:[{last:100.5},{last:100.5}]};
 const r=f.t.evaluateTradingPlan(p,m,{zoneAlertSentAt:'earlier'},verify);assert.equal(r.minimumNetRR,2);assert.equal(r.checks.rrPassed,false);
 p.minNetRR=2.8;p.takeProfits[0].price=114;const q=f.t.evaluateTradingPlan(p,m,{zoneAlertSentAt:'earlier'},verify);
 assert.equal(q.checks.rrPassed,true);assert.equal(p.stopLoss,originalStop);
});
await test('candidate structural pool buffer never tightens a stop to manufacture RR',()=>{
 const f=fixture(),m=pullbackMarket(f),a=m.assets.ETHUSDT,s=f.t.trendPullbackSeeds(a)[0];const r=f.t.opportunityAssessment(s,a,m.assets.BTCUSDT);
 assert.equal(r.structuralPoolBufferApplied,true);assert.ok(r.stopLoss<r.rawProtectiveStop);assert.ok(r.netRR>=2);
});
await test('external breakout acceptance can qualify before the lagging 4h regime label',()=>{
 const f=fixture(),m=compressionMarket(f),a=m.assets.ETHUSDT,s=f.t.compressionSeeds(a)[0];
 a.marketRegimeRouter.regime='TRANSITION';a.rangeContext={status:'ok',confirmed:false,upperBoundary:100,lowerBoundary:80,locationZone:'OUTSIDE'};
 a.timeframes['1h'].trend='DOWN';a.timeframes['1h'].structure='LH_LL';
 const r=f.t.opportunityAssessment(s,a,m.assets.BTCUSDT);assert.ok(r.candidate,JSON.stringify(r));assert.equal(r.candidate.externalBoundaryAcceptance,true);
});
await test('an internal breakout cannot use the external-boundary promotion',()=>{
 const f=fixture(),m=compressionMarket(f),a=m.assets.ETHUSDT,s=f.t.compressionSeeds(a)[0];a.marketRegimeRouter.regime='TRANSITION';
 a.rangeContext={status:'ok',confirmed:false,upperBoundary:120,lowerBoundary:80,locationZone:'MIDDLE'};
 assert.equal(f.t.opportunityAssessment(s,a,m.assets.BTCUSDT).failedGate,'REGIME_ACCEPTANCE_PENDING');
});
await test('one outside close or a return inside cannot promote the old regime',()=>{
 const f=fixture(),m=compressionMarket(f),a=m.assets.ETHUSDT,s=f.t.compressionSeeds(a)[0];a.marketRegimeRouter.regime='TRANSITION';
 a.rangeContext={status:'ok',confirmed:false,upperBoundary:100,lowerBoundary:80,locationZone:'OUTSIDE'};
 a.timeframes['15m'].recentCandles.at(-2).c=99;
 assert.equal(f.t.opportunityAssessment(s,a,m.assets.BTCUSDT).failedGate,'REGIME_ACCEPTANCE_PENDING');
});
await test('formal scanner and reference decision both require real external-acceptance evidence',()=>{
 const f=fixture(),m=compressionMarket(f),a=m.assets.ETHUSDT,p=plan(f);a.marketRegimeRouter.regime='TRANSITION';
 a.rangeContext={status:'ok',confirmed:false,upperBoundary:100,lowerBoundary:80,locationZone:'OUTSIDE'};
 a.ticker.last=100.8;p.trigger.acceptanceLevel=100;p.marketRegime='TRANSITION';
 const v={confirmed:true,rule:'TWO_INDEPENDENT_CURRENT_OKX_SAMPLES_INSIDE_ZONE',samples:[{last:100.8},{last:100.8}]};
 const r=f.t.evaluateTradingPlan(p,m,{zoneAlertSentAt:'earlier'},v);assert.equal(r.externalBoundaryAcceptance,true);assert.equal(r.checks.regimeDirectPermission,true);
 const input={direction:'LONG',model:'B',submodel:'B1',marketRegime:'TRANSITION',locationQuality:'GOOD',rangePosition:'EDGE',
 setup:{breakout:true,retest:true,acceptance:true,rejection:false,acceptanceLevel:100},trigger:{complete:true,meaningful:true,protectiveStructure:true},
 execution:{clearInvalidation:true,netRR:2.1,minNetRR:2},data:{requiredFieldsReady:true},
 environment:{btcSystemicConflict:false,majorNewsExecutionRisk:false,liquidityAbnormal:false},confirmation:{minimumSufficientEvidence:true},
 risk:{riskAssessmentStatus:'VERIFIED_CLEAR',dailyRiskLimitReached:false,psychologicalVeto:false,correlatedRiskPct:0},pendingTrigger:'external acceptance',marketAsset:a};
 assert.equal(f.t.evaluateCourseDecision(input).finalState,'LONG');delete input.marketAsset;assert.equal(f.t.evaluateCourseDecision(input).finalState,'WAIT');
});
console.log(JSON.stringify({suite:'v24-models',passed,failed,liveNetworkCalls:0,performanceBacktest:false}));
process.exitCode=failed?1:0;
