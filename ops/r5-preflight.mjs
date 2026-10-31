import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {requestJson,cloudflareSnapshot,summarizeSample} from './diagnostics.mjs';

export const R4_BASELINE={
 build:'crypto-alpha-worker-v27.6.3-macro-r4',
 deploymentId:'f18315e1-0726-4d3d-9f5e-4011f7770b5d',
 namespaceFingerprint:'aedfbcd14cd1'
};
export const R5_BUILD='crypto-alpha-worker-v27.6.3-macro-r5b';

export function assessR5Preflight({manifest,sourceGitBlobSha,cloudflare,fast,status,now=Date.now()}){
 const ident=fast?.backendIdentity||{},scanId=status?.backendIdentity||{};
 const sample=summarizeSample(fast,status,now);
 const fresh=t=>Number.isFinite(Date.parse(t))&&now-Date.parse(t)>=-5000&&now-Date.parse(t)<=110000;
 const previousVersionId=cloudflare?.versions?.length===1?cloudflare.versions[0]?.id:null;
 const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
 const gates={
  immutableSource:manifest?.sourceGitBlobSha===sourceGitBlobSha,
  uniqueR5Build:manifest?.build===R5_BUILD&&manifest?.status==='CANDIDATE_NOT_DEPLOYED'&&manifest?.priorLiveBuild===R4_BASELINE.build,
  correctDeployment:cloudflare?.deploymentId===R4_BASELINE.deploymentId&&cloudflare?.singleVersion===true&&cloudflare?.versions?.[0]?.percentage===100&&uuid.test(previousVersionId||''),
  namespacePreserved:cloudflare?.bindingMatches===true&&cloudflare?.binding?.namespaceFingerprint===R4_BASELINE.namespaceFingerprint,
  frontendOwnerConsistent:fast?.build===R4_BASELINE.build&&fast?.apiVersion===manifest?.apiVersion&&ident.matched===true&&ident.frontendBuild===R4_BASELINE.build&&ident.stateOwnerBuild===R4_BASELINE.build&&ident.stateOwnerContract===manifest?.stateOwnerContract,
  scannerOwnerConsistent:status?.build===R4_BASELINE.build&&scanId.matched===true&&scanId.stateOwnerBuild===R4_BASELINE.build&&sample.scanner.stateReadSucceeded&&sample.scanner.producerBuild===R4_BASELINE.build,
  scannerCurrent:['completed','running'].includes(sample.scanner.status)&&fresh(sample.scanner.lastSuccessfulCycleAt),
  fullEightModelReview:sample.receipts.some(r=>r.producerBuild===R4_BASELINE.build&&r.status==='completed'&&r.inspectedModels===8&&r.modelDataReady&&fresh(r.completedAt)),
  currentOKXQuote:sample.health.quote===true&&sample.health.sampling===true&&fresh(sample.health.lastSuccessAt)
 };
 const failedGates=Object.entries(gates).filter(([,v])=>!v).map(([k])=>k);
 return {passed:failedGates.length===0,gates,failedGates,
  priorDeploymentId:cloudflare?.deploymentId||null,priorVersionId:uuid.test(previousVersionId||'')?previousVersionId:null,
  scope:'READ_ONLY_R5_PRODUCTION_PREFLIGHT_NOT_DEPLOYMENT_AUTHORIZATION'};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const config=JSON.parse(fs.readFileSync(new URL('./config.json',import.meta.url),'utf8'));
 const manifest=JSON.parse(fs.readFileSync(new URL('./release-manifest.json',import.meta.url),'utf8'));
 const source=fs.readFileSync(new URL('../main-v188.js',import.meta.url));
 const sourceGitBlobSha=createHash('sha1').update(Buffer.from('blob '+source.length)).update(Buffer.from([0])).update(source).digest('hex');
 const token=process.env.CLOUDFLARE_API_TOKEN,scannerToken=process.env.SCANNER_TOKEN;
 if(!token||!scannerToken)throw Error('R5_CLOUDFLARE_AND_SCANNER_CREDENTIALS_REQUIRED');
 const [cloudflare,fast,status]=await Promise.all([
   cloudflareSnapshot(fetch,config,token),
   requestJson(fetch,config.origin+'/?view=fast'),
   requestJson(fetch,config.origin+'/scanner/status',{authorization:'Bearer '+scannerToken})
 ]);
 const assessment=assessR5Preflight({manifest,sourceGitBlobSha,cloudflare,fast,status});
 if(assessment.passed)fs.writeFileSync('r5-preflight-evidence.json',JSON.stringify({
   build:R5_BUILD,sourceGitBlobSha,priorDeploymentId:assessment.priorDeploymentId,
   priorVersionId:assessment.priorVersionId,namespaceFingerprint:R4_BASELINE.namespaceFingerprint,
   observedAt:new Date().toISOString(),scope:assessment.scope
 },null,2));
 console.log(JSON.stringify(assessment));
 if(!assessment.passed)process.exitCode=1;
}
