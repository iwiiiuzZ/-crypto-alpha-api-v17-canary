import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {requestJson,summarizeSample,assessSamples,cloudflareSnapshot,safeOutput,OpsError} from './diagnostics.mjs';
export function assessSoak(samples,expected,before,after,requiredMs=600000){
 const result=assessSamples(samples,expected);
 const time=v=>Date.parse(v),end=time(samples.at(-1)?.readAt),start=time(samples[0]?.readAt);
 const fresh=(v,now)=>Number.isFinite(time(v))&&now-time(v)>=-5000&&now-time(v)<=180000;
 const progresses=(select,maxIdleMs=110000)=>{
  if(!samples.length)return false;
  const stamps=samples.map(select).map(time);
  return stamps.every((stamp,i)=>Number.isFinite(stamp)&&stamp<=time(samples[i].readAt)+5000&&time(samples[i].readAt)-stamp<=maxIdleMs&&(!i||stamp>=stamps[i-1]))&&stamps.at(-1)>stamps[0];
 };
 const latestReceipt=s=>s.receipts.filter(r=>r.producerBuild===expected.build&&r.inspectedModels===8&&r.modelDataReady&&r.status==='completed').sort((a,b)=>time(b.completedAt)-time(a.completedAt))[0]?.completedAt;
 const gates={...result.gates,
  heartbeatProgresses:progresses(s=>s.scanner.lastSuccessfulCycleAt),
  modelReviewProgresses:progresses(latestReceipt),
  fullDuration:samples.length>=36&&end-start>=requiredMs,
  noReadGap:samples.every((s,i)=>!i||time(s.readAt)-time(samples[i-1].readAt)<=35000),
  allMinuteHeartbeats:samples.every(s=>s.scanner.stateReadSucceeded&&s.scanner.identityMatched&&s.scanner.producerBuild===expected.build&&['completed','running'].includes(s.scanner.status)&&fresh(s.scanner.lastSuccessfulCycleAt,time(s.readAt))),
  allModelReceipts:samples.every(s=>s.receipts.some(r=>r.producerBuild===expected.build&&r.inspectedModels===8&&r.modelDataReady&&r.status==='completed'&&fresh(r.completedAt,time(s.readAt)))),
  deploymentUnchanged:!!before?.deploymentId&&before.deploymentId===after?.deploymentId&&before.singleVersion===true&&after.singleVersion===true,
  namespacePreserved:before?.bindingMatches===true&&after?.bindingMatches===true&&before.binding?.namespaceFingerprint==='aedfbcd14cd1'&&after.binding?.namespaceFingerprint==='aedfbcd14cd1'};
 return {gates,passed:Object.values(gates).every(Boolean),failedGates:Object.keys(gates).filter(k=>!gates[k]),sampleCount:samples.length,observedSeconds:(end-start)/1000,
  scope:'TEN_MINUTE_SAMPLED_PRODUCTION_WINDOW_NOT_LONG_TERM_OR_PROFITABILITY_PROOF'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const config=JSON.parse(fs.readFileSync(new URL('./config.json',import.meta.url),'utf8'));
 const source=fs.readFileSync(new URL('../main-v188.js',import.meta.url),'utf8');
 const expected={...config,build:source.match(/const BUILD\s*=\s*"([^"]+)"/)[1]};
 const token=process.env.CLOUDFLARE_API_TOKEN,scanner=process.env.SCANNER_TOKEN;
 if(!token||!scanner)throw Error('MISSING_REQUIRED_CREDENTIAL');
 const samples=[],errors=[];let before,after;
 try{
  before=await cloudflareSnapshot(fetch,config,token);
  let start=Date.now();
  for(let i=0;i<=36;i++){
   await delay(Math.max(0,start+i*17000-Date.now()));
   const [fast,status]=await Promise.all([requestJson(fetch,config.origin+'/?view=fast'),requestJson(fetch,config.origin+'/scanner/status',{authorization:'Bearer '+scanner})]);
   const sample=summarizeSample(fast,status);samples.push(sample);if(!i)start=Date.parse(sample.readAt);
   // Emit safe progress immediately so interrupted runs retain failure evidence.
   console.log(safeOutput({sample:i,readAt:sample.readAt,health:sample.health,failures:sample.failures,scanner:sample.scanner,receipts:sample.receipts},[token,scanner]));
  }
  after=await cloudflareSnapshot(fetch,config,token);
 }catch(e){errors.push(e instanceof OpsError?e.code:'SOAK_READ_FAILED');}
 const assessment=assessSoak(samples,expected,before,after);
 console.log(safeOutput({result:'SOAK_COMPLETE',expectedBuild:expected.build,assessment,before,after,errors,deviceReceiptVerified:false,preparedNotificationLiveVerified:false},[token,scanner]));
 if(errors.length||!assessment.passed)process.exitCode=1;
}
