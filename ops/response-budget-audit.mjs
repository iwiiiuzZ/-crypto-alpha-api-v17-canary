import fs from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
const config=JSON.parse(fs.readFileSync(new URL('./config.json',import.meta.url),'utf8'));
let failed=false;
const size=v=>v===undefined?0:Buffer.byteLength(JSON.stringify(v));
for(let attempt=0;attempt<3;attempt++){
 if(attempt)await delay(17000);
 try{
  const response=await fetch(config.origin+'/',{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(40000)});
  const body=await response.json(),t=body.transportDiagnostics||{};
  const report={attempt,readAt:new Date().toISOString(),httpStatus:response.status,
   error:body.error?.code==='MARKET_RESPONSE_BUDGET_EXCEEDED'?'MARKET_RESPONSE_BUDGET_EXCEEDED':body.error?'OTHER_APPLICATION_ERROR':null,
   bytes:size(body),build:typeof body.build==='string'&&/^crypto-alpha-worker-v[0-9a-z.-]+$/.test(body.build)?body.build:null,referenceCount:t.references&&typeof t.references==='object'?Object.keys(t.references).length:0,transferredUtf8Bytes:Number.isFinite(t.transferredUtf8Bytes)?t.transferredUtf8Bytes:null,modelAssessmentsTransferredInFull:t.modelAssessmentsTransferredInFull===true,originalUtf8Bytes:Number.isFinite(t.originalUtf8Bytes)?t.originalUtf8Bytes:null,attemptedCompactedUtf8Bytes:Number.isFinite(t.attemptedCompactedUtf8Bytes)?t.attemptedCompactedUtf8Bytes:null,
   sections:Object.fromEntries(['analysisContract','newsContext','macroRisk','assets','coverage','execution','liquidityRisk','transportDiagnostics'].map(k=>[k,size(body[k])])),
   assets:Object.fromEntries(['ETHUSDT','BTCUSDT'].map(symbol=>[symbol,Object.fromEntries(['timeframes','opportunityEngine','liquidityRisk','dynamicContext','orderflow','multiVenueLiquidity','derivatives','courseAnalysis','tradeReadiness'].map(k=>[k,size(body.assets?.[symbol]?.[k])]))])),
   models:(body.assets?.ETHUSDT?.opportunityEngine?.models||[]).map((m,index)=>({index,bytes:size(m),candidateBytes:size(m.candidate),swingBytes:size(m.swingAssessment)})),
   scope:'RESPONSE_SIZE_ONLY_NO_PRICES_MESSAGES_IDENTIFIERS_OR_RAW_CONTENT'};
  failed ||= !response.ok||report.bytes>90000||report.models.length!==8||report.modelAssessmentsTransferredInFull!==true;
  console.log(JSON.stringify(report));
 }catch{failed=true;console.log(JSON.stringify({attempt,readAt:new Date().toISOString(),error:'AUDIT_REQUEST_FAILED'}));}
}

if(failed)process.exitCode=1;
