import assert from 'node:assert/strict';
import {assessR5Preflight,PRIOR_BASELINE,R5_BUILD} from '../ops/r5-preflight.mjs';

const now=Date.parse('2026-10-31T01:00:00Z');
const tick=new Date(now-22000).toISOString();
const manifest={build:R5_BUILD,status:'CANDIDATE_NOT_DEPLOYED',priorLiveBuild:PRIOR_BASELINE.build,sourceGitBlobSha:'locked',apiVersion:'7.6.0',stateOwnerContract:'owner-local-dispatch-v1'};
const cloudflare={deploymentId:PRIOR_BASELINE.deploymentId,singleVersion:true,
 versions:[{id:'01234567-89ab-cdef-0123-456789abcdef',percentage:100}],
 bindingMatches:true,binding:{namespaceFingerprint:PRIOR_BASELINE.namespaceFingerprint}};
const fast={build:PRIOR_BASELINE.build,apiVersion:'7.6.0',
 backendIdentity:{matched:true,frontendBuild:PRIOR_BASELINE.build,stateOwnerBuild:PRIOR_BASELINE.build,stateOwnerContract:'owner-local-dispatch-v1'},
 fastMonitor:{quoteHealthy:true,samplingHealthy:true,lastSuccessAt:tick,fullReview:{producerBuild:PRIOR_BASELINE.build,status:'completed',inspectedModels:8,modelDataReady:true,completedAt:tick}}};
const status={build:PRIOR_BASELINE.build,backendIdentity:{matched:true,stateOwnerBuild:PRIOR_BASELINE.build},diagnostics:{stateReadSucceeded:true},
 heartbeat:{producerBuild:PRIOR_BASELINE.build,status:'completed',lastSuccessfulCycleAt:tick}};
const base={manifest,sourceGitBlobSha:'locked',cloudflare,fast,status,now};
const ok=assessR5Preflight(base);
assert.equal(ok.passed,true,JSON.stringify(ok.failedGates));
assert.equal(ok.priorVersionId,cloudflare.versions[0].id);
const duringMinuteCycle=structuredClone(base);
duringMinuteCycle.status.heartbeat.status='running';
assert.equal(assessR5Preflight(duringMinuteCycle).passed,true,'running scanner with fresh last-success and complete model receipt is healthy');
duringMinuteCycle.status.heartbeat.lastSuccessfulCycleAt=new Date(now-200000).toISOString();
assert.equal(assessR5Preflight(duringMinuteCycle).passed,false,'running scanner with stale last-success must fail closed');
duringMinuteCycle.status.heartbeat.lastSuccessfulCycleAt=tick;
duringMinuteCycle.status.heartbeat.status='failed';
assert.equal(assessR5Preflight(duringMinuteCycle).passed,false,'failed scanner status must fail closed');
const cases=[
 o=>o.sourceGitBlobSha='different',
 o=>o.manifest.build=PRIOR_BASELINE.build,
 o=>o.manifest.status='DEPLOYED',
 o=>o.cloudflare.deploymentId='different',
 o=>o.cloudflare.versions[0].percentage=90,
 o=>o.cloudflare.versions[0].id='invalid-uuid',
 o=>o.cloudflare.binding.namespaceFingerprint='different',
 o=>o.fast.backendIdentity.stateOwnerBuild='old',
 o=>o.fast.fastMonitor.fullReview.inspectedModels=7,
 o=>o.fast.fastMonitor.fullReview.completedAt=new Date(now-250000).toISOString(),
 o=>o.fast.fastMonitor.quoteHealthy=false,
 o=>o.fast.fastMonitor.lastSuccessAt=new Date(now-200000).toISOString(),
 o=>o.status.heartbeat.lastSuccessfulCycleAt=new Date(now-112000).toISOString(),
 o=>o.status.backendIdentity.matched=false
];
for(const change of cases){const a=structuredClone(base);change(a);const verdict=assessR5Preflight(a);assert.equal(verdict.passed,false,JSON.stringify(verdict.gates));}
console.log('PASS r5 preflight fail-closed scenarios',cases.length+1);
