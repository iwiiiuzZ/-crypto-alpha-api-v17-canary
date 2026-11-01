// Creates one temporary, authenticated, stateless diagnostic Worker and removes it.
// The production script, configuration, secrets, routes and durable state are read only.
import fs from 'node:fs';
import {randomBytes,createHash} from 'node:crypto';
import {cloudflareSnapshot,requestJson,safeOutput} from './diagnostics.mjs';
import {assessCurrentRelease} from './current-release.mjs';
const config=JSON.parse(fs.readFileSync(new URL('./config.json',import.meta.url),'utf8'));
const manifest=JSON.parse(fs.readFileSync(new URL('./release-manifest.json',import.meta.url),'utf8'));
const baseline=JSON.parse(fs.readFileSync(new URL('./production-baseline.json',import.meta.url),'utf8'));
const token=process.env.CLOUDFLARE_API_TOKEN;
if(!token)throw Error('CF_PROBE_TOKEN_REQUIRED');
const apiBase='https://api.cloudflare.com/client/v4/accounts/'+config.accountId+'/workers/scripts/';
const ownershipPath='bls-isolated-probe-ownership.json';
const validProbe=name=>/^crypto-alpha-bls-probe-20261101-[a-f0-9]{8}$/.test(name)&&name!==config.worker;
async function api(name,suffix='',method='GET',body,missingAllowed=false){
 if(!validProbe(name))throw Error('PROBE_TARGET_NOT_ALLOWED');
 const r=await fetch(apiBase+encodeURIComponent(name)+suffix,{method,body,headers:{authorization:'Bearer '+token,...(body&&!(body instanceof FormData)?{'content-type':'application/json'}:{})},signal:AbortSignal.timeout(20000)});
 if(missingAllowed&&r.status===404){await r.body?.cancel();return null;}
 if(!r.ok){await r.body?.cancel();throw Error('CF_PROBE_HTTP_'+r.status);}
 // The script download endpoint returns source bytes, not a JSON API envelope.
 if(method==='GET'&&suffix===''){await r.body?.cancel();return{present:true};}
 const data=await r.json();if(data.success!==true)throw Error('CF_PROBE_API_FAILED');return data.result;
}
async function cleanup(name){
 const present=await api(name,'','GET',undefined,true);if(present!==null)await api(name,'','DELETE');
 return await api(name,'','GET',undefined,true)===null;
}
if(process.argv.includes('--cleanup-only')){
 if(fs.existsSync(ownershipPath)){
  const owned=JSON.parse(fs.readFileSync(ownershipPath,'utf8'));
  if(owned.accountId!==config.accountId||owned.reserved!==true)throw Error('PROBE_OWNERSHIP_MISMATCH');
  console.log(JSON.stringify({temporaryProbeRemoved:await cleanup(owned.name)}));
 }
}else{
 const name='crypto-alpha-bls-probe-20261101-'+randomBytes(4).toString('hex');
 const probeToken=randomBytes(24).toString('hex');
 const report={scope:'ISOLATED_TEMPORARY_STATELESS_WORKER_NO_PRODUCTION_MUTATION',startedAt:new Date().toISOString(),probeWorker:name,productionWorker:config.worker,errors:[],created:false,cleanupConfirmed:false};
 let reserved=false;
 try{
  const source=fs.readFileSync(new URL('../main-v188.js',import.meta.url));
  const sourceGitBlobSha=createHash('sha1').update(Buffer.from('blob '+source.length+'\0')).update(source).digest('hex');
  const [before,fast]=await Promise.all([cloudflareSnapshot(fetch,config,token),requestJson(fetch,config.origin+'/?view=fast')]);
  report.productionBefore=before;report.sourceGitBlobSha=sourceGitBlobSha;
  report.preflight=assessCurrentRelease({manifest,sourceGitBlobSha,baseline,cloudflare:before,fast});
  if(!report.preflight.alreadyDeployed)throw Error('PRODUCTION_CHANGED_BEFORE_PROBE');
  if(await api(name,'','GET',undefined,true)!==null)throw Error('PROBE_NAME_ALREADY_EXISTS');
  fs.writeFileSync(ownershipPath,JSON.stringify({accountId:config.accountId,name,reserved:true}));reserved=true;
  const sourceText=fs.readFileSync(new URL('./bls-egress-probe-worker.mjs',import.meta.url),'utf8');
  const form=new FormData();form.append('metadata',new Blob([JSON.stringify({main_module:'probe.mjs',compatibility_date:'2026-10-01',bindings:[{type:'secret_text',name:'PROBE_TOKEN',text:probeToken}]})],{type:'application/json'}));
  form.append('probe.mjs',new Blob([sourceText],{type:'application/javascript+module'}),'probe.mjs');
  await api(name,'','PUT',form);report.created=true;
  await api(name,'/subdomain','POST',JSON.stringify({enabled:true,previews_enabled:false}));
  const suffix=new URL(config.origin).hostname.split('.').slice(1).join('.');
  if(suffix!=='id-mranran.workers.dev')throw Error('PROBE_ORIGIN_NOT_ALLOWED');
  const url='https://'+name+'.'+suffix+'/';
  for(let attempt=0;attempt<3;attempt++){
   const r=await fetch(url,{method:'POST',headers:{'x-probe-token':probeToken},signal:AbortSignal.timeout(65000)});
   if(r.ok){report.measurement=await r.json();break;}
   const status=r.status;await r.body?.cancel();if(![404,502,503].includes(status)||attempt===2)throw Error('PROBE_ENDPOINT_HTTP_'+status);
   await new Promise(r=>setTimeout(r,2000));
  }
 }catch(e){report.errors.push(/^[A-Z0-9_]+$/.test(e.message)?e.message:'ISOLATED_PROBE_FAILED');}
 finally{
  if(reserved){try{report.cleanupConfirmed=await cleanup(name);}catch{report.errors.push('PROBE_CLEANUP_NOT_CONFIRMED');}}
  try{report.productionAfter=await cloudflareSnapshot(fetch,config,token);}catch{report.errors.push('PRODUCTION_AFTER_READ_FAILED');}
  report.productionUnchanged=!!report.productionBefore&&report.productionAfter?.deploymentId===report.productionBefore.deploymentId&&JSON.stringify(report.productionAfter?.versions)===JSON.stringify(report.productionBefore.versions)&&report.productionAfter?.bindingMatches===true;
  report.identifiedOfficialAccessVerified=report.measurement?.identifiedAllValid===true;
  report.passed=report.productionUnchanged&&report.cleanupConfirmed&&report.identifiedOfficialAccessVerified&&!report.errors.length;
  report.completedAt=new Date().toISOString();
  const output=safeOutput(report,[token,probeToken]);fs.writeFileSync('bls-isolated-egress-evidence.json',output);console.log(output);
 }
 if(!report.passed)process.exitCode=1;
}
