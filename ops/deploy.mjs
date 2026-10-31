import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {validateTarget,wranglerCLI} from './deployment.mjs';
import {assessCurrentRelease} from './current-release.mjs';
import {cloudflareSnapshot,requestJson} from './diagnostics.mjs';
const root=new URL('../',import.meta.url);
const config=JSON.parse(fs.readFileSync(new URL('./config.json',import.meta.url),'utf8'));
const wrangler=JSON.parse(fs.readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
// Preserve the production state namespace and object identity across code releases.
validateTarget(wrangler,config,process.env.CLOUDFLARE_ACCOUNT_ID);
const tests=spawnSync(process.execPath,[new URL('./run-tests.mjs',import.meta.url).pathname],{cwd:root,stdio:'inherit'});
if(tests.status!==0)process.exit(tests.status||1);
// The candidate must not deploy over an unreviewed production identity or state binding.
// A missing scanner credential or inaccessible production endpoint fails closed.
const manifest=JSON.parse(fs.readFileSync(new URL('./release-manifest.json',import.meta.url),'utf8'));
const baselineUrl=new URL('./production-baseline.json',import.meta.url);
if(fs.existsSync(baselineUrl)){
 const baseline=JSON.parse(fs.readFileSync(baselineUrl,'utf8'));
 if(baseline.build===manifest.build){
  const token=process.env.CLOUDFLARE_API_TOKEN;
  if(!token)throw Error('CURRENT_SOURCE_READ_ONLY_VERIFICATION_TOKEN_REQUIRED');
  const bytes=fs.readFileSync(new URL('../main-v188.js',import.meta.url));
  const sourceGitBlobSha=createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex');
  const [cloudflare,fast]=await Promise.all([cloudflareSnapshot(fetch,config,token),requestJson(fetch,config.origin+'/?view=fast')]);
  const assessment=assessCurrentRelease({manifest,sourceGitBlobSha,baseline,cloudflare,fast});
  console.log(JSON.stringify(assessment));
  if(!assessment.alreadyDeployed)throw Error('PREVIOUSLY_VERIFIED_SOURCE_CHANGED_NO_IMPLICIT_REDEPLOYMENT');
  console.log(JSON.stringify({status:'EXACT_VERIFIED_SOURCE_ALREADY_DEPLOYED_NO_MUTATION',build:manifest.build,deploymentId:cloudflare.deploymentId}));
  process.exit(0);
 }
}
if(manifest.build==='crypto-alpha-worker-v27.6.3-macro-r5f'){
 const preflight=spawnSync(process.execPath,[new URL('./r5-preflight.mjs',import.meta.url).pathname],{cwd:root,stdio:'inherit',env:process.env});
 if(preflight.status!==0)process.exit(preflight.status||1);
}
if(manifest.build==='crypto-alpha-worker-v27.6.3-macro-r4'){
 const preflight=spawnSync(process.execPath,[new URL('./r4-preflight.mjs',import.meta.url).pathname],{cwd:root,stdio:'inherit',env:process.env});
 if(preflight.status!==0)process.exit(preflight.status||1);
}
const result=spawnSync(process.execPath,[wranglerCLI(),'deploy','--config','wrangler.jsonc','--keep-vars'],{cwd:root,stdio:'inherit',env:{...process.env,CLOUDFLARE_ACCOUNT_ID:config.accountId,CI:'true'}});
process.exitCode=result.status===0?0:(result.status||1);
