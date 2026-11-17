import {requestJson} from './diagnostics.mjs';
const canonical=v=>JSON.stringify(sort(v));
function sort(v){return Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v;}
function resources(v){
 const r=v?.resources;if(!r||!Array.isArray(r.bindings)||!r.script_runtime)return null;
 // Only the explicitly requested AI configuration can differ. Never log bindings.
 const bindings=r.bindings.filter(b=>!(b.name==='OPENAI_API_KEY'&&b.type==='secret_text')&&!(b.name==='CRYPTO_ALPHA_AI_MODEL'&&['plain_text','secret_text'].includes(b.type)))
  .sort((a,b)=>String(a.name).localeCompare(String(b.name)));
 return {bindings,runtime:r.script_runtime};
}
export function equivalentVersion(old,current){
 return Object.values(versionEvidence(old,current)).every(Boolean);
}
export function versionEvidence(old,current){
 const a=resources(old),b=resources(current),etag=old?.resources?.script?.etag,next=current?.resources?.script?.etag;
 return {baselineResourcesPresent:!!a,currentResourcesPresent:!!b,
  baselineHashPresent:typeof etag==='string'&&etag.length>=16,currentHashPresent:typeof next==='string'&&next.length>=16,
  codeMatches:!!etag&&etag===next,runtimeMatches:!!a&&!!b&&canonical(a.runtime)===canonical(b.runtime),
  bindingsMatch:!!a&&!!b&&canonical(a.bindings)===canonical(b.bindings)};
}
export async function revalidateDeskVersion(config,baseline,snapshot,token,fetcher=fetch){
 if(!snapshot.singleVersion||snapshot.versions?.length!==1||snapshot.versions[0].percentage!==100)throw Error('DESK_MULTIVERSION_REJECTED');
 const current=snapshot.versions[0].id;
 const base='https://api.cloudflare.com/client/v4/accounts/'+encodeURIComponent(config.accountId)+'/workers/scripts/'+encodeURIComponent(config.worker)+'/versions/';
 const headers={authorization:'Bearer '+token};
 const [a,b]=await Promise.all([requestJson(fetcher,base+encodeURIComponent(baseline.versionId),headers),requestJson(fetcher,base+encodeURIComponent(current),headers)]);
 if(a.success!==true||b.success!==true||a.result?.id!==baseline.versionId||b.result?.id!==current||!equivalentVersion(a.result,b.result)){
  const error=Error('DESK_VERSION_CODE_OR_BINDINGS_CHANGED');
  error.evidence={providerVersionsMatched:a.success===true&&b.success===true&&a.result?.id===baseline.versionId&&b.result?.id===current,...versionEvidence(a.result,b.result)};
  throw error;
 }
 return {...baseline,deploymentId:snapshot.deploymentId,versionId:current};
}
