import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {requestJson,summarizeReadContext,observeNewsConsumption,compareNewsBatches,summarizeSample} from './diagnostics.mjs';
import {R5_BUILD} from './r5-preflight.mjs';

export function summarizeR5NewsAudit(result,context){
 const rows=context?.newsSources||[];
 const successful=rows.filter(r=>r.status==='ok'&&Number.isFinite(Date.parse(r.fetchedAt)));
 const unavailable=rows.filter(r=>r.status!=='ok');
 const latest=result?.observations?.at(-1)||{};
 return {passed:result?.passed===true&&successful.length>=5,
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
 const news=await requestJson(fetch,config.origin+'/?view=news');
 const context=summarizeReadContext(null,news);
 const result=await observeNewsConsumption(
  ()=>requestJson(fetch,config.origin+'/scanner/status',{authorization:'Bearer '+token}),context,R5_BUILD);
 const evidence=summarizeR5NewsAudit(result,context);
 fs.writeFileSync('r5-news-consumption-evidence.json',JSON.stringify(evidence,null,2));
 console.log(JSON.stringify(evidence));
 if(!evidence.passed)process.exitCode=1;
}
