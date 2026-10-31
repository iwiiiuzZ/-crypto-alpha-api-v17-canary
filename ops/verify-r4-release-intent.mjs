import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const R3_VERSION='0ce31eb2-d0d7-4a64-82b2-fcc846bc2f73';
export function verifyReleaseIntent(intent,manifest,actualBlob){
 const gates={
  explicitApproval:intent?.approved===true&&intent?.purpose==='R4_PRODUCTION_ACCEPTANCE_WITH_AUTOMATIC_ROLLBACK',
  immutableSource:intent?.sourceGitBlobSha===actualBlob&&manifest?.sourceGitBlobSha===actualBlob,
  matchingBuild:intent?.build===manifest?.build&&manifest?.build==='crypto-alpha-worker-v27.6.3-macro-r4',
  priorProductionLocked:intent?.priorVersion===R3_VERSION&&manifest?.priorLiveBuild==='crypto-alpha-worker-v27.6.3-acceptance-candidate-r3',
  unshippedCandidate:manifest?.status==='CANDIDATE_NOT_DEPLOYED',
  rollbackEnabled:intent?.rollbackOnFailure===true
 };
 return {passed:Object.values(gates).every(Boolean),gates,scope:'EXPLICIT_SOURCE_LOCKED_RELEASE_INTENT_NOT_PRODUCTION_PROOF'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const intent=JSON.parse(fs.readFileSync(new URL('./r4-release-intent.json',import.meta.url),'utf8'));
 const manifest=JSON.parse(fs.readFileSync(new URL('./release-manifest.json',import.meta.url),'utf8'));
 const source=fs.readFileSync(new URL('../main-v188.js',import.meta.url));
 const actualBlob=createHash('sha1').update(Buffer.from('blob '+source.length)).update(Buffer.from([0])).update(source).digest('hex');
 const result=verifyReleaseIntent(intent,manifest,actualBlob);
 console.log(JSON.stringify(result));
 if(!result.passed)process.exitCode=1;
}
