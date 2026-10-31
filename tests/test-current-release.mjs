import assert from 'node:assert/strict';
import {assessCurrentRelease} from '../ops/current-release.mjs';
const manifest={build:'known-build',sourceGitBlobSha:'known-blob',stateOwnerContract:'owner-local-dispatch-v1',apiVersion:'7.6.0'};
const baseline={build:manifest.build,sourceGitBlobSha:manifest.sourceGitBlobSha,status:'PRODUCTION_WINDOW_VERIFIED_AWAITING_FINAL_ACCEPTANCE',autonomousWindowPassed:true,deploymentId:'known-deployment',versionId:'known-version',namespaceFingerprint:'aedfbcd14cd1'};
const cloudflare={deploymentId:baseline.deploymentId,singleVersion:true,versions:[{id:baseline.versionId,percentage:100}],bindingMatches:true,binding:{namespaceFingerprint:baseline.namespaceFingerprint}};
const fast={build:manifest.build,apiVersion:manifest.apiVersion,backendIdentity:{matched:true,frontendBuild:manifest.build,stateOwnerBuild:manifest.build,stateOwnerContract:manifest.stateOwnerContract}};
const good={manifest,sourceGitBlobSha:manifest.sourceGitBlobSha,baseline,cloudflare,fast};
assert.equal(assessCurrentRelease(good).alreadyDeployed,true);
const changes=[v=>v.baseline.autonomousWindowPassed=false,v=>v.baseline.status='CANDIDATE',v=>v.sourceGitBlobSha='different',v=>v.baseline.sourceGitBlobSha='different',v=>v.cloudflare.deploymentId='other',v=>v.cloudflare.versions[0].id='other',v=>v.cloudflare.versions[0].percentage=90,v=>v.cloudflare.versions.push({id:'second',percentage:10}),v=>v.cloudflare.singleVersion=false,v=>v.cloudflare.binding.namespaceFingerprint='other',v=>v.fast.backendIdentity.stateOwnerBuild='old',v=>v.fast.backendIdentity.matched=false,v=>v.fast.apiVersion='old'];
for(const change of changes){const value=structuredClone(good);change(value);assert.equal(assessCurrentRelease(value).alreadyDeployed,false);}
assert.equal(assessCurrentRelease({}).alreadyDeployed,false);
console.log(JSON.stringify({passed:true,cases:changes.length+2,scope:'EXACT_SOURCE_IDEMPOTENCY_FAIL_CLOSED_NO_CLOUDFLARE_MUTATION'}));
