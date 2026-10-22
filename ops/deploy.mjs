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
const result=spawnSync(process.execPath,[wranglerCLI(),'deploy','--config','wrangler.jsonc','--keep-vars'],{cwd:root,stdio:'inherit',env:{...process.env,CLOUDFLARE_ACCOUNT_ID:config.accountId,CI:'true'}});
process.exitCode=result.status===0?0:(result.status||1);
