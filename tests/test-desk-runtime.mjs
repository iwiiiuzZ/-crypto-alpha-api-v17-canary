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
const plan={id:'ZEC-B1-LONG-INTRADAY-a',revision:'v1',eventAt:at(now-900000),asset:'ZEC',model:'B1',direction:'LONG',horizon:'INTRADAY',low:99,high:100,stop:95,invalidation:97,target:116,costPct:.15,capturedAt:at(now),expiresAt:at(now+900000)};
const asset={ready:true,quote:{ready:true,independent:true},plans:[plan]};
const scan={capturedAt:at(now),assets:{ZEC:asset,BTC:{...asset,plans:[]}}};
const snapshot={assets:{ZECUSDT:{timeframes:{}},BTCUSDT:{timeframes:{}}}};
await api.capture(owner,scan,snapshot);await api.capture(owner,scan,snapshot);
assert.equal((await api.read(owner)).journal.records.length,1,'scan is idempotent');
assert.equal(state.get('desk:v1:watches').length,1,'automatic discovery needs no button');
// The same market event must keep its first published paper ticket even when
// recalculated ATR/cost creates a new revision every minute.
await api.capture(owner,{...scan,assets:{...scan.assets,ZEC:{...asset,plans:[{...plan,revision:'drift',low:99.01,stop:94.99}]}}},snapshot);
assert.equal((await api.read(owner)).journal.records.length,1,'same event does not create a stream of drafts');
assert.equal((await api.read(owner)).journal.records[0].plan.revision,'v1','published prices remain frozen');
assert.equal(state.get('desk:v1:watches')[0].plan.revision,'v1','watch and ledger use the same frozen ticket');
// Older plans used the recalculated boundary in their ID: simulate a restart across the upgrade.
for(const key of state.keys())if(key.startsWith('desk:v3:structure:'))state.delete(key);
await api.capture(owner,{...scan,assets:{...scan.assets,ZEC:{...asset,plans:[{...plan,id:plan.id+'-moved',revision:'changed',low:99.03}]}}},snapshot);
assert.equal((await api.read(owner)).journal.records.length,1,'a moving boundary on the same candle retains the legacy ticket');
assert.equal(state.get('desk:v1:watches').length,1);
const restarted={ctx:{storage},env:{}};
assert.equal((await api.read(restarted)).journal.records.length,1,'journal survives isolate restart');
await api.tick(owner);assert.equal((await api.read(owner)).journal.records[0].status,'WAITING');
await api.tick(owner,plan,quote());assert.equal((await api.read(owner)).journal.records[0].status,'OPEN');
assert.equal((await api.read(owner)).alerts.filter(a=>a.id.startsWith('ENTRY:')).length,1,'paper entry has its own durable notification');
const amended={...plan,revision:'v2',target:118,capturedAt:at(f.now())};await api.capture(owner,{...scan,assets:{...scan.assets,ZEC:{...asset,plans:[amended]}}},snapshot);
assert.equal((await api.read(owner)).journal.records.length,1,'open position cannot be rewritten by a new target');
f.advance(1000);price=117;await api.tick(owner);assert.equal((await api.read(owner)).journal.statistics.sampleSize,1);
await api.flush(owner);assert.equal((await api.read(owner)).alerts[0].status,'FAILED');
fail=false;f.advance(20000);await api.flush(owner);let alerts=(await api.read(owner)).alerts;assert.equal(alerts[0].status,'ACCEPTED');await api.flush(owner);alerts=(await api.read(owner)).alerts;assert.equal(alerts.filter(r=>r.id.startsWith('PLAN:')).length,1);assert.ok(alerts.every(r=>r.status==='ACCEPTED'));const sent=pushes;await api.flush(owner);assert.equal(pushes,sent,'provider accepted alert is not resent');
assert.equal(alerts[0].deviceReceiptVerified,false);
await api.control(owner,{value:{action:'pause'}});assert.equal((await api.read(owner)).settings.enabled,false);
const test=await api.control(owner,{value:{action:'test-notification'}});assert.equal(test.status,200);
const receipt=test.body.alerts.find(a=>a.id.startsWith('TEST:'));assert.equal(receipt.deviceReceiptVerified,false);
await api.control(owner,{value:{action:'confirm-receipt',id:receipt.id}});assert.equal((await api.read(owner)).alerts.find(a=>a.id===receipt.id).deviceReceiptVerified,true);
assert.equal((await api.control(owner,{value:{action:'test-notification'}})).status,429);
console.log('PASS durable auto-discovery, restart, idempotency, frozen open plan, paper lifecycle, retry, receipt confirmation and rate limit');

