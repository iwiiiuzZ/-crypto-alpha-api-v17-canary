import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {fixture,observation,plan,market,authRequest} from './v24-fixtures.mjs';
const raw=fs.readFileSync(new URL('../main-v188.js',import.meta.url),'utf8');
const names='ScannerState,parseOkxExecutionPrice,genuineExecutionQuote,snapshotReadiness,refreshServedSnapshot,coordinatedMarketBundle,coordinatedDirectQuote,coordinatedPublicEndpoint,verifyOkxScannerPrice,verifyOkxScannerZone,scannerStatus,normalizeTradingPlan,evaluateTradingPlan,evaluateObservation';
const source=raw.replaceAll('export class ','class ').replaceAll('export function ','function ').replace('export default {','globalThis.worker={')+'\nglobalThis.t={'+names+'};';
let passed=0,failed=0;const results=[];
async function test(name,fn){try{await fn();passed++;results.push({name,passed:true});}catch(e){failed++;results.push({name,passed:false,error:e.message});console.error(name,e.stack);}}
function fx(){
 let now=Date.parse('2026-10-14T02:40:00Z');
 class Clock extends Date{constructor(...a){super(...(a.length?a:[now]));}static now(){return now;}}
 const db=new Map(),calls=[];let handler=()=>Response.json({code:'0',data:[]});
 const c={Date:Clock,console,Math,JSON,URL,URLSearchParams,Request,Response,Headers,AbortController,setTimeout,clearTimeout,structuredClone,crypto:webcrypto,
 fetch:async(url,opts)=>{calls.push(String(url));return handler(new URL(url),opts);}};
 vm.createContext(c);vm.runInContext(source,c);
 let tail=Promise.resolve();const storage={get:async k=>structuredClone(db.get(k)),put:async(k,v)=>db.set(k,structuredClone(v)),delete:async k=>db.delete(k),transaction(fn){const t=tail.then(()=>fn(storage));tail=t.catch(()=>{});return t;}};
 const owner=new c.t.ScannerState({storage});
 const env={SCANNER_TOKEN:'synthetic-token',SCANNER_STATE:{getByName(){return{fetch:(url,init)=>owner.fetch(new Request(url,init))};}}};
 const ticker=(id='ETH-USDT-SWAP')=>({instId:id,last:'100',bidPx:'99.99',askPx:'100.01',ts:String(now)});
 const mark=()=>[{instId:'ETH-USDT-SWAP',markPx:'100',ts:String(now)}];
 return {c,t:c.t,env,owner,db,calls,storage,ticker,mark,now:()=>now,advance:n=>now+=n,setHandler:h=>handler=h,put:(k,v)=>db.set(k,{value:v,expiresAt:now+86400000})};
}
const ok=data=>Response.json({code:'0',data});
const rate=()=>new Response('limited',{status:429,headers:{'retry-after':'60'}});
await test('mark-only never becomes executable last price',()=>{
 const f=fx(),q=f.t.parseOkxExecutionPrice(f.mark(),[],'ETH-USDT-SWAP');
 assert.equal(q.status,'partial');assert.equal(q.last,null);assert.equal(q.markPrice,100);assert.equal(f.t.genuineExecutionQuote(q),false);
});
await test('reject zero, crossed, future and stale quote rows',()=>{
 for(const change of [{bidPx:'0'},{bidPx:'101',askPx:'100'},{ts:String(Date.parse('2026-10-14T02:41:00Z'))},{ts:String(Date.parse('2026-10-14T02:39:00Z'))}]){
  const f=fx(),q=f.t.parseOkxExecutionPrice(f.mark(),[{...f.ticker(),...change}],'ETH-USDT-SWAP');assert.equal(q.last,null);
 }
});
await test('fresh real quote does not require mark endpoint',()=>{const f=fx(),q=f.t.parseOkxExecutionPrice([], [f.ticker()], 'ETH-USDT-SWAP');assert.equal(f.t.genuineExecutionQuote(q),true);assert.equal(q.markPrice,null);});
function readyAssets(f){const a=market(f.now()).assets;for(const v of Object.values(a)){v.ticker=f.t.parseOkxExecutionPrice([], [f.ticker()], 'ETH-USDT-SWAP');v.derivatives={openInterest:{status:'ok'},funding:{status:'ok'}};}return a;}
await test('execution blocked but observation preserved on quote failure',()=>{const f=fx(),a=readyAssets(f);a.ETHUSDT.ticker=f.t.parseOkxExecutionPrice(f.mark(),[],'ETH-USDT-SWAP');const r=f.t.snapshotReadiness(a);assert.equal(r.observationDataReady,true);assert.equal(r.criticalReady,false);});
await test('BTC missing execution quote alone does not veto ETH',()=>{const f=fx(),a=readyAssets(f);a.BTCUSDT.ticker={status:'unavailable'};assert.equal(f.t.snapshotReadiness(a).criticalReady,true);a.BTCUSDT.timeframes['4h'].quality.passed=false;assert.equal(f.t.snapshotReadiness(a).criticalReady,false);});
await test('cached response recomputes execution quote age',()=>{const f=fx(),s={assets:readyAssets(f),coverage:{},decisionState:'DATA_READY'};f.advance(36000);assert.equal(f.t.refreshServedSnapshot(s).decisionState,'DATA_BLOCKED');});
await test('ten concurrent consumers share sixteen shared public requests with multi-venue recheck kept separate',async()=>{
 const f=fx();f.setHandler(u=>u.pathname==='/api/v5/market/tickers'&&u.searchParams.get('instType')==='SWAP'?ok([f.ticker('BTC-USDT-SWAP'),f.ticker()]):ok([]));
 const r=await Promise.all(Array.from({length:10},()=>f.t.coordinatedMarketBundle(f.owner)));
 assert.equal(f.calls.length,16);assert.ok(r.every(x=>x.modules['/api/v5/market/tickers?instType=SWAP'].rows.length===2));
 const freshOwner=new f.t.ScannerState({storage:f.storage});await f.t.coordinatedMarketBundle(freshOwner);assert.equal(f.calls.length,18,'Object restart refreshes only short-lived raw feeds');
});
await test('batch 429 falls back to real single-instrument quote',async()=>{
 const f=fx();f.setHandler(u=>u.pathname==='/api/v5/market/tickers'&&u.searchParams.get('instType')==='SWAP'?rate():u.pathname==='/api/v5/market/ticker'?ok([f.ticker(u.searchParams.get('instId'))]):ok([]));
 const r=await f.t.coordinatedMarketBundle(f.owner);const rows=r.modules['/api/v5/market/tickers?instType=SWAP'].rows;
 assert.equal(rows.length,2);assert.ok(rows.every(r=>r._endpoint.startsWith('/api/v5/market/ticker?')));assert.ok(Object.values(f.db.get('market:public-okx:v25').cooldowns).every(n=>n>=f.now()+60000));
});
function quoteFallback(f,{fullOnly=false,failAll=false}={}){
 f.setHandler(u=>{
  if(u.pathname.endsWith('/ticker'))return rate();
  if(u.pathname.endsWith('/mark-price'))return ok([]);
  if(failAll)return rate();
  if(u.pathname.endsWith('/trades'))return ok([{instId:'ETH-USDT-SWAP',px:'100',ts:String(f.now())}]);
  if(u.pathname.endsWith('/books')&&fullOnly)return rate();
  if(/\/books(?:-full)?$/.test(u.pathname))return ok([{bids:[['99.99','10']],asks:[['100.01','10']],ts:String(f.now())}]);
  return ok([]);
 });
}
await test('single ticker outage uses actual trade plus perpetual book',async()=>{const f=fx();quoteFallback(f);const q=await f.t.verifyOkxScannerPrice('ETHUSDT',f.env);assert.equal(q.last,100);assert.equal(q.primaryEndpoint,'OKX_SWAP_TRADES_PLUS_BOOK');assert.equal(q.verification.passed,true);assert.ok(q.bookTimestamp&&q.lastTradeTimestamp);});
await test('books outage uses books-full without disguising other exchange',async()=>{const f=fx();quoteFallback(f,{fullOnly:true});const q=await f.t.verifyOkxScannerPrice('ETHUSDT',f.env);assert.equal(q.source,'OKX_USDT_PERPETUAL_DIRECT_VERIFIED');assert.ok(f.calls.some(u=>u.includes('/books-full?')));});
await test('all quote paths rate limited: no fabricated price, cooldown persists',async()=>{
 const f=fx();quoteFallback(f,{failAll:true});await assert.rejects(()=>f.t.coordinatedDirectQuote(f.owner,'ETHUSDT'));
 const n=f.calls.length;const owner=new f.t.ScannerState({storage:f.storage});await assert.rejects(()=>f.t.coordinatedDirectQuote(owner,'ETHUSDT'));assert.equal(f.calls.length,n);
});
await test('direct reminder double sample really fetches twice',async()=>{const f=fx();f.setHandler(u=>u.pathname.endsWith('/ticker')?ok([f.ticker()]):ok([]));const q=await f.t.verifyOkxScannerZone('ETHUSDT',{min:99,max:101},f.env);assert.equal(q.confirmed,true);assert.equal(f.calls.filter(u=>u.includes('/ticker?')).length,2);});
await test('stale recent trade cannot be combined with a fresh book',async()=>{const f=fx();quoteFallback(f);const base=f.c.fetch;f.c.fetch=async(u,o)=>String(u).includes('/trades?')?ok([{instId:'ETH-USDT-SWAP',px:'100',ts:String(f.now()-60000)}]):base(u,o);await assert.rejects(()=>f.t.verifyOkxScannerPrice('ETHUSDT',f.env));});
await test('state endpoint read retries a transient failure then recovers',async()=>{const f=fx();let n=0;const original=f.storage.get;f.storage.get=async k=>{if(n++===0)throw new Error('transient database');return original(k);};const r=await f.t.scannerStatus(f.env);assert.equal(r.status,'ok');assert.equal(r.diagnostics.stateReadSucceeded,true);});
await test('persistent state error is readable degraded JSON and does not erase state',async()=>{const f=fx();f.put('scanner:observations:v23',{records:[{observationId:'keep',state:'OBSERVING'}]});f.storage.get=async()=>{throw new Error('database unavailable');};const r=await(await f.c.worker.fetch(authRequest('/scanner/status'),f.env,{})).json();assert.equal(r.status,'degraded');assert.equal(r.diagnostics.heartbeatHealthy,false);assert.equal(r.observations,null);assert.equal(f.db.get('scanner:observations:v23').value.records[0].observationId,'keep');});
await test('malformed legacy records are reported not iterated or deleted',async()=>{const f=fx();f.put('scanner:observations:v23',{records:{bad:true}});const r=await f.t.scannerStatus(f.env);assert.equal(r.status,'degraded');assert.equal(r.diagnostics.stateFormatIssue,'OBSERVATION_RECORDS_NOT_ARRAY');assert.deepEqual(f.db.get('scanner:observations:v23').value.records,{bad:true});});
await test('status payload compacts histories while retaining active identifiers',async()=>{
 const f=fx();f.put('scanner:observations:v23',{records:Array.from({length:60},(_,i)=>({observationId:'obs-'+i,state:i<12?'OBSERVING':'EXPIRED',observationZone:{min:100,max:101},pendingCondition:'x'.repeat(10000),history:Array(100).fill({message:'x'.repeat(1000)}),alerts:{IN_ZONE:{status:'PENDING',attempts:2}}}))});
 const r=await f.t.scannerStatus(f.env);assert.equal(r.observations.length,12);assert.equal(r.observations[0].observationId,'obs-0');assert.equal(r.diagnostics.pendingObservationPushes,60);assert.ok(JSON.stringify(r).length<65000);
});
await test('fresh state heartbeats distinguished from missing and stale',async()=>{const f=fx();assert.equal((await f.t.scannerStatus(f.env)).diagnostics.heartbeatHealthy,false);f.put('scanner:heartbeat:v23',{lastCompletedAt:new Date(f.now()).toISOString(),status:'completed'});assert.equal((await f.t.scannerStatus(f.env)).diagnostics.heartbeatHealthy,true);f.advance(181000);assert.equal((await f.t.scannerStatus(f.env)).diagnostics.heartbeatHealthy,false);});
await test('status still requires authentication',async()=>{const f=fx();assert.equal((await f.c.worker.fetch(new Request('https://test.invalid/scanner/status'),f.env,{})).status,401);});
await test('account/psychology absent accepted without fabricating cleared status',()=>{const f=fixture(),p=plan(f);delete p.risk;const normalized=f.t.normalizeTradingPlan(p);assert.equal(normalized.risk.management,'USER_MANAGED');assert.equal(normalized.risk.riskAssessmentStatus,undefined);assert.equal(normalized.risk.derivedSizing,undefined);});
await test('legacy account blockers ignored, genuine market blockers remain',()=>{const f=fixture(),p=plan(f);p.hardBlockers=['ACCOUNT_OR_PSYCHOLOGY_STATE_NOT_VERIFIED'];assert.doesNotThrow(()=>f.t.normalizeTradingPlan(p));p.hardBlockers.push('MAJOR_EVENT_EXECUTION_RISK');assert.throws(()=>f.t.normalizeTradingPlan(p));});
await test('valid observation saves through actual route without quote/account data',async()=>{const f=fixture();f.setPriceFailure(true);f.setSnapshotFailure(true);const r=await(await f.c.worker.fetch(authRequest('/scanner/plan',observation(f)),f.env,{})).json();assert.equal(r.status,'observation_saved');assert.ok(r.observation.observationId);assert.equal(f.reads.prices,0);});
await test('close-based invalidation still works during quote outage',()=>{const f=fixture(),o=observation(f,{observationInvalidation:{level:101,mode:'CLOSE_15M'},sourceAnalysisAt:new Date(f.now()-900000).toISOString()});const r=f.t.evaluateObservation(o,f.market(),null);assert.equal(r.state,'INVALIDATED');});
await test('price-based observation is retained when quote is unavailable',()=>{const f=fixture(),o=observation(f);const r=f.t.evaluateObservation(o,f.market(),null);assert.equal(r.state,'DATA_BLOCKED');assert.equal(r.observationRetained,true);});
await test('manual priority no longer starves discovery and scanner heartbeat',async()=>{const f=fixture();f.put('scanner:manual-priority',{until:f.now()+60000});await f.t.runScanner(f.env);assert.ok(f.reads.snapshots>0);assert.equal(f.get('scanner:heartbeat:v23').status,'completed');});
await test('scheduled entry point runs despite active manual priority',async()=>{const f=fx();let scans=0;f.put('scanner:manual-priority',{until:f.now()+60000});f.c.scanFake=async()=>{scans++;};vm.runInContext('loadDurableStructureRecords=async()=>({});runScanner=scanFake;',f.c);await f.c.worker.scheduled({},f.env,{});assert.equal(scans,1);});
await test('MARK_PRICE_ONLY cannot invalidate a formal plan or confirm entry',()=>{const f=fixture(),p=plan(f),s=f.market();s.assets.ETHUSDT.ticker={status:'ok',source:'OKX_USDT_PERPETUAL',priceType:'MARK_PRICE_ONLY',last:94,markPrice:94};assert.equal(f.t.evaluateTradingPlan(p,s,{},null).state,'DATA_BLOCKED');});
await test('missing asset set cannot claim observation readiness',()=>{assert.equal(fx().t.snapshotReadiness({}).observationDataReady,false);});
await test('malformed book write is refused and original content preserved',async()=>{const f=fixture();f.put('scanner:observations:v23',{records:{unknown:'preserve'}});await assert.rejects(()=>f.t.saveObservation(f.env,observation(f)),/FORMAT_INVALID/);assert.equal(f.get('scanner:observations:v23').records.unknown,'preserve');});
console.log(JSON.stringify({passed,failed,total:passed+failed,results},null,2));process.exitCode=failed?1:0;
