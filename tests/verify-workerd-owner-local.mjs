// Full production handlers + real workerd Durable Object; ALL exchanges/news/push are local fixtures.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';import assert from 'node:assert/strict';
const bin=process.argv[2];if(!bin)throw Error('Pass actual workerd binary');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-contention-runtime-'));
const source=fs.readFileSync(new URL('../main-v188.js',import.meta.url),'utf8');
const expectedBuild=source.match(/const BUILD\s*=\s*"([^"]+)"/)[1];
fs.writeFileSync(path.join(dir,'app.mjs'),`const RealDate=globalThis.Date;class Date extends RealDate {}export function setClock(n){}\n`+source);
fs.writeFileSync(path.join(dir,'entry.mjs'),`
import app,{setClock,ScannerState as BaseScannerState} from './app.mjs';
export class ScannerState extends BaseScannerState {
 constructor(ctx,env){const meter={calls:0};super(ctx,{...env,SCANNER_STATE:{getByName(){return {fetch(){meter.calls++;throw Error('Subrequest depth limit exceeded');}};}}});this.meter=meter;}
 async fetch(req){const body=await req.clone().json();if(body.op==='fixtureForbiddenCount')return Response.json({calls:this.meter.calls});return super.fetch(req);}
}

export default {async fetch(req,env,ctx){const u=new URL(req.url);
 if(u.pathname==='/__fixture/cron'){await app.scheduled({},env);return Response.json({handled:true});}
 if(u.pathname==='/__fixture/forbidden')return env.SCANNER_STATE.get(env.SCANNER_STATE.idFromName('crypto-alpha-primary')).fetch('https://internal/state',{method:'POST',body:JSON.stringify({op:'fixtureForbiddenCount'})});
 if(u.pathname==='/__fixture/public')return env.SCANNER_STATE.get(env.SCANNER_STATE.idFromName('crypto-alpha-primary')).fetch('https://internal/state',{method:'POST',body:JSON.stringify({op:'publicMarket'})});
 if(u.pathname==='/__fixture/control'){const q=await req.json();if(q.now)setClock(q.now);return fetch('https://fixtures.invalid/control',{method:'POST',body:JSON.stringify(q)});}
 return app.fetch(req,env,ctx);
}};`);
fs.writeFileSync(path.join(dir,'upstream.mjs'),`
let now=Date.now(),barkFail=false,quoteFail=false,newsFail=false,blsFail=false,pushes=[],quote=2400,bookCounter=0,flowFail=false;const counts={};
export default {async fetch(req){now=Date.now();const u=new URL(req.url);counts[u.hostname]=(counts[u.hostname]||0)+1;
 if(u.hostname==='fixtures.invalid'){const b=await req.json();if(b.now)now=b.now;if(b.barkFail!==undefined)barkFail=b.barkFail;if(b.quoteFail!==undefined)quoteFail=b.quoteFail;if(b.newsFail!==undefined)newsFail=b.newsFail;if(b.blsFail!==undefined)blsFail=b.blsFail;if(b.quote)quote=b.quote;if(b.flowFail!==undefined)flowFail=b.flowFail;return Response.json({now,pushes,counts});}
 if(u.hostname==='api.day.app'){const b=await req.json();if(barkFail)return Response.json({code:500},{status:503});pushes.push({title:b.title,body:b.body});return Response.json({code:200});}
 if(u.hostname==='mcp.jin10.com'){if(newsFail)return new Response('temporary upstream error',{status:503});const b=await req.json();if(req.headers.get('authorization')!=='Bearer fixture-news')return new Response('denied',{status:401});let result={};
  if(b.method==='initialize')result={protocolVersion:'2025-03-26',capabilities:{tools:{}}};if(b.method==='notifications/initialized')return new Response(null,{status:202});
  if(b.method==='tools/list')result={tools:[{name:'list_flash',inputSchema:{type:'object',properties:{}}}]};
  if(b.method==='tools/call')result={structuredContent:{status:200,data:{items:[{id:'news-1',title:'ETH fixture exchange security review',time:new Date(now-10000).toISOString(),url:'https://flash.jin10.com/detail/fixture'}]}}};
  return Response.json({jsonrpc:'2.0',id:b.id,result});
 }
 if(u.hostname==='www.bls.gov'&&blsFail)return new Response('access denied',{status:403});
 if(u.hostname==='www.newyorkfed.org'){
  const codes=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'],names=['January','February','March','April','May','June','July','August','September','October','November','December'],parts=u.pathname.match(/i-([a-z]+)([0-9]{2})/),month=codes.indexOf(parts[1]),year=2000+Number(parts[2]),next=new Date(now+86400000),day=next.getUTCMonth()===month?next.getUTCDate():1;
  return new Response('<h1>Economic Indicators Calendar</h1><div>'+names[month]+' '+year+'</div><table><td><div>'+String(day).padStart(2,'0')+'<br><a href="https://www.bls.gov/news.release/empsit.htm">Employment Situation</a><br>(08:30)</div></td></table>');
 }
 if(u.hostname.includes('coindesk')||u.hostname.includes('federalreserve')||u.hostname==='www.bls.gov')return new Response(u.pathname.endsWith('.ics')?'BEGIN:VCALENDAR\\nEND:VCALENDAR':'<rss><channel><item><title>ETH fixture</title><link>https://example.org/a</link><pubDate><![CDATA['+new Date(now-10000).toUTCString()+']]></pubDate></item></channel></rss>');
 if(u.hostname==='fapi.binance.com')return new Response('fixture region restriction',{status:451});
 if(u.hostname==='api.bybit.com'){
  let result={};
  if(u.pathname.endsWith('instruments-info'))result={list:[{symbol:'ETHUSDT',baseCoin:'ETH',quoteCoin:'USDT',settleCoin:'USDT',contractType:'LinearPerpetual'}]};
  if(u.pathname.endsWith('orderbook'))result={s:'ETHUSDT',b:[[String(quote-.01),'1000']],a:[[String(quote+.01),'1000']],cts:now+(++bookCounter),u:bookCounter};
  if(u.pathname.endsWith('recent-trade'))result={category:'linear',list:Array.from({length:50},(_,i)=>({execId:String(now-i*100),symbol:'ETHUSDT',time:String(now-i*100),price:String(quote),size:'10',side:i%2?'Buy':'Sell',isRPITrade:false}))};
  return Response.json({retCode:0,result});
 }
 if(u.hostname.includes('gateio')){
  if(u.pathname.endsWith('contracts/ETH_USDT'))return Response.json({name:'ETH_USDT',type:'direct',quanto_multiplier:'0.01'});
  if(u.pathname.endsWith('candlesticks')){const interval=u.searchParams.get('interval'),step=({'15m':900000,'1h':3600000,'4h':14400000})[interval],limit=Number(u.searchParams.get('limit')||240),last=Math.floor(now/step)*step;
   const btc=u.searchParams.get('contract')?.startsWith('BTC'),base=btc?80000:quote;
   return Response.json(Array.from({length:limit},(_,i)=>({t:Math.floor((last-(limit-1-i)*step)/1000),o:String(base),h:String(base*1.005),l:String(base*.995),c:String(base),v:'100',sum:String(base*100)})));}
  if(u.pathname.endsWith('trades'))return Response.json(Array.from({length:20},(_,i)=>({id:i,create_time_ms:now-i*1000,create_time:Math.floor((now-i*1000)/1000),price:String(quote),size:i%2?1:-1})));
  if(u.pathname.endsWith('order_book'))return Response.json({id:++bookCounter,current:(now+bookCounter)/1000,update:(now+bookCounter)/1000,bids:[{p:String(quote-.01),s:100}],asks:[{p:String(quote+.01),s:100}]});
  return Response.json([]);
 }
 if(u.hostname.includes('okx')){const p=u.pathname,inst=u.searchParams.get('instId')||'ETH-USDT-SWAP',btc=inst.startsWith('BTC'),price=btc?80000:quote;
  const tick=id=>({instId:id,last:String(id.startsWith('BTC')?80000:quote),bidPx:String((id.startsWith('BTC')?80000:quote)-.01),askPx:String((id.startsWith('BTC')?80000:quote)+.01),ts:String(now),open24h:String(price),high24h:String(price*1.02),low24h:String(price*.98),vol24h:'10000',volCcy24h:'1000000'});
  if((quoteFail&&/tickers|ticker$|trades$|books/.test(p))||(flowFail&&/trades$|books/.test(p)))return Response.json({code:'50011',data:[]},{status:429});
  let data=[];
  if(p.endsWith('/instruments'))data=[{instId:inst,ctType:'linear',ctVal:'0.1',ctValCcy:'ETH',settleCcy:'USDT',ctMult:'1'}];
  else if(p.endsWith('/tickers'))data=['ETH-USDT-SWAP','BTC-USDT-SWAP','ETH-USDT','BTC-USDT'].map(tick);
  else if(p.endsWith('ticker'))data=[tick(inst)];
  else if(p.includes('books'))data=[{ts:String(now+(++bookCounter)),seqId:String(bookCounter),bids:[[String(price-.01),'1000','0','1']],asks:[[String(price+.01),'1000','0','1']]}];
  else if(p.endsWith('trades'))data=Array.from({length:20},(_,i)=>({instId:inst,ts:String(now-i*100),px:String(price),sz:'1',side:i%2?'buy':'sell',tradeId:String(i)}));
  else if(p.endsWith('mark-price'))data=['ETH-USDT-SWAP','BTC-USDT-SWAP'].map(id=>({instId:id,markPx:String(id.startsWith('BTC')?80000:quote),ts:String(now)}));
  else if(p.includes('index-tickers'))data=['ETH-USDT','BTC-USDT'].map(id=>({instId:id,idxPx:String(id.startsWith('BTC')?80000:quote),ts:String(now)}));
  else if(p.endsWith('open-interest'))data=['ETH-USDT-SWAP','BTC-USDT-SWAP'].map(id=>({instId:id,oi:'100000',oiCcy:'1000',oiUsd:'10000000',ts:String(now)}));
  else if(p.endsWith('funding-rate'))data=[{instId:inst,fundingRate:'0.0001',fundingTime:String(now+3600000),nextFundingTime:String(now+9*3600000),ts:String(now)}];
  else if(p.includes('open-interest-volume'))data=Array.from({length:20},(_,i)=>[String(now-i*300000),'10000000','1000000']);
  return Response.json({code:'0',data});
 }
 return Response.json({error:'UNEXPECTED_FIXTURE_HOST'},{status:502});
}};`);
fs.writeFileSync(path.join(dir,'config.capnp'),`using W=import "/workerd/workerd.capnp";const config:W.Config=(services=[
 (name="main",worker=(compatibilityDate="2026-08-22",globalOutbound="upstream",modules=[(name="entry.mjs",esModule=embed "entry.mjs"),(name="app.mjs",esModule=embed "app.mjs")],
 durableObjectNamespaces=[(className="ScannerState",uniqueKey="isolated-consolidated-runtime-fixture")],durableObjectStorage=(inMemory=void),
 bindings=[(name="SCANNER_STATE",durableObjectNamespace=(className="ScannerState")),(name="SCANNER_TOKEN",text="fixture-scanner"),(name="BARK_DEVICE_KEY",text="fixture-device"),(name="JIN10_MCP_TOKEN",text="fixture-news")])),
 (name="upstream",worker=(compatibilityDate="2026-08-22",modules=[(name="upstream.mjs",esModule=embed "upstream.mjs")]))
],sockets=[(name="http",address="127.0.0.1:0",http=(),service="main")]);`);