await api.control(owner,{value:{action:'enable'}});
const badScan={...scan,assets:{...scan.assets,ZEC:{...asset,asset:'ZEC',ready:false}}};
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

const hourly=runInContext('deskClosedBars',f.c);
const period=3600000,last=Math.floor(f.now()/period)*period-period;
const history=Array.from({length:80},(_,i)=>({ts:at(last-(79-i)*period),open:100,close:101,high:102,low:99,volumeBase:12,confirmed:true}));
let upstream=0;f.c.hourRead=async()=>{upstream++;return history;};
runInContext('fetchOkxStructureCandles=hourRead;',f.c);
const isolated={ctx:{storage},env:{}};
assert.equal((await hourly(isolated,'BTCUSDT',f.now(),false)).length,0);assert.equal(upstream,0);
const rows=await hourly(isolated,'BTCUSDT',f.now(),true);assert.equal(rows.length,80);assert.equal(rows[0].source,'OKX_USDT_PERPETUAL');
assert.equal((await hourly(isolated,'BTCUSDT',f.now(),false)).length,80);assert.equal(upstream,1);
assert.ok(runInContext('AlphaDeskAutonomy.volatility',f.c)({timeframes:{'1h':{candles:rows}}},f.now()).threshold>0);

const zecOwner={ctx:{storage},env:{}};f.c.hourRead=async(config,tf)=>{
 assert.equal(config.instrumentId,'ZEC-USDT-SWAP');
 const ms={'15m':900000,'1h':3600000,'4h':14400000}[tf],end=Math.floor(f.now()/ms)*ms;
 return history.map((r,i)=>({...r,ts:at(end-(80-i)*ms)}));
};
runInContext('fetchOkxStructureCandles=hourRead;',f.c);
await api.market(zecOwner,{assets:{ZECUSDT:{timeframes:{}}}});
const zecFrames=state.get('desk:v2:market-scanner').frames.filter(f=>f.asset==='ZEC');
assert.equal(zecFrames.length,3);assert.ok(zecFrames.every(f=>!f.reason&&f.source==='OKX_USDT_PERPETUAL'));

// A previous installation can have both assets in its watch and paper queues.
const migration = runInContext('retireEtherMonitoring',f.c);
const previousStore = new Map([
 ['scanner:active-plan',{value:{symbol:'BTCUSDT',planId:'existing'}}],
 ['scanner:fast-market:v1',{executionQuote:{last:2200}}],
 ['desk:v1:watches',[{plan:{asset:'BTC'}},{plan:{asset:'ETH'}}]],
 ['desk:v2:alerts',[{id:'PLAN:ETH-B1',title:'ETH 正式模拟计划'},{id:'PLAN:BTC-B1',title:'BTC 正式模拟计划'}]],
 ['desk:v2:active',['old-open','old-wait','live-btc']],
 ['old-open',{status:'OPEN',plan:{asset:'ETH'},entry:{price:2200},exit:null}],
 ['old-wait',{status:'WAITING',plan:{asset:'ETH'},entry:null}],
 ['live-btc',{status:'OPEN',plan:{asset:'BTC'},entry:{price:75000}}],
 ['old-win',{status:'WIN',plan:{asset:'ETH'},exit:{price:2300}}]
]);
const migratedStorage = {get:async k=>previousStore.get(k),put:async(k,v)=>previousStore.set(k,v),
 delete:async k=>previousStore.delete(k),transaction:async fn=>fn(migratedStorage)};
await migration(migratedStorage);
assert.deepEqual(Array.from(previousStore.get('desk:v2:active')),['live-btc']);
assert.equal(previousStore.get('old-open').status,'UNRESOLVED');
assert.equal(previousStore.get('old-open').exit,null);
assert.equal(previousStore.get('old-wait').status,'RETIRED');
assert.equal(previousStore.get('old-win').status,'WIN');
assert.equal(previousStore.get('live-btc').status,'OPEN');
assert.equal(previousStore.get('scanner:active-plan').value.planId,'existing');
assert.equal(previousStore.has('scanner:fast-market:v1'),false);
assert.equal(previousStore.get('desk:v2:alerts').length,1);
assert.equal(previousStore.get('desk:v1:watches')[0].plan.asset,'BTC');
const once=JSON.stringify([...previousStore]);
await migration(migratedStorage);
assert.equal(JSON.stringify([...previousStore]),once);
console.log('PASS retired ETH never repriced or pushed; BTC watches and settled history preserved across restart');
