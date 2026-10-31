import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
const path = process.env.CRYPTO_AUDIT_SOURCE || new URL('../main-v188.js', import.meta.url);
const source = fs.readFileSync(path, 'utf8').replaceAll('export class ', 'class ').replaceAll('export function ', 'function ').replace('export default {', 'globalThis.worker = {') + '\n;globalThis.t={normalizeTradingPlan,evaluateCourseDecision,evaluateTradingPlan,planNetRR,scannerConfiguration,capitalFlowEvidence};';
const context = {console, Date, Math, JSON, URL, URLSearchParams, Request, Response, Headers, crypto: webcrypto, setTimeout, clearTimeout, structuredClone, fetch: async () => {throw new Error('Unexpected network request');}};
vm.createContext(context); vm.runInContext(source, context);
const {normalizeTradingPlan, evaluateCourseDecision, evaluateTradingPlan, planNetRR} = context.t;
let passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; } catch (error) { failed++; console.error(name, error.message); } }
function input() {return {
  symbol:'ETHUSDT', direction:'LONG', model:'B', submodel:'B1', marketRegime:'TREND', opportunityGrade:'A', timeframe:'SHORT',
  modelInvalidation:'Loss of protected low', location:{quality:'GOOD',type:'RETEST',rangePosition:'EDGE',rationale:'Breakout retest'},
  trigger:{type:'BOS',meaningful:true,level:100,acceptanceLevel:99,protectiveStructure:{type:'HL',price:96}},
  entryZone:{min:100,max:101},stopLoss:95,invalidationPrice:95,takeProfits:[{price:120,allocationPct:100}],firstRealisticTarget:{price:120,basis:'First overhead resistance'},
  minNetRR:2,estimatedRoundTripCostPct:0.15,confirmation:{close15mAbove:100},hardBlockers:[],
  risk:{accountEquityUsdt:1000,accountRiskPct:1,leverage:5,riskAssessmentStatus:'VERIFIED_CLEAR',dailyRiskLimitReached:false,psychologicalVeto:false,correlatedRiskPct:0},
  sourceAnalysisAt:new Date().toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString()
};}
function decision() {return {
  direction:'LONG',model:'B',submodel:'B1',marketRegime:'TREND',locationQuality:'GOOD',rangePosition:'EDGE',
  setup:{breakout:true,retest:true,acceptance:true,rejection:false},trigger:{complete:true,meaningful:true,protectiveStructure:true},
  confirmation:{minimumSufficientEvidence:true},execution:{clearInvalidation:true,netRR:2,minNetRR:2},data:{requiredFieldsReady:true},
  environment:{btcSystemicConflict:false,majorNewsExecutionRisk:false,liquidityAbnormal:false},
  risk:{riskAssessmentStatus:'VERIFIED_CLEAR',dailyRiskLimitReached:false,psychologicalVeto:false,correlatedRiskPct:0}
};}
test('default auxiliary flow is not mandatory',()=>assert.equal(normalizeTradingPlan(input()).confirmation.requireFlowSupport,false));
test('explicit auxiliary requirement retained',()=>{const x=input();x.confirmation.requireFlowSupport=true;assert.equal(normalizeTradingPlan(x).confirmation.requireFlowSupport,true);});
test('account sizing removed, market costs retained',()=>{const p=normalizeTradingPlan(input());assert.equal(p.risk.derivedSizing,undefined);assert.equal(p.estimatedRoundTripCostPct,0.15);});
test('invalid negative estimated costs rejected',()=>{const x=input();x.estimatedRoundTripCostPct=-1;assert.throws(()=>normalizeTradingPlan(x));});
test('zero threshold cannot arm evaluator',()=>{const x=decision();x.execution.netRR=0;x.execution.minNetRR=0;assert.equal(evaluateCourseDecision(x).openNow,false);});
test('unknown account no longer blocks market signal',()=>{const x=decision();x.risk={};assert.equal(evaluateCourseDecision(x).openNow,true);});
test('rejected breakout is cancelled, not waiting',()=>{const x=decision();x.setup.rejection=true;x.setup.acceptance=false;assert.equal(evaluateCourseDecision(x).finalState,'NO_TRADE');});
test('empty setup cannot become waiting',()=>{const x=decision();x.setup={};assert.equal(evaluateCourseDecision(x).finalState,'NO_TRADE');});
test('completed model can open',()=>assert.equal(evaluateCourseDecision(decision()).finalState,'LONG'));
test('incomplete model requires specific pending trigger',()=>{const x=decision();x.trigger.complete=false;assert.equal(evaluateCourseDecision(x).finalState,'NO_TRADE');x.pendingTrigger='15m close above 100 with protected low 96';assert.equal(evaluateCourseDecision(x).finalState,'WAIT');});
test('missing confirmation evidence cannot open',()=>{const x=decision();x.confirmation={};assert.equal(evaluateCourseDecision(x).openNow,false);});
test('hard blocker cannot be overridden',()=>{const x=decision();x.environment.majorNewsExecutionRisk=true;x.score=100;assert.equal(evaluateCourseDecision(x).openNow,false);});
test('raw RR is not rounded up across threshold',()=>{const p={direction:'LONG',stopLoss:90,takeProfits:[{price:117.996}],estimatedRoundTripCostPct:0};assert.ok(planNetRR(p,100)<1.8);});

