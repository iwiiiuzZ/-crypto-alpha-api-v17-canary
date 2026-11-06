import {collectMacroReferences,MACRO_REFERENCE_SOURCES,parseClaimsHtml} from './macro-reference.mjs';
export const MACRO_REFERENCE_KEY='macro:reference-cache:v1';
export const MACRO_REFERENCE_REVISION='27.6.3-macro-reference-h1';
export const CLAIMS_REFERENCE_RELAY_KEY='macro:claims-official-relay:v1';
const CLAIMS_RELAY_MAX_AGE_MS=1200000;
const policy=s=>s.type==='option'?{refreshMs:60000,maxAgeMs:180000}:{refreshMs:21600000,maxAgeMs:43200000};
function age(stamp,now){const n=Date.parse(stamp);return Number.isFinite(n)?now-n:Infinity;}
export function summarizeMacroReferences(saved,now=Date.now()){
 const rows=MACRO_REFERENCE_SOURCES.map(s=>{
  const r=saved?.records?.[s.id],fresh=r?.revision===MACRO_REFERENCE_REVISION&&r.status==='ok'&&age(r.fetchedAt,now)>=-5000&&age(r.fetchedAt,now)<=(r?.transport==='AUTHENTICATED_GITHUB_OFFICIAL_REFERENCE_RELAY'?CLAIMS_RELAY_MAX_AGE_MS:policy(s).maxAgeMs);
  return{id:s.id,status:fresh?'ok':'unavailable',reason:fresh?null:r?.error||(r?.fetchedAt?'REFERENCE_TRANSPORT_STALE':'REFERENCE_CACHE_WARMING'),
   fetchedAt:r?.fetchedAt||null,lastAttemptAt:r?.lastAttemptAt||null,lastSuccessAt:r?.lastSuccessAt||null,nextAttemptAt:r?.nextAttemptAt?new Date(r.nextAttemptAt).toISOString():null,httpStatus:r?.httpStatus??null,
   revision:r?.revision||null,transport:r?.transport||'DIRECT',directHttpStatus:r?.directHttpStatus??null,data:fresh?r.data:null};
 });
 return{revision:MACRO_REFERENCE_REVISION,checkedAt:new Date(now).toISOString(),sourceCount:6,availableCount:rows.filter(r=>r.status==='ok').length,sources:rows,dxy:{status:'NO_AUTHORIZED_REALTIME_SOURCE_CONNECTED'},
  scope:'REFERENCE_CONTEXT_NOT_NEW_TRADE_OR_NOTIFICATION_GATE',allMarketCoverage:false,latestEconomicPublicationVerified:false,tradeDirection:null,openNowAllowed:false};
}
export function macroReferenceReceipts(summary,consumedAt){
 return{revision:summary?.revision||MACRO_REFERENCE_REVISION,consumedAt,sources:(summary?.sources||[]).map(r=>({source:r.id,status:r.status,fetchedAt:r.fetchedAt,dataAsOf:r.data?.asOf||r.data?.weekEnding||null,reason:r.reason||null,transport:r.transport||'DIRECT',directHttpStatus:r.directHttpStatus??null})),scope:'SCANNER_CONSUMED_REFERENCE_CONTEXT_NOT_ECONOMIC_EVENT_CONFIRMATION'};
}
export async function refreshMacroReferenceCache(owner,{fetcher=fetch,now=Date.now,collect=collectMacroReferences}={}){
 if(owner.macroReferenceWork)return owner.macroReferenceWork;
 const task=(async()=>{
  const storage=owner.ctx.storage,began=now(),saved=await storage.get(MACRO_REFERENCE_KEY)||{records:{}};
  const envelope=await storage.get(CLAIMS_REFERENCE_RELAY_KEY);
  const relay=envelope?.expiresAt>began?envelope.value:null;
  let relayChanged=false;
  for(const spec of MACRO_REFERENCE_SOURCES.filter(s=>s.type==='claims')){
   const r=relay?.records?.[spec.id],old=saved.records?.[spec.id];
   if(r&&age(r.fetchedAt,began)>=-5000&&age(r.fetchedAt,began)<=CLAIMS_RELAY_MAX_AGE_MS&&(!old?.fetchedAt||Date.parse(r.fetchedAt)>Date.parse(old.fetchedAt))){
    saved.records[spec.id]={id:spec.id,status:'ok',revision:MACRO_REFERENCE_REVISION,fetchedAt:r.fetchedAt,lastSuccessAt:r.fetchedAt,lastAttemptAt:old?.lastAttemptAt||r.fetchedAt,nextAttemptAt:old?.nextAttemptAt||0,
     transport:'AUTHENTICATED_GITHUB_OFFICIAL_REFERENCE_RELAY',directHttpStatus:old?.directHttpStatus??old?.httpStatus??null,httpStatus:200,data:parseClaimsHtml(r.body,{series:spec.series,now:began})};relayChanged=true;
   }
  }
  if(relayChanged)await storage.put(MACRO_REFERENCE_KEY,saved);
  if(saved.leaseUntil>began)return summarizeMacroReferences(saved,began);
  const due=MACRO_REFERENCE_SOURCES.filter(s=>{const r=saved.records?.[s.id];return !r||r.revision!==MACRO_REFERENCE_REVISION||(!(r.nextAttemptAt>began)&&(r.status!=='ok'||(r.transport==='AUTHENTICATED_GITHUB_OFFICIAL_REFERENCE_RELAY'&&age(r.fetchedAt,began)>CLAIMS_RELAY_MAX_AGE_MS)||age(r.lastAttemptAt,began)>=policy(s).refreshMs));});
  if(!due.length)return summarizeMacroReferences(saved,began);
  // A bounded restart lease avoids duplicate transports after an interrupted owner.
  const state={...saved,records:{...saved.records},leaseUntil:began+60000};await storage.put(MACRO_REFERENCE_KEY,state);
  let index=0;
  await Promise.all([0,1].map(async()=>{while(index<due.length){
   const spec=due[index++],old=state.records[spec.id],attemptAt=new Date(now()).toISOString();let r;
   try{const result=await collect({fetcher,now,selectedIds:[spec.id]});r=result.sources?.find(x=>x.id===spec.id);if(!r)throw Error('REFERENCE_RESULT_MISSING');}
   catch{r={status:'unavailable',error:'REFERENCE_COLLECTION_FAILED'};}
   if(r.status==='ok')state.records[spec.id]={...r,revision:MACRO_REFERENCE_REVISION,lastAttemptAt:attemptAt,lastSuccessAt:r.fetchedAt,failureCount:0,nextAttemptAt:0};
   else if(old?.transport==='AUTHENTICATED_GITHUB_OFFICIAL_REFERENCE_RELAY'&&age(old.fetchedAt,now())<=CLAIMS_RELAY_MAX_AGE_MS){state.records[spec.id]={...old,directHttpStatus:r.httpStatus??null,lastAttemptAt:attemptAt,nextAttemptAt:now()+120000};}
   else{const failures=(old?.failureCount||0)+1,backoff=Math.max(r.retryAfterSeconds?Math.min(86400000,r.retryAfterSeconds*1000):0,r.httpStatus===401||r.httpStatus===403?3600000:r.httpStatus===429?600000:Math.min(900000,60000*2**Math.min(failures,4)));
    state.records[spec.id]={...old,status:'unavailable',error:r.error||'REFERENCE_COLLECTION_FAILED',httpStatus:r.httpStatus??null,revision:MACRO_REFERENCE_REVISION,lastAttemptAt:attemptAt,failureCount:failures,nextAttemptAt:now()+backoff};}
  }}));
  state.leaseUntil=0;state.updatedAt=new Date(now()).toISOString();await storage.put(MACRO_REFERENCE_KEY,state);return summarizeMacroReferences(state,now());
 })();owner.macroReferenceWork=task;try{return await task;}finally{owner.macroReferenceWork=null;}
}
export async function cachedMacroReferences(owner,{schedule=true}={}){
 let summary;
 try{summary=summarizeMacroReferences(await owner.ctx.storage.get(MACRO_REFERENCE_KEY));}catch{return{...summarizeMacroReferences(null),cacheReadFailed:true};}
 // Public/scanner reads return cached data only. Reference transport cannot hold quote/scan requests.
 if(schedule&&typeof owner.ctx.waitUntil==='function')owner.ctx.waitUntil(refreshMacroReferenceCache(owner).catch(()=>{}));
 return summary;
}

