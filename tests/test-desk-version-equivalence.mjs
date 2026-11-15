import assert from 'node:assert/strict';
import {equivalentVersion,revalidateDeskVersion} from '../ops/desk-version-equivalence.mjs';
const old={id:'old',resources:{script:{etag:'0123456789abcdef'},script_runtime:{compatibility_date:'2026-01-01'},bindings:[{name:'STATE',type:'durable_object_namespace',namespace_id:'original'},{name:'TOKEN',type:'secret_text'}]}};
const current=structuredClone(old);current.id='current';current.resources.bindings.push({name:'OPENAI_API_KEY',type:'secret_text'},{name:'CRYPTO_ALPHA_AI_MODEL',type:'plain_text',text:'selected-model'});
assert.ok(equivalentVersion(old,current));
for(const change of [x=>x.resources.script.etag='changed',x=>delete x.resources.script.etag,x=>x.resources.script_runtime.compatibility_date='other',x=>x.resources.bindings[0].namespace_id='other',x=>x.resources.bindings.push({name:'UNREVIEWED',type:'plain_text',text:'1'}),x=>delete x.resources.bindings]){const bad=structuredClone(current);change(bad);assert.equal(equivalentVersion(old,bad),false);}
const seen=[];const fetcher=async url=>{seen.push(url);return Response.json({success:true,result:url.endsWith('/old')?old:current});};
const baseline={versionId:'old',deploymentId:'original',build:'r4'};
const r=await revalidateDeskVersion({accountId:'fixture',worker:'fixture'},baseline,{singleVersion:true,versions:[{id:'current',percentage:100}],deploymentId:'changed'},'fixture-token',fetcher);
assert.equal(r.versionId,'current');assert.equal(baseline.versionId,'old');assert.equal(seen.length,2);
await assert.rejects(()=>revalidateDeskVersion({},baseline,{singleVersion:false},'',fetcher),/MULTIVERSION/);
console.log('PASS same-code AI configuration revision; reject code/runtime/storage changes, missing evidence and split deployment; baseline immutable');