function snapshot(regime='TREND', rangeZone='LOWER_EDGE') {
 const tf=()=>({status:'ok',source:'GATE_USDT_PERPETUAL',quality:{passed:true},dataFreshness:{state:'fresh'},trend:'UP',structure:'HH_HL',indicators:{atr14:1},levels:{},recentCandles:[{ts:new Date(Math.floor(Date.now()/900000)*900000-900000).toISOString(),o:100,h:102,l:99,c:101,confirmed:true}]});
 const asset={ticker:{status:'ok',last:100.5,source:'OKX_USDT_PERPETUAL',bid:100.49,ask:100.51,exchangeTimestamp:new Date().toISOString()},timeframes:{'15m':tf(),'1h':tf(),'4h':tf()},marketRegimeRouter:{regime},rangeContext:{confirmed:true,locationZone:rangeZone},capitalFlow:{status:'unavailable'},liquidityRisk:{visibleLiquidityPools:{equalLowClusters:[],equalHighClusters:[]},recentSweep:{bullishSweepReclaim:true}}};
 return {decisionState:'DATA_READY',assets:{ETHUSDT:asset,BTCUSDT:structuredClone(asset)}};
}
const verification={confirmed:true,rule:'TWO_INDEPENDENT_CURRENT_OKX_SAMPLES_INSIDE_ZONE'};
function evaluate(p,s) {return evaluateTradingPlan(p,s,{zoneAlertSentAt:new Date().toISOString()},verification);}
test('breakout watch-to-trend promotion no deadlock',()=>{const x=input();x.marketRegime='COMPRESSION';const p=normalizeTradingPlan(x);p.confirmation.requireFlowSupport=false;const r=evaluate(p,snapshot());assert.equal(r.state,'MARKET_CONFIRMED',JSON.stringify(r.failedChecks));});
test('unexpected regime change still blocked',()=>{const p=normalizeTradingPlan(input());p.confirmation.requireFlowSupport=false;assert.notEqual(evaluate(p,snapshot('RANGE')).state,'MARKET_CONFIRMED');});
test('range reversal not vetoed by 1h range leg',()=>{const x=input();x.model='C';x.submodel='C1';x.marketRegime='RANGE';x.trigger.reclaimLevel=99;x.location.rangePosition='LOWER_EDGE';const p=normalizeTradingPlan(x);p.confirmation.requireFlowSupport=false;const s=snapshot('RANGE');s.assets.ETHUSDT.timeframes['1h'].trend='DOWN';s.assets.ETHUSDT.timeframes['1h'].structure='LH_LL';assert.equal(evaluate(p,s).state,'MARKET_CONFIRMED');});
test('saved edge cannot authorize current range middle',()=>{const x=input();x.model='C';x.submodel='C1';x.marketRegime='RANGE';x.trigger.reclaimLevel=99;x.location.rangePosition='LOWER_EDGE';const p=normalizeTradingPlan(x);p.confirmation.requireFlowSupport=false;assert.notEqual(evaluate(p,snapshot('RANGE','MIDDLE')).state,'MARKET_CONFIRMED');});
test('scanner never grants execution',()=>{const p=normalizeTradingPlan(input());p.confirmation.requireFlowSupport=false;assert.equal(evaluate(p,snapshot()).openNowAllowed,false);});
test('expired plan cannot confirm',()=>{const p=normalizeTradingPlan(input());p.expiresAt=new Date(Date.now()-1).toISOString();assert.equal(evaluate(p,snapshot()).state,'EXPIRED');});
test('model invalidation still cancels',()=>{const p=normalizeTradingPlan(input());const s=snapshot();s.assets.ETHUSDT.ticker.last=94;assert.equal(evaluate(p,s).state,'INVALIDATED');});
test('registered trigger level is actually checked',()=>{const x=input();x.trigger.level=105;const p=normalizeTradingPlan(x);p.confirmation.requireFlowSupport=false;assert.notEqual(evaluate(p,snapshot()).state,'MARKET_CONFIRMED');});
test('legacy correlated risk is user managed',()=>{const x=input();x.risk.correlatedRiskPct=8;assert.equal(normalizeTradingPlan(x).risk.management,'USER_MANAGED');});
test('unknown correlated risk not invented',()=>{const x=input();delete x.risk.correlatedRiskPct;assert.equal(normalizeTradingPlan(x).risk.correlatedRiskPct,undefined);});
test('requested RR threshold is not rounded down',()=>{const x=input();x.minNetRR=2.0004;assert.equal(normalizeTradingPlan(x).minNetRR,2.0004);});
test('missing flow ratio is not adverse zero',()=>{const asset={capitalFlow:{periods:{'1h':{takerBuySellRatio:1}},orderBook:{imbalancePct:0}}};const btc={capitalFlow:{periods:{'15m':{takerBuySellRatio:1}}}};const r=context.t.capitalFlowEvidence('LONG',asset,btc);assert.equal(r.hardAdverse,false);assert.equal(r.score,3);});
test('missing flow ratio contributes no short score',()=>{const asset={capitalFlow:{periods:{'1h':{takerBuySellRatio:2}},orderBook:{imbalancePct:0}}};const btc={capitalFlow:{periods:{'15m':{takerBuySellRatio:2}}}};assert.equal(context.t.capitalFlowEvidence('SHORT',asset,btc).score,1);});
test('soft adverse evidence does not erase valid model',()=>{const x=decision();x.confirmation.extremeCrowding=true;assert.equal(evaluateCourseDecision(x).finalState,'LONG');});
test('account gap preserves separate market assessment',()=>{const x=decision();x.risk={};assert.equal(evaluateCourseDecision(x).marketState,'LONG');});
test('unknown environment cannot open',()=>{const x=decision();x.environment={};assert.equal(evaluateCourseDecision(x).openNow,false);});
test('legacy leverage ignored without fabricating authorization',()=>{const x=input();x.risk.leverage=0.01;assert.equal(normalizeTradingPlan(x).risk.leverage,undefined);});
test('short signal also excludes automatic sizing',()=>{const x=input();x.direction='SHORT';x.entryZone={min:100,max:101};x.stopLoss=x.invalidationPrice=106;x.takeProfits=[{price:80,allocationPct:100}];x.firstRealisticTarget.price=80;x.trigger.protectiveStructure={type:'LH',price:105};x.confirmation={close15mBelow:101};const p=normalizeTradingPlan(x);assert.equal(p.risk.derivedSizing,undefined);assert.ok(planNetRR(p,100)>2);});

