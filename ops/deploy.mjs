import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {validateTarget,wranglerCLI} from './deployment.mjs';
import {assessCurrentRelease} from './current-release.mjs';
import {cloudflareSnapshot,requestJson} from './diagnostics.mjs';
import {withDispatchSecretFile} from './dispatch-secret-file.mjs';
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
// Preview builds may test candidates; only the reviewed release workflow can publish.
if(manifest.status==='CANDIDATE_NOT_DEPLOYED'&&process.env.CRYPTO_ALPHA_CONTROLLED_RELEASE!=='1'){console.log(JSON.stringify({status:'CANDIDATE_PREVIEW_NO_PRODUCTION_MUTATION',build:manifest.build}));process.exit(0);}
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
if(manifest.build==='crypto-alpha-worker-v27.6.3-macro-r5i'){
 const preflight=spawnSync(process.execPath,[new URL('./r5-preflight.mjs',import.meta.url).pathname],{cwd:root,stdio:'inherit',env:process.env});
 if(preflight.status!==0)process.exit(preflight.status||1);
 const secrets=await requestJson(fetch,'https://api.cloudflare.com/client/v4/accounts/'+config.accountId+'/workers/scripts/'+encodeURIComponent(config.worker)+'/secrets',{authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN});
 if(!String(process.env.GITHUB_ACTIONS_DISPATCH_TOKEN||'').trim()&&(!Array.isArray(secrets.result)||!secrets.result.some(s=>s.name==='GITHUB_ACTIONS_DISPATCH_TOKEN')))throw Error('PERSISTENT_GITHUB_DISPATCH_SECRET_REQUIRED_BEFORE_DEPLOYMENT');
}
if(manifest.build==='crypto-alpha-worker-v27.6.3-macro-r4'){
 const preflight=spawnSync(process.execPath,[new URL('./r4-preflight.mjs',import.meta.url).pathname],{cwd:root,stdio:'inherit',env:process.env});
 if(preflight.status!==0)process.exit(preflight.status||1);
}
const result=withDispatchSecretFile(manifest.build==='crypto-alpha-worker-v27.6.3-macro-r5i'?process.env.GITHUB_ACTIONS_DISPATCH_TOKEN:null,file=>
 spawnSync(process.execPath,[wranglerCLI(),'deploy','--config','wrangler.jsonc','--keep-vars',...(file?['--secrets-file',file]:[])],{cwd:root,stdio:'inherit',env:{...process.env,CLOUDFLARE_ACCOUNT_ID:config.accountId,CI:'true'}}));
process.exitCode=result.status===0?0:(result.status||1);
