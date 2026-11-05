import assert from 'node:assert/strict';
import fs from 'node:fs';
import {assessAutomaticBlsRenewals} from '../ops/observe-bls-renewal.mjs';
const start=Date.parse('2026-11-01T04:00:00Z'),iso=n=>new Date(start+n).toISOString(),ref='crypto-alpha-collector-r5g-20261101',commit='a'.repeat(40),build='candidate';
const expected={collectorRef:ref,collectorCommit:commit,build},ids=['BLS_CPI','BLS_PPI','BLS_EMPLOYMENT','BLS_CALENDAR'];
function fixture(){const samples=Array.from({length:51},(_,i)=>{const ms=i*30000,batch=ms>1200000?1200000:ms>600000?600000:0,id=batch?batch===600000?101:102:null;return{readAt:iso(ms),build,identityMatched:true,stateReadSucceeded:true,consumedAt:iso(ms),sources:ids.map(source=>({source,status:'ok',fetchedAt:iso(batch?batch+2000:-1000)})),dispatcher:{configured:true,status:'SOURCE_RECEIPT_FRESH',collectorRef:ref,workflowRunId:id,lastRequestAcceptedAt:batch?iso(batch):null}};});const runs=Object.fromEntries([[101,600000],[102,1200000]].map(([id,ms])=>[id,{id,event:'workflow_dispatch',status:'completed',conclusion:'success',head_sha:commit,head_branch:ref,run_started_at:iso(ms+1000),created_at:iso(ms)}]));return{samples,runs};}
const good=fixture();assert.equal(assessAutomaticBlsRenewals(good.samples,good.runs,expected).passed,true);
// Healthy startup coverage is already valid; insufficient duration is a separate gate.
for(let n=1;n<=good.samples.length;n++){
 const result=assessAutomaticBlsRenewals(good.samples.slice(0,n),good.runs,expected);
 assert.equal(result.coveragePassed,true,'healthy prefix '+n+' must not abort the live observer');
 assert.equal(result.passed,n===51,'a startup prefix must never satisfy the full 25-minute gate');
}
const aborted=JSON.parse(fs.readFileSync(new URL('../evidence/2026-11-01-r5g-renewal-aborted.json',import.meta.url)));
const replay=assessAutomaticBlsRenewals(aborted.samples,aborted.runs,aborted.expected);
assert.equal(replay.coveragePassed,true,'the two actual healthy production samples must not cause premature abort');
assert.equal(replay.passed,false,'replaying thirty seconds cannot certify twenty-five minutes or two renewals');
const earlyBad=fixture();earlyBad.samples[1].sources[0].status='unavailable';
assert.equal(assessAutomaticBlsRenewals(earlyBad.samples.slice(0,2),earlyBad.runs,expected).coveragePassed,false);
assert.equal(assessAutomaticBlsRenewals([],{},expected).coveragePassed,false);
const changes=[
 f=>f.runs[102].event='schedule',
 f=>f.runs[102].conclusion='failure',
 f=>f.runs[102].head_sha='b'.repeat(40),
 f=>f.runs[102].head_branch='main',
 f=>f.runs[102].status='in_progress',
 f=>f.samples[45].sources.pop(),
 f=>f.samples[45].sources[0].status='unavailable',
 f=>f.samples[45].sources[0].fetchedAt=iso(-3600000),
 f=>f.samples[45].build='old',
 f=>f.samples[45].identityMatched=false,
 f=>f.samples[45].dispatcher.configured=false,
 f=>f.samples[45].dispatcher.status='AUTHORIZATION_OR_TARGET_REQUIRED',
 f=>f.samples[45].dispatcher.collectorRef='main',
 f=>f.samples[45].consumedAt=iso(-1000),
 f=>f.samples.splice(10,10),
 f=>f.samples.pop(),
 f=>{for(const s of f.samples)if(s.dispatcher.workflowRunId)s.dispatcher.workflowRunId=101;},
 f=>{for(const s of f.samples)if(s.dispatcher.workflowRunId===102)s.dispatcher.lastRequestAcceptedAt=iso(-1000);}
];
for(const change of changes){const f=fixture();change(f);assert.equal(assessAutomaticBlsRenewals(f.samples,f.runs,expected).passed,false);}
console.log('PASS renewal coverage, complete duration and authentic spaced renewals',JSON.stringify({healthyPrefixes:51,negativeScenarios:changes.length,actualAbortedWindowReplayed:true}));
