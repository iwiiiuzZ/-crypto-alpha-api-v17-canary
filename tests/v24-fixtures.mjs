import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

// All prices, candles, accounts, state and pushes in this suite are synthetic.
// No live exchange, Bark, account or network access is used.
const source = fs.readFileSync(new URL('../main-v188.js', import.meta.url), 'utf8')
  .replaceAll('export class ', 'class ').replaceAll('export function ', 'function ').replace('export default {', 'globalThis.worker = {')
  + '\n;globalThis.t={ScannerState,normalizeTradingPlan,normalizeObservation,saveObservation,evaluateObservation,observationVerification,breakoutSeeds,breakoutProgress,breakoutCandidate,runDiscovery,runScanner,scanActivePlan,scannerStatus,scannerCompareAndPut,processObservation,cancelTradingPlan,trendPullbackSeeds,pullbackProgress,compressionSeeds,opportunityAssessment,buildOpportunityScan,dynamicMarketContext,parseGateLargeTrades,processDynamicAlert,buildMarketRegimeRouter,fourHourTrendDirection,effectivePlanMinNetRR,planNetRR,evaluateTradingPlan,buildEffortVsResult,evaluateCourseDecision,LEGACY_CONFIG};';
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
  const asset={ticker:{status:'ok',last:100.5,bid:100.49,ask:100.51,source:'OKX_USDT_PERPETUAL',exchangeTimestamp:new Date(now).toISOString()},timeframes:{'15m':structuredClone(tf),'1h':structuredClone(tf),'4h':structuredClone(tf)},
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


export {fixture,market,observation,plan,authRequest};
