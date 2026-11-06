import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {requestJson,cloudflareSnapshot,OpsError} from './diagnostics.mjs';
const uuid=v=>/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v||'');
// Explicit target selection does not authorize overwriting a later deployment.
export function assessMaintenanceRollback({baseline,current,targetVersionId}={}){
 const single=current?.singleVersion===true&&current?.versions?.length===1&&current.versions[0].percentage===100;
 const namespace=current?.bindingMatches===true&&baseline?.namespaceFingerprint==='aedfbcd14cd1'&&current?.binding?.namespaceFingerprint===baseline.namespaceFingerprint;
 const alreadyRestored=uuid(targetVersionId)&&single&&namespace&&current.versions[0].id===targetVersionId;
 const gates={verifiedBaseline:baseline?.status==='PRODUCTION_WINDOW_VERIFIED_AWAITING_FINAL_ACCEPTANCE'&&baseline?.autonomousWindowPassed===true,
  explicitTarget:uuid(targetVersionId),exactDeployment:uuid(baseline?.deploymentId)&&current?.deploymentId===baseline.deploymentId,
  exactVersion:uuid(baseline?.versionId)&&single&&current.versions[0].id===baseline.versionId,
  namespacePreserved:namespace};
 const canRollback=Object.values(gates).every(Boolean)&&!alreadyRestored;
 return {alreadyRestored,canRollback,gates,status:alreadyRestored?'ALREADY_AT_REQUESTED_VERSION':canRollback?'EXACT_BASELINE_ROLLBACK_ALLOWED':'UNVERIFIED_OR_CONCURRENT_DEPLOYMENT_NO_MUTATION'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
const config=JSON.parse(fs.readFileSync(new URL('./config.json',import.meta.url),'utf8'));
const baseline=JSON.parse(fs.readFileSync(new URL('./production-baseline.json',import.meta.url),'utf8'));
const version=process.env.ROLLBACK_VERSION;
if(!uuid(version))throw Error('EXPLICIT_VERSION_UUID_REQUIRED');
const token=process.env.CLOUDFLARE_API_TOKEN;
if(!token)throw Error('MISSING_CLOUDFLARE_API_TOKEN');
const base='https://api.cloudflare.com/client/v4/accounts/'+config.accountId+'/workers/scripts/'+config.worker;
const target=await requestJson(fetch,base+'/versions/'+version,{authorization:'Bearer '+token});
if(target.success!==true||target.result?.id!==version)throw Error('ROLLBACK_VERSION_NOT_FOUND');
const before=await cloudflareSnapshot(fetch,config,token);
const assessment=assessMaintenanceRollback({baseline,current:before,targetVersionId:version});
console.log(JSON.stringify({phase:'MAINTENANCE_ROLLBACK_GATE',...assessment}));
if(assessment.alreadyRestored)process.exit(0);
if(!assessment.canRollback)throw Error('CURRENT_DEPLOYMENT_DIFFERS_FROM_VERIFIED_BASELINE_NO_MUTATION');
// Re-read immediately before the write; the first snapshot is not a lease.
const justBefore=await cloudflareSnapshot(fetch,config,token);
const recheck=assessMaintenanceRollback({baseline,current:justBefore,targetVersionId:version});
if(recheck.alreadyRestored){console.log(JSON.stringify({status:recheck.status}));process.exit(0);}
if(!recheck.canRollback)throw Error('PRODUCTION_CHANGED_BEFORE_MAINTENANCE_ROLLBACK_NO_MUTATION');
// No force flag: Cloudflare must reject incompatible migrations or secret changes.
const r=await fetch(base+'/deployments',{method:'POST',redirect:'error',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({strategy:'percentage',versions:[{version_id:version,percentage:100}],annotations:{'workers/message':'Explicit maintenance rollback'}}),signal:AbortSignal.timeout(30000)});
if(!r.ok)throw new OpsError('ROLLBACK_HTTP_'+r.status);
const after=await cloudflareSnapshot(fetch,config,token);
if(!after.singleVersion||after.versions?.length!==1||after.versions[0].id!==version||after.versions[0].percentage!==100||!after.bindingMatches||after.binding?.namespaceFingerprint!==baseline.namespaceFingerprint)throw Error('ROLLBACK_NOT_CONFIRMED');
console.log(JSON.stringify({status:'ROLLBACK_DEPLOYMENT_CONFIRMED',previousDeploymentId:before.deploymentId,newDeploymentId:after.deploymentId,versionId:version,namespacePreserved:true,deviceDeliveryVerified:false}));
}
