import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import {validateTarget,wranglerCLI} from './deployment.mjs';
const root=new URL('../',import.meta.url);
const config=JSON.parse(fs.readFileSync(new URL('./config.json',import.meta.url),'utf8'));
const wrangler=JSON.parse(fs.readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
// Preserve the production state namespace and object identity across code releases.
validateTarget(wrangler,config,process.env.CLOUDFLARE_ACCOUNT_ID);
const tests=spawnSync(process.execPath,[new URL('./run-tests.mjs',import.meta.url).pathname],{cwd:root,stdio:'inherit'});
if(tests.status!==0)process.exit(tests.status||1);
// The R4 candidate must not deploy over a changed production identity or state binding.
// A missing scanner credential or inaccessible production endpoint fails closed.
const manifest=JSON.parse(fs.readFileSync(new URL('./release-manifest.json',import.meta.url),'utf8'));
if(manifest.build==='crypto-alpha-worker-v27.6.3-macro-r5'){
 const preflight=spawnSync(process.execPath,[new URL('./r5-preflight.mjs',import.meta.url).pathname],{cwd:root,stdio:'inherit',env:process.env});
 if(preflight.status!==0)process.exit(preflight.status||1);
}
if(manifest.build==='crypto-alpha-worker-v27.6.3-macro-r4'){
 const preflight=spawnSync(process.execPath,[new URL('./r4-preflight.mjs',import.meta.url).pathname],{cwd:root,stdio:'inherit',env:process.env});
 if(preflight.status!==0)process.exit(preflight.status||1);
}
const result=spawnSync(process.execPath,[wranglerCLI(),'deploy','--config','wrangler.jsonc','--keep-vars'],{cwd:root,stdio:'inherit',env:{...process.env,CLOUDFLARE_ACCOUNT_ID:config.accountId,CI:'true'}});
process.exitCode=result.status===0?0:(result.status||1);
