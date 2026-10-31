// Real runtime, deliberately mixed new frontend and old owner modules. No external networking.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';import {spawn,execFileSync} from 'node:child_process';
const bin=process.argv[2];if(!bin)throw Error('Pass native workerd executable');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-mixed-owner-'));
fs.writeFileSync(path.join(dir,'new.mjs'),fs.readFileSync(new URL('../main-v188.js',import.meta.url)));
fs.writeFileSync(path.join(dir,'old.mjs'),fs.readFileSync(new URL('./baselines/V27_6_0_main-v188.js',import.meta.url)));
fs.writeFileSync(path.join(dir,'entry.mjs'),"import app from './new.mjs';export {ScannerState} from './old.mjs';export default app;");
fs.writeFileSync(path.join(dir,'upstream.mjs'),"export default {fetch(){throw Error('NO_EXTERNAL_NETWORK_EXPECTED')}};");
fs.writeFileSync(path.join(dir,'config.capnp'),`using W=import "/workerd/workerd.capnp";const config:W.Config=(services=[
 (name="main",worker=(compatibilityDate="2026-08-22",globalOutbound="upstream",modules=[(name="entry.mjs",esModule=embed "entry.mjs"),(name="new.mjs",esModule=embed "new.mjs"),(name="old.mjs",esModule=embed "old.mjs")],durableObjectNamespaces=[(className="ScannerState",uniqueKey="isolated-mixed-owner")],durableObjectStorage=(inMemory=void),bindings=[(name="SCANNER_STATE",durableObjectNamespace=(className="ScannerState")),(name="SCANNER_TOKEN",text="fixture-scanner"),(name="BARK_DEVICE_KEY",text="fixture-device")])),
 (name="upstream",worker=(compatibilityDate="2026-08-22",modules=[(name="upstream.mjs",esModule=embed "upstream.mjs")]))],sockets=[(name="http",address="127.0.0.1:0",http=(),service="main")]);`);
const child=spawn(bin,['serve',path.join(dir,'config.capnp'),'--control-fd=3'],{stdio:['ignore','ignore','pipe','pipe']});let stderr='';child.stderr.on('data',b=>stderr+=b);const checks=[];
try{
 const port=await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(Error(stderr)),8000);child.on('exit',n=>{clearTimeout(timer);reject(Error('runtime '+n+' '+stderr));});child.stdio[3].on('data',b=>{out+=b;for(const l of out.split('\n'))try{const row=JSON.parse(l);if(row.port){clearTimeout(timer);resolve(row.port);}}catch{}});});
 async function get(p,auth=true){const r=await fetch('http://127.0.0.1:'+port+p,{headers:auth?{authorization:'Bearer fixture-scanner'}:{},signal:AbortSignal.timeout(8000)});return {status:r.status,body:await r.json()};}
 const f=await get('/?view=fast');assert.equal(f.status,200);assert.equal(f.body.build,fs.readFileSync(new URL('../main-v188.js',import.meta.url),'utf8').match(/^const BUILD = "([^"]+)";/m)[1]);assert.equal(f.body.fastMonitor.stateOwnerBuild,undefined);assert.equal(f.body.fastMonitor.quoteHealthy,undefined);assert.equal(f.body.backendIdentity.matched,false);assert.equal(f.body.backendIdentity.status,'OWNER_IDENTITY_NOT_RETURNED');assert.equal(f.body.status,'degraded');checks.push('actual new frontend plus legacy owner reproduces missing flags and is explicitly degraded');
 const s=await get('/scanner/status');assert.equal(s.status,200);assert.equal(s.body.diagnostics.stateReadSucceeded,true);assert.equal(s.body.status,'degraded');assert.equal(s.body.backendIdentity.matched,false);assert.equal(s.body.activePlan,null);assert.deepEqual(s.body.observations,[]);checks.push('identity failure does not invent an empty-state read failure or a healthy backend');
 assert.equal((await get('/scanner/status',false)).status,401);checks.push('private records remain authenticated in a deliberately mismatched deployment');
 console.log(JSON.stringify({runtime:execFileSync(bin,['--version'],{encoding:'utf8'}).trim(),mixedModules:true,productionDeploymentVerified:false,productionMismatchConfirmed:false,externalUpstreams:'NONE',passed:checks.length,failed:0,checks},null,2));
}finally{child.kill('SIGTERM');fs.rmSync(dir,{recursive:true,force:true});}
