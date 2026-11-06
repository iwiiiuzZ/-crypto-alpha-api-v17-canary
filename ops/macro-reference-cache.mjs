import {collectMacroReferences,MACRO_REFERENCE_SOURCES} from './macro-reference.mjs';
export const MACRO_REFERENCE_KEY='macro:reference-cache:v1';
export const MACRO_REFERENCE_REVISION='27.6.3-macro-reference-h1';
const policy=s=>s.type==='option'?{refreshMs:60000,maxAgeMs:180000}:{refreshMs:21600000,maxAgeMs:43200000};
function age(stamp,now){const n=Date.parse(stamp);return Number.isFinite(n)?now-n:Infinity;}
export function summarizeMacroReferences(saved,now=Date.now()){
 const rows=MACRO_REFERENCE_SOURCES.map(s=>{
  const r=saved?.records?.[s.id],fresh=r?.revision===MACRO_REFERENCE_REVISION&&r.status==='ok'&&age(r.fetchedAt,now)>=-5000&&age(r.fetchedAt,now)<=policy(s).maxAgeMs;
  return{id:s.id,status:fresh?'ok':'unavailable',reason:fresh?null:r?.error||(r?.fetchedAt?'REFERENCE_TRANSPORT_STALE':'REFERENCE_CACHE_WARMING'),
   fetchedAt:r?.fetchedAt||null,lastAttemptAt:r?.lastAttemptAt||null,lastSuccessAt:r?.lastSuccessAt||null,nextAttemptAt:r?.nextAttemptAt?new Date(r.nextAttemptAt).toISOString():null,httpStatus:r?.httpStatus??null,
   revision:r?.revision||null,data:fresh?r.data:null};
 });
 return{revision:MACRO_REFERENCE_REVISION,checkedAt:new Date(now).toISOString(),sourceCount:6,availableCount:rows.filter(r=>r.status==='ok').length,sources:rows,dxy:{status:'NO_AUTHORIZED_REALTIME_SOURCE_CONNECTED'},
  scope:'REFERENCE_CONTEXT_NOT_NEW_TRADE_OR_NOTIFICATION_GATE',allMarketCoverage:false,latestEconomicPublicationVerified:false,tradeDirection:null,openNowAllowed:false};
}
export function macroReferenceReceipts(summary,consumedAt){
 return{revision:summary?.revision||MACRO_REFERENCE_REVISION,consumedAt,sources:(summary?.sources||[]).map(r=>({source:r.id,status:r.status,fetchedAt:r.fetchedAt,dataAsOf:r.data?.asOf||r.data?.weekEnding||null,reason:r.reason||null})),scope:'SCANNER_CONSUMED_REFERENCE_CONTEXT_NOT_ECONOMIC_EVENT_CONFIRMATION'};
}
export async function refreshMacroReferenceCache(owner,{fetcher=fetch,now=Date.now,collect=collectMacroReferences}={}){
 if(owner.macroReferenceWork)return owner.macroReferenceWork;
 const task=(async()=>{
  const storage=owner.ctx.storage,began=now(),saved=await storage.get(MACRO_REFERENCE_KEY)||{records:{}};
  if(saved.leaseUntil>began)return summarizeMacroReferences(saved,began);
  const due=MACRO_REFERENCE_SOURCES.filter(s=>{const r=saved.records?.[s.id];return !r||r.revision!==MACRO_REFERENCE_REVISION||(!(r.nextAttemptAt>began)&&(r.status!=='ok'||age(r.lastAttemptAt,began)>=policy(s).refreshMs));});
  if(!due.length)return summarizeMacroReferences(saved,began);
  // A bounded restart lease avoids duplicate transports after an interrupted owner.
  const state={...saved,records:{...saved.records},leaseUntil:began+60000};await storage.put(MACRO_REFERENCE_KEY,state);
  let index=0;
  await Promise.all([0,1].map(async()=>{while(index<due.length){
   const spec=due[index++],old=state.records[spec.id],attemptAt=new Date(now()).toISOString();let r;
   try{const result=await collect({fetcher,now,selectedIds:[spec.id]});r=result.sources?.find(x=>x.id===spec.id);if(!r)throw Error('REFERENCE_RESULT_MISSING');}
   catch{r={status:'unavailable',error:'REFERENCE_COLLECTION_FAILED'};}
   if(r.status==='ok')state.records[spec.id]={...r,revision:MACRO_REFERENCE_REVISION,lastAttemptAt:attemptAt,lastSuccessAt:r.fetchedAt,failureCount:0,nextAttemptAt:0};
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
