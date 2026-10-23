// Read a bounded historical window; never publish raw telemetry, URLs or messages.
// API: https://developers.cloudflare.com/api/resources/workers/subresources/observability/subresources/telemetry/methods/query/
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
const known=['MARKET_RESPONSE_BUDGET_EXCEEDED','MARKET_RESPONSE_DEADLINE','MARKET_SNAPSHOT_FAILED','NEWS_CACHE_READ_FAILED','PUBLIC_MARKET_COORDINATOR_FAILED'];
export function projectHistory(result,worker){
 const rows=result?.events?.events||[],matched=rows.filter(x=>x.$metadata?.service===worker);
 const events=matched.map(e=>{
  const m=e.$metadata||{},w=e.$workers||{},raw=JSON.stringify(e),codes=known.filter(c=>raw.includes(c));
  if(/Subrequest depth limit exceeded/i.test(raw))codes.push('SUBREQUEST_DEPTH_LIMIT');
  if(/Too many subrequests/i.test(raw))codes.push('SUBREQUEST_COUNT_LIMIT');
  if(/exceeded.*CPU|CPU.*limit/i.test(raw))codes.push('CPU_LIMIT');
  if(/exceeded.*memory|memory.*limit/i.test(raw))codes.push('MEMORY_LIMIT');
  for(const [pattern,code] of [[/Cannot perform I\/O on behalf of a different request/i,'CROSS_REQUEST_IO'],[/code had hung|never generate a response|promise will never complete/i,'RUNTIME_HUNG_REQUEST'],[/canceled|cancelled/i,'CANCELLATION'],[/network connection lost/i,'NETWORK_CONNECTION_LOST'],[/exceeded.*subrequest|subrequest.*limit/i,'SUBREQUEST_LIMIT'],[/Too many requests|rate limit|50011/i,'UPSTREAM_RATE_LIMIT']])if(pattern.test(raw))codes.push(code);
  const status=m.statusCode??w.event?.response?.status,duration=m.duration??w.wallTimeMs;
  const words=['promise','context','execution','canceled','cancelled','memory','quota','budget','internal','network','fetch','socket','disconnect','timeout','storage','durable','object','reset','exception','body','limit','invalid','hung','response','request'].filter(x=>new RegExp('\\b'+x+'\\b','i').test(String(m.error||'')));
  let endpoint='OTHER';try{const u=new URL(m.url||w.event?.request?.url);if(u.pathname==='/')endpoint=u.searchParams.get('view')==='news'?'NEWS':u.searchParams.get('view')==='fast'?'FAST':'MARKET';else if(u.pathname==='/scanner/status')endpoint='STATUS';}catch{}
  const timestamp=Number.isFinite(e.timestamp)?new Date(e.timestamp).toISOString():null;
  return {timestamp,endpoint,httpStatus:Number.isInteger(status)?status:null,durationMs:Number.isFinite(duration)?duration:null,eventType:['fetch','scheduled','alarm','rpc','jsrpc'].includes(w.eventType)?w.eventType:null,outcome:['ok','exception','canceled','exceededCpu','exceededMemory'].includes(w.outcome)?w.outcome:null,errorPresent:Boolean(m.error),errorVocabulary:words,knownErrorCodes:codes};
 });
 return {returnedRows:rows.length,matchedRows:matched.length,totalReported:Number.isFinite(result?.events?.count)?result.events.count:null,events,coverage:'BOUNDED_RETAINED_LOGS_NOT_FULL_HISTORY',absenceOfErrorDoesNotProveSuccess:true};
}
export async function runHistory(fetcher,config,token){
 if(!token)throw Error('MISSING_TOKEN');
 const timeframe={from:Date.parse('2026-10-23T02:16:30Z'),to:Date.parse('2026-10-23T02:18:30Z')};
 const base='https://api.cloudflare.com/client/v4/accounts/'+config.accountId+'/workers/observability/telemetry/';
 const post=async(path,body)=>{
  const r=await fetcher(base+path,{method:'POST',redirect:'error',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw Error('TELEMETRY_HTTP_'+r.status);
  const text=await r.text();if(text.length>4*1024*1024)throw Error('TELEMETRY_RESPONSE_TOO_LARGE');
  let j;try{j=JSON.parse(text);}catch{throw Error('TELEMETRY_INVALID_JSON');}
  if(j.success!==true)throw Error('TELEMETRY_API_REJECTED');return j.result;
 };
 const keys=await post('keys',{...timeframe,keyNeedle:{value:'$metadata.service',matchCase:false},limit:50});
 // Only the documented script-name field is eligible; no arbitrary account-wide event query.
 const available=Array.isArray(keys)?keys:keys?.keys||[];
 if(!available.some(k=>k.key==='$metadata.service'&&k.type==='string'))return {timeframe,status:'SERVICE_FIELD_NOT_AVAILABLE',availableKeyCount:available.length};
 const result=await post('query',{queryId:'crypto-alpha-503-audit-20261023',timeframe,view:'events',limit:1000,parameters:{filterCombination:'and',filters:[{key:'$metadata.service',operation:'eq',type:'string',value:config.worker}]}});
 return {timeframe,status:'HISTORICAL_QUERY_COMPLETED',...projectHistory(result,config.worker)};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const config=JSON.parse(fs.readFileSync(new URL('./config.json',import.meta.url),'utf8'));
 try{console.log(JSON.stringify(await runHistory(fetch,config,process.env.CLOUDFLARE_API_TOKEN),null,2));}
 catch(e){const code=/^(MISSING_TOKEN|TELEMETRY_HTTP_\d{3}|TELEMETRY_RESPONSE_TOO_LARGE|TELEMETRY_INVALID_JSON|TELEMETRY_API_REJECTED)$/.test(e.message)?e.message:'TELEMETRY_REQUEST_FAILED';console.log(JSON.stringify({status:'UNVERIFIED',code}));process.exitCode=1;}
}
