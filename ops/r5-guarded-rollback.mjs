import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {cloudflareSnapshot,requestJson} from './diagnostics.mjs';
import {PRIOR_BASELINE,R5_BUILD} from './r5-preflight.mjs';

export function assessR5GuardedRollback({before,post,current,liveBuild}){
 const alreadyRestored=current?.deploymentId===before?.priorDeploymentId&&
    current?.versions?.[0]?.id===before?.priorVersionId&&current?.singleVersion===true;
 const expectedCurrent=post?.build===R5_BUILD&&current?.deploymentId===post?.deploymentId&&
    current?.versions?.[0]?.id===post?.versionId&&current?.singleVersion===true;
 const validPriorVersion=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(before?.priorVersionId||'');
 const canRollback=validPriorVersion&&post?.priorVersionId===before?.priorVersionId&&post?.priorDeploymentId===before?.priorDeploymentId&&before?.build===R5_BUILD&&before?.priorDeploymentId===PRIOR_BASELINE.deploymentId&&
    before?.namespaceFingerprint===PRIOR_BASELINE.namespaceFingerprint&&
    current?.bindingMatches===true&&current?.binding?.namespaceFingerprint===PRIOR_BASELINE.namespaceFingerprint&&
    expectedCurrent&&liveBuild===R5_BUILD;
 return {alreadyRestored,canRollback,
   status:alreadyRestored?'ALREADY_AT_PREVIOUS_VERSION':canRollback?'GUARDED_R5_ROLLBACK_ALLOWED':'UNVERIFIED_OR_CONCURRENT_DEPLOYMENT_NO_MUTATION'};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const config=JSON.parse(fs.readFileSync(new URL('./config.json',import.meta.url),'utf8'));
 const before=JSON.parse(fs.readFileSync('r5-preflight-evidence.json','utf8'));
 const post=fs.existsSync('r5-postdeploy-evidence.json')?JSON.parse(fs.readFileSync('r5-postdeploy-evidence.json','utf8')):null;
 const token=process.env.CLOUDFLARE_API_TOKEN;
 if(!token)throw Error('CLOUDFLARE_TOKEN_REQUIRED');
 const current=await cloudflareSnapshot(fetch,config,token);
 let liveBuild=null;
 if(post)try{const response=await requestJson(fetch,config.origin+'/?view=fast');liveBuild=response.build;}catch{}
 const assessment=assessR5GuardedRollback({before,post,current,liveBuild});
 console.log(JSON.stringify({phase:'R5_ROLLBACK_GATE',...assessment}));
 if(assessment.alreadyRestored)process.exit(0);
 if(!assessment.canRollback)process.exit(1);
 const base='https://api.cloudflare.com/client/v4/accounts/'+config.accountId+'/workers/scripts/'+config.worker;
 const version=await requestJson(fetch,base+'/versions/'+before.priorVersionId,{authorization:'Bearer '+token});
 if(version.success!==true||version.result?.id!==before.priorVersionId)throw Error('PRIOR_VERSION_NO_LONGER_AVAILABLE');
 const justBefore=await cloudflareSnapshot(fetch,config,token);
 if(justBefore.deploymentId!==post.deploymentId||justBefore.versions?.[0]?.id!==post.versionId||
    justBefore.binding?.namespaceFingerprint!==PRIOR_BASELINE.namespaceFingerprint)throw Error('PRODUCTION_CHANGED_BEFORE_ROLLBACK');
 const response=await fetch(base+'/deployments',{method:'POST',redirect:'error',
  headers:{authorization:'Bearer '+token,'content-type':'application/json'},
  body:JSON.stringify({strategy:'percentage',versions:[{version_id:before.priorVersionId,percentage:100}],
    annotations:{'workers/message':'R5 acceptance failed; guarded rollback to pinned previous version'}}),
  signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw Error('GUARDED_ROLLBACK_HTTP_'+response.status);
 const after=await cloudflareSnapshot(fetch,config,token);
 const success=after.singleVersion===true&&after.versions?.[0]?.id===before.priorVersionId&&
   after.bindingMatches===true&&after.binding?.namespaceFingerprint===PRIOR_BASELINE.namespaceFingerprint;
 const evidence={status:success?'PREVIOUS_VERSION_RESTORED':'PREVIOUS_RESTORE_NOT_CONFIRMED',
   previousVersionId:before.priorVersionId,newDeploymentId:after.deploymentId,
   namespacePreserved:after.bindingMatches,deviceReceiptVerified:false,
   observedAt:new Date().toISOString()};
 fs.writeFileSync('r5-rollback-evidence.json',JSON.stringify(evidence,null,2));
 console.log(JSON.stringify(evidence));
 if(!success)process.exitCode=1;
}
