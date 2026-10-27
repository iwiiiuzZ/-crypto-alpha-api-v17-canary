import assert from 'node:assert/strict';
import {identityConverged} from '../ops/wait-for-identity.mjs';
const now=Date.parse('2026-10-25T03:00:00Z'),iso=n=>new Date(n).toISOString();
const expected={build:'candidate',apiVersion:'7.6.0',stateContract:'owner-local-dispatch-v1'};
const row={readAt:iso(now),build:expected.build,apiVersion:expected.apiVersion,identity:{matched:true,frontendBuild:expected.build,stateOwnerBuild:expected.build,stateOwnerContract:expected.stateContract},scanner:{build:expected.build,identityMatched:true,stateReadSucceeded:true,producerBuild:expected.build,lastSuccessfulCycleAt:iso(now-1000)},receipts:[{producerBuild:expected.build,status:'completed',inspectedModels:8,modelDataReady:true,completedAt:iso(now-1000)}],health:{quote:false,sampling:false,flow:false}};
assert.equal(identityConverged([],expected),false);
assert.equal(identityConverged([row],expected),false);
assert.equal(identityConverged([row,row],expected),true,'identity gate must not cherry-pick a healthy quote');
for(const change of[r=>r.identity.matched=false,r=>r.identity.stateOwnerBuild='old',r=>r.identity.stateOwnerContract=null,r=>r.apiVersion='old',r=>r.scanner.build='old',r=>r.scanner.producerBuild='old',r=>r.scanner.lastSuccessfulCycleAt=iso(now-181000),r=>r.receipts[0].completedAt=iso(now+6000),r=>r.receipts[0].inspectedModels=0,r=>r.receipts[0].modelDataReady=false]){
 const bad=structuredClone(row);change(bad);
 assert.equal(identityConverged([bad,row],expected),false);
 assert.equal(identityConverged([row,bad],expected),false);
 assert.equal(identityConverged([bad,row,row],expected),true);
}
console.log(JSON.stringify({passed:true,scope:'IDENTITY_GATE_FIXTURES_NOT_PRODUCTION_HEALTH'}));
