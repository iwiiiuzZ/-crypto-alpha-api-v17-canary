import assert from 'node:assert/strict';
import {verifyReleaseIntent} from '../ops/verify-r4-release-intent.mjs';
const blob='locked-blob',build='crypto-alpha-worker-v27.6.3-macro-r4';
const manifest={sourceGitBlobSha:blob,build,priorLiveBuild:'crypto-alpha-worker-v27.6.3-acceptance-candidate-r3',status:'CANDIDATE_NOT_DEPLOYED'};
const intent={approved:true,purpose:'R4_PRODUCTION_ACCEPTANCE_WITH_AUTOMATIC_ROLLBACK',sourceGitBlobSha:blob,build,priorVersion:'0ce31eb2-d0d7-4a64-82b2-fcc846bc2f73',rollbackOnFailure:true};
assert.equal(verifyReleaseIntent(intent,manifest,blob).passed,true);
for(const mutation of [
 i=>i.intent.approved=false,
 i=>i.intent.sourceGitBlobSha='tampered',
 i=>i.intent.priorVersion='different',
 i=>i.intent.rollbackOnFailure=false,
 i=>i.manifest.status='DEPLOYED',
 i=>i.actualBlob='different'
]){
 const copy=structuredClone({intent,manifest,actualBlob:blob});mutation(copy);
 assert.equal(verifyReleaseIntent(copy.intent,copy.manifest,copy.actualBlob).passed,false);
}
console.log('PASS explicit R4 release intent and immutable source lock');
