// Fallback transport only. GitHub Actions fetches original BLS URLs, never a proxy's content.
// No trading order, news interpretation or notification is initiated by this script.
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const BLS_FEEDS=Object.freeze([
 {id:'BLS_CPI',url:'https://www.bls.gov/feed/cpi.rss'},
 {id:'BLS_PPI',url:'https://www.bls.gov/feed/ppi.rss'},
 {id:'BLS_EMPLOYMENT',url:'https://www.bls.gov/feed/empsit.rss'},
 {id:'BLS_CALENDAR',url:'https://www.bls.gov/schedule/news_release/bls.ics'}
]);
export function validOfficialBlSResponse({url,text,contentType,source}){
 const u=new URL(url),correct=u.protocol==='https:'&&u.hostname==='www.bls.gov'&&u.username===''&&u.password==='';
 const isCalendar=source==='BLS_CALENDAR';
 return correct&&typeof text==='string'&&text.length>50&&text.length<=180000&&
    (isCalendar?/BEGIN:VCALENDAR/.test(text)&&/END:VCALENDAR/.test(text):/<(?:rss|feed|rdf:RDF)\b/i.test(text)&&/<(?:item|entry)\b/i.test(text));
}
export async function collectBlsSources(fetcher=fetch,now=Date.now){
 const sources=[],failures=[];
 for(const {id,url} of BLS_FEEDS){
  try{
   const r=await fetcher(url,{method:'GET',headers:{'User-Agent':'CryptoAlphaSourceHealth/1.0 (+read-only validation)',accept:id==='BLS_CALENDAR'?'text/calendar':'application/rss+xml, application/xml, text/xml;q=0.9'},redirect:'manual',signal:AbortSignal.timeout(16000)});
   if(!r.ok)throw new Error('UPSTREAM_HTTP_'+r.status);
   const body=await r.text();
   if(!validOfficialBlSResponse({url:r.url,text:body,source:id,contentType:r.headers?.get?.('content-type')}))throw new Error('OFFICIAL_FEED_FORMAT_OR_FINAL_HOST_INVALID');
   sources.push({id,sourceUrl:url,body,fetchedAt:new Date(now()).toISOString(),sha256:createHash('sha256').update(body,'utf8').digest('hex')});
  }catch(e){failures.push({id,reason:/^(UPSTREAM_HTTP_\d{3}|OFFICIAL_FEED_FORMAT_OR_FINAL_HOST_INVALID)$/.test(e.message)?e.message:'SOURCE_UNAVAILABLE_OR_INVALID'});}
 }
 return {sources,failures};
}
export async function deliverBlsSources(fetcher,origin,token,data){
 if(!token||!/^https:\/\/[A-Za-z0-9.-]+$/.test(origin))throw new Error('RELAY_AUTH_OR_ORIGIN_MISSING');
 if(!data.sources.length)return {delivered:false,reason:'NO_VALID_OFFICIAL_SOURCES',sources:0};
 const r=await fetcher(origin+'/scanner/official-macro-relay',{
  method:'POST',redirect:'error',headers:{authorization:'Bearer '+token,'content-type':'application/json'},
  body:JSON.stringify({sources:data.sources}),
  signal:AbortSignal.timeout(30000)});
 if(!r.ok)throw new Error('RELAY_TARGET_HTTP_'+r.status);
 const json=await r.json();
 if(json.status!=='OFFICIAL_BLS_RELAY_ACCEPTED'||!Array.isArray(json.accepted)||json.accepted.length!==data.sources.length)throw new Error('RELAY_ACCEPTANCE_NOT_CONFIRMED');
 return {delivered:true,accepted:json.accepted,failures:data.failures};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const target=process.env.CRYPTO_ALPHA_WORKER_ORIGIN,token=process.env.SCANNER_TOKEN;
 if(!target||!token)throw new Error('RELAY_ENV_MISSING');
 // Do not post to an old R4: a cron running before R5 deployment is harmless.
 const health=await fetch(target+'/health',{signal:AbortSignal.timeout(12000)});
 const current=await health.json();
 if(current.build!=='crypto-alpha-worker-v27.6.3-macro-r5'){
  console.log(JSON.stringify({status:'SKIPPED_R5_NOT_DEPLOYED',currentBuild:current.build||'unknown'}));process.exit(0);
 }
 const data=await collectBlsSources();
 const result=await deliverBlsSources(fetch,target,token,data);
 console.log(JSON.stringify({status:result.delivered?'OFFICIAL_BLS_RELAY_INGESTED':'OFFICIAL_BLS_RELAY_UNAVAILABLE',accepted:result.accepted||[],fetchFailures:data.failures}));
 if(!result.delivered||data.failures.length)process.exitCode=1;
}
