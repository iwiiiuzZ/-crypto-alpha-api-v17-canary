import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

// All prices, candles, accounts, state and pushes in this suite are synthetic.
// No live exchange, Bark, account or network access is used.
const source = fs.readFileSync(new URL('../main-v188.js', import.meta.url), 'utf8')
  .replaceAll('export class ', 'class ').replaceAll('export function ', 'function ').replace('export default {', 'globalThis.worker = {')
  + '\n;globalThis.t={ScannerState,normalizeTradingPlan,normalizeObservation,saveObservation,evaluateObservation,observationVerification,breakoutSeeds,breakoutProgress,breakoutCandidate,runDiscovery,runScanner,scanActivePlan,scannerStatus,scannerCompareAndPut,processObservation,cancelTradingPlan};';
let passed=0, failed=0;
async function test(name,fn){try{await fn();passed++;}catch(e){failed++;console.error(name, e.stack);}}
function fixture() {
  let now=Date.parse('2026-10-02T09:05:00Z');
  class Clock extends Date {constructor(...args){super(...(args.length?args:[now]));} static now(){return now;}}
  const c={console,Date:Clock,Math,JSON,URL,URLSearchParams,Request,Response,Headers,crypto:webcrypto,structuredClone,setTimeout,clearTimeout,AbortController,
    fetch:async()=>{throw new Error('UNEXPECTED_LIVE_NETWORK');}};
  vm.createContext(c);vm.runInContext(source,c);
  const db=new Map();let tail=Promise.resolve();
  const storage={async get(k){return structuredClone(db.get(k));},async put(k,v){db.set(k,structuredClone(v));},async delete(k){db.delete(k);},
    transaction(fn){const task=tail.then(()=>fn(storage));tail=task.catch(()=>{});return task;}};
  const object=new c.t.ScannerState({storage});
  const env={SCANNER_TOKEN:'synthetic-token',BARK_DEVICE_KEY:'synthetic-key',SCANNER_STATE:{getByName(){return {fetch(url,options){return object.fetch(new Request(url,options));}};}}};
  const get=k=>db.get(k)?.value??null;
  const put=(k,value)=>db.set(k,{value:structuredClone(value),expiresAt:now+30*86400000});
  let pushes=[], pushFails=0, samples=[100.5,100.5], priceFails=false, snapshotFails=false, reads={prices:0,snapshots:0};
  let full=market(now);
  c.priceFake=async()=>{reads.prices++;if(priceFails)throw Error('PRICE_OUTAGE');return {passed:true,confirmed:true,rule:'TWO_INDEPENDENT_CURRENT_OKX_SAMPLES_INSIDE_ZONE',
    current:{status:'ok',bid:samples[1]-0.01,ask:samples[1]+0.01,last:samples[1],source:'OKX_USDT_PERPETUAL_DIRECT_VERIFIED',verification:{passed:true},exchangeTimestamp:new Clock().toISOString()},
    samples:samples.map(last=>({last}))};};
  c.snapshotFake=async()=>{reads.snapshots++;if(snapshotFails)throw Error('STRUCTURE_OUTAGE');return structuredClone(full);};
  c.pushFake=async(_,n)=>{if(pushFails>0){pushFails--;throw Error('BARK_503');}assert.ok(n);pushes.push(n);return {sent:true};};
  vm.runInContext('verifyOkxScannerZone=priceFake;buildSnapshot=snapshotFake;sendBark=pushFake;',c);
  return {c,t:c.t,env,get,put,reads,pushes,advance:n=>now+=n,now:()=>now,setPrices:a=>samples=a,setPriceFailure:v=>priceFails=v,
    setSnapshotFailure:v=>snapshotFails=v,setPushFailures:n=>pushFails=n,setMarket:m=>full=m,market:()=>full};
}
function market(now) {
  const end=Math.floor(now/900000)*900000;
  const candles=Array.from({length:24},(_,i)=>({ts:new Date(end-(24-i)*900000).toISOString(),o:100,h:102,l:98,c:100,confirmed:true}));
  const tf={status:'ok',source:'GATE_USDT_PERPETUAL',quality:{passed:true},dataFreshness:{state:'live'},recentCandles:candles,
    trend:'UP',structure:'HH_HL',indicators:{atr14:10},levels:{resistance20:140,resistance50:160,support20:60,support50:50}};
  const asset={ticker:{last:100.5},timeframes:{'15m':structuredClone(tf),'1h':structuredClone(tf),'4h':structuredClone(tf)},
    marketRegimeRouter:{regime:'TREND'},executionLiquidity:{status:'ok'},derivatives:{openInterest:{status:'ok'},funding:{status:'ok'}},capitalFlow:{status:'unavailable'}};
  return {decisionState:'DATA_READY',coverage:{openNowDataReady:true},assets:{ETHUSDT:asset,BTCUSDT:structuredClone(asset)}};
}
function observation(f,extra={}){return {recordType:'OBSERVATION',notificationMode:'ALL_STAGES',symbol:'ETHUSDT',direction:'LONG',model:'B',submodel:'B1',marketRegime:'TREND',
  observationZone:{min:100,max:101},observationInvalidation:{level:95,mode:'PRICE'},strategySummary:'Synthetic breakout retest',pendingCondition:'15m key close over 102 with protected low; review model afterwards',
  sourceAnalysisAt:new Date(f.now()).toISOString(),expiresAt:new Date(f.now()+3600000).toISOString(),...extra};}
