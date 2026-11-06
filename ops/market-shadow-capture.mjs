// Temporary, unbound diagnostic Worker. No production deployment or private binding is changed.
import fs from 'node:fs';
import {cloudflareSnapshot,safeOutput} from './diagnostics.mjs';
const config=JSON.parse(fs.readFileSync(new URL('./config.json',import.meta.url),'utf8'));
const token=process.env.CLOUDFLARE_API_TOKEN,run=process.env.GITHUB_RUN_ID;
if(!token||!/^\d+$/.test(run||''))throw Error('NETWORK_PROBE_ENV_REQUIRED');
const name='crypto-alpha-market-capture-'+run;
if(!/^crypto-alpha-market-capture-\d+$/.test(name)||name===config.worker)throw Error('ISOLATED_PROBE_NAME_REQUIRED');
const base='https://api.cloudflare.com/client/v4/accounts/'+config.accountId+'/workers/scripts/'+name;
const headers={authorization:'Bearer '+token};
const report={scope:'TEMPORARY_SHADOW_PUBLIC_SNAPSHOT_CAPTURE_NO_PRIVATE_CREDENTIALS_OR_PRODUCTION_DEPLOYMENT',worker:name,sources:null,removed:false,errors:[]};
let uploaded=false;
async function api(path,method='GET',body,type='application/json'){
 const r=await fetch(base+path,{method,redirect:'error',headers:{...headers,...(body?{'content-type':type}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
 if(!r.ok){await r.body?.cancel();throw Error('PROBE_API_HTTP_'+r.status);}const json=await r.json();if(json.success!==true)throw Error('PROBE_API_REJECTED');return json;
}
try{
 report.before=await cloudflareSnapshot(fetch,config,token);
 if(report.before.deploymentId!=='53126941-a9f4-49f4-823d-ec31d30f214a'||report.before.binding?.namespaceFingerprint!=='aedfbcd14cd1')throw Error('PRODUCTION_BASELINE_CHANGED_NO_PROBE');
 const form=new FormData();form.set('metadata',new Blob([JSON.stringify({main_module:'probe.mjs',compatibility_date:'2026-08-22',bindings:[{name:'SCANNER_STATE',type:'durable_object_namespace',class_name:config.stateClass,script_name:config.worker}]})],{type:'application/json'}));
 form.set('probe.mjs',new Blob(["import {buildSnapshot} from './worker.mjs'; export default {async fetch(request,env){if(request.method!=='GET')return new Response('method',{status:405});return Response.json({scope:'SHADOW_PUBLIC_SNAPSHOT_CAPTURE',snapshot:await buildSnapshot({env})});}};"],{type:'application/javascript+module'}),'probe.mjs');
 form.set('worker.mjs',new Blob([fs.readFileSync(new URL('../main-v188.js',import.meta.url),'utf8')+'\nexport {buildSnapshot};\n'],{type:'application/javascript+module'}),'worker.mjs');
 const upload=await fetch(base,{method:'PUT',redirect:'error',headers,body:form,signal:AbortSignal.timeout(20000)});
 if(!upload.ok){await upload.body?.cancel();throw Error('PROBE_UPLOAD_HTTP_'+upload.status);}const accepted=await upload.json();if(accepted.success!==true)throw Error('PROBE_UPLOAD_REJECTED');uploaded=true;
 await api('/subdomain','POST',{enabled:true,previews_enabled:false});
 const original=new URL(config.origin).hostname;if(!original.startsWith(config.worker+'.')||!original.endsWith('.workers.dev'))throw Error('PROBE_ORIGIN_INVALID');
 const origin='https://'+name+original.slice(config.worker.length);
 for(let i=0;i<10;i++){
  const r=await fetch(origin,{method:'GET',redirect:'error',signal:AbortSignal.timeout(90000)});
  if(r.ok){const result=await r.json();if(result.scope==='SHADOW_PUBLIC_SNAPSHOT_CAPTURE'){report.sources=result;break;}}
  else await r.body?.cancel();
  await new Promise(resolve=>setTimeout(resolve,3000));
 }
 if(!report.sources)throw Error('ISOLATED_WORKER_NOT_READY');
}catch(e){report.errors.push(/^[A-Z0-9_]+$/.test(e.message)?e.message:'NETWORK_PROBE_FAILED');}
finally{
 if(uploaded)try{await api('','DELETE');report.removed=true;}catch{report.errors.push('TEMPORARY_PROBE_CLEANUP_FAILED');}
 try{report.after=await cloudflareSnapshot(fetch,config,token);report.productionIdentityUnchanged=report.after.deploymentId===report.before?.deploymentId&&report.after.versions?.[0]?.id===report.before?.versions?.[0]?.id&&report.after.binding?.namespaceFingerprint==='aedfbcd14cd1';}catch{report.errors.push('PRODUCTION_IDENTITY_READ_FAILED');}
 report.checkedAt=new Date().toISOString();fs.writeFileSync('market-shadow-capture.json',safeOutput(report,[token]));console.log(safeOutput(report,[token]));
}
if(report.errors.length||!report.productionIdentityUnchanged||uploaded&&!report.removed)process.exitCode=1;
