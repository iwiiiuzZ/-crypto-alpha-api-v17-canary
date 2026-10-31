import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {webcrypto,createHash} from 'node:crypto';
const root=path.resolve(process.argv[2]||path.join(path.dirname(new URL(import.meta.url).pathname),'..'));
if(!process.argv[3])throw Error('Pass repository root and original extracted 07_RESEARCH directory');
const samples=path.resolve(process.argv[3]);
const source=fs.readFileSync(path.join(root,'main-v188.js'),'utf8');
let now=0;class Clock extends Date{constructor(...a){super(...(a.length?a:[now]));}static now(){return now;}}
const c={Date:Clock,console,Math,JSON,URL,Request,Response,Headers,structuredClone,crypto:webcrypto,AbortController,setTimeout,clearTimeout,fetch:async()=>{throw Error('NETWORK_DISABLED');}};
vm.createContext(c);vm.runInContext(source.replaceAll('export class ','class ').replaceAll('export function ','function ').replace('export default {','globalThis.worker={'),c);
const e=vm.runInContext('({summarizeTimeframe,buildRangeContext,buildMarketRegimeRouter,trendPullbackSeeds,pullbackProgress,breakoutSeeds,breakoutProgress,compressionSeeds,rangeObservationSeed,adaptiveSeeds,adaptiveProgress})',c);
const steps={'15m':900000,'1h':3600000,'4h':14400000},results={};
for(const dir of ['MARKET_SAMPLE','MARKET_SAMPLE_20261020']){
 const raw={},provenance=[];
 for(const symbol of ['ETH','BTC']){
  raw[symbol]={};
  for(const [tf,step] of Object.entries(steps)){
   const p=path.join(samples,dir,symbol+'_'+tf+'.json'),bytes=fs.readFileSync(p),rows=JSON.parse(bytes).map(r=>({ts:new Date(Number(r.t)*1000).toISOString(),open:Number(r.o),high:Number(r.h),low:Number(r.l),close:Number(r.c),volumeContracts:Number(r.v),confirmed:true})).sort((a,b)=>Date.parse(a.ts)-Date.parse(b.ts));
   const valid=rows.every((r,i)=>[r.open,r.high,r.low,r.close].every(Number.isFinite)&&r.low<=Math.min(r.open,r.close)&&r.high>=Math.max(r.open,r.close)&&r.volumeContracts>=0&&(!i||Date.parse(r.ts)-Date.parse(rows[i-1].ts)===step));
   if(!valid)throw Error('INVALID_SAVED_SAMPLE_'+symbol+'_'+tf);
   raw[symbol][tf]=rows;
   provenance.push({symbol,timeframe:tf,rows:rows.length,sha256:createHash('sha256').update(bytes).digest('hex')});
  }
 }
 const seen=new Set(),ready=new Set(),by=Object.fromEntries(['A1','A2','B1','B2','C1','C2','D1','D2'].map(k=>[k,{uniqueResearchEvents:0,structureReadyEvents:0}]));
 let scanned=0,first=null,last=null;
 for(const bar of raw.ETH['15m'].slice(240,-1)){
  now=Date.parse(bar.ts)+steps['15m']+2000;
  const assets={};let valid=true;
  for(const symbol of ['ETH','BTC']){
   const frames={};
   for(const [tf,step] of Object.entries(steps)){
    const rows=raw[symbol][tf].filter(r=>Date.parse(r.ts)+step<=now).slice(-240);
    if(rows.length<200){valid=false;break;}
    frames[tf]={...e.summarizeTimeframe(rows),status:'ok',source:'GATE_USDT_PERPETUAL',quality:{passed:true},dataFreshness:{state:'HISTORICAL_PREFIX_RESEARCH_ONLY'},lastClosedCandle:rows.at(-1)};
   }
   if(!valid)break;
   const a={symbol:symbol+'USDT',timeframes:frames,ticker:{status:'research_only',last:frames['15m'].lastClose,source:'HISTORICAL_CANDLE_CLOSE_NOT_EXECUTABLE_OKX'}};
   a.rangeContext=e.buildRangeContext(a);a.marketRegimeRouter=e.buildMarketRegimeRouter(a);assets[symbol]=a;
  }
  if(!valid)continue;
  scanned++;first||=new Date(now).toISOString();last=new Date(now).toISOString();
  const a=assets.ETH,seeds=[...e.trendPullbackSeeds(a),...e.compressionSeeds(a),...e.breakoutSeeds(a),...e.adaptiveSeeds(a)];const range=e.rangeObservationSeed(a);if(range)seeds.push(range);
  for(const seed of seeds){
   const key=[seed.submodel,seed.direction,seed.eventAt||seed.breakoutAt,seed.boundary].join(':');
   if(!seen.has(key)){seen.add(key);by[seed.submodel].uniqueResearchEvents++;}
   const progress=seed.model==='A'?e.pullbackProgress(seed,a):seed.model==='B'?e.breakoutProgress(seed,a):seed.model==='D'?e.adaptiveProgress(seed,a):null;
   if(progress?.state==='STRUCTURE_READY'&&!ready.has(key)){ready.add(key);by[seed.submodel].structureReadyEvents++;}
  }
 }
 results[dir]={scannedClosed15mPrefixes:scanned,startAt:first,endAt:last,uniqueResearchEvents:seen.size,structureReadyEvents:ready.size,bySubmodel:by,provenance};
}
const report={scope:'SAVED_CANDLE_ONLY_STRUCTURE_DIAGNOSTIC_NOT_BACKTEST_OR_EXECUTABLE_TRADE',build:source.match(/const BUILD = "([^"]+)"/)[1],sourceSha256:createHash('sha256').update(source).digest('hex'),
 sourceDescription:'Original privately retained Gate public perpetual candles; not freshly fetched or independently authenticated in this run',
 barEndTimeCutoffApplied:true,historicalPublicationAvailabilityVerified:false,exactContractToBaseUnitsVerified:false,
 executableQuotesAvailable:false,orderbookAvailable:false,contemporaneousNewsAvailable:false,historicalFundingAvailable:false,
 unseenSampleStatus:'NOT_CERTIFIED_OUT_OF_SAMPLE_PRIOR_DEVELOPMENT_USE_UNKNOWN',overlappingWindowsNotIndependent:true,
 coverageQualityAssumption:'PREFIX_OHLC_CONTINUITY_CHECKED_LIVE_CROSS_MARKET_QUALITY_NOT_VERIFIED',
 structureReadyMeaning:'DETECTOR_PROGRESS_UNDER_LIMITED_RESEARCH_INPUT_NOT_PREPARED_TRADE',actualTradeCount:null,winRate:null,netExpectancy:null,profitabilityValidated:false,results};
fs.writeFileSync(path.join(root,'evidence/2026-10-31-r5d-candle-structure-diagnostic.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({scope:report.scope,build:report.build,results:Object.fromEntries(Object.entries(results).map(([k,v])=>[k,{steps:v.scannedClosed15mPrefixes,events:v.uniqueResearchEvents,structureReady:v.structureReadyEvents,by:v.bySubmodel}])),profitabilityValidated:false},null,2));
