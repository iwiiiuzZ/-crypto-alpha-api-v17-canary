// Real workerd runtime; GitHub and all credentials here are LOCAL fixtures.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const binary=process.argv[2];if(!binary)throw Error('workerd binary required');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'crypto-bls-dispatch-'));
const source=fs.readFileSync(new URL('../main-v188.js',import.meta.url),'utf8');
const build=source.match(/const BUILD = "([^"]+)"/)?.[1];
const collectorRef=source.match(/const BLS_COLLECTOR_REF = "([^"]+)"/)?.[1];
fs.writeFileSync(path.join(dir,'app.mjs'),source+'\nexport {maintainOfficialBlsRelay};');
fs.writeFileSync(path.join(dir,'entry.mjs'),`
import app,{ScannerState,maintainOfficialBlsRelay} from './app.mjs';
export default {async fetch(){
 const records=new Map(),pending=[],operations=[];
 const ctx={storage:{get:async k=>structuredClone(records.get(k)),put:async(k,v)=>records.set(k,structuredClone(v))},waitUntil:p=>pending.push(p)};
 const object=new ScannerState(ctx,{GITHUB_ACTIONS_DISPATCH_TOKEN:'local-fixture-token'});
 const stub={fetch:async(u,o)=>{const input=JSON.parse(o.body);operations.push(input.op);if(input.op==='scannerCycle')return Response.json({error:'LOCAL_MARKET_FAILURE'},{status:503});return object.fetch(new Request(u,o));}};
 const env={GITHUB_ACTIONS_DISPATCH_TOKEN:'local-fixture-token',SCANNER_STATE:{getByName(){return stub;}}};
 await app.scheduled(null,env,ctx);await Promise.all(pending);
 const first=await (await object.fetch(new Request('https://state.test',{method:'POST',body:JSON.stringify({op:'officialBlsRelayMaintenance'})}))).json();
 const restarted=new ScannerState(ctx,{GITHUB_ACTIONS_DISPATCH_TOKEN:'local-fixture-token'});
 const afterRestart=await maintainOfficialBlsRelay(restarted);
 const callsAfterRestart=(await (await fetch('https://fixture.invalid/stats')).json()).calls;
 const now=Date.now(),at=new Date(now).toISOString(),body='<rss><channel><item><title>Native local official fixture only</title></item></channel></rss>';
 const relay={expiresAt:now+1800000,value:{records:Object.fromEntries([['BLS_CPI','https://www.bls.gov/feed/cpi.rss'],['BLS_PPI','https://www.bls.gov/feed/ppi.rss'],['BLS_EMPLOYMENT','https://www.bls.gov/feed/empsit.rss'],['BLS_CALENDAR','https://www.bls.gov/schedule/news_release/bls.ics']].map(([id,sourceUrl])=>[id,{id,sourceUrl,body,fetchedAt:at,receivedAt:at}]))}};
 records.set('news:bls-official-relay:v1',relay);const original=JSON.stringify(relay);
 const fresh=await maintainOfficialBlsRelay(restarted,{now});
 const due=await maintainOfficialBlsRelay(restarted,{now:now+600000});
 const stats=await (await fetch('https://fixture.invalid/stats')).json();
 const previousOperations=operations.length,missingPending=[];
 await app.scheduled(null,{SCANNER_STATE:env.SCANNER_STATE},{waitUntil:p=>missingPending.push(p)});await Promise.all(missingPending);
 return Response.json({operations,first,afterRestart,callsAfterRestart,fresh,due,stats,
  sourceTtlUnchanged:JSON.stringify(records.get('news:bls-official-relay:v1'))===original,
  credentialMissingOperations:operations.slice(previousOperations),productionNetworkVerified:false});
}};`);
fs.writeFileSync(path.join(dir,'upstream.mjs'),`
let calls=0;
export default {async fetch(request){const u=new URL(request.url);
 if(u.hostname==='fixture.invalid')return Response.json({calls});
 if(u.href!=='https://api.github.com/repos/iwiiiuzZ/-crypto-alpha-api-v17-canary/actions/workflows/official-bls-relay.yml/dispatches')return new Response('unexpected fixture target',{status:400});
 if(request.headers.get('authorization')!=='Bearer local-fixture-token')return new Response(null,{status:401});
 if(request.headers.get('user-agent')!=='CryptoAlphaRelayDispatcher/1.0')return new Response(null,{status:400});
 const body=await request.json();if(body.ref!==${JSON.stringify(collectorRef)}||body.return_run_details!==true)return new Response(null,{status:422});
 calls++;return Response.json({workflow_run_id:1000+calls});
}};`);
fs.writeFileSync(path.join(dir,'config.capnp'),`using Workerd = import "/workerd/workerd.capnp";
const config :Workerd.Config = (
 services=[(name="main",worker=(compatibilityDate="2026-08-22",globalOutbound="fixture",modules=[(name="entry.mjs",esModule=embed "entry.mjs"),(name="app.mjs",esModule=embed "app.mjs")])),
 (name="fixture",worker=(compatibilityDate="2026-08-22",modules=[(name="upstream.mjs",esModule=embed "upstream.mjs")]))],
 sockets=[(name="http",address="127.0.0.1:0",http=(),service="main")]);`);
const version=execFileSync(binary,['--version'],{encoding:'utf8'}).trim();
const child=spawn(binary,['serve',path.join(dir,'config.capnp'),'--control-fd=3'],{stdio:['ignore','ignore','pipe','pipe']});let errors='';child.stderr.on('data',b=>errors+=b);
try{
 const port=await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('NATIVE_START_TIMEOUT '+errors)),8000);child.on('exit',code=>{clearTimeout(timer);reject(Error('NATIVE_EXIT_'+code+' '+errors));});child.stdio[3].on('data',b=>{text+=b;for(const line of text.split('\n')){try{const event=JSON.parse(line);if(event.port){clearTimeout(timer);resolve(event.port);}}catch{}}});});
 const r=await fetch('http://127.0.0.1:'+port,{signal:AbortSignal.timeout(12000)});assert.equal(r.status,200);const e=await r.json();
 assert.deepEqual(e.operations.slice(0,2).sort(),['officialBlsRelayMaintenance','scannerCycle'].sort());
 assert.equal(e.first.status,'AWAITING_SOURCE_RECEIPT');assert.equal(e.afterRestart.attemptCount,1);assert.equal(e.callsAfterRestart,1);
 assert.equal(e.fresh.status,'SOURCE_RECEIPT_FRESH');assert.equal(e.due.status,'AWAITING_SOURCE_RECEIPT');assert.equal(e.stats.calls,2);assert.equal(e.sourceTtlUnchanged,true);
 assert.deepEqual(e.credentialMissingOperations,['scannerCycle']);
 assert.equal(e.first.tradeSignalGenerated,false);assert.equal(e.first.deviceNotificationSent,false);assert(!JSON.stringify(e).includes('local-fixture-token'));
 console.log(JSON.stringify({runtime:version,candidateBuild:build,scheduledDispatchIndependentOfMarketFailure:true,restartDedupVerified:true,sourceReceiptAndRequestAckSeparated:true,sourceTtlUnchanged:true,credentialMissingNoDispatch:true,upstreams:'LOCAL_FIXTURES_ONLY',result:'PASS'}));
}finally{child.kill('SIGTERM');fs.rmSync(dir,{recursive:true,force:true});}
