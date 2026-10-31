// This is a read-only production audit, never a signal or notification generator.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {requestJson,summarizeReadContext,summarizeCandidateChain,summarizeSample,safeOutput} from './diagnostics.mjs';
import {R5_BUILD} from './r5-preflight.mjs';
const config=JSON.parse(fs.readFileSync(new URL('./config.json',import.meta.url),'utf8'));
const scanner=process.env.SCANNER_TOKEN;
if(!scanner)throw Error('SCANNER_TOKEN_REQUIRED');
const errors=[],evidence={scope:'READ_ONLY_CURRENT_RUNTIME_AND_BOUNDED_STATUS_HISTORY',observedAt:new Date().toISOString(),build:R5_BUILD};
let market,news,status,fast,schema;
for(const [name,route,headers] of [['market','/?view=market',{}],['news','/?view=news',{}],['status','/scanner/status',{authorization:'Bearer '+scanner}],['fast','/?view=fast',{}],['schema','/openapi.json',{}]]){
 try{const body=await requestJson(fetch,config.origin+route,headers);if(name==='market')market=body;if(name==='news')news=body;if(name==='status')status=body;if(name==='fast')fast=body;if(name==='schema')schema=body;}
 catch(e){errors.push({view:name,error:e.code||'READ_FAILED',reason:e.reason||null});}
}
evidence.context=summarizeReadContext(market,news);
evidence.candidateChain=summarizeCandidateChain(status);
const sample=summarizeSample(fast,status);
const source=fs.readFileSync(new URL('../main-v188.js',import.meta.url),'utf8');
let schemaMatches=false;
if(schema)try{
 const worker=await import('data:text/javascript;base64,'+Buffer.from(source+'\nexport {openApi};').toString('base64'));
 assert.deepEqual(schema,worker.openApi(config.origin));schemaMatches=true;
}catch{errors.push({view:'schema',error:'LIVE_SCHEMA_DIFFERS_FROM_TESTED_SOURCE'});}
const models=evidence.context.models.map(m=>m.model).sort();
const identity=sample.identity;
evidence.gates={allReadsSucceeded:errors.length===0,
 sourceSchemaMatches:schemaMatches,
 frontendOwnerIdentity:sample.build===R5_BUILD&&identity.frontendBuild===R5_BUILD&&identity.stateOwnerBuild===R5_BUILD&&identity.matched&&identity.stateOwnerContract===config.stateContract,
 sixRequiredStructureSeries:evidence.context.structure.length===6&&evidence.context.structure.every(r=>r.qualityPassed&&r.newestClosedAt===r.expectedClosedAt),
 allEightModelsReturned:JSON.stringify(models)===JSON.stringify(['A1','A2','B1','B2','C1','C2','D1','D2']),
 currentOKXQuote:sample.health.quote&&sample.health.sampling&&sample.health.flow,
 authenticatedStateRead:sample.scanner.stateReadSucceeded&&sample.scanner.identityMatched};
const attempts=status?.notificationAudit?.recentAttempts||[],records=[...(status?.observations||[]),...(status?.observationHistory||[])];
evidence.preparedNotifications=records.filter(r=>r.alerts?.MARKET_CANDIDATE||r.preparedTrade).map(r=>{
 const a=r.alerts?.MARKET_CANDIDATE,c=r.preparedTrade;
 const matched=attempts.find(t=>t.kind==='OBSERVATION'&&t.stage==='MARKET_CANDIDATE'&&t.eventId===r.observationId&&t.attemptId===a?.auditAttemptId&&t.outcome==='PROVIDER_ACCEPTED');
 return {eventFingerprint:createHash('sha256').update(String(r.observationId)).digest('hex').slice(0,12),
   validTechnicalCard:!!c&&c.technicalConditionsPassed===true&&c.netRR>=2&&[c.entry,c.stopLoss,c.firstTarget].every(Number.isFinite),
   persistedQueueStatus:a?.status||null,matchingAcceptedAttempt:!!matched,
   providerAcceptedAt:a?.providerAcceptedAt||null,
   queueTransitionIndependentlyObserved:false,deviceReceiptVerified:false};
});
evidence.preparedNotificationLiveVerified=false; // no independently observed queue transition in this single read
evidence.gptInstalledVerified=false;
evidence.strategyProfitabilityVerified=false;
evidence.operationalAuditPassed=Object.values(evidence.gates).every(Boolean);
evidence.finalDeliveryAccepted=false;
evidence.errors=errors;
fs.writeFileSync('r5-final-readonly-audit.json',JSON.stringify(evidence,null,2));
console.log(safeOutput(evidence,[scanner]));
if(!evidence.operationalAuditPassed)process.exitCode=1;
