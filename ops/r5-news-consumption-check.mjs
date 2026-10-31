import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {requestJson,summarizeReadContext,observeNewsConsumption,compareNewsBatches,summarizeSample} from './diagnostics.mjs';
import {R5_BUILD} from './r5-preflight.mjs';

export function summarizeR5NewsAudit(result,context,{requireBls=false}={}){
 const rows=context?.newsSources||[];
 const successful=rows.filter(r=>r.status==='ok'&&Number.isFinite(Date.parse(r.fetchedAt)));
 const unavailable=rows.filter(r=>r.status!=='ok');
 const latest=result?.observations?.at(-1)||{};
 const requiredBls=['BLS_CPI','BLS_PPI','BLS_EMPLOYMENT','BLS_CALENDAR'];
 const blsVerified=requiredBls.every(id=>successful.some(r=>r.source===id&&r.sourceProvenance==='AUTHORIZED_GITHUB_ACTIONS_BLS_RELAY_DELAYED')&&(latest.comparisons||[]).some(r=>r.source===id&&(r.verified||r.newerSuccessfulBatchConsumed)));
 return {passed:result?.passed===true&&successful.length>=5&&(!requireBls||blsVerified),
   requireBls,allFourBlsActuallyConsumed:blsVerified,
   successfulSourceCount:successful.length,unavailableSources:unavailable.map(x=>({
     source:x.source,status:x.status,httpStatus:x.httpStatus,fetchedAt:x.fetchedAt,cacheState:x.cacheState
   })),expectedSuccessfulSources:successful.map(x=>x.source),
   verifiedSources:(latest.comparisons||[]).filter(x=>x.verified||x.newerSuccessfulBatchConsumed).map(x=>x.source),
   expectedSourceDetailsReturned:(latest.comparisons||[]).filter(x=>x.meaning!=='SOURCE_DETAILS_NOT_RETURNED').map(x=>x.source),
   newsConsumerAdvanced:result?.observations?.some(x=>x.newsConsumedAt),
   scope:'PRODUCTION_READ_ONLY_SOURCE_BATCH_RECONCILIATION_NOT_DEVICE_DELIVERY'};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const config=JSON.parse(fs.readFileSync(new URL('./config.json',import.meta.url),'utf8'));
 const token=process.env.SCANNER_TOKEN;
 if(!token)throw Error('SCANNER_TOKEN_REQUIRED');
 let news=await requestJson(fetch,config.origin+'/?view=news');
 const requireBls=process.env.REQUIRE_BLS_RELAY==='1';
 if(requireBls){
  for(let i=0;i<3;i++){
   if(['BLS_CPI','BLS_PPI','BLS_EMPLOYMENT','BLS_CALENDAR'].every(id=>news?.newsContext?.sources?.[id]?.status==='ok'&&news.newsContext.sources[id].sourceProvenance==='AUTHORIZED_GITHUB_ACTIONS_BLS_RELAY_DELAYED'))break;
   await new Promise(r=>setTimeout(r,15000));news=await requestJson(fetch,config.origin+'/?view=news');
  }
 }
 const context=summarizeReadContext(null,news);
 const result=await observeNewsConsumption(
  ()=>requestJson(fetch,config.origin+'/scanner/status',{authorization:'Bearer '+token}),context,R5_BUILD);
 const evidence=summarizeR5NewsAudit(result,context,{requireBls});
 fs.writeFileSync('r5-news-consumption-evidence.json',JSON.stringify(evidence,null,2));
 console.log(JSON.stringify(evidence));
 if(!evidence.passed)process.exitCode=1;
}
