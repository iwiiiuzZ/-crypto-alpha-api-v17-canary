// Changes only the reviewed production trigger's deploy command; never starts a build.
// https://developers.cloudflare.com/workers/ci-cd/builds/api-reference/
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
export const EXPECTED_TRIGGER='5827726d-2dc7-4544-ab7e-08a1169dcb20';
const checked='npm run deploy:checked';
const standard=['npx wrangler deploy','npx wrangler deploy --keep-vars'];
export async function configureBuildGate(fetcher,config,token,{apply=false}={}){
 if(!token)throw Error('MISSING_TOKEN');
 const base='https://api.cloudflare.com/client/v4/accounts/'+encodeURIComponent(config.accountId);
 const call=async(path,method='GET',body)=>{
  const r=await fetcher(base+path,{method,redirect:'error',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw Error('BUILD_GATE_HTTP_'+r.status);
  let j;try{j=await r.json();}catch{throw Error('BUILD_GATE_INVALID_JSON');}
  if(j.success!==true)throw Error('BUILD_GATE_API_REJECTED');return j.result;
 };
 const scripts=await call('/workers/scripts');
 const targets=Array.isArray(scripts)?scripts.filter(s=>s.id===config.worker):[];
 if(targets.length!==1||!targets[0].tag)throw Error('TARGET_WORKER_NOT_UNIQUE');
 const listPath='/builds/workers/'+encodeURIComponent(targets[0].tag)+'/triggers';
 const before=await call(listPath);
 if(!Array.isArray(before))throw Error('TRIGGERS_MISSING');
 const main=before.filter(t=>t.trigger_uuid===EXPECTED_TRIGGER);
 if(main.length!==1)throw Error('EXPECTED_TRIGGER_MISSING');
 const t=main[0];
 if(JSON.stringify(t.branch_includes)!=='["main"]'||(t.branch_excludes||[]).length||!['','/','.'].includes(t.root_directory))throw Error('TRIGGER_SCOPE_CHANGED');
 if(t.external_script_id&&t.external_script_id!==targets[0].tag)throw Error('TRIGGER_WORKER_MISMATCH');
 if(t.build_command?.trim())throw Error('UNREVIEWED_BUILD_COMMAND');
 const old=t.deploy_command?.trim();
 if(![checked,...standard].includes(old))throw Error('UNREVIEWED_DEPLOY_COMMAND');
 if(old===checked)return {status:'ALREADY_CONFIGURED',trigger:EXPECTED_TRIGGER,checkedDeployCommand:true,buildStarted:false};
 if(!apply)return {status:'READY_TO_CONFIGURE',trigger:EXPECTED_TRIGGER,checkedDeployCommand:false,buildStarted:false};
 await call('/builds/triggers/'+EXPECTED_TRIGGER,'PATCH',{deploy_command:checked});
 const after=await call(listPath),next=Array.isArray(after)?after.find(x=>x.trigger_uuid===EXPECTED_TRIGGER):null;
 if(next?.deploy_command?.trim()!==checked)throw Error('BUILD_GATE_WRITE_NOT_VERIFIED');
 // Preserve branch/root/repository/token/watch configuration, without printing any credential.
 for(const key of ['external_script_id','branch_includes','branch_excludes','root_directory','repo_connection_uuid','build_token_uuid','path_includes','path_excludes','build_command']){
  if(JSON.stringify(next[key])!==JSON.stringify(t[key]))throw Error('BUILD_GATE_UNRELATED_FIELD_CHANGED');
 }
 const untouched=before.filter(x=>x.trigger_uuid!==EXPECTED_TRIGGER);
 for(const other of untouched){const n=after.find(x=>x.trigger_uuid===other.trigger_uuid);if(!n||n.deploy_command!==other.deploy_command)throw Error('PREVIEW_COMMAND_CHANGED');}
 return {status:'CONFIGURED_AND_READ_BACK',trigger:EXPECTED_TRIGGER,checkedDeployCommand:true,buildStarted:false,
  previousDeployCommand:old,previewCommandPreserved:true};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const config=JSON.parse(fs.readFileSync(new URL('./config.json',import.meta.url),'utf8'));
 try{console.log(JSON.stringify(await configureBuildGate(fetch,config,process.env.CLOUDFLARE_API_TOKEN,{apply:process.argv.includes('--apply')})));}
 catch(e){const code=/^[A-Z][A-Z0-9_]+$/.test(e.message)?e.message:'BUILD_GATE_REQUEST_FAILED';console.log(JSON.stringify({status:'NOT_CONFIRMED',code}));process.exitCode=1;}
}