function plan(f){return f.t.normalizeTradingPlan({planId:'old-plan',symbol:'ETHUSDT',direction:'LONG',model:'B',submodel:'B1',marketRegime:'TREND',opportunityGrade:'A',timeframe:'SHORT',
  modelInvalidation:'Loss of protected low',location:{quality:'GOOD',type:'RETEST',rangePosition:'EDGE',rationale:'Breakout retest'},
  trigger:{type:'BOS',meaningful:true,level:100,acceptanceLevel:99,protectiveStructure:{type:'HL',price:96}},
  entryZone:{min:100,max:101},invalidationPrice:95,stopLoss:95,takeProfits:[{price:120,allocationPct:100}],firstRealisticTarget:{price:120,basis:'First structural resistance'},
  minNetRR:2,estimatedRoundTripCostPct:0.15,confirmation:{close15mAbove:100},hardBlockers:[],
  risk:{accountEquityUsdt:1000,accountRiskPct:1,leverage:5,riskAssessmentStatus:'VERIFIED_CLEAR',dailyRiskLimitReached:false,psychologicalVeto:false,correlatedRiskPct:0},
  sourceAnalysisAt:new Date(f.now()).toISOString(),expiresAt:new Date(f.now()+3600000).toISOString()});}
const authRequest=(route,body)=>new Request('https://test.invalid'+route,{method:body?'POST':'GET',headers:{authorization:'Bearer synthetic-token','content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});

await test('observations save via existing action without fabricated risk or stops',async()=>{
 const f=fixture();const r=await f.c.worker.fetch(authRequest('/scanner/plan',observation(f)),f.env,{});assert.equal(r.status,200);
 const b=await r.json();assert.equal(b.status,'observation_saved');assert.equal(b.observation.openNowAllowed,false);assert.equal(f.get('scanner:active-plan'),null);
});
await test('all six registered submodels are supported',async()=>{const f=fixture();for(const s of ['A1','A2','B1','B2','C1','C2']){
 const x=observation(f,{model:s[0],submodel:s,marketRegime:s[0]==='C'?'RANGE':'TREND'});assert.equal((await f.t.saveObservation(f.env,x)).status,'observation_saved');}});
await test('default PLAN still rejects missing risk/execution fields',async()=>{const f=fixture();const x=observation(f);delete x.recordType;assert.equal((await f.c.worker.fetch(authRequest('/scanner/plan',x),f.env,{})).status,400);});
await test('observation does not replace existing armed plan',async()=>{const f=fixture();f.put('scanner:active-plan',plan(f));await f.t.saveObservation(f.env,observation(f));assert.equal(f.get('scanner:active-plan').planId,'old-plan');});
await test('identical repeat preserves state and expiry',async()=>{const f=fixture();const x=observation(f);const a=await f.t.saveObservation(f.env,x);f.advance(60000);x.sourceAnalysisAt=new Date(f.now()).toISOString();x.expiresAt=new Date(f.now()+3600000).toISOString();const b=await f.t.saveObservation(f.env,x);assert.equal(b.status,'unchanged');assert.equal(a.observation.expiresAt,b.observation.expiresAt);assert.equal(a.observation.observationId,b.observation.observationId);});
await test('invalid direction, missing thesis and expired analysis cannot be saved',async()=>{const f=fixture();for(const bad of [{direction:'SIDEWAYS'},{strategySummary:''},{sourceAnalysisAt:'2020-01-01'},{observationInvalidation:{level:102,mode:'PRICE'}},{expiresAt:new Date(f.now()+25*3600000).toISOString()}])assert.throws(()=>f.t.normalizeObservation(observation(f,bad)));});
await test('concurrent distinct observations are not lost',async()=>{const f=fixture();await Promise.all([f.t.saveObservation(f.env,observation(f)),f.t.saveObservation(f.env,observation(f,{pendingCondition:'Second independent level'}))]);assert.equal(f.get('scanner:observations:v23').records.length,2);});
await test('CAS prevents stale retirement overwriting revised plan',async()=>{const f=fixture();const p=plan(f);f.put('scanner:active-plan',{...p,revision:2});assert.equal(await f.t.scannerCompareAndPut(f.env,{'scanner:active-plan':p},{'scanner:active-plan':{...p,status:'EXPIRED'}}),false);assert.equal(f.get('scanner:active-plan').revision,2);});
await test('expired plan retires during price outage and discovery runs',async()=>{const f=fixture();f.put('scanner:active-plan',{...plan(f),expiresAt:new Date(f.now()-1).toISOString()});f.setPriceFailure(true);const r=await f.t.runScanner(f.env);assert.equal(r.evaluation.state,'EXPIRED');assert.equal(f.get('scanner:active-plan').status,'EXPIRED');assert.ok(f.get('scanner:discovery').lastRunAt);assert.equal(f.reads.prices,0);});
await test('invalidated plan retires and records setup invalidation not a trade loss',async()=>{const f=fixture();f.put('scanner:active-plan',plan(f));f.setPrices([94,94]);const r=await f.t.runScanner(f.env);assert.equal(r.evaluation.state,'INVALIDATED');assert.equal(f.get('scanner:active-plan').status,'INVALIDATED');assert.equal(f.get('scanner:failure-history')[0].executionWasAssumed,false);});
await test('failed terminal plan push retries after retirement',async()=>{const f=fixture();f.put('scanner:active-plan',{...plan(f),expiresAt:new Date(f.now()-1).toISOString()});f.setPushFailures(1);await f.t.runScanner(f.env);assert.equal(f.get('scanner:active-plan').status,'EXPIRED');assert.equal(f.pushes.length,0);f.advance(120000);await f.t.runScanner(f.env);assert.equal(f.pushes.length,1);assert.equal(f.get('scanner:runtime').notification.sent,true);});
await test('live plan and independent observation run in same cycle with shared fetches',async()=>{const f=fixture();f.put('scanner:active-plan',plan(f));await f.t.saveObservation(f.env,observation(f));const r=await f.t.runScanner(f.env);assert.equal(r.observations.evaluations[0].state,'IN_ZONE');assert.equal(f.reads.prices,1);assert.equal(f.reads.snapshots,1);});
await test('approach, arrival and registered close each notify once',async()=>{
 const f=fixture();await f.t.saveObservation(f.env,observation(f,{observationTrigger:{type:'CLOSE_ABOVE',level:102,meaningful:true}}));
 f.setPrices([99,99]);await f.t.runScanner(f.env);assert.match(f.pushes[0].title,/接近/);
 f.advance(60000);f.setPrices([100.5,100.5]);await f.t.runScanner(f.env);assert.match(f.pushes[1].title,/已到/);
 f.advance(15*60000);const m=market(f.now());m.assets.ETHUSDT.timeframes['15m'].recentCandles.at(-1).c=103;f.setMarket(m);
 await f.t.runScanner(f.env);assert.match(f.pushes[2].title,/收盘条件/);await f.t.runScanner(f.env);assert.equal(f.pushes.length,3);
 assert.equal(f.get('scanner:observations:v23').records[0].openNowAllowed,false);
});
await test('single sample inside cannot trigger arrival',async()=>{const f=fixture();await f.t.saveObservation(f.env,observation(f));f.setPrices([99.9,100.5]);await f.t.runScanner(f.env);assert.notEqual(f.get('scanner:observations:v23').records[0].state,'IN_ZONE');});
await test('historical touch and historical close cannot replace current arrival',async()=>{const f=fixture();await f.t.saveObservation(f.env,observation(f));f.setPrices([105,105]);await f.t.runScanner(f.env);assert.equal(f.get('scanner:observations:v23').records[0].currentInZone,false);assert.ok(f.pushes.every(n=>!n.title.includes('已到')));});
await test('failed stage delivery retained and retried, then deduplicated',async()=>{const f=fixture();await f.t.saveObservation(f.env,observation(f));f.setPushFailures(1);await f.t.runScanner(f.env);let r=f.get('scanner:observations:v23').records[0];assert.equal(r.alerts.IN_ZONE.status,'PENDING');f.advance(60000);await f.t.runScanner(f.env);assert.equal(f.pushes.length,0);f.advance(60000);await f.t.runScanner(f.env);assert.equal(f.pushes.length,1);await f.t.runScanner(f.env);assert.equal(f.pushes.length,1);});
await test('invalidation supersedes failed ready notice',async()=>{const f=fixture();await f.t.saveObservation(f.env,observation(f));f.setPushFailures(1);await f.t.runScanner(f.env);f.advance(120000);f.setPrices([94,94]);await f.t.runScanner(f.env);const r=f.get('scanner:observations:v23').records[0];assert.equal(r.state,'INVALIDATED');assert.equal(r.alerts.IN_ZONE.status,'SUPERSEDED');assert.equal(f.pushes.length,1);assert.match(f.pushes[0].title,/失效/);});
await test('missing structure preserves zone monitoring but cannot claim market ready',async()=>{const f=fixture();await f.t.saveObservation(f.env,observation(f));f.setSnapshotFailure(true);await f.t.runScanner(f.env);const r=f.get('scanner:observations:v23').records[0];assert.equal(r.state,'IN_ZONE');assert.equal(r.structureReady,false);assert.equal(f.get('scanner:heartbeat:v23').status,'degraded');});
await test('expiry stops observation even during complete data outage',async()=>{const f=fixture();await f.t.saveObservation(f.env,observation(f));f.advance(3600001);f.setPriceFailure(true);f.setSnapshotFailure(true);await f.t.runScanner(f.env);assert.equal(f.get('scanner:observations:v23').records[0].state,'EXPIRED');});
await test('targeted cancel preserves other observation and plan',async()=>{const f=fixture();f.put('scanner:active-plan',plan(f));const a=await f.t.saveObservation(f.env,observation(f));await f.t.saveObservation(f.env,observation(f,{pendingCondition:'other'}));await f.t.cancelTradingPlan(f.env,{scope:'OBSERVATION',observationId:a.observation.observationId});assert.equal(f.get('scanner:active-plan').status,'ARMED');assert.equal(f.get('scanner:observations:v23').records.filter(r=>r.state!=='CANCELLED').length,1);});
await test('cancelled observation cannot send pending notice',async()=>{const f=fixture();const a=await f.t.saveObservation(f.env,observation(f));f.setPushFailures(1);await f.t.runScanner(f.env);await f.t.cancelTradingPlan(f.env,{scope:'OBSERVATION',observationId:a.observation.observationId});f.advance(120000);await f.t.runScanner(f.env);assert.equal(f.pushes.length,0);});
await test('status distinguishes configuration, heartbeat and provider delivery',async()=>{const f=fixture();let s=await f.t.scannerStatus(f.env);assert.equal(s.configuration.barkConfigured,true);assert.equal(s.diagnostics.heartbeatHealthy,false);await f.t.runScanner(f.env);s=await f.t.scannerStatus(f.env);assert.equal(s.diagnostics.heartbeatHealthy,true);f.advance(180001);s=await f.t.scannerStatus(f.env);assert.equal(s.diagnostics.heartbeatHealthy,false);});
await test('four actions retained with observation fields and targeted cancel',async()=>{const f=fixture();const s=await(await f.c.worker.fetch(new Request('https://test.invalid/openapi.json'),f.env,{})).json();assert.equal(Object.values(s.paths).flatMap(p=>Object.values(p)).filter(p=>p.operationId).length,4);const schema=s.paths['/scanner/plan'].post.requestBody.content['application/json'].schema;assert.ok(schema.properties.observationZone);assert.equal(schema.required.includes('risk'),false);assert.ok(s.paths['/scanner/cancel'].post.requestBody);});

function breakoutMarket(f,n=6,short=false) {
 const m=market(f.now()), rows=m.assets.ETHUSDT.timeframes['15m'].recentCandles;
 rows.forEach(c=>Object.assign(c,{o:95,h:100,l:90,c:95}));
 const i=rows.length-n;
 Object.assign(rows[i],{o:99,h:103,l:99,c:102});
 for(let j=i+1;j<rows.length;j++)Object.assign(rows[j],{o:102,h:104,l:101,c:102});
 Object.assign(rows[i+2],{o:102,h:102,l:99,c:101});
 Object.assign(rows.at(-1),{o:102,h:105,l:101,c:104});
 m.assets.ETHUSDT.ticker.last=104;
 if(short){rows.forEach(c=>{const {o,h,l,c:close}=c;Object.assign(c,{o:200-o,h:200-l,l:200-h,c:200-close});});m.assets.ETHUSDT.ticker.last=96;
 for(const a of Object.values(m.assets))for(const tf of Object.values(a.timeframes)){tf.trend='DOWN';tf.structure='LH_LL';}}
 return m;
}
await test('breakout progresses across six candles rather than exact last three',async()=>{const f=fixture(),m=breakoutMarket(f);const seed=f.t.breakoutSeeds(m.assets.ETHUSDT)[0];assert.equal(seed.boundary,100);assert.equal(f.t.breakoutProgress(seed,m.assets.ETHUSDT).state,'STRUCTURE_READY');assert.equal(f.t.breakoutCandidate(seed,m.assets.ETHUSDT,m.assets.BTCUSDT)?.submodel,'B1');});
await test('short breakout is mirrored',async()=>{const f=fixture(),m=breakoutMarket(f,6,true);const seed=f.t.breakoutSeeds(m.assets.ETHUSDT)[0];assert.equal(seed.direction,'SHORT');assert.equal(f.t.breakoutCandidate(seed,m.assets.ETHUSDT,m.assets.BTCUSDT)?.direction,'SHORT');});
await test('breakout boundary and clock stay fixed while candles append',async()=>{const f=fixture(),m=breakoutMarket(f);const seed=f.t.breakoutSeeds(m.assets.ETHUSDT)[0],original=JSON.stringify(seed);m.assets.ETHUSDT.timeframes['15m'].recentCandles[1].h=999;f.t.breakoutProgress(seed,m.assets.ETHUSDT);assert.equal(JSON.stringify(seed),original);});
await test('two closes back inside invalidate breakout instead of infinite wait',async()=>{const f=fixture(),m=breakoutMarket(f);const seed=f.t.breakoutSeeds(m.assets.ETHUSDT)[0];m.assets.ETHUSDT.timeframes['15m'].recentCandles.at(-2).c=97;m.assets.ETHUSDT.timeframes['15m'].recentCandles.at(-1).c=97;assert.equal(f.t.breakoutProgress(seed,m.assets.ETHUSDT).state,'INVALIDATED');});
await test('unconfirmed future candle cannot supply trigger',async()=>{const f=fixture(),m=breakoutMarket(f);m.assets.ETHUSDT.timeframes['15m'].recentCandles.at(-1).confirmed=false;const seed=f.t.breakoutSeeds(m.assets.ETHUSDT)[0];assert.notEqual(f.t.breakoutProgress(seed,m.assets.ETHUSDT).state,'STRUCTURE_READY');});
await test('stale structure, price chasing and missing realistic target do not qualify',async()=>{const f=fixture(),m=breakoutMarket(f);const a=m.assets.ETHUSDT,b=m.assets.BTCUSDT,seed=f.t.breakoutSeeds(a)[0];a.ticker.last=115;assert.equal(f.t.breakoutCandidate(seed,a,b),null);a.ticker.last=104;a.timeframes['15m'].dataFreshness.state='stale-on-error';assert.equal(f.t.breakoutCandidate(seed,a,b),null);a.timeframes['15m'].dataFreshness.state='live';a.timeframes['1h'].levels={};a.timeframes['4h'].levels={};assert.equal(f.t.breakoutCandidate(seed,a,b),null);});
await test('autonomous discovery creates persistent observations even with live plan',async()=>{const f=fixture();f.setMarket(breakoutMarket(f));f.setPrices([104,104]);f.put('scanner:active-plan',plan(f));vm.runInContext('planLiquidityRisk=()=>({passed:true});',f.c);const r=await f.t.runScanner(f.env);assert.equal(r.observations.status,'candidate');assert.ok(f.get('scanner:observations:v23').records.length);assert.equal(f.get('scanner:active-plan').planId,'old-plan');assert.equal(f.reads.snapshots,1);});
await test('discovery does not require optional flow and never saves execution plan',async()=>{const f=fixture();f.setMarket(breakoutMarket(f));f.setPrices([104,104]);vm.runInContext('planLiquidityRisk=()=>({passed:true});',f.c);await f.t.runScanner(f.env);const r=f.get('scanner:observations:v23').records.find(r=>r.state==='MARKET_CANDIDATE');assert.ok(r);assert.equal(r.openNowAllowed,false);assert.equal(f.get('scanner:active-plan'),null);});
await test('registered observation works with autonomous discovery disabled',async()=>{const f=fixture();f.env.DISCOVERY_ENABLED='false';await f.t.saveObservation(f.env,observation(f));await f.t.runScanner(f.env);assert.equal(f.get('scanner:observations:v23').records[0].state,'IN_ZONE');assert.equal(f.pushes.length,1);});
await test('repeat cancellation of identical plan sends exactly one cancellation notice',async()=>{const f=fixture();f.put('scanner:active-plan',plan(f));await f.t.cancelTradingPlan(f.env);await f.t.cancelTradingPlan(f.env);await f.t.cancelTradingPlan(f.env);assert.equal(f.pushes.length,1);assert.equal(f.get('scanner:active-plan').status,'CANCELLED');});
await test('observation history pruning retains oldest live record',async()=>{const f=fixture();const a=await f.t.saveObservation(f.env,observation(f));const book=f.get('scanner:observations:v23');for(let i=0;i<48;i++)book.records.push({observationId:'history-'+i,state:'EXPIRED'});f.put('scanner:observations:v23',book);await f.t.saveObservation(f.env,observation(f,{pendingCondition:'second active'}));const b=f.get('scanner:observations:v23');assert.equal(b.records.length,48);assert.ok(b.records.find(r=>r.observationId===a.observation.observationId));});
await test('slow snapshot forces fresh prices before an arrival notice',async()=>{const f=fixture();f.put('scanner:active-plan',plan(f));f.c.slow=async()=>{f.advance(9000);f.setPrices([110,110]);return structuredClone(f.market());};vm.runInContext('buildSnapshot=slow;',f.c);const r=await f.t.runScanner(f.env);assert.notEqual(r.evaluation.state,'ZONE_REACHED');assert.equal(f.reads.prices,2);});
await test('cancel all reports cancelled observations when no plan exists',async()=>{const f=fixture();await f.t.saveObservation(f.env,observation(f));const r=await f.t.cancelTradingPlan(f.env,{scope:'ALL'});assert.equal(r.status,'cancelled');assert.equal(r.count,1);assert.equal(f.get('scanner:observations:v23').records[0].state,'CANCELLED');});
await test('cancel all reports observations when old plan is already cancelled',async()=>{const f=fixture();f.put('scanner:active-plan',{...plan(f),status:'CANCELLED'});await f.t.saveObservation(f.env,observation(f));const r=await f.t.cancelTradingPlan(f.env,{scope:'ALL'});assert.equal(r.status,'cancelled');assert.equal(r.observationCancellation.count,1);assert.equal(f.pushes.length,0);});
console.log(JSON.stringify({suite:'v23-lifecycle',passed,failed,total:passed+failed,liveNetworkCalls:0}));process.exitCode=failed?1:0;