export async function validateClaimsReferenceRelay(payload,{previous={},now=Date.now(),digest=async body=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body)))).map(b=>b.toString(16).padStart(2,'0')).join('')}={}){
 if(payload.sources!==undefined||!Array.isArray(payload.references)||payload.references.length!==2)throw Error('CLAIMS_RELAY_INVALID_SOURCE_COUNT');
 const next={...previous},seen=new Set();
 for(const r of payload.references){
  const spec=MACRO_REFERENCE_SOURCES.find(s=>s.type==='claims'&&s.id===r?.id);
  if(!spec||seen.has(r.id)||r.sourceUrl!==spec.url)throw Error('CLAIMS_RELAY_SOURCE_NOT_ALLOWED');seen.add(r.id);
  if(typeof r.body!=='string'||r.body.length<50||r.body.length>300000||!/^[a-f0-9]{64}$/.test(r.sha256||''))throw Error('CLAIMS_RELAY_INVALID_BODY');
  const at=Date.parse(r.fetchedAt);
  if(!Number.isFinite(at)||at>now+5000||now-at>900000)throw Error('CLAIMS_RELAY_STALE_OR_FUTURE');
  if(await digest(r.body)!==r.sha256)throw Error('CLAIMS_RELAY_HASH_MISMATCH');
  parseClaimsHtml(r.body,{series:spec.series,now});
  if(previous[r.id]&&Date.parse(previous[r.id].fetchedAt)>at)throw Error('CLAIMS_RELAY_TIMESTAMP_DOWNGRADE');
  if(previous[r.id]?.fetchedAt===r.fetchedAt&&previous[r.id]?.sha256!==r.sha256)throw Error('CLAIMS_RELAY_CONFLICTING_REPLAY');
  next[r.id]={id:r.id,sourceUrl:spec.url,body:r.body,sha256:r.sha256,fetchedAt:r.fetchedAt,receivedAt:new Date(now).toISOString()};
 }
 return {records:next};
}
export async function acceptClaimsReferenceRelay(payload,env,{get,put}){
 try{
  const previous=(await get(env,CLAIMS_REFERENCE_RELAY_KEY))?.records||{};
  const next=await validateClaimsReferenceRelay(payload,{previous});
  await put(env,CLAIMS_REFERENCE_RELAY_KEY,next,1200);
  return{status:'OFFICIAL_CLAIMS_REFERENCE_RELAY_ACCEPTED',accepted:Object.keys(next.records),storedAt:new Date().toISOString(),tradeSignalGenerated:false,deviceNotificationSent:false,scope:'DELAYED_WEEKLY_REFERENCE_NOT_REALTIME_ECONOMIC_EVENT'};
 }catch(e){return{error:/^CLAIMS_RELAY_[A-Z_]+$/.test(e.message)?e.message:'CLAIMS_RELAY_INVALID_OR_STORAGE_FAILED'};}
}
