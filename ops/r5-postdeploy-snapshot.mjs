import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {cloudflareSnapshot} from './diagnostics.mjs';
import {R4_BASELINE,R5_BUILD} from './r5-preflight.mjs';

export function assessR5DeploymentSnapshot(before,after){
 const previous=before?.priorVersionId;
 const gates={
  authorizedPreviousR4:before?.priorDeploymentId===R4_BASELINE.deploymentId&&
    typeof previous==='string'&&previous.length===36,
  newDeploymentIdentity:typeof after?.deploymentId==='string'&&after.deploymentId!==before?.priorDeploymentId,
  singleActiveVersion:after?.singleVersion===true&&after?.versions?.length===1&&after.versions[0]?.percentage===100,
  newVersionIdentity:typeof after?.versions?.[0]?.id==='string'&&after.versions[0].id!==previous,
  durableNamespacePreserved:after?.bindingMatches===true&&after?.binding?.namespaceFingerprint===R4_BASELINE.namespaceFingerprint
 };
 return {passed:Object.values(gates).every(Boolean),gates,failedGates:Object.keys(gates).filter(x=>!gates[x]),
    activeDeploymentId:after?.deploymentId??null,activeVersionId:after?.versions?.[0]?.id??null,
    priorDeploymentId:before?.priorDeploymentId??null,priorVersionId:previous??null,
    scope:'CLOUDFLARE_DEPLOYMENT_ID_AND_NAMESPACE_NOT_YET_FRONTEND_IDENTITY'};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const config=JSON.parse(fs.readFileSync(new URL('./config.json',import.meta.url),'utf8'));
 const preflight=JSON.parse(fs.readFileSync('r5-preflight-evidence.json','utf8'));
 if(preflight.build!==R5_BUILD)throw Error('PREFLIGHT_BUILD_MISMATCH');
 if(!process.env.CLOUDFLARE_API_TOKEN)throw Error('CLOUDFLARE_TOKEN_REQUIRED');
 const after=await cloudflareSnapshot(fetch,config,process.env.CLOUDFLARE_API_TOKEN);
 const assessment=assessR5DeploymentSnapshot(preflight,after);
 console.log(JSON.stringify(assessment));
 if(assessment.passed)fs.writeFileSync('r5-postdeploy-evidence.json',JSON.stringify({
   build:R5_BUILD,observedAt:new Date().toISOString(),deploymentId:assessment.activeDeploymentId,
   versionId:assessment.activeVersionId,priorVersionId:assessment.priorVersionId,
   priorDeploymentId:assessment.priorDeploymentId,namespaceFingerprint:R4_BASELINE.namespaceFingerprint
 },null,2));
 else process.exitCode=1;
}
