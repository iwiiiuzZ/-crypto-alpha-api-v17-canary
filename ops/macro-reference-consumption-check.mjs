import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {requestJson} from './diagnostics.mjs';
import {R5_BUILD} from './r5-preflight.mjs';
export function reconcileMacroReferences(context,status,{now=Date.now(),build=R5_BUILD}={}){
 const expected=['US_INITIAL_CLAIMS','US_CONTINUED_CLAIMS','IBIT_HOLDINGS','ETHA_HOLDINGS','OKX_ETH_OPTIONS','OKX_BTC_OPTIONS'];
 const receipt=status?.diagnostics?.macroReferenceReceipts;
 const rows=expected.map(id=>{
  const source=context?.sources?.find(x=>x.id===id),consumed=receipt?.sources?.find(x=>x.source===id);
  const fetched=Date.parse(source?.fetchedAt),at=Date.parse(consumed?.fetchedAt),consumerAt=Date.parse(receipt?.consumedAt);
  const maxAge=id.includes('OPTIONS')?180000:source?.transport==='AUTHENTICATED_GITHUB_OFFICIAL_REFERENCE_RELAY'?1200000:43200000;
  const fresh=Number.isFinite(fetched)&&now-fetched>=-5000&&now-fetched<=maxAge;
  const passed=source?.status==='ok'&&fresh&&consumed?.status==='ok'&&Number.isFinite(at)&&at>=fetched&&Number.isFinite(consumerAt)&&consumerAt>=at&&now-consumerAt>=-5000&&now-consumerAt<=180000&&consumed?.transport===source?.transport;
  return {source:id,passed,fetchedAt:source?.fetchedAt||null,consumedFetchedAt:consumed?.fetchedAt||null,status:source?.status||'missing',transport:source?.transport||null,directHttpStatus:source?.directHttpStatus??null,dataAsOf:source?.data?.asOf||source?.data?.weekEnding||null};
 });
 const identity=status?.backendIdentity;
 const matched=identity?.matched===true&&identity?.frontendBuild===build&&identity?.stateOwnerBuild===build;
 return{passed:matched&&rows.every(r=>r.passed),matched,build,generatedAt:new Date(now).toISOString(),consumedAt:receipt?.consumedAt||null,sources:rows,dxy:context?.dxy||null,scope:'ACTUAL_CACHED_REFERENCE_BATCH_CONSUMPTION_NOT_PROFIT_OR_NEW_TRADE_SIGNAL'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const {origin}=JSON.parse(fs.readFileSync(new URL('./config.json',import.meta.url),'utf8'));
 const token=process.env.SCANNER_TOKEN;if(!token)throw Error('SCANNER_TOKEN_REQUIRED');
 const observations=[];let evidence;
 // Passive reads only: no forced scan, plan mutation, test push or trade.
 for(let i=0;i<13;i++){
  const news=await requestJson(fetch,origin+'/?view=news');
  const status=await requestJson(fetch,origin+'/scanner/status',{authorization:'Bearer '+token});
  evidence=reconcileMacroReferences(news?.newsContext?.macroReferences,status);observations.push(evidence);
  if(evidence.passed)break;
  if(i<12)await new Promise(r=>setTimeout(r,15000));
 }
 fs.writeFileSync('r5-macro-reference-consumption-evidence.json',JSON.stringify({passed:evidence?.passed,observations},null,2));
 console.log(JSON.stringify(evidence));if(!evidence?.passed)process.exitCode=1;
}