const child=spawn(bin,['serve',path.join(dir,'config.capnp'),'--control-fd=3'],{stdio:['ignore','ignore','pipe','pipe']});let stderr='';child.stderr.on('data',b=>stderr+=b);const checks=[];
try{
 const port=await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('Runtime start '+stderr)),8000);child.on('exit',c=>{clearTimeout(timer);reject(Error('Runtime exit '+c+' '+stderr));});child.stdio[3].on('data',b=>{text+=b;for(const l of text.split('\n'))try{const j=JSON.parse(l);if(j.port){clearTimeout(timer);resolve(j.port);}}catch{}});});
 const base='http://127.0.0.1:'+port;
 async function call(p,body){const r=await fetch(base+p,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',authorization:'Bearer fixture-scanner'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(40000)});return {http:r.status,body:await r.json()};}
 async function until(fn,timeout=70000){const end=Date.now()+timeout;let value;while(Date.now()<end){value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,1000));}throw Error('Runtime timeout '+JSON.stringify(await call('/?view=fast'))+' '+stderr);}
 const boot=await call('/');assert.equal(boot.body.coverage.executionDataReady,true);let first=await until(async()=>{const s=(await call('/?view=fast')).body.fastMonitor;return s.status==='ok'&&s.fullReview?.modelDataReady?s:null;},20000);checks.push('canonical fast sample and shared eight-model receipt start in the actual runtime');
 const now=Date.now(),obs={recordType:'OBSERVATION',observationId:'isolated-contention-research',notificationMode:'ACTIONABLE_ONLY',symbol:'ETHUSDT',direction:'LONG',model:'B',submodel:'B1',marketRegime:'RANGE',observationZone:{min:2399,max:2401},observationInvalidation:{level:2300,mode:'CLOSE_15M'},strategySummary:'Isolated pending research',pendingCondition:'Wait for a complete real model',sourceAnalysisAt:new Date(now).toISOString(),expiresAt:new Date(now+600000).toISOString()};assert.equal((await call('/scanner/plan',obs)).http,200);
 await call('/__fixture/control',{flowFail:true});let nextManual=0,originalDeadline=null,failedAt=null,backgroundReviewObserved=false,contexts=0;
 const failed=await until(async()=>{if(Date.now()>=nextManual){await call('/?view=market&recheck=true');contexts++;nextManual=Date.now()+4000;}const s=(await call('/?view=fast')).body.fastMonitor;if(s.status==='partial'){failedAt=Date.parse(s.lastAttemptAt);originalDeadline=s.flowRetryAt;return s;}return null;},20000);
 assert.equal(failed.quoteHealthy,true);assert.equal(failed.flowHealthy,false);assert.equal(failed.lastSuccessAt,first.lastSuccessAt);assert.ok(originalDeadline);assert.ok(failed.feedDiagnostics.some(d=>d.httpStatus===429));checks.push('depth/trade HTTP429 leaves a separate genuine fresh quote and honest degraded flow state');
 // Keep the upstream fault active until an independently completed review is
 // observed during degradation. A 30s review throttle and a 30s cooldown can
 // otherwise race; removing the fault immediately cannot prove this property.
 const duringFailure=await until(async()=>{
  if(Date.now()>=nextManual){await call('/?view=market&recheck=true');contexts++;nextManual=Date.now()+4000;}
  const s=(await call('/?view=fast')).body.fastMonitor;
  const receipts=[s.fullReview,s.fullReview?.lastSharedCycle,s.fullReview?.lastCompletedReview].filter(Boolean);
  const fresh=receipts.some(r=>r.status==='completed'&&r.inspectedModels===8&&r.modelDataReady===true&&r.producerBuild===expectedBuild&&Date.parse(r.completedAt||r.lastCompletedAt)>failedAt);
  return s.status==='partial'&&fresh?s:null;
 },80000);
 backgroundReviewObserved=true;originalDeadline=duringFailure.flowRetryAt;assert.ok(originalDeadline);
 await call('/__fixture/control',{flowFail:false});
 const recovered=await until(async()=>{if(Date.now()>=nextManual){const m=await call('/?view=market&recheck=true');assert.equal(m.http,200);contexts++;nextManual=Date.now()+4000;}const s=(await call('/?view=fast')).body.fastMonitor;if(s.fullReview?.modelDataReady&&Date.parse(s.fullReview.lastCompletedAt)>failedAt&&s.status==='partial')backgroundReviewObserved=true;if(s.status==='partial'&&s.flowRetryAt)assert.equal(s.flowRetryAt,originalDeadline,'passive/manual queries must not slide cooldown');return s.status==='ok'&&Date.parse(s.lastSuccessAt)>Date.parse(first.lastSuccessAt)?s:null;});
 assert.equal(recovered.samplingHealthy,true);assert.equal(recovered.flowHealthy,true);assert.ok(recovered.actualLastGapSeconds<15);assert.ok(contexts>=3);checks.push('normal manual refreshes cannot extend the circuit; actual alarms resume successful flow after expiry');
 assert.equal(backgroundReviewObserved,true,JSON.stringify({recovered,failed}));checks.push('active research completes a shared eight-model review while executed-flow collection is still cooling');
 const status=(await call('/scanner/status')).body;assert.ok(status.observations.some(o=>o.observationId===obs.observationId));assert.equal(status.activePlan,null);assert.equal(status.diagnostics.pendingPushes,0);checks.push('the same research survives cooldown and recovery without creating an execution plan');
 assert.equal(status.backendIdentity.matched,true);assert.equal(status.fastMonitor.stateOwnerBuild,expectedBuild);assert.equal(typeof status.fastMonitor.quoteHealthy,'boolean');assert.equal(typeof status.fastMonitor.flowHealthy,'boolean');checks.push('actual owner build, contract and all three health flags are visible in the native response');
 const previousCompletion=Date.parse(status.heartbeat.lastSuccessfulCycleAt),cronStartedAt=Date.now();
 const cron=await call('/__fixture/cron');assert.equal(cron.body.handled,true);
 // The scheduled entry can share an existing lease, and a native alarm can start
 // the next cycle before this read. Neither "handled" nor "running" proves a
 // new success: wait for an independently observed, strictly newer completion.
 const afterCron=await until(async()=>{const s=(await call('/scanner/status')).body,finished=Date.parse(s.heartbeat?.lastSuccessfulCycleAt);return finished>=cronStartedAt&&finished>previousCompletion?s:null;},20000);
 assert.equal(afterCron.heartbeat.producerBuild,expectedBuild);assert.ok(['completed','running'].includes(afterCron.heartbeat.status));checks.push('scheduled entry shares the owner-local scanner and a strictly new successful heartbeat is observed');
 assert.equal((await call('/__fixture/forbidden')).body.calls,0);checks.push('native alarms, depth-rejection fault injection, forced refreshes and scheduled cycles make zero owner self-namespace fetch calls');
 const pushes=(await call('/__fixture/control',{})).body.pushes;assert.equal(pushes.length,0);checks.push('ordinary research touches and degraded-flow history do not generate spurious push messages');
 console.log(JSON.stringify({runtime:execFileSync(bin,['--version'],{encoding:'utf8'}).trim(),realDurableObject:true,nativeAlarms:true,concurrentManualRefreshes:contexts,observedLastGapSeconds:recovered.actualLastGapSeconds,checks,passed:checks.length,failed:0,externalUpstreams:'LOCAL_FIXTURES_ONLY',selfNamespaceFetchPolicy:'THROW_SYNTHETIC_DEPTH_ERROR',productionDepthErrorReplayed:false,productionDeploymentVerified:false,realDeviceDeliveryVerified:false},null,2));
}finally{child.kill('SIGTERM');fs.rmSync(dir,{recursive:true,force:true});}
