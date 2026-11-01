import assert from 'node:assert/strict';
import {assessAutomaticBlsRenewals} from '../ops/observe-bls-renewal.mjs';
const start=Date.parse('2026-11-01T04:00:00Z'),iso=n=>new Date(start+n).toISOString(),ref='crypto-alpha-collector-r5g-20261101',commit='a'.repeat(40),build='candidate';
const expected={collectorRef:ref,collectorCommit:commit,build},ids=['BLS_CPI','BLS_PPI','BLS_EMPLOYMENT','BLS_CALENDAR'];
function fixture(){const samples=Array.from({length:51},(_,i)=>{const ms=i*30000,batch=ms>1200000?1200000:ms>600000?600000:0,id=batch?batch===600000?101:102:null;return{readAt:iso(ms),build,identityMatched:true,stateReadSucceeded:true,consumedAt:iso(ms),sources:ids.map(source=>({source,status:'ok',fetchedAt:iso(batch?batch+2000:-1000)})),dispatcher:{configured:true,status:'SOURCE_RECEIPT_FRESH',collectorRef:ref,workflowRunId:id,lastRequestAcceptedAt:batch?iso(batch):null}};});const runs=Object.fromEntries([[101,600000],[102,1200000]].map(([id,ms])=>[id,{id,event:'workflow_dispatch',status:'completed',conclusion:'success',head_sha:commit,head_branch:ref,run_started_at:iso(ms+1000),created_at:iso(ms)}]));return{samples,runs};}
const good=fixture();assert.equal(assessAutomaticBlsRenewals(good.samples,good.runs,expected).passed,true);
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
console.log('PASS automatic renewal observer accepts spaced consumed dispatches and rejects scheduled/manual/old/missing/stale/foreign/failed/short/gapped evidence',changes.length+1);
