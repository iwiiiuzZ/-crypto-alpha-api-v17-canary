// One GET per documented official endpoint. No credentials, plans, or pushes.
import fs from 'node:fs';
const rows=[];
for(const endpoint of ['books','books-full']){
 const url='https://www.okx.com/api/v5/market/'+endpoint+'?instId=ETH-USDT-SWAP&sz=400';
 try{
  const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(10000)});
  const body=await response.json(),book=body?.data?.[0];
  const age=(Date.now()-Number(book?.ts))/1000;
  const valid=response.ok&&body.code==='0'&&Number.isFinite(age)&&age>=-2&&age<=10
    &&Number(book.bids?.[0]?.[0])>0&&Number(book.asks?.[0]?.[0])>0
    &&Number(book.bids[0][0])<=Number(book.asks[0][0]);
  rows.push({endpoint:'OKX_'+endpoint.toUpperCase().replace('-','_'),httpStatus:response.status,
   exchangeCode:body?.code??null,exchangeTimestamp:book?.ts?new Date(Number(book.ts)).toISOString():null,
   dataAgeSeconds:Number.isFinite(age)?age:null,bidLevels:book?.bids?.length??0,askLevels:book?.asks?.length??0,
   columns:book?.bids?.[0]?.length??0,valid});
 }catch{rows.push({endpoint:'OKX_'+endpoint.toUpperCase().replace('-','_'),valid:false,error:'UNAVAILABLE_OR_INVALID'});}
}
const evidence={scope:'GITHUB_RUNNER_OFFICIAL_FEED_PROBE_NOT_CLOUDFLARE_RUNTIME_PROOF',observedAt:new Date().toISOString(),rows,passed:rows.every(r=>r.valid)};
fs.writeFileSync('official-book-live-probe.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
if(!evidence.passed)process.exitCode=1;
