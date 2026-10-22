import fs from 'node:fs';
import {requestJson,cloudflareSnapshot,OpsError} from './diagnostics.mjs';
const config=JSON.parse(fs.readFileSync(new URL('./config.json',import.meta.url),'utf8'));
const version=process.env.ROLLBACK_VERSION;
if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(version||''))throw Error('EXPLICIT_VERSION_UUID_REQUIRED');
const token=process.env.CLOUDFLARE_API_TOKEN;
if(!token)throw Error('MISSING_CLOUDFLARE_API_TOKEN');
const base='https://api.cloudflare.com/client/v4/accounts/'+config.accountId+'/workers/scripts/'+config.worker;
const target=await requestJson(fetch,base+'/versions/'+version,{authorization:'Bearer '+token});
if(target.success!==true||target.result?.id!==version)throw Error('ROLLBACK_VERSION_NOT_FOUND');
const before=await cloudflareSnapshot(fetch,config,token);
if(!before.bindingMatches)throw Error('STATE_BINDING_REQUIRES_REVIEW');
// No force flag: Cloudflare must reject incompatible migrations or secret changes.
const r=await fetch(base+'/deployments',{method:'POST',redirect:'error',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({strategy:'percentage',versions:[{version_id:version,percentage:100}],annotations:{'workers/message':'Explicit maintenance rollback'}}),signal:AbortSignal.timeout(30000)});
if(!r.ok)throw new OpsError('ROLLBACK_HTTP_'+r.status);
const after=await cloudflareSnapshot(fetch,config,token);
if(!after.singleVersion||after.versions[0].id!==version)throw Error('ROLLBACK_NOT_CONFIRMED');
console.log(JSON.stringify({status:'ROLLBACK_DEPLOYMENT_CONFIRMED',deviceDeliveryVerified:false}));
