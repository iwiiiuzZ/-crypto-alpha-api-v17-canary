import assert from 'node:assert/strict';
import {assessSoak} from '../ops/soak-monitor.mjs';
const start=Date.parse('2026-10-25T03:00:00Z'),iso=n=>new Date(n).toISOString();
const expected={build:'candidate',apiVersion:'7.6.0',stateContract:'owner-local-dispatch-v1'};
const metadata={deploymentId:'same',singleVersion:true,bindingMatches:true,binding:{namespaceFingerprint:'aedfbcd14cd1'}};
const rows=Array.from({length:37},(_,i)=>{const t=start+i*17000,at=iso(t-1000);return {readAt:iso(t),build:'candidate',apiVersion:'7.6.0',identity:{frontendBuild:'candidate',stateOwnerBuild:'candidate',matched:true,stateOwnerContract:expected.stateContract},health:{sampling:true,quote:true,flow:true,lastSuccessAt:at,lastTradeAt:at,bookAt:at},scanner:{stateReadSucceeded:true,identityMatched:true,build:'candidate',producerBuild:'candidate',status:'completed',lastSuccessfulCycleAt:at,newsConsumedAt:at},receipts:[{producerBuild:'candidate',status:'completed',inspectedModels:8,modelDataReady:true,checkedAt:at,completedAt:at}]};});
assert.equal(assessSoak(rows,expected,metadata,metadata).passed,true);
for(const change of [r=>r[15].health.quote=false,r=>r[15].scanner.status='degraded',r=>r[15].scanner.lastSuccessfulCycleAt=iso(start-300000),r=>r[15].receipts[0].producerBuild='old',r=>r[15].identity.matched=false,r=>r.splice(12,3)]){
 const copy=structuredClone(rows);change(copy);assert.equal(assessSoak(copy,expected,metadata,metadata).passed,false);
}
// A stale but still <180s heartbeat used to pass the older soak gate.
for(const field of ['scanner','receipts']){
 const copy=structuredClone(rows);
 for(let i=12;i<=21;i++){
  if(field==='scanner')copy[i].scanner.lastSuccessfulCycleAt=copy[11].scanner.lastSuccessfulCycleAt;
  else copy[i].receipts[0].completedAt=copy[11].receipts[0].completedAt;
 }
 const result=assessSoak(copy,expected,metadata,metadata);
 assert.equal(result.passed,false);
 assert.equal(result.gates[field==='scanner'?'heartbeatProgresses':'modelReviewProgresses'],false);
}
// Progress must never move backwards, even if every individual timestamp is fresh.
for(const field of ['scanner','receipts']){
 const copy=structuredClone(rows);
 if(field==='scanner')copy[20].scanner.lastSuccessfulCycleAt=copy[18].scanner.lastSuccessfulCycleAt;
 else copy[20].receipts[0].completedAt=copy[18].receipts[0].completedAt;
 assert.equal(assessSoak(copy,expected,metadata,metadata).passed,false);
}
assert.equal(assessSoak(rows,expected,metadata,{...metadata,deploymentId:'changed'}).passed,false);
assert.equal(assessSoak(rows,expected,metadata,{...metadata,binding:{namespaceFingerprint:'other'}}).passed,false);
assert.equal(assessSoak(rows.slice(0,3),expected,metadata,metadata).passed,false);
assert.equal(assessSoak([],expected,metadata,undefined).passed,false);
console.log(JSON.stringify({passed:true,scope:'SYNTHETIC_SOAK_GATE_TESTS',productionVerified:false}));