async function testAsync(name,fn) {try {await fn();passed++;}catch(error){failed++;console.error(name,error.message);}}
const db=new Map();
const env={SCANNER_TOKEN:'local-fixture-not-a-real-secret',ALERT_STATE:{async get(key){return structuredClone(db.get(key)??null);},async put(key,value){db.set(key,JSON.parse(value));}}};
const request=(route,body,auth=true)=>new Request(`https://local.invalid${route}`,{method:body?'POST':'GET',headers:{...(auth?{authorization:'Bearer local-fixture-not-a-real-secret'}:{}),'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
await testAsync('actual route denies missing auth',async()=>assert.equal((await context.worker.fetch(request('/scanner/plan',input(),false),env,{})).status,401));
await testAsync('actual route accepts market plan without account risk',async()=>{const x=input();delete x.risk;assert.equal((await context.worker.fetch(request('/scanner/plan',x),env,{})).status,200);db.clear();});
await testAsync('actual route saves valid plan and preserves exact retry progress',async()=>{
 const x=input();const response=await context.worker.fetch(request('/scanner/plan',x),env,{});assert.equal(response.status,200);const first=await response.json();assert.equal(first.status,'saved');
 const runtime=db.get('scanner:runtime');runtime.zoneAlertSentAt='test-progress';db.set('scanner:runtime',runtime);
 const second=await (await context.worker.fetch(request('/scanner/plan',x),env,{})).json();assert.equal(second.status,'unchanged');assert.equal(second.plan.planId,first.plan.planId);assert.equal(db.get('scanner:runtime').zoneAlertSentAt,'test-progress');
});
await testAsync('actual schema preserves four actions and flow default',async()=>{const schema=await(await context.worker.fetch(request('/openapi.json'),env,{})).json();const operations=Object.values(schema.paths).flatMap(p=>Object.values(p)).filter(p=>p.operationId);assert.equal(operations.length,4);assert.match(JSON.stringify(schema),/"requireFlowSupport":\{"type":"boolean","default":false/);});
await testAsync('actual health reports partial automatic coverage',async()=>{const health=await(await context.worker.fetch(request('/health'),env,{})).json();assert.equal(health.actionCount,4);assert.equal(health.scanner.discovery.coverageIsPartial,true);assert.equal(health.binanceRequested,false);});
await testAsync('actual cancellation preserves no-auto-trade policy',async()=>{const response=await context.worker.fetch(request('/scanner/cancel',{}),env,{});assert.equal(response.status,200);assert.equal(db.get('scanner:active-plan').status,'CANCELLED');});
await testAsync('discovery missing optional flow does not erase structure candidate',async()=>{
 const isolated={...context};vm.createContext(isolated);vm.runInContext(source,isolated);
 isolated.full=snapshot();isolated.full.coverage={openNowDataReady:true};isolated.full.assets.ETHUSDT.executionLiquidity={status:'ok'};
 vm.runInContext(`
 breakoutProgress=()=>({state:'STRUCTURE_READY'});
 opportunityAssessment=()=>({candidate:{model:'B',submodel:'B1',direction:'LONG',boundary:100,candleAt:'fixture',entryZone:{min:100,max:101}}});
 planLiquidityRisk=()=>({passed:true});
 `,isolated);
 const r=vm.runInContext(`evaluateObservation({symbol:'ETHUSDT',direction:'LONG',origin:'AUTONOMOUS',seed:{kind:'BREAKOUT'},observationZone:{min:100,max:101},observationInvalidation:{level:95,mode:'PRICE'},expiresAt:new Date(Date.now()+600000).toISOString()}, full, {confirmed:true,current:{last:100.5},samples:[{last:100.5},{last:100.5}]})`,isolated);
 assert.equal(r.state,'MARKET_CANDIDATE');assert.equal(r.openNowAllowed,false);assert.ok(r.candidate.softWarnings.includes('AUXILIARY_FLOW_UNAVAILABLE_REVIEW_REQUIRED'));
});
console.log(JSON.stringify({passed,failed,total:passed+failed}));process.exitCode=failed?1:0;
