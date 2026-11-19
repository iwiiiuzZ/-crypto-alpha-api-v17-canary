import assert from 'node:assert/strict';
import {runInContext} from 'node:vm';
import {fixture} from './v24-fixtures.mjs';
const f=fixture(),at=n=>new Date(n).toISOString();
const state=new Map();
const storage={get:async k=>structuredClone(state.get(k)),put:async(k,v)=>state.set(k,structuredClone(v)),transaction:async fn=>fn(storage),list:async({prefix,reverse=false,limit=100,end})=>new Map([...state].filter(([k])=>k.startsWith(prefix)&&(!end||k<end)).sort(([a],[b])=>reverse?b.localeCompare(a):a.localeCompare(b)).slice(0,limit))};
const owner={ctx:{storage},env:{}};
const now=f.now();
const quote=(price=100)=>({status:'ok',source:'OKX_USDT_PERPETUAL',priceType:'LAST_TRADE_PLUS_REAL_BOOK',last:price,bid:price-.01,ask:price,lastTradeTimestamp:at(f.now()),bookTimestamp:at(f.now()),exchangeTimestamp:at(f.now())});
let price=100,pushes=0,fail=true;
f.c.runtimeQuote=async()=>quote(price);
f.c.runtimePush=async()=>{pushes++;return {sent:!fail,providerAcceptedAt:!fail?at(f.now()):null};};
const api=runInContext(`deskDirectQuote=runtimeQuote;sendBark=runtimePush;fastMonitorConfigured=()=>true;ensureFastMonitor=async()=>({scheduled:true});({capture:captureDeskPlans,tick:deskPaperTick,read:deskOperations,control:deskControl,flush:deskFlushAlerts,alert:deskAlert,market:recordDeskMarketScan})`,f.c);
const plan={id:'ETH-B1-LONG-INTRADAY-a',revision:'v1',asset:'ETH',model:'B1',direction:'LONG',horizon:'INTRADAY',low:99,high:100,stop:95,invalidation:97,target:116,costPct:.15,capturedAt:at(now),expiresAt:at(now+900000)};
const asset={ready:true,quote:{ready:true,independent:true},plans:[plan]};
const scan={capturedAt:at(now),assets:{ETH:asset,BTC:{...asset,plans:[]}}};
const snapshot={assets:{ETHUSDT:{timeframes:{}},BTCUSDT:{timeframes:{}}}};
await api.capture(owner,scan,snapshot);await api.capture(owner,scan,snapshot);
assert.equal((await api.read(owner)).journal.records.length,1,'scan is idempotent');
assert.equal(state.get('desk:v1:watches').length,1,'automatic discovery needs no button');
// The same market event must keep its first published paper ticket even when
// recalculated ATR/cost creates a new revision every minute.
await api.capture(owner,{...scan,assets:{...scan.assets,ETH:{...asset,plans:[{...plan,revision:'drift',low:99.01,stop:94.99}]}}},snapshot);
assert.equal((await api.read(owner)).journal.records.length,1,'same event does not create a stream of drafts');
assert.equal((await api.read(owner)).journal.records[0].plan.revision,'v1','published prices remain frozen');
assert.equal(state.get('desk:v1:watches')[0].plan.revision,'v1','watch and ledger use the same frozen ticket');
const restarted={ctx:{storage},env:{}};
assert.equal((await api.read(restarted)).journal.records.length,1,'journal survives isolate restart');
await api.tick(owner);assert.equal((await api.read(owner)).journal.records[0].status,'WAITING');
f.advance(1000);await api.tick(owner,plan,quote());assert.equal((await api.read(owner)).journal.records[0].status,'OPEN');
assert.equal((await api.read(owner)).alerts.filter(a=>a.id.startsWith('ENTRY:')).length,1,'paper entry has its own durable notification');
const amended={...plan,revision:'v2',target:118,capturedAt:at(f.now())};await api.capture(owner,{...scan,assets:{...scan.assets,ETH:{...asset,plans:[amended]}}},snapshot);
assert.equal((await api.read(owner)).journal.records.length,1,'open position cannot be rewritten by a new target');
f.advance(1000);price=117;await api.tick(owner);assert.equal((await api.read(owner)).journal.statistics.sampleSize,1);
await api.flush(owner);assert.equal((await api.read(owner)).alerts[0].status,'FAILED');
fail=false;f.advance(20000);await api.flush(owner);let alerts=(await api.read(owner)).alerts;assert.equal(alerts[0].status,'ACCEPTED');const sent=pushes;await api.flush(owner);assert.equal(pushes,sent,'provider accepted alert is not resent');
assert.equal(alerts[0].deviceReceiptVerified,false);
await api.control(owner,{value:{action:'pause'}});assert.equal((await api.read(owner)).settings.enabled,false);
const test=await api.control(owner,{value:{action:'test-notification'}});assert.equal(test.status,200);
const receipt=test.body.alerts.find(a=>a.id.startsWith('TEST:'));assert.equal(receipt.deviceReceiptVerified,false);
await api.control(owner,{value:{action:'confirm-receipt',id:receipt.id}});assert.equal((await api.read(owner)).alerts.find(a=>a.id===receipt.id).deviceReceiptVerified,true);
assert.equal((await api.control(owner,{value:{action:'test-notification'}})).status,429);
console.log('PASS durable auto-discovery, restart, idempotency, frozen open plan, paper lifecycle, retry, receipt confirmation and rate limit');

