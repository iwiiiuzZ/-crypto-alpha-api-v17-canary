import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Real coordinator + real fast alarm, synthetic network and isolated storage.
// Reproduces production's BOOK 429 with no permissive health/test routes.
const source=fs.readFileSync(new URL('../main-v188.js',import.meta.url),'utf8');
let now=Date.parse('2026-10-31T03:07:17.060Z');
class Clock extends Date {constructor(...a){super(...(a.length?a:[now]));}static now(){return now;}}
const calls=[],state=new Map();let mode='ok';
const primary='/api/v5/market/books?instId=ETH-USDT-SWAP&sz=400';
const fallback='/api/v5/market/books-full?instId=ETH-USDT-SWAP&sz=400';
const book=()=>({ts:String(now),bids:[['2399.99','100','3']],asks:[['2400.01','100','4']]});
const c={Date:Clock,URL,Response,Request,Headers,AbortController,structuredClone,console,setTimeout,clearTimeout,
 fetch:async url=>{
  const p=new URL(url).pathname+new URL(url).search;calls.push(p);
  if(p===primary)return new Response('',{status:429,headers:{'Retry-After':'30'}});
  if(p===fallback){
   if(mode==='fail')return new Response('',{status:503});
   const b=book();if(mode==='stale')b.ts=String(now-10001);if(mode==='crossed')b.bids[0][0]='2401';
   return Response.json({code:'0',data:[b]});
  }
  if(p.includes('/instruments?'))return Response.json({code:'0',data:[{instId:'ETH-USDT-SWAP',ctType:'linear',ctValCcy:'ETH',settleCcy:'USDT',ctVal:'0.1',ctMult:'1'}]});
  if(p.includes('/trades?'))return Response.json({code:'0',data:[{instId:'ETH-USDT-SWAP',tradeId:String(now),ts:String(now),px:'2400',sz:'100',side:'buy'}]});
  return new Response('',{status:503});
 }};
vm.createContext(c);vm.runInContext(source.replaceAll('export class ','class ').replaceAll('export function ','function ').replace('export default {','globalThis.worker={'),c);
vm.runInContext('globalThis.x={coordinatedOrderflowEndpoint,publicMarketPersistable,runFastMonitorAlarm,compactFastMonitor,FAST_MONITOR_KEY,FAST_REVIEW_KEY,PUBLIC_MARKET_STATE_KEY};',c);
const x=c.x,owner={env:{SCANNER_TOKEN:'isolated',BARK_DEVICE_KEY:'isolated',SCANNER_STATE:{getByName(){return {};}}},ctx:{storage:{async get(k){return state.get(k);},async put(k,v){state.set(k,v);},async setAlarm(){}}}};
// Keep model/notification code isolated; no external message is sent by this test.
vm.runInContext('maintainFastModelReview=async()=>{};fastSendPending=async()=>{};',c);
const policy={freshSeconds:4,staleSeconds:0};
const first=await x.coordinatedOrderflowEndpoint(owner,primary,policy);
assert.equal(first.endpoint,fallback);assert.equal(first.failover.primaryHttpStatus,429);assert.equal(first.failover.fallbackSucceeded,true);
assert.deepEqual(Array.from(first.rows[0].bids[0]),['2399.99','100','0','3']);
assert.equal(owner.publicRecords.cooldowns['https://www.okx.com/api/v5/market/books'],now+30000);
const retryAt=owner.publicRecords.cooldowns['https://www.okx.com/api/v5/market/books'];
for(let i=0;i<3;i++){
 now+=5000;
 const r=await x.coordinatedOrderflowEndpoint(owner,primary,policy);
 assert.equal(r.failover.fallbackSucceeded,true);assert.equal(r.failover.primaryRetryAt,new Date(retryAt).toISOString());
}
assert.equal(calls.filter(p=>p===primary).length,1,'primary retry deadline honored');
assert.equal(owner.publicRecords.cooldowns['https://www.okx.com/api/v5/market/books'],retryAt,'fallback must not slide/clear primary circuit');
const before=calls.length;now+=1000;
await Promise.all(Array.from({length:10},()=>x.coordinatedOrderflowEndpoint(owner,primary,policy)));
assert.equal(calls.length,before,'all consumers reuse the four-second verified book');
const persisted=x.publicMarketPersistable(owner.publicRecords);
assert.equal(Object.hasOwn(persisted.entries,fallback),false);assert.equal(Object.hasOwn(persisted.entries,primary),false);
const live=await x.runFastMonitorAlarm(owner);
assert.equal(live.samplingHealthy,true);assert.equal(live.quoteHealthy,true);assert.equal(live.flowHealthy,true);
assert.equal(live.feedDiagnostics[2].actualEndpoint,fallback);assert.equal(live.feedDiagnostics[2].failover.primaryHttpStatus,429);
for(const bad of ['stale','crossed','fail']){
 now+=5000;mode=bad;delete owner.publicRecords.entries[primary];
 const r=await x.coordinatedOrderflowEndpoint(owner,primary,policy);
 assert.equal(r.failover.fallbackSucceeded,false,bad);assert.equal(r.state,'unavailable',bad);
}
now+=5000;delete owner.publicRecords.entries[primary];
const failed=await x.runFastMonitorAlarm(owner);
assert.equal(failed.samplingHealthy,false);assert.equal(failed.flowHealthy,false);
assert.ok(state.get(x.FAST_MONITOR_KEY).nextFlowAttemptAt>=now);
assert.equal(failed.lastSuccessAt,live.lastSuccessAt,'failed fallback cannot advance the old success');
console.log(JSON.stringify({passed:true,scope:'ISOLATED_REAL_COORDINATOR_AND_FAST_ALARM_429_FALLBACK',checks:['actual-source','full-depth-contract-count','primary-circuit-preserved','bounded-cache','coalesced-consumers','ephemeral-depth','fresh-fast-health','stale-crossed-and-double-failure-rejected'],productionVerified:false}));
