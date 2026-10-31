import {stripMonitorExtensions} from './preservation-monitor.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {fixture,market} from './v24-fixtures.mjs';

// Isolated payloads from production builders with synthetic upstream data only.
// The 96,272-byte case matches the reported size, not the user's unseen payload.
const root=new URL('../',import.meta.url),sizes=[],cases=[];
let passed=0,failed=0;
async function test(name,fn){try{await fn();passed++;cases.push({name,passed:true});}catch(e){failed++;cases.push({name,passed:false,error:e.message});console.error(name,e.stack);}}
const plain=v=>JSON.parse(JSON.stringify(v)),byteSize=v=>Buffer.byteLength(JSON.stringify(v));
function load(source){const c={Date,Response,Request,Headers,URL,console,structuredClone};vm.createContext(c);vm.runInContext(source.replaceAll('export class ','class ').replaceAll('export function ','function ').replace('export default {','globalThis.worker={'),c);return c;}
const source=fs.readFileSync(new URL('main-v188.js',root),'utf8');
const current=load(source),old=load(fs.readFileSync(new URL('tests/baselines/V27_1_1_main-v188.js',root),'utf8'));
const project=(c,m)=>{c.snapshot=m;return plain(vm.runInContext('boundedMarketSnapshot(snapshot)',c));};
const full=()=>JSON.parse(fs.readFileSync(new URL('tests/fixtures/full-market-synthetic.json',root),'utf8'));
function connected(m){
  const at=m.generatedAt;
  m.newsContext={status:'PARTIAL_VERIFIED_FEEDS',checkedAt:at,sources:Object.fromEntries(['JIN10','COINDESK','FED_PRESS','FED_SPEECH','BLS_CPI','BLS_EMPLOYMENT','BLS_CALENDAR'].map(id=>[id,{status:'ok',httpStatus:200,fetchedAt:at,latestPublishedAt:at,parserRevision:'27.1.1',itemCount:20,parseDiagnostics:{rawItemCount:20,acceptedItemCount:20,rejectedItemCount:0,parserRevision:'27.1.1'}}])),
    headlines:Array.from({length:16},(_,i)=>({id:'fixture-'+i,source:'JIN10',title:'ETH 以太坊风险消息中文与 emoji 😀 '.repeat(8),url:'https://example.invalid/'+i,publishedAt:at,fetchedAt:at,riskTags:['RISK_REASSESSMENT'],relevant:true})),recentRiskHeadlines:[],upcomingEvents:[],eventWindow:[]};
  m.newsContext.recentRiskHeadlines=m.newsContext.headlines.slice(0,4);
  return m;
}
function preserve(input,out){
  assert.notEqual(out.decisionState,'TRANSPORT_ERROR',JSON.stringify(out.transportDiagnostics));
  assert.ok(byteSize(out)<=90000);
  assert.equal(out.transportDiagnostics.transferredUtf8Bytes,byteSize(out));
  assert.equal(out.transportDiagnostics.modelAssessmentsTransferredInFull,true);
  for(const symbol of ['ETHUSDT','BTCUSDT']){
    assert.deepEqual(out.assets[symbol].ticker,input.assets[symbol].ticker);
    for(const tf of ['15m','1h','4h'])for(const key of ['quality','coordinator','indicators','levels'])assert.deepEqual(out.assets[symbol].timeframes[tf][key],input.assets[symbol].timeframes[tf][key]);
  }
  assert.deepEqual(out.assets.ETHUSDT.opportunityEngine.models,input.assets.ETHUSDT.opportunityEngine.models);
  assert.deepEqual(out.newsContext.sources,input.newsContext.sources);
  assert.deepEqual(out.newsContext.recentRiskHeadlines,input.newsContext.recentRiskHeadlines);
  sizes.push({originalUtf8Bytes:byteSize(input),transferredUtf8Bytes:byteSize(out),reductions:out.transportDiagnostics.omitted});
}
await test('actual builder shape retains complete model assessments and audit fields',()=>{
  const m=full(),before=JSON.stringify(m);preserve(m,project(current,m));assert.equal(JSON.stringify(m),before);
});
await test('96,272-byte synthetic payload reproduces previous rejection and transfers now',()=>{
  const m=full();
  for(const asset of Object.values(m.assets))for(const tf of Object.values(asset.timeframes))tf.recentCandles=tf.recentCandles.slice(-8);
  m.newsContext.diagnosticSamples={};
  while(byteSize(m)<96100)m.newsContext.diagnosticSamples['sample'+Object.keys(m.newsContext.diagnosticSamples).length]='x'.repeat(30);
  m.newsContext.diagnosticContext='';const need=96272-byteSize(m);assert.ok(need>=0);m.newsContext.diagnosticContext='x'.repeat(need);assert.equal(byteSize(m),96272);
  const before=project(old,m);assert.equal(before.error?.code,'MARKET_RESPONSE_BUDGET_EXCEEDED');preserve(m,project(current,m));
});
await test('connected seven-source news and long multibyte titles fit without losing risk headlines',()=>{
  const m=connected(full());preserve(m,project(current,m));
});
await test('all eight nonempty candidates retain every number, cost, target and frozen evidence item',()=>{
  const m=connected(full());
  m.assets.ETHUSDT.opportunityEngine.models=m.assets.ETHUSDT.opportunityEngine.models.map((row,i)=>({...row,state:'CANDIDATE_FOR_REVIEW',failedGate:null,netRR:2+i/10,
    candidate:{submodel:row.submodel,direction:'LONG',entryZone:{min:2410+i,max:2412+i},stopLoss:2400,firstRealisticTarget:{price:2442+i,basis:'NEAREST_STRUCTURAL_OBSTACLE'},target:2442+i,netRR:2+i/10,
      estimatedRoundTripCostPct:0.15,costStressMultiplier:1.5,eventAt:m.generatedAt,expiresAt:m.generatedAt,routeEvidence:{frozen:true,observations:Array.from({length:20},(_,j)=>({candleAt:m.generatedAt,close:2410+j,protectedLow:2400+j,passed:true})),rationale:'Real structural evidence must remain intact. '.repeat(20)},openNowAllowed:false}}));
  preserve(m,project(current,m));
});
await test('same-response duplicate references resolve to the exact original object',()=>{
  const m=connected(full()),out=project(current,m),read=(o,p)=>p.split('.').reduce((v,k)=>v?.[k],o);
  assert.ok(Object.keys(out.transportDiagnostics.references).length>=2);
  for(const [from,to] of Object.entries(out.transportDiagnostics.references)){
    const original=plain(read(m,from));const normalize=v=>{if(!v||typeof v!=='object')return;for(const [k,x] of Object.entries(v)){if(['limitation','identityWarning','policy'].includes(k)&&typeof x==='string')v[k]='SEE_CORE_KNOWLEDGE';else normalize(x);}};
    if(out.transportDiagnostics.omitted.includes('REPEATED_EXPLANATORY_SENTENCES_AVAILABLE_IN_CORE_KNOWLEDGE'))normalize(original);
    assert.deepEqual(read(out,to),original);
  }
});
await test('unknown oversized extension stays an explicit transport error and never fabricates a trade state',()=>{
  const m=full();m.unknown=Object.fromEntries(Array.from({length:5000},(_,i)=>['field'+i,'x'.repeat(100)]));const out=project(current,m);
  assert.equal(out.decisionState,'TRANSPORT_ERROR');assert.equal(out.transportDiagnostics.modelAssessmentsTransferredInFull,false);assert.ok(byteSize(out)<90000);
});
await test('old parser cache is flagged, refreshed and consumed with current-version Fed items',async()=>{
  const f=fixture();f.c.TextDecoder=TextDecoder;f.c.Intl=Intl;
  const x=vm.runInContext('({cachedNewsContext,newsContextSummary})',f.c),at=new Date(f.now()).toISOString(),pending=[];
  let records={records:Object.fromEntries(['FED_PRESS','FED_SPEECH'].map(id=>[id,{status:'ok',httpStatus:200,items:[],fetchedAt:at,lastAttemptAt:at,transportRevision:'27.0.2',parserRevision:'27.1.0',parseDiagnostics:{rawItemCount:id==='FED_PRESS'?20:15,acceptedItemCount:0,rejectedItemCount:id==='FED_PRESS'?20:15,contentStatus:'ALL_ITEMS_REJECTED'}}]))};
  let release;const blocked=new Promise(r=>release=r);
  const owner={env:{},ctx:{storage:{get:async()=>structuredClone(records),put:async(k,v)=>{records=structuredClone(v);}},waitUntil:p=>pending.push(p)}};
  f.c.fetch=async url=>{await blocked;return new Response(url.endsWith('.ics')?'BEGIN:VCALENDAR\nEND:VCALENDAR':`<rss><channel><item><title>ETH Fed test</title><link>https://example.invalid/n</link><pubDate><![CDATA[${new Date(f.now()).toUTCString()}]]></pubDate></item></channel></rss>`);};
  const stale=await x.cachedNewsContext(owner);assert.equal(stale.parserAudit.cacheNeedsRefresh,true);assert.equal(stale.sources.FED_PRESS.parseDiagnostics.acceptedItemCount,0);
  release();await Promise.all(pending);
  const refreshed=await x.cachedNewsContext(owner);assert.equal(refreshed.parserAudit.cacheNeedsRefresh,false);assert.equal(refreshed.sources.FED_PRESS.parserRevision,x.newsContextSummary({}).parserAudit.expectedRevision);assert.equal(refreshed.sources.FED_PRESS.parseDiagnostics.acceptedItemCount,1);
  await Promise.all(pending);
  const m=market(f.now());m.newsContext=refreshed;f.setMarket(m);await f.t.runDiscovery(f.env);const status=await f.t.scannerStatus(f.env);
  assert.equal(status.diagnostics.newsConsumption.parserAudit.cacheNeedsRefresh,false);assert.equal(status.discovery.newsStatus.sources.FED_PRESS.parseDiagnostics.acceptedItemCount,1);
});
await test('delivery and official macro-news patch preserves scanner implementation and model thresholds',()=>{
  const allowed=new Set(['handleSnapshot','estimatedCandidateCost','holdingFundingScenarios','assessSwingOpportunity','adaptiveAssessmentBase','opportunityAssessmentBase','discoverRangeReversalBase','fastLocalEnvironment','scannerCycleReceipt','scannerStatusRecord','processObservation','sendBark','saveTradingPlan','scanActivePlan','boundedScannerStatus','processNewsReassessment','newsItem','parseNewsXml','newsContextSummary','coordinatedNewsContext','durableStateCall','coordinatedPublicEndpoint','cooldownError','candleQuality','coordinatedLiquidityRecheck','scannerCycle','runScannerUnlocked','runScanner','scannerConfiguration','scannerStatus','buildManualResponse','evaluateObservation','runDiscovery','processDynamicAlert','openApi','advanceForwardRecord','updateForwardStudy','forwardStudySummary','candidateCard','observationAlert','scannerNotification','parseOkxFunding','updateRejectionFunnel','buildOpportunityScan','adaptiveAssessment','opportunityAssessment','discoverRangeReversal','evaluateTradingPlan','evaluateObservation','runDiscovery','scanActivePlan','durableStateCall','openApi','opportunityAssessment','discoverRangeReversal','evaluateTradingPlan','buildManualResponse','openApi','publicMarketDefinitions','coordinatedMarketBundle','coordinatedDirectQuote','refreshServedSnapshot','buildSnapshot','runDiscovery','coordinatedNewsContext','newsContextSummary','adaptiveAssessment','buildOpportunityScan','updateRejectionFunnel','buildMarketRegimeRouter','boundedMarketSnapshot','newsContextSummary','runDiscovery','scannerStatus']);
  const previous=fs.readFileSync(new URL('tests/baselines/V27_1_1_main-v188.js',root),'utf8');
  for(const [,n] of previous.matchAll(/^(?:export )?(?:async )?function (\w+)\(/gm))if(vm.runInContext(n+'.toString()',old)!==vm.runInContext(n+'.toString()',current))assert.ok(allowed.has(n),n);
  assert.equal(stripMonitorExtensions(vm.runInContext('ScannerState.toString()',old)).replace(/    if\(input\?\.op==="liquidityRecheck"\).*?\n/,''),stripMonitorExtensions(vm.runInContext('ScannerState.toString()',current)).replace(/    if\(input\?\.op==="liquidityRecheck"\).*?\n/,''));
});
console.log(JSON.stringify({suite:'market-envelope',passed,failed,cases,sizes,productionPayloadAvailable:false,productionVerified:false},null,2));process.exitCode=failed?1:0;
