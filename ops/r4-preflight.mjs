import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {requestJson,cloudflareSnapshot,OpsError} from './diagnostics.mjs';

const PRIOR_VERSION='0ce31eb2-d0d7-4a64-82b2-fcc846bc2f73';
const PRIOR_DEPLOYMENT='9c4489b1-ead3-4b0a-8585-d7a2a8a81291';
const FINGERPRINT='aedfbcd14cd1';

export function assessR4Preflight({manifest,sourceBlobSha,cloudflare,fast,status,now=Date.now()}){
 const id=fast?.backendIdentity||{},heartbeat=status?.heartbeat||{},scanId=status?.backendIdentity||{};
 const age=Date.parse(heartbeat.lastSuccessfulCycleAt);
 const gates={
  sourceLocked:manifest?.sourceGitBlobSha===sourceBlobSha,
  candidateBuild:manifest?.build==='crypto-alpha-worker-v27.6.3-macro-r4'&&manifest?.status==='CANDIDATE_NOT_DEPLOYED',
  expectedPriorBuild:manifest?.priorLiveBuild==='crypto-alpha-worker-v27.6.3-acceptance-candidate-r3',
  priorDeploymentUnchanged:cloudflare?.deploymentId===PRIOR_DEPLOYMENT&&cloudflare?.singleVersion===true&&cloudflare?.versions?.length===1&&cloudflare.versions[0]?.id===PRIOR_VERSION&&cloudflare.versions[0]?.percentage===100,
  durableObjectUnchanged:cloudflare?.bindingMatches===true&&cloudflare?.binding?.namespaceFingerprint===FINGERPRINT,
  frontendBackendMatch:fast?.build===manifest?.priorLiveBuild&&fast?.apiVersion===manifest?.apiVersion&&id.matched===true&&id.frontendBuild===manifest?.priorLiveBuild&&id.stateOwnerBuild===manifest?.priorLiveBuild&&id.stateOwnerContract===manifest?.stateOwnerContract,
  scannerStateMatch:status?.build===manifest?.priorLiveBuild&&scanId.matched===true&&scanId.stateOwnerBuild===manifest?.priorLiveBuild&&status?.diagnostics?.stateReadSucceeded===true&&heartbeat.producerBuild===manifest?.priorLiveBuild,
  scannerRecentSuccess:Number.isFinite(age)&&now-age>=-5000&&now-age<=110000&&['running','completed'].includes(heartbeat.status)
 };
 return {passed:Object.values(gates).every(Boolean),gates,failedGates:Object.keys(gates).filter(k=>!gates[k]),priorVersion:PRIOR_VERSION,scope:'READ_ONLY_PRE_DEPLOY_CHECK_NOT_DEPLOYMENT_AUTHORIZATION'};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const config=JSON.parse(fs.readFileSync(new URL('./config.json',import.meta.url),'utf8'));
 const manifest=JSON.parse(fs.readFileSync(new URL('./release-manifest.json',import.meta.url),'utf8'));
 const source=fs.readFileSync(new URL('../main-v188.js',import.meta.url));
 const sourceBlobSha=createHash('sha1').update(Buffer.from('blob '+source.length+'\\0')).update(source).digest('hex');
 const token=process.env.CLOUDFLARE_API_TOKEN,scanner=process.env.SCANNER_TOKEN;
 if(!token||!scanner)throw new OpsError('PREFLIGHT_CREDENTIALS_REQUIRED');
 const [cloudflare,fast,status]=await Promise.all([
  cloudflareSnapshot(fetch,config,token),
  requestJson(fetch,config.origin+'/?view=fast'),
  requestJson(fetch,config.origin+'/scanner/status',{authorization:'Bearer '+scanner})
 ]);
 const result=assessR4Preflight({manifest,sourceBlobSha,cloudflare,fast,status});
 console.log(JSON.stringify(result));
 if(!result.passed)process.exitCode=1;
}
