// Isolated source access diagnostic. No production writes, proxies or browser impersonation.
import {setTimeout as delay} from 'node:timers/promises';
const ua='CryptoAlphaMonitor/27.6 (+https://github.com/iwiiiuzZ/-crypto-alpha-api-v17-canary/issues)';
const sources=[['BLS_CPI','https://www.bls.gov/feed/cpi.rss'],['BLS_EMPLOYMENT','https://www.bls.gov/feed/empsit.rss'],['BLS_CALENDAR','https://www.bls.gov/schedule/news_release/bls.ics']];
for(const [source,url] of sources){
 const at=new Date().toISOString();
 try{
  const r=await fetch(url,{headers:{'user-agent':ua,accept:'application/rss+xml, application/xml, text/calendar'},redirect:'manual',signal:AbortSignal.timeout(10000)});
  let bytes=0,text='';
  if(r.ok){const reader=r.body.getReader(),decoder=new TextDecoder();try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>600000)throw Error('TOO_LARGE');text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}finally{await reader.cancel().catch(()=>{});}}
  else await r.body?.cancel();
  console.log(JSON.stringify({source,at,httpStatus:r.status,bytes,expectedContainer:r.ok&&(source==='BLS_CALENDAR'?text.includes('BEGIN:VCALENDAR'):/<(rss|feed)\b/i.test(text)),identifiedClient:true,scope:'GITHUB_RUNNER_NOT_PRODUCTION_WORKER',productionRecoveryVerified:false}));
 }catch{console.log(JSON.stringify({source,at,error:'ACCESS_DIAGNOSTIC_FAILED',productionRecoveryVerified:false}));}
 await delay(2000);
}