await api.control(owner,{value:{action:'enable'}});
const badScan={...scan,assets:{...scan.assets,ETH:{...asset,asset:'ETH',ready:false}}};
await api.capture(owner,badScan,snapshot);
let health=state.get('desk:v2:health');assert.equal(health.incidentOpen,true);
const failures=()=>state.get('desk:v2:alerts').filter(r=>r.title==='聚流｜行情数据异常').length;
const failuresAtStart=failures();
f.advance(10000);await api.capture(owner,scan,snapshot);
assert.equal(state.get('desk:v2:health').incidentOpen,true,'one healthy scan must not announce recovery');
f.advance(10000);await api.capture(owner,badScan,snapshot);assert.equal(failures(),failuresAtStart,'flapping stays in the same incident');
f.advance(10000);await api.capture(owner,scan,snapshot);
f.advance(61000);await api.capture(owner,scan,snapshot);
assert.equal(state.get('desk:v2:health').incidentOpen,false,'sustained healthy scans close the incident');
assert.equal(failures(),0,'technical faults never enter phone queue');
console.log('PASS technical health stays internal');
// Statistics must include older pages and remain identical when paging the list.
for(let i=0;i<145;i++)state.set('desk:v2:journal:2020-'+String(i).padStart(4,'0'),{status:i%2?'WIN':'LOSS',closedAt:at(now+i),exit:{netR:i%2?2:-1},plan:{id:'old-'+i,revision:'one'}});
owner.deskLedgerGeneration=(owner.deskLedgerGeneration||0)+1;
const all=await api.read(owner);assert.equal(all.journal.records.length,100);assert.equal(all.journal.statistics.sampleSize,146);assert.equal(all.journal.statistics.complete,true);
const earlier=await api.control(owner,{value:{action:'history',before:all.journal.nextBefore}});
assert.equal(earlier.body.statistics.sampleSize,146,'changing pages must not change the system win rate');
assert.equal((await api.read({ctx:{storage},env:{}})).journal.statistics.sampleSize,146,'all-history statistics survive restart');
console.log('PASS full-history statistics over multiple pages and restart');

// Suppress legacy technical retries, including ones already queued before upgrade.
state.set('desk:v2:alerts',[{id:'DATA:legacy',title:'聚流｜行情数据异常',status:'FAILED',attempts:1,nextAt:0}]);
const beforeTechnicalPush=pushes;await api.flush(owner);assert.equal(pushes,beforeTechnicalPush);assert.equal(state.get('desk:v2:alerts')[0].status,'SUPPRESSED');
await api.alert(owner,'RECOVER:new','聚流｜数据恢复','ignored');assert.equal(state.get('desk:v2:alerts').length,1);
// Background scanner and durable dedup do not depend on an open Site tab.
const ms=900000,end=Math.floor(f.now()/ms)*ms;
const frame={status:'ok',quality:{passed:true},recentCandles:Array.from({length:60},(_,i)=>({ts:at(end-(60-i)*ms),o:100,c:100,h:101,l:99,volume:100,confirmed:true}))};
Object.assign(frame.recentCandles.at(-1),{c:103,h:104,volume:300});
// Set the clock within the freshness window of this close.
f.advance(end+60000-f.now());
const market={assets:{BTCUSDT:{timeframes:{'15m':frame}}}};
await api.market(owner,market);await api.market(owner,market);await api.market({ctx:{storage},env:{}},market);
assert.equal(state.get('desk:v2:market-scanner').events.length,1,'same candle remains one event across restarts');
assert.equal(state.get('desk:v2:alerts').filter(a=>a.id.startsWith('MARKET:')).length,1);
assert.equal((await api.read(owner)).notificationPolicy.technicalPhoneAlerts,false);
console.log('PASS queued technical notices suppressed; 24-hour scanner persists and deduplicates over restart');

// Empty/already-final queues must not consume storage writes on every fast alarm.
const beforePut=storage.put;let noopWrites=0;storage.put=async(...args)=>{noopWrites++;return beforePut(...args);};
state.set('desk:v2:alerts',[]);
await api.flush(owner);assert.equal(noopWrites,0,'empty notification queue is read-only');
state.set('desk:v2:alerts',[{id:'HEALTH:old',status:'SUPPRESSED',reason:'OWNER_DISABLED_TECHNICAL_PHONE_ALERTS'}]);
await api.flush(owner);assert.equal(noopWrites,0,'suppressed notification stays read-only');
storage.put=beforePut;
console.log('PASS idle and suppressed queues perform zero writes');
