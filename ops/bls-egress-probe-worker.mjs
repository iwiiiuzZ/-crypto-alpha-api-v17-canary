// Temporary stateless diagnostic only. Never part of the production Worker.
const feeds=[
 ['BLS_CPI','https://www.bls.gov/feed/cpi.rss'],
 ['BLS_PPI','https://www.bls.gov/feed/ppi.rss'],
 ['BLS_EMPLOYMENT','https://www.bls.gov/feed/empsit.rss'],
 ['BLS_CALENDAR','https://www.bls.gov/schedule/news_release/bls.ics']
];
async function check(source,url,identified){
 const started=Date.now();
 const headers={accept:source==='BLS_CALENDAR'?'text/calendar':'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9'};
 if(identified)headers['User-Agent']='CryptoAlphaSourceHealth/1.0 (+read-only validation)';
 try{
  const r=await fetch(url,{headers,redirect:'manual',signal:AbortSignal.timeout(6000)});
  const type=(r.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
  if(!r.ok){await r.body?.cancel();return{source,identified,httpStatus:r.status,contentType:type,valid:false,elapsedMs:Date.now()-started};}
  const reader=r.body.getReader(),chunks=[];let bytes=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>180000)throw Error('BODY_TOO_LARGE');chunks.push(value);}}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  const body=new Uint8Array(bytes);let offset=0;for(const c of chunks){body.set(c,offset);offset+=c.length;}
  const text=new TextDecoder().decode(body),calendar=source==='BLS_CALENDAR';
  const typeValid=calendar?['text/calendar','application/ics'].includes(type):['application/rss+xml','application/atom+xml','application/xml','text/xml'].includes(type);
  const count=calendar?[...text.matchAll(/BEGIN:VEVENT/g)].length:[...text.matchAll(/<(?:item|entry)\b/gi)].length;
  const valid=typeValid&&count>0&&(calendar?/BEGIN:VCALENDAR[\s\S]*END:VCALENDAR/.test(text):/<(?:rss|feed|rdf:RDF)\b/i.test(text));
  const sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',body))].map(x=>x.toString(16).padStart(2,'0')).join('');
  return{source,identified,httpStatus:r.status,contentType:type,valid,recordCount:count,bytes,sha256,elapsedMs:Date.now()-started};
 }catch{return{source,identified,httpStatus:null,valid:false,reason:'SOURCE_REQUEST_OR_FORMAT_FAILED',elapsedMs:Date.now()-started};}
}
export default{async fetch(request,env){
 if(request.method!=='POST'||request.headers.get('x-probe-token')!==env.PROBE_TOKEN)return new Response(null,{status:401});
 const control=await check(feeds[0][0],feeds[0][1],false),identified=[];
 for(const [source,url] of feeds)identified.push(await check(source,url,true));
 return Response.json({scope:'ISOLATED_CLOUDFLARE_EGRESS_OFFICIAL_URLS_NOT_PRODUCTION_OR_TRADING',observedAt:new Date().toISOString(),control,identified,identifiedAllValid:identified.every(x=>x.valid)},{headers:{'cache-control':'no-store'}});
}};
