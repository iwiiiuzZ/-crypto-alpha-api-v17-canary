import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
export function validateTarget(wrangler,config,account){
  const bindings=wrangler.durable_objects?.bindings?.filter(b=>b.name===config.stateBinding)||[];
  if(wrangler.name!==config.worker||wrangler.main!=='main-v188.js'||bindings.length!==1||bindings[0].class_name!==config.stateClass||bindings[0].script_name)throw Error('PRODUCTION_TARGET_OR_BINDING_CHANGED');
  if(JSON.stringify(wrangler.migrations)!==JSON.stringify([{tag:'v18-8-0-scanner-state',new_sqlite_classes:['ScannerState']}]))throw Error('STATE_MIGRATION_REQUIRES_SEPARATE_REVIEW');
  if(account&&account!==config.accountId)throw Error('WRONG_CLOUDFLARE_ACCOUNT');
}
export function wranglerCLI(){
  const pkg=require.resolve('wrangler/package.json'),metadata=JSON.parse(fs.readFileSync(pkg,'utf8'));
  return path.resolve(path.dirname(pkg),metadata.bin.wrangler);
}
