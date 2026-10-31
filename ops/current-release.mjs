// An automatic rebuild of the same verified source is a no-op. A changed UUID,
// namespace, source blob or owner never authorizes an implicit redeployment.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {cloudflareSnapshot,requestJson} from './diagnostics.mjs';
export function assessCurrentRelease({manifest,sourceGitBlobSha,baseline,cloudflare,fast}){
 const id=fast?.backendIdentity||{};
 const gates={
  verifiedWindow:baseline?.status==='PRODUCTION_WINDOW_VERIFIED_AWAITING_FINAL_ACCEPTANCE'&&baseline?.autonomousWindowPassed===true,
  immutableSource:!!sourceGitBlobSha&&manifest?.sourceGitBlobSha===sourceGitBlobSha&&baseline?.sourceGitBlobSha===sourceGitBlobSha,
  sameBuild:!!manifest?.build&&baseline?.build===manifest.build&&fast?.build===manifest.build,
  exactDeployment:!!baseline?.deploymentId&&cloudflare?.deploymentId===baseline.deploymentId,
  exactVersion:!!baseline?.versionId&&cloudflare?.singleVersion===true&&cloudflare?.versions?.length===1&&cloudflare.versions[0].id===baseline.versionId&&cloudflare.versions[0].percentage===100,
  sameNamespace:baseline?.namespaceFingerprint==='aedfbcd14cd1'&&cloudflare?.bindingMatches===true&&cloudflare?.binding?.namespaceFingerprint===baseline.namespaceFingerprint,
  ownerMatches:id.matched===true&&id.frontendBuild===manifest?.build&&id.stateOwnerBuild===manifest?.build&&id.stateOwnerContract===manifest?.stateOwnerContract,
  correctApi:fast?.apiVersion===manifest?.apiVersion
 };
 return {alreadyDeployed:Object.values(gates).every(Boolean),gates,failedGates:Object.keys(gates).filter(k=>!gates[k]),
  scope:'EXACT_PREVIOUSLY_VERIFIED_PHYSICAL_SOURCE_NO_REDEPLOYMENT_NOT_NEW_ACCEPTANCE'};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const config=JSON.parse(fs.readFileSync(new URL('./config.json',import.meta.url),'utf8'));
 const manifest=JSON.parse(fs.readFileSync(new URL('./release-manifest.json',import.meta.url),'utf8'));
 const baseline=JSON.parse(fs.readFileSync(new URL('./production-baseline.json',import.meta.url),'utf8'));
 const bytes=fs.readFileSync(new URL('../main-v188.js',import.meta.url));
 const sourceGitBlobSha=createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex');
 const token=process.env.CLOUDFLARE_API_TOKEN;
 if(!token)throw Error('CURRENT_RELEASE_READ_ONLY_TOKEN_REQUIRED');
 const [cloudflare,fast]=await Promise.all([cloudflareSnapshot(fetch,config,token),requestJson(fetch,config.origin+'/?view=fast')]);
 const assessment=assessCurrentRelease({manifest,sourceGitBlobSha,baseline,cloudflare,fast});
 const evidence={...assessment,build:manifest.build,sourceGitBlobSha,deploymentId:cloudflare.deploymentId,versionId:cloudflare.versions?.[0]?.id||null,namespaceFingerprint:cloudflare.binding?.namespaceFingerprint||null,checkedAt:new Date().toISOString(),finalDeliveryAccepted:false};
 fs.writeFileSync('current-release-evidence.json',JSON.stringify(evidence,null,2));
 console.log(JSON.stringify(evidence));
 if(!assessment.alreadyDeployed)process.exitCode=1;
}
