import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';

const root=new URL('../',import.meta.url),require=createRequire(import.meta.url);
const unit=['test-operations.mjs','test-course-engine.mjs','test-rate-protection.mjs','test-fast-monitor.mjs','test-monitor-coordination.mjs','test-owner-local-dispatch.mjs','test-push-observability.mjs'];
const native=['verify-workerd-full-system.mjs','verify-workerd-fast-monitor.mjs','verify-workerd-owner-local.mjs'];
mkdirSync(new URL('test-results/',root),{recursive:true});
const summary=[];
let binary=process.env.WORKERD_BIN;
if(!process.argv.includes('--unit')&&!binary){
  // Run the native executable: the npm JS launcher does not preserve control fd 3.
  if(process.platform!=='linux'||process.arch!=='x64')throw Error('Native suite requires Linux x64 or explicit WORKERD_BIN');
  binary=require.resolve('@cloudflare/workerd-linux-64/bin/workerd');
}
if(binary&&!existsSync(binary))throw Error('WORKERD_BIN_NOT_FOUND');
for(const suite of [...unit,...(process.argv.includes('--unit')?[]:native)]){
  const p=spawnSync(process.execPath,[new URL('../tests/'+suite,import.meta.url).pathname,...(suite.startsWith('verify-')?[binary]:[])],{cwd:root,encoding:'utf8',timeout:240000,maxBuffer:4*1024*1024,env:{...process.env,CLOUDFLARE_API_TOKEN:'',SCANNER_TOKEN:'',BARK_DEVICE_KEY:'',JIN10_MCP_TOKEN:''}});
  const ok=p.status===0&&!p.error;
  writeFileSync(new URL('test-results/'+suite+'.log',root),(p.stdout||'')+(p.stderr||''));
  summary.push({suite,passed:ok});
  console.log((ok?'PASS ':'FAIL ')+suite);
  if(!ok){console.error((p.stderr||p.stdout||p.error?.code||'TEST_FAILED').slice(-4000));break;}
}
writeFileSync(new URL('test-results/summary.json',root),JSON.stringify({mode:'ISOLATED_FIXTURES_ONLY',productionVerified:false,suites:summary},null,2));
if(summary.some(s=>!s.passed))process.exitCode=1;
