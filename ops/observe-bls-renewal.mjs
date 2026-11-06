import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {requestJson,cloudflareSnapshot,safeOutput} from './diagnostics.mjs';
const IDS=['BLS_CPI','BLS_PPI','BLS_EMPLOYMENT','BLS_CALENDAR'];
export function assessAutomaticBlsRenewals(samples,runs,expected){
 const at=v=>Date.parse(v),start=at(samples[0]?.readAt),end=at(samples.at(-1)?.readAt),events=new Map();
 // Prefix validity must not depend on the minimum evidence for final acceptance.
 const coveragePassed=samples.length>0&&samples.every((s,i)=>s.identityMatched===true&&s.build===expected.build&&s.stateReadSucceeded===true
  &&s.dispatcher?.configured===true&&s.dispatcher?.collectorRef===expected.collectorRef&&!['AUTHORIZATION_OR_TARGET_REQUIRED','DISPATCH_COLLECTOR_REF_INVALID'].includes(s.dispatcher?.status)
  &&Number.isFinite(at(s.consumedAt))&&at(s.readAt)-at(s.consumedAt)>=-5000&&at(s.readAt)-at(s.consumedAt)<=180000
  &&(!i||at(s.readAt)>at(samples[i-1].readAt)&&at(s.readAt)-at(samples[i-1].readAt)<=75000)
  &&IDS.every(id=>{const r=s.sources.find(r=>r.source===id);return r?.status==='ok'&&Number.isFinite(at(r.fetchedAt))&&at(s.readAt)-at(r.fetchedAt)>=-5000&&at(s.readAt)-at(r.fetchedAt)<=1200000;}));
 for(const s of samples){
  const d=s.dispatcher||{},run=runs[d.workflowRunId];
  if(!run||run.event!=='workflow_dispatch'||run.status!=='completed'||run.conclusion!=='success'||run.head_sha!==expected.collectorCommit||String(run.head_branch).replace(/^refs\/tags\//,'')!==expected.collectorRef)continue;
  const fetched=IDS.map(id=>at(s.sources.find(r=>r.source===id)?.fetchedAt));
  const ack=at(d.lastRequestAcceptedAt),runStart=at(run.run_started_at||run.created_at);
  if(!Number.isFinite(ack)||ack<start||!fetched.every(Number.isFinite)||Math.min(...fetched)<runStart-5000||at(s.consumedAt)<Math.max(...fetched)-5000)continue;
  if(!events.has(d.workflowRunId))events.set(d.workflowRunId,{workflowRunId:d.workflowRunId,requestAcceptedAt:d.lastRequestAcceptedAt,oldestFetchedAt:new Date(Math.min(...fetched)).toISOString(),consumedAt:s.consumedAt});
 }
 const renewals=[...events.values()].sort((a,b)=>at(a.oldestFetchedAt)-at(b.oldestFetchedAt));
 const spacedRenewals=renewals.some((a,i)=>renewals.slice(i+1).some(b=>at(b.oldestFetchedAt)-at(a.oldestFetchedAt)>=540000&&at(b.oldestFetchedAt)-start>=1080000));
 const windowPassed=samples.length>=3&&Number.isFinite(start)&&Number.isFinite(end)&&end-start>=1500000;
 return{passed:coveragePassed&&windowPassed&&spacedRenewals,coveragePassed,windowPassed,spacedRenewals,renewals,sampleCount:samples.length,observedSeconds:(end-start)/1000,
  scope:'PASSIVE_25_MINUTE_SOURCE_COVERAGE_AND_TWO_SPACED_AUTOMATIC_RENEWALS_NOT_PROFIT_OR_DEVICE_PROOF'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const config=JSON.parse(fs.readFileSync(new URL('./config.json',import.meta.url),'utf8'));
 const manifest=JSON.parse(fs.readFileSync(new URL('./release-manifest.json',import.meta.url),'utf8'));
 const pin=JSON.parse(fs.readFileSync('r5-collector-pin-evidence.json','utf8')),post=JSON.parse(fs.readFileSync('r5-postdeploy-evidence.json','utf8'));
 const scanner=process.env.SCANNER_TOKEN,cf=process.env.CLOUDFLARE_API_TOKEN,github=process.env.GITHUB_ACTIONS_DISPATCH_TOKEN;
 if(!scanner||!cf||!github)throw Error('CONTINUOUS_SOURCE_ACCEPTANCE_AUTHORIZATION_REQUIRED');
 const expected={build:manifest.build,collectorRef:pin.collectorRef,collectorCommit:pin.collectorCommit};
 const report={mode:'PASSIVE_STATUS_ONLY_NO_FOREGROUND_NEWS_OR_MANUAL_COLLECTOR',expected,samples:[],runs:{},errors:[],finalDeliveryAccepted:false};
 let began=Date.now();
 try{
  report.cloudflareBefore=await cloudflareSnapshot(fetch,config,cf);
  if(report.cloudflareBefore.deploymentId!==post.deploymentId)throw Error('DEPLOYMENT_CHANGED_BEFORE_RENEWAL_WINDOW');
  for(let offset=0;offset<=1500000;offset+=30000){
   await new Promise(r=>setTimeout(r,Math.max(0,began+offset-Date.now())));
   const status=await requestJson(fetch,config.origin+'/scanner/status',{authorization:'Bearer '+scanner});
   const receipts=status.diagnostics?.newsSourceReceipts||{},dispatch=status.diagnostics?.blsRelayDispatch||{};
   const s={readAt:new Date().toISOString(),build:status.build,identityMatched:status.backendIdentity?.matched===true&&status.backendIdentity?.stateOwnerBuild===manifest.build,
    stateReadSucceeded:status.diagnostics?.stateReadSucceeded===true,consumedAt:status.diagnostics?.newsConsumption?.consumedAt||null,
    sources:IDS.map(source=>({source,status:receipts[source]?.status==='ok'?'ok':'unavailable',fetchedAt:receipts[source]?.fetchedAt||null})),
    dispatcher:{configured:dispatch.configured===true,status:dispatch.status||null,collectorRef:dispatch.collectorRef||null,workflowRunId:dispatch.workflowRunId||null,lastRequestAcceptedAt:dispatch.lastRequestAcceptedAt||null}};
   report.samples.push(s);if(report.samples.length===1)began=Date.parse(s.readAt);
   const id=s.dispatcher.workflowRunId;
   if(Number.isSafeInteger(id)&&report.runs[id]?.status!=='completed'){
    const run=await requestJson(fetch,'https://api.github.com/repos/iwiiiuzZ/-crypto-alpha-api-v17-canary/actions/runs/'+id,{authorization:'Bearer '+github});
    report.runs[id]=Object.fromEntries(['id','event','status','conclusion','head_sha','head_branch','created_at','run_started_at'].map(k=>[k,run[k]??null]));
   }
   report.assessment=assessAutomaticBlsRenewals(report.samples,report.runs,expected);
   fs.writeFileSync('r5-bls-renewal-evidence.json',safeOutput(report,[scanner,cf,github]));
   console.log(JSON.stringify({readAt:s.readAt,samples:report.samples.length,automaticRenewals:report.assessment.renewals.length,coveragePassed:report.assessment.coveragePassed}));
   if(report.samples.length>=2&&!report.assessment.coveragePassed)throw Error('SOURCE_COVERAGE_OR_CONSUMPTION_GAP_IN_RENEWAL_WINDOW');
  }
  report.cloudflareAfter=await cloudflareSnapshot(fetch,config,cf);
  if(report.cloudflareAfter.deploymentId!==post.deploymentId||!report.cloudflareAfter.singleVersion||report.cloudflareAfter.binding?.namespaceFingerprint!=='aedfbcd14cd1')throw Error('DEPLOYMENT_OR_NAMESPACE_CHANGED_DURING_RENEWAL_WINDOW');
 }catch(e){report.errors.push(/^[A-Z0-9_]+$/.test(e.message)?e.message:'RENEWAL_OBSERVATION_FAILED');}
 report.passed=report.assessment?.passed===true&&!report.errors.length;
 fs.writeFileSync('r5-bls-renewal-evidence.json',safeOutput(report,[scanner,cf,github]));console.log(JSON.stringify({passed:report.passed,assessment:report.assessment,errors:report.errors}));
 if(!report.passed)process.exitCode=1;
}
