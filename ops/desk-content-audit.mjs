import {createHash} from 'node:crypto';
import {transformSync} from 'esbuild';
// Rebuilt from reviewed R4 blob 4c175dfc27b6cebb0ebc57e95ceb9979e1bfc230,
// main-v188.js, locked Wrangler 4.151.3 and unchanged wrangler.jsonc.
export const REVIEWED_R4_DIGEST='46e873a5e472cc21bffa1f2ec83d1ebb0eaece6964402b8507b5626ac9ee597e';
export function normalizedDigest(source){
 const code=transformSync(source,{loader:'js',minifyWhitespace:true,legalComments:'none',target:'esnext'}).code;
 return createHash('sha256').update(code).digest('hex');
}
export async function auditDeskContent(config,token,fetcher=fetch){
 const url='https://api.cloudflare.com/client/v4/accounts/'+encodeURIComponent(config.accountId)+'/workers/scripts/'+encodeURIComponent(config.worker)+'/content/v2';
 const r=await fetcher(url,{method:'GET',redirect:'error',headers:{authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});
 if(!r.ok||!r.body)throw Error('CONTENT_READ_FAILED');
 const reader=r.body.getReader(),parts=[];let bytes=0;
 for(;;){const x=await reader.read();if(x.done)break;bytes+=x.value.length;if(bytes>2_000_000){await reader.cancel();throw Error('CONTENT_TOO_LARGE');}parts.push(x.value);}
 const response=new Response(Buffer.concat(parts),{headers:r.headers});
 let modules;const sourceBlobs=[];
 if((r.headers.get('content-type')||'').startsWith('multipart')){
  const form=await response.formData();
  for(const [name,v] of form.entries())if(name.endsWith('.map')){
    try{const map=JSON.parse(typeof v==='string'?v:await v.text());for(const s of (map.sourcesContent||[]).slice(0,20))if(typeof s==='string'){
      const bytes=Buffer.from(s);sourceBlobs.push(createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex'));
    }}catch{/* A map is supporting evidence, never permission to deploy. */}
  }
  modules=await Promise.all([...form.entries()].filter(([name])=>!name.endsWith('.map')).map(async([name,v])=>({name,text:typeof v==='string'?v:await v.text()})));
 }else modules=[{name:'script.js',text:await response.text()}];
 if(modules.length!==1||!modules[0].name.endsWith('.js'))return {verified:false,moduleCount:modules.length,reason:'UNEXPECTED_MODULE_SET'};
 const digest=normalizedDigest(modules[0].text);
 // No code, configuration values or credentials leave this read-only audit.
 return {verified:digest===REVIEWED_R4_DIGEST,moduleCount:1,bytes,normalizedSha256:digest,sourceBlobs,
  reviewedSourcePresent:sourceBlobs.includes('4c175dfc27b6cebb0ebc57e95ceb9979e1bfc230'),scope:'REVIEWED_R4_BUNDLE_COMPARISON',deploymentAuthorized:false};
}
