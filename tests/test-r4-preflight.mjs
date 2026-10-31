import assert from 'node:assert/strict';
import {assessR4Preflight} from '../ops/r4-preflight.mjs';

const now=Date.parse('2026-10-30T08:00:00Z');
const build='crypto-alpha-worker-v27.6.3-acceptance-candidate-r3';
const manifest={build:'crypto-alpha-worker-v27.6.3-macro-r4',status:'CANDIDATE_NOT_DEPLOYED',priorLiveBuild:build,sourceGitBlobSha:'blob',apiVersion:'7.6.0',stateOwnerContract:'owner-local-dispatch-v1'};
const cloudflare={deploymentId:'9c4489b1-ead3-4b0a-8585-d7a2a8a81291',singleVersion:true,versions:[{id:'0ce31eb2-d0d7-4a64-82b2-fcc846bc2f73',percentage:100}],bindingMatches:true,binding:{namespaceFingerprint:'aedfbcd14cd1'}};
const fast={build,apiVersion:'7.6.0',backendIdentity:{matched:true,frontendBuild:build,stateOwnerBuild:build,stateOwnerContract:'owner-local-dispatch-v1'}};
const status={build,backendIdentity:{matched:true,stateOwnerBuild:build},diagnostics:{stateReadSucceeded:true},heartbeat:{producerBuild:build,status:'completed',lastSuccessfulCycleAt:new Date(now-30000).toISOString()}};
const input={manifest,sourceBlobSha:'blob',cloudflare,fast,status,now};
assert.equal(assessR4Preflight(input).passed,true);
const scenarios=[
 v=>v.sourceBlobSha='modified',
 v=>v.manifest.status='DEPLOYED',
 v=>v.cloudflare.deploymentId='unexpected',
 v=>v.cloudflare.versions[0].id='different',
 v=>v.cloudflare.binding.namespaceFingerprint='different',
 v=>v.fast.backendIdentity.stateOwnerBuild='old',
 v=>v.status.heartbeat.producerBuild='old',
 v=>v.status.heartbeat.lastSuccessfulCycleAt=new Date(now-111000).toISOString(),
 v=>v.status.diagnostics.stateReadSucceeded=false
];
for(const mutate of scenarios){const copy=structuredClone(input);mutate(copy);assert.equal(assessR4Preflight(copy).passed,false);}
console.log(JSON.stringify({passed:true,scenarios:scenarios.length+1,scope:'ISOLATED_R4_RELEASE_PREFLIGHT'}));
