import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../main-v188.js',import.meta.url),'utf8');
let now=Date.parse('2026-10-31T04:40:47.514Z');
class Clock extends Date{constructor(...a){super(...(a.length?a:[now]));}static now(){return now;}}
let calls=0;const c={Date:Clock,Response,Request,Headers,URL,AbortController,structuredClone,console,setTimeout,clearTimeout,
 fetch:async()=>{calls++;return Response.json({code:'0',data:[{ts:String(now),instId:'ETH-USDT-SWAP',tradeId:'current',px:'2400',sz:'1',side:'buy'}]});}};
vm.createContext(c);vm.runInContext(source.replaceAll('export class ','class ').replaceAll('export function ','function ').replace('export default {','globalThis.worker={'),c);
const x=vm.runInContext('({nextFastAlarmAt,compactFastMonitor,coordinatedPublicEndpoint,persistPublicMarketIfChanged,runFastMonitorAlarm,FAST_MONITOR_KEY,PUBLIC_MARKET_STATE_KEY})',c);
const state={status:'ok',lastTickAt:Date.parse('2026-10-31T04:40:47.231Z'),lastSuccessAt:new Date(now).toISOString(),
 executionQuote:{status:'ok',source:'OKX_USDT_PERPETUAL',last:2400,bid:2399.99,ask:2400.01,
 exchangeTimestamp:'2026-10-31T04:40:45.350Z',lastTradeTimestamp:'2026-10-31T04:40:45.350Z',bookTimestamp:'2026-10-31T04:40:47.352Z'}};
const oldDue=Date.parse('2026-10-31T04:40:52.350Z'),observedLateMs=4495,boundedObservedNetworkMs=300;
const next=x.nextFastAlarmAt(state);
assert.ok(next<oldDue-2000,'production late-alarm case must wake earlier');
const healthyAt=at=>{const saved=now;now=at;const healthy=x.compactFastMonitor(state).quoteHealthy;now=saved;return healthy;};
assert.equal(healthyAt(next+observedLateMs+boundedObservedNetworkMs),true,'original quote remains inside 10s at repaired handoff');
assert.equal(healthyAt(oldDue+observedLateMs+boundedObservedNetworkMs),false,'same old quote still expires at the original hard threshold');

const path='/api/v5/market/trades?instId=ETH-USDT-SWAP&limit=500',db=new Map();let writes=0,fail=false;
const owner={ctx:{storage:{async get(k){return db.get(k);},async put(k,v){writes++;if(fail){fail=false;throw Error('ISOLATED_STORAGE_FAILURE');}db.set(k,structuredClone(v));}}}};
db.set(x.PUBLIC_MARKET_STATE_KEY,{entries:{[path]:{rows:[{ts:String(now-5000)}],storedAt:now-1000,state:'live'}},cooldowns:{}});
const current=await x.coordinatedPublicEndpoint(owner,path,{freshSeconds:4,staleSeconds:0});
assert.equal(calls,1,'1s collection age cannot disguise 5s-old exchange trades');assert.equal(current.state,'live');
await x.coordinatedPublicEndpoint(owner,path,{freshSeconds:4,staleSeconds:0});assert.equal(calls,1,'genuinely fresh trade is still shared');
// Ordinary raw flow updates do not rewrite unchanged durable metadata/circuits.
await x.persistPublicMarketIfChanged(owner);const initialWrites=writes;
for(let i=0;i<20;i++){
 owner.publicRecords.entries[path].rows[0].ts=String(now+i);
 await x.persistPublicMarketIfChanged(owner);
}
assert.equal(writes,initialWrites);
owner.publicRecords.cooldowns.book=now+30000;
await Promise.all(Array.from({length:10},()=>x.persistPublicMarketIfChanged(owner)));
assert.equal(writes,initialWrites+1,'concurrent callers persist one changed cooldown');
owner.publicRecords.cooldowns.book+=1000;fail=true;
await assert.rejects(()=>x.persistPublicMarketIfChanged(owner),/ISOLATED_STORAGE_FAILURE/);
await x.persistPublicMarketIfChanged(owner);
assert.equal(db.get(x.PUBLIC_MARKET_STATE_KEY).cooldowns.book,owner.publicRecords.cooldowns.book,'failed durable write cannot suppress recovery');
// Ordinary fast ticks need one state row and one alarm row, not five writes.
owner.env={SCANNER_TOKEN:'fixture',BARK_DEVICE_KEY:'fixture',SCANNER_STATE:{getByName(){return {};}}};
let alarmWrites=0,fastWrites=0;
owner.ctx.storage.setAlarm=async()=>{alarmWrites++;};
const put=owner.ctx.storage.put;
owner.ctx.storage.put=async(k,v)=>{if(k===x.FAST_MONITOR_KEY)fastWrites++;return put(k,v);};
c.fakeFlow=async(_o,path)=>({state:'live',storedAt:now,rows:path.includes('instruments')?
 [{instId:'ETH-USDT-SWAP',ctType:'linear',ctVal:'0.1',ctValCcy:'ETH',settleCcy:'USDT'}]:path.includes('trades')?
 [{instId:'ETH-USDT-SWAP',tradeId:String(now),ts:String(now),px:'2400',sz:'1',side:'buy'}]:
 [{ts:String(now),bids:[['2399.99','100','0','1']],asks:[['2400.01','100','0','1']]}]});
vm.runInContext('coordinatedPublicEndpoint=fakeFlow;maintainFastModelReview=async()=>{};',c);
for(let i=0;i<24;i++){now+=2500;const tick=await x.runFastMonitorAlarm(owner);assert.equal(tick.quoteHealthy,true);}
assert.equal(fastWrites,24);assert.equal(alarmWrites,24);
const worstCaseFastRowsPerDay=2*86400000/2500;
assert.equal(worstCaseFastRowsPerDay,69120);
assert.ok(worstCaseFastRowsPerDay<100000,'fast baseline must leave headroom within the documented free row-write quota');
console.log(JSON.stringify({passed:true,scope:'REPLAY_REAL_R5C_TIMESTAMPS_WITH_SYNTHETIC_ALARM_AND_STORAGE',oldDue:new Date(oldDue).toISOString(),newDue:new Date(next).toISOString(),originalTenSecondExpiryPreserved:true,unchangedFlowWritesCoalesced:true,productionVerified:false}));
