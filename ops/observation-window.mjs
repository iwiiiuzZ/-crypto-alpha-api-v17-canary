import {setTimeout as delay} from 'node:timers/promises';
import {requestJson, summarizeSample, assessNewsReceiptCoverage, OpsError} from './diagnostics.mjs';

// Keep each read's evidence. A failed endpoint must not erase the other one,
// and later recovery must not turn an interrupted window into a green audit.
export async function collectObservationWindow({fetcher, origin, scanner, now=Date.now, wait=delay}) {
  const attempts=[], samples=[], errors=[];
  let began=now();
  for (const [index, offset] of [0,25000,85000].entries()) {
    await wait(Math.max(0,began+offset-now()));
    const startedAt=new Date(now()).toISOString();
    const results=await Promise.allSettled([
      requestJson(fetcher,origin+'/?view=fast'),
      requestJson(fetcher,origin+'/scanner/status',{authorization:'Bearer '+scanner})
    ]);
    const evidence=summarizeSample(results[0].value,results[1].value,now());
    const endpoints=results.map((r,i)=> {
      const endpoint=i===0?'fast':'scanner-status';
      if(r.status==='fulfilled') return {endpoint,status:'ok'};
      const error={stage:'sample',attempt:index+1,endpoint,
        code:r.reason instanceof OpsError?r.reason.code:'INTERNAL_DIAGNOSTIC_ERROR'};
      errors.push(error);
      return {endpoint,status:'error',code:error.code};
    });
    const complete=results.every(r=>r.status==='fulfilled');
    attempts.push({attempt:index+1,startedAt,completedAt:evidence.readAt,complete,endpoints,
      // These are sanitized summaries, never raw payloads or HTTP headers.
      partialEvidence:complete?null:evidence,
      newsCoverage:results[1].status==='fulfilled'?assessNewsReceiptCoverage(evidence):{
        passed:false,assessed:false,reason:'SCANNER_STATUS_UNAVAILABLE',rows:[]
      }});
    if(complete) samples.push(evidence);
    // Anchor later reads to the first attempt, even if that attempt failed.
    if(index===0) began=Date.parse(evidence.readAt);
  }
  return {attempts,samples,errors};
}
