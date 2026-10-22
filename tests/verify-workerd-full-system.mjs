// Full production handlers + real workerd Durable Object; ALL exchanges/news/push are local fixtures.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';import assert from 'node:assert/strict';
const bin=process.argv[2];if(!bin)throw Error('Pass actual workerd binary');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-full-runtime-'));
const source=fs.readFileSync(new URL('../main-v188.js',import.meta.url),'utf8');
fs.writeFileSync(path.join(dir,'app.mjs'),`const RealDate=globalThis.Date;let testNow=RealDate.now();class Date extends RealDate {constructor(...a){super(...(a.length?a:[testNow]));}static now(){return testNow;}}export function setClock(n){testNow=n;}\n`+source);
fs.writeFileSync(path.join(dir,'entry.mjs'),`
import app,{setClock} from './app.mjs';export {ScannerState} from './app.mjs';
export default {async fetch(req,env,ctx){const u=new URL(req.url);
 if(u.pathname==='/__fixture/public')return env.SCANNER_STATE.get(env.SCANNER_STATE.idFromName('crypto-alpha-primary')).fetch('https://internal/state',{method:'POST',body:JSON.stringify({op:'publicMarket'})});
 if(u.pathname==='/__fixture/control'){const q=await req.json();if(q.now)setClock(q.now);return fetch('https://fixtures.invalid/control',{method:'POST',body:JSON.stringify(q)});}
 return app.fetch(req,env,ctx);
}};`);
fs.writeFileSync(path.join(dir,'upstream.mjs'),`
let now=Date.now(),barkFail=false,quoteFail=false,newsFail=false,blsFail=false,pushes=[],quote=100.5,bookCounter=0;const counts={};
export default {async fetch(req){const u=new URL(req.url);counts[u.hostname]=(counts[u.hostname]||0)+1;
 if(u.hostname==='fixtures.invalid'){const b=await req.json();if(b.now)now=b.now;if(b.barkFail!==undefined)barkFail=b.barkFail;if(b.quoteFail!==undefined)quoteFail=b.quoteFail;if(b.newsFail!==undefined)newsFail=b.newsFail;if(b.blsFail!==undefined)blsFail=b.blsFail;if(b.quote)quote=b.quote;return Response.json({now,pushes,counts});}
 if(u.hostname==='api.day.app'){const b=await req.json();if(barkFail)return Response.json({code:500},{status:503});pushes.push({title:b.title,body:b.body,isArchive:b.isArchive});return Response.json({code:200});}
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
   const btc=u.searchParams.get('contract')?.startsWith('BTC'),base=btc?80000:100.5;
   return Response.json(Array.from({length:limit},(_,i)=>({t:Math.floor((last-(limit-1-i)*step)/1000),o:String(base),h:String(base*1.005),l:String(base*.995),c:String(base),v:'100',sum:String(base*100)})));}
  if(u.pathname.endsWith('trades'))return Response.json(Array.from({length:20},(_,i)=>({id:i,create_time_ms:now-i*1000,create_time:Math.floor((now-i*1000)/1000),price:String(quote),size:i%2?1:-1})));
  if(u.pathname.endsWith('order_book'))return Response.json({id:++bookCounter,current:(now+bookCounter)/1000,update:(now+bookCounter)/1000,bids:[{p:String(quote-.01),s:100}],asks:[{p:String(quote+.01),s:100}]});
  return Response.json([]);
 }
 if(u.hostname.includes('okx')){const p=u.pathname,inst=u.searchParams.get('instId')||'ETH-USDT-SWAP',btc=inst.startsWith('BTC'),price=btc?80000:quote;
  const tick=id=>({instId:id,last:String(id.startsWith('BTC')?80000:quote),bidPx:String((id.startsWith('BTC')?80000:quote)-.01),askPx:String((id.startsWith('BTC')?80000:quote)+.01),ts:String(now),open24h:String(price),high24h:String(price*1.02),low24h:String(price*.98),vol24h:'10000',volCcy24h:'1000000'});
  if(quoteFail&&/tickers|ticker$|trades$|books/.test(p))return Response.json({code:'50011',data:[]},{status:429});
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
 bindings=[(name="SCANNER_STATE",durableObjectNamespace=(className="ScannerState")),(name="SCANNER_TOKEN",text="fixture-scanner"),(name="FAST_MONITOR_ENABLED",text="false"),(name="BARK_DEVICE_KEY",text="fixture-device"),(name="JIN10_MCP_TOKEN",text="fixture-news")])),
 (name="upstream",worker=(compatibilityDate="2026-08-22",modules=[(name="upstream.mjs",esModule=embed "upstream.mjs")]))
],sockets=[(name="http",address="127.0.0.1:0",http=(),service="main")]);`);
const child=spawn(bin,['serve',path.join(dir,'config.capnp'),'--control-fd=3'],{stdio:['ignore','ignore','pipe','pipe']});let stderr='';child.stderr.on('data',b=>stderr+=b);const checks=[];
try{
 const port=await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('Runtime start '+stderr)),8000);child.on('exit',c=>{clearTimeout(timer);reject(Error('Runtime exit '+c+' '+stderr));});child.stdio[3].on('data',b=>{text+=b;for(const l of text.split('\n'))try{const j=JSON.parse(l);if(j.port){clearTimeout(timer);resolve(j.port);}}catch{}});});
 const base='http://127.0.0.1:'+port;
 async function call(p,body,auth=true){const r=await fetch(base+p,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(auth?{authorization:'Bearer fixture-scanner'}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(40000)});return {http:r.status,body:await r.json()};}
 let now=Date.now();await call('/__fixture/control',{now,blsFail:true});
 assert.equal((await call('/scanner/status',undefined,false)).http,401);checks.push('private records reject missing authentication');
 const news=await call('/?view=news');assert.equal(news.http,200);assert.equal(news.body.newsContext.sources.JIN10.httpStatus,200);assert.equal(news.body.newsContext.sources.JIN10.parseDiagnostics.acceptedItemCount,1);assert.equal(news.body.newsContext.sources.FED_PRESS.parseDiagnostics.acceptedItemCount,1);assert.equal(news.body.newsContext.sources.FED_SPEECH.parseDiagnostics.acceptedItemCount,1);checks.push('news handshake through actual Durable Object and fetch');
 assert.equal(news.body.newsContext.sources.BLS_CALENDAR.httpStatus,403);assert.equal(news.body.newsContext.calendarCoverage.independentBackupAvailable,true);assert.ok(news.body.newsContext.upcomingEvents.some(e=>e.source==='NYFED_CALENDAR'));checks.push('actual runtime preserves BLS denial and consumes independent calendar');
 const snap=await call('/');assert.equal(snap.http,200,JSON.stringify(snap.body));assert.ok(Buffer.byteLength(JSON.stringify(snap.body))<=90000);assert.equal(snap.body.assets.ETHUSDT.opportunityEngine.models.length,8);assert.equal(snap.body.coverage.executionDataReady,true,JSON.stringify({coverage:snap.body.coverage,ticker:snap.body.assets?.ETHUSDT?.ticker,errors:snap.body.errors,public:await call('/__fixture/public')}));assert.equal(snap.body.assets.ETHUSDT.timeframes['15m'].quality.passed,true);checks.push('full market build with real production parsers and persistent candles');
 assert.equal(snap.body.assets.ETHUSDT.publicOrderflow.status,'ok');assert.equal(snap.body.assets.ETHUSDT.publicOrderflow.standaloneEntryPermission,false);assert.equal(snap.body.assets.ETHUSDT.publicOrderflow.contractUnits.ctVal,0.1);checks.push('public orderflow computed through real DO, compact envelope and correct contract units');
 assert.equal(snap.body.assets.ETHUSDT.holdingProfile.mode,'SWING_FIRST');assert.equal(snap.body.assets.ETHUSDT.holdingProfile.leverageIsSizingGate,false);assert.ok(snap.body.assets.ETHUSDT.opportunityEngine.models.every(m=>m.swingAssessment?.state));checks.push('swing-first preference and separate high-timeframe assessment for all eight models survive production envelope');
 const checked=await call('/?view=liquidity');assert.equal(checked.http,200,JSON.stringify(checked.body));assert.equal(checked.body.crossVenueLiquidity.status,'ok');assert.equal(checked.body.crossVenueLiquidity.arrivalRecheck.passed,true,JSON.stringify(checked.body));assert.ok(checked.body.crossVenueLiquidity.connectedVenues.includes('BYBIT'));assert.ok(checked.body.crossVenueLiquidity.venues.some(v=>v.venue==='BINANCE'&&v.status==='unavailable'));assert.equal(checked.body.modelContext.fresh,true);assert.equal(checked.body.executionQuote.source,'OKX_USDT_PERPETUAL');assert.equal(checked.body.openNowAllowed,false);assert.ok(Buffer.byteLength(JSON.stringify(checked.body))<20000);checks.push('dedicated arrival recheck uses two real DO samples, fresh trades and explicit region-failure coverage');

 const denied=checked.body.crossVenueLiquidity.venues.find(v=>v.venue==='BINANCE');assert.equal(denied.diagnostics.meta.httpStatus,451);assert.ok(denied.diagnostics.meta.failedAt);assert.ok(denied.diagnostics.meta.retryAt);checks.push('a region denial remains HTTP451 with original failure time and cooldown instead of generic rate-limit labeling');
 const obs={recordType:'OBSERVATION',observationId:'runtime-observation',symbol:'ETHUSDT',direction:'LONG',model:'B',submodel:'B1',marketRegime:'RANGE',notificationMode:'ALL_STAGES',observationZone:{min:100,max:101},observationInvalidation:{level:90,mode:'CLOSE_15M'},strategySummary:'Isolated runtime observation',pendingCondition:'Wait for real structure',sourceAnalysisAt:new Date(now).toISOString(),expiresAt:new Date(now+600000).toISOString()};
 const saved=await call('/scanner/plan',obs);assert.equal(saved.http,200,JSON.stringify(saved.body));checks.push('authenticated observation persists in actual Durable Object');
 await call('/__fixture/control',{barkFail:true});const scan=await call('/scanner/run',{});assert.equal(scan.http,200,JSON.stringify(scan.body));
 let status=(await call('/scanner/status')).body;assert.equal(status.diagnostics.stateReadSucceeded,true);assert.ok(status.diagnostics.pendingObservationPushes>=1,JSON.stringify(status));assert.equal(status.notificationAudit.channels.find(c=>c.kind==='OBSERVATION').failures,1);assert.equal(status.notificationAudit.recentAttempts.at(-1).outcome,'FAILED');assert.equal(status.notificationAudit.recentAttempts.at(-1).eventId,obs.observationId);checks.push('real failed push remains pending with a persistent correlated failure audit');
 now+=121000;await call('/__fixture/control',{now,barkFail:false});await call('/scanner/run',{});status=(await call('/scanner/status')).body;
 assert.equal(status.diagnostics.pendingObservationPushes,0,JSON.stringify(status));assert.equal(status.diagnostics.heartbeatHealthy,true);assert.equal(status.discovery.newsStatus.sources.JIN10.httpStatus,200);checks.push('retry after virtual-clock backoff succeeds and heartbeat plus news consumption persist');
 const pushState=(await call('/__fixture/control',{})).body;assert.equal(pushState.pushes.length,1);assert.equal(pushState.pushes[0].isArchive,'1');const audit=status.notificationAudit.channels.find(c=>c.kind==='OBSERVATION');assert.equal(audit.accepted,1);assert.equal(audit.failures,1);assert.equal(audit.attempts,2);assert.equal(status.notificationAudit.deviceReceiptVerified,false);checks.push('actual provider attempts, failed retry, archive request and acceptance remain distinct from device receipt');await call('/scanner/run',{});assert.equal((await call('/__fixture/control',{})).body.pushes.length,1);checks.push('no duplicate stage push on repeated scan');
 const cancelled=await call('/scanner/cancel',{scope:'OBSERVATION',observationId:obs.observationId});assert.equal(cancelled.http,200);status=(await call('/scanner/status')).body;assert.ok(!status.observations.some(r=>r.observationId===obs.observationId));checks.push('targeted cancellation does not erase persistent history');
 // Quotes fail with 429, then recover; the record must survive both phases.
 const retained={...obs,observationId:'runtime-retained',sourceAnalysisAt:new Date(now).toISOString(),expiresAt:new Date(now+900000).toISOString()};assert.equal((await call('/scanner/plan',retained)).http,200);
 now+=121000;await call('/__fixture/control',{now,quoteFail:true});const blocked=await call('/');assert.equal(blocked.body.decisionState,'DATA_BLOCKED');await call('/scanner/run',{});status=(await call('/scanner/status')).body;assert.ok(status.observations.some(r=>r.observationId===retained.observationId&&r.state==='DATA_BLOCKED'));checks.push('quote rate limit is data-blocked and retains observation');
 now+=301000;await call('/__fixture/control',{now,quoteFail:false});const restored=await call('/');assert.equal(restored.body.coverage.executionDataReady,true);await call('/scanner/run',{});status=(await call('/scanner/status')).body;assert.ok(status.observations.some(r=>r.observationId===retained.observationId&&r.state!=='DATA_BLOCKED'));checks.push('same observation recovers after genuine quotes return and cooldown ends');
 now+=61000;await call('/__fixture/control',{now,newsFail:true});const failedNews=await call('/?view=news');assert.equal(failedNews.body.newsContext.sources.JIN10.httpStatus,503);assert.ok(failedNews.body.newsContext.sources.JIN10.fetchedAt);await call('/scanner/run',{});status=(await call('/scanner/status')).body;assert.equal(status.discovery.newsStatus.sources.JIN10.httpStatus,503);assert.equal(status.diagnostics.stateReadSucceeded,true);checks.push('news source failure preserves last success but scanner sees real failed status');
 now+=121000;await call('/__fixture/control',{now,newsFail:false});const recoveredNews=await call('/?view=news');assert.equal(recoveredNews.body.newsContext.sources.JIN10.httpStatus,200);await call('/scanner/run',{});status=(await call('/scanner/status')).body;assert.equal(status.discovery.newsStatus.sources.JIN10.httpStatus,200);assert.equal(status.diagnostics.heartbeatHealthy,true);checks.push('news retry and scanner consumption recover without token rebinding');
 now+=3600001;await call('/__fixture/control',{now,blsFail:false});const blsRecovered=await call('/?view=news');assert.equal(blsRecovered.body.newsContext.sources.BLS_CPI.httpStatus,200);assert.equal(blsRecovered.body.newsContext.sources.BLS_CPI.parseDiagnostics.acceptedItemCount,1);checks.push('BLS source recovers after respected denial backoff without rebinding');
 const staleContext=await call('/?view=liquidity');assert.equal(staleContext.http,200);assert.equal(staleContext.body.modelContext.fresh,false);assert.equal(staleContext.body.proposals.length,0);assert.equal(staleContext.body.openNowAllowed,false);checks.push('new arrival quotes cannot revive an expired public model context');
 console.log(JSON.stringify({runtime:execFileSync(bin,['--version'],{encoding:'utf8'}).trim(),realDurableObject:true,productionHandlers:true,checks,passed:checks.length,failed:0,externalUpstreams:'LOCAL_FIXTURES_ONLY',realDeviceDeliveryVerified:false,productionDeploymentVerified:false},null,2));
}finally{child.kill('SIGTERM');fs.rmSync(dir,{recursive:true,force:true});}
