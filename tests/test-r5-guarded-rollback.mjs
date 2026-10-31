import assert from 'node:assert/strict';
import {assessR5DeploymentSnapshot} from '../ops/r5-postdeploy-snapshot.mjs';
import {assessR5GuardedRollback} from '../ops/r5-guarded-rollback.mjs';
import {R4_BASELINE,R5_BUILD} from '../ops/r5-preflight.mjs';
const r4Id='01234567-89ab-cdef-0123-456789abcdef',r5Id='abcdef01-2345-6789-abcd-ef0123456789';
const before={build:R5_BUILD,priorDeploymentId:R4_BASELINE.deploymentId,priorVersionId:r4Id,namespaceFingerprint:R4_BASELINE.namespaceFingerprint};
const current={deploymentId:'r5-deployment',singleVersion:true,versions:[{id:r5Id,percentage:100}],
 bindingMatches:true,binding:{namespaceFingerprint:R4_BASELINE.namespaceFingerprint}};
const snapshot=assessR5DeploymentSnapshot(before,current);
assert.equal(snapshot.passed,true,JSON.stringify(snapshot.failedGates));
const post={build:R5_BUILD,deploymentId:current.deploymentId,versionId:r5Id,priorVersionId:r4Id,priorDeploymentId:R4_BASELINE.deploymentId};
const ok=assessR5GuardedRollback({before,post,current,liveBuild:R5_BUILD});
assert.equal(ok.canRollback,true);
assert.equal(ok.alreadyRestored,false);
const mutations=[
 x=>x.current.deploymentId='out-of-band',
 x=>x.current.versions[0].id='other-version',
 x=>x.current.singleVersion=false,
 x=>x.current.binding.namespaceFingerprint='another-namespace',
 x=>x.current.bindingMatches=false,
 x=>x.post=null,
 x=>x.liveBuild=R4_BASELINE.build,
 x=>x.before.priorVersionId=null,
 x=>x.before.priorDeploymentId='different'
];
for(const mutate of mutations){const x=structuredClone({before,post,current,liveBuild:R5_BUILD});mutate(x);
 assert.equal(assessR5GuardedRollback(x).canRollback,false);}
const restored={...current,deploymentId:R4_BASELINE.deploymentId,versions:[{id:r4Id,percentage:100}]};
assert.equal(assessR5GuardedRollback({before,post,current:restored,liveBuild:null}).alreadyRestored,true);
assert.equal(assessR5DeploymentSnapshot(before,{...current,versions:[{id:r4Id,percentage:100}]}).passed,false);
console.log('PASS safe R5 deployment pinning and rollback only to verified prior R4',mutations.length+4);
