// Actual Cloudflare workerd integration. Upstream services are LOCAL fixtures, not real accounts.
// Usage: node 04_TESTS/verify-workerd-news-runtime.mjs /absolute/path/to/workerd
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const binary=process.argv[2];if(!binary)throw Error('Pass a workerd executable path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'crypto-news-runtime-'));
const code=fs.readFileSync(new URL('../main-v188.js',import.meta.url),'utf8');
fs.writeFileSync(path.join(dir,'app.mjs'),code+'\nexport {coordinatedNewsContext,loadNewsContext,acceptOfficialBlsRelay};\n');
fs.writeFileSync(path.join(dir,'entry.mjs'),`
import {ScannerState,loadNewsContext,acceptOfficialBlsRelay} from './app.mjs';
export default {async fetch(){
 let legacy;try{await fetch('https://www.coindesk.com/arc/outboundfeeds/rss/',{redirect:'error'});legacy={rejected:false};}catch(e){legacy={rejected:true,name:e.name,message:e.message};}
 const records=new Map(),pending=[],ctx={storage:{get:async k=>records.get(k),put:async(k,v)=>records.set(k,v)},waitUntil:p=>pending.push(p)};
 const object=new ScannerState(ctx,{JIN10_MCP_TOKEN:'synthetic-runtime-only'});
 const env={SCANNER_STATE:{getByName(){return {fetch:(u,o)=>object.fetch(new Request(u,o))};}}};
 const started=Date.now(),cold=await loadNewsContext(env,{cacheFirst:true}),coldReadMs=Date.now()-started;
 await Promise.all(pending);
 const result=await loadNewsContext(env),scanner=await loadNewsContext(env,{cacheFirst:true});
 await Promise.all(pending);
 await fetch('https://fixture.invalid/enable-bls-outage');
 records.delete('news:context:v27');
 const fetchedAt=new Date().toISOString(),sources=[];
 for(const [id,sourceUrl] of [['BLS_CPI','https://www.bls.gov/feed/cpi.rss'],['BLS_PPI','https://www.bls.gov/feed/ppi.rss'],['BLS_EMPLOYMENT','https://www.bls.gov/feed/empsit.rss'],['BLS_CALENDAR','https://www.bls.gov/schedule/news_release/bls.ics']]){
  const body=id==='BLS_CALENDAR'?'BEGIN:VCALENDAR\\nVERSION:2.0\\nPRODID:-//CryptoAlpha//Local-Fixture\\nEND:VCALENDAR':'<feed><entry><title>Consumer Price Index CPI relay fixture</title><link href="https://www.bls.gov/news.release/cpi.htm"/><updated>'+fetchedAt+'</updated></entry></feed>';
  const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body)))).map(x=>x.toString(16).padStart(2,'0')).join('');
  sources.push({id,sourceUrl,body,fetchedAt,sha256});
 }
 const relay=await acceptOfficialBlsRelay(new Request('https://worker.test/scanner/official-macro-relay',{method:'POST',body:JSON.stringify({sources})}),env);
 const envelope=records.get('news:bls-official-relay:v1');
 const relayStoredWithValueWrapper=!!envelope?.value?.records?.BLS_CPI&&envelope.expiresAt>Date.now();
 const relaySummary=await loadNewsContext(env),relayScannerSummary=await loadNewsContext(env,{cacheFirst:true});
 await Promise.all(pending);
 records.set('news:bls-official-relay:v1',{...envelope,expiresAt:Date.now()-1});records.delete('news:context:v27');
 const expiredRelaySummary=await loadNewsContext(env);
 return Response.json({legacy,result,scanner,cold,coldReadMs,relay,relayStoredWithValueWrapper,relaySummary,relayScannerSummary,expiredRelaySummary});
}};`);
fs.writeFileSync(path.join(dir,'upstream.mjs'),`
let blsOutage=false;
export default {async fetch(req){const u=new URL(req.url),now=new Date().toISOString();
 if(u.hostname==='fixture.invalid'){blsOutage=true;return new Response('ok');}
 if(blsOutage&&u.hostname==='www.bls.gov')return new Response('fixture denied',{status:403});
 if(u.hostname==='mcp.jin10.com'){
  if(req.headers.get('authorization')!=='Bearer synthetic-runtime-only')return new Response('denied',{status:401});
  const b=await req.json();let result={};
  if(b.method==='initialize')result={protocolVersion:'2025-03-26',capabilities:{tools:{}}};
  if(b.method==='notifications/initialized')return new Response(null,{status:202});
  if(b.method==='tools/list')result={tools:[{name:'list_flash',inputSchema:{type:'object',properties:{}}}]};
  if(b.method==='tools/call')result={structuredContent:{status:200,data:{items:[{id:'runtime-fixture',title:'ETH runtime fixture',time:now,url:'https://flash.jin10.com/detail/runtime-fixture'}]}}};
  return Response.json({jsonrpc:'2.0',id:b.id,result});
 }
 if(u.hostname==='www.newyorkfed.org'){
  const short=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'],names=['January','February','March','April','May','June','July','August','September','October','November','December'];
  const match=u.pathname.match(/i-([a-z]{3})([0-9]{2})/),month=short.indexOf(match[1]),year=2000+Number(match[2]);
  return new Response('<h1>Economic Indicators Calendar</h1><div>'+names[month]+' '+year+'</div><table><td><div>01<br><a href="https://www.bls.gov/news.release/empsit.htm">Employment Situation</a><br>(08:30)</div></td></table>');
 }
 if(u.hostname==='home.treasury.gov')return new Response('Date,"2 Yr","10 Yr"\\n'+new Date().toLocaleDateString('en-US',{timeZone:'UTC',month:'2-digit',day:'2-digit',year:'numeric'})+',4.61,4.98\\n');
 if(u.pathname.endsWith('.ics'))return new Response('BEGIN:VCALENDAR\\nEND:VCALENDAR');
 return new Response('<rss><channel><item><title>ETH runtime fixture</title><link>https://example.org/runtime-fixture</link><pubDate>'+new Date().toUTCString()+'</pubDate></item></channel></rss>');
}};`);
fs.writeFileSync(path.join(dir,'config.capnp'),`using Workerd = import "/workerd/workerd.capnp";
const config :Workerd.Config = (
 services = [
  (name = "main", worker = (compatibilityDate = "2026-08-22", globalOutbound = "mock-upstream", modules = [
   (name = "entry.mjs", esModule = embed "entry.mjs"),
   (name = "app.mjs", esModule = embed "app.mjs")
  ])),
  (name = "mock-upstream", worker = (compatibilityDate = "2026-08-22", modules = [(name = "upstream.mjs", esModule = embed "upstream.mjs")]))
 ], sockets = [(name = "http", address = "127.0.0.1:0", http = (), service = "main")]
);`);
const processVersion=execFileSync(binary,['--version'],{encoding:'utf8'}).trim();
const child=spawn(binary,['serve',path.join(dir,'config.capnp'),'--control-fd=3'],{stdio:['ignore','ignore','pipe','pipe']});
let errors='';child.stderr.on('data',b=>errors+=b);
try{
 const port=await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('Runtime start timeout '+errors)),8000);child.on('exit',c=>{clearTimeout(timer);reject(Error('Runtime exit '+c+' '+errors));});child.stdio[3].on('data',b=>{text+=b;for(const l of text.split('\n')){try{const j=JSON.parse(l);if(j.port){clearTimeout(timer);resolve(j.port);}}catch{}}});});
 const response=await fetch('http://127.0.0.1:'+port,{signal:AbortSignal.timeout(12000)});assert.equal(response.status,200);
 const {legacy,result,scanner,cold,coldReadMs,relay,relayStoredWithValueWrapper,relaySummary,relayScannerSummary,expiredRelaySummary}=await response.json();assert.equal(legacy.rejected,true);assert.match(legacy.message,/Invalid redirect value/);
 assert.deepEqual(Object.keys(result.sources).sort(),['JIN10','BEA_RELEASES','BOJ_RELEASES','COINDESK','FED_PRESS','FED_SPEECH','BLS_CPI','BLS_PPI','BLS_EMPLOYMENT','BLS_CALENDAR','US_TREASURY_YIELD_DAILY','NYFED_CALENDAR'].sort());
 for(const [source,r] of Object.entries(result.sources)){assert.equal(r.status,'ok',source+': '+JSON.stringify(r));assert.equal(r.httpStatus,200);assert.ok(r.fetchedAt);}
 assert.ok(result.sources.JIN10.handshakeAt);assert.ok(result.sources.JIN10.latestPublishedAt);
 assert.equal(cold.reason,'NEWS_CACHE_WARMING');assert.ok(coldReadMs<1000);
 assert.equal(scanner.cachePolicy,'CACHE_FIRST_BACKGROUND_REFRESH');
 for(const id of Object.keys(result.sources)){assert.equal(scanner.sources[id].fetchedAt,result.sources[id].fetchedAt);assert.equal(scanner.sources[id].httpStatus,200);}
 assert.equal(relay.status,'OFFICIAL_BLS_RELAY_ACCEPTED',JSON.stringify(relay));assert.equal(relayStoredWithValueWrapper,true);
 for(const id of ['BLS_CPI','BLS_PPI','BLS_EMPLOYMENT','BLS_CALENDAR']){
  assert.equal(relaySummary.sources[id].status,'ok',id+' accepted envelope must actually reach consumer');
  assert.equal(relaySummary.sources[id].sourceProvenance,'AUTHORIZED_GITHUB_ACTIONS_BLS_RELAY_DELAYED');
  assert.equal(relaySummary.sources[id].fetchedAt,relayScannerSummary.sources[id].fetchedAt);
  assert.equal(expiredRelaySummary.sources[id].status,'unavailable',id+' expired storage envelope must fail closed');
 }
 assert.equal(relaySummary.recentRiskHeadlines.filter(i=>i.source.startsWith('BLS_')).length,0);
 console.log(JSON.stringify({runtime:processVersion,compatibilityDate:'2026-08-22',legacyErrorReproduced:legacy,updatedSourceCount:12,updatedSourcesPassed:12,
  coldCacheReadMs:coldReadMs,scannerAndDirectSourceTimestampsMatch:true,actualScannerStateInternalRouteVerified:true,
  actualRelayEnvelopeConsumed:true,expiredRelayEnvelopeRejected:true,result:'PASS',actualProductionNetworkVerified:false,actualJin10AuthorizationVerified:false,upstreams:'LOCAL_FIXTURES_ONLY'},null,2));
}finally{child.kill('SIGTERM');fs.rmSync(dir,{recursive:true,force:true});}
