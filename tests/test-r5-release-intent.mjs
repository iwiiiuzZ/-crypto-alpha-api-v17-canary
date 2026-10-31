import assert from 'node:assert/strict';
import {verifyR5ReleaseIntent} from '../ops/r5-release-intent-check.mjs';
import {PRIOR_BASELINE,R5_BUILD} from '../ops/r5-preflight.mjs';
const parentCommit='abcdef0123456789abcdef0123456789abcdef01';
const manifest={build:R5_BUILD,status:'CANDIDATE_NOT_DEPLOYED',priorLiveBuild:PRIOR_BASELINE.build,sourceGitBlobSha:'source-lock'};
const intent={approved:true,purpose:'R5_STABLE_PRODUCTION_RELEASE',reviewedCommit:parentCommit,sourceGitBlobSha:'source-lock',build:R5_BUILD,priorDeploymentId:PRIOR_BASELINE.deploymentId,rollbackOnFailure:true,noOrderExecution:true};
const input={intent,manifest,actualGitBlob:'source-lock',parentCommit,changedFiles:['ops/r5-release-intent.json']};
assert.equal(verifyR5ReleaseIntent(input).passed,true);
const cases=[
 x=>x.intent.approved=false,
 x=>x.intent.reviewedCommit='incorrect',
 x=>x.parentCommit='different',
 x=>x.changedFiles.push('main-v188.js'),
 x=>x.actualGitBlob='changed',
 x=>x.manifest.build='r4',
 x=>x.intent.priorDeploymentId='different',
 x=>x.intent.rollbackOnFailure=false,
 x=>x.intent.noOrderExecution=false
];
for(const mutate of cases){const x=structuredClone(input);mutate(x);assert.equal(verifyR5ReleaseIntent(x).passed,false);}
console.log('PASS reviewed-commit release intent gates',cases.length+1);
