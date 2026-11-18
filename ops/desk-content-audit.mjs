import {createHash} from 'node:crypto';
import {transformSync} from 'esbuild';
export function normalizedDigest(source){
 const code=transformSync(source,{loader:'js',minifyWhitespace:true,legalComments:'none',target:'esnext'}).code;
 return createHash('sha256').update(code).digest('hex');
}
// Always read an explicit version. The generic script content endpoint may
// return an uploaded candidate that is not receiving production traffic.
export async function versionModules(config,version,token,fetcher=fetch){
 if(!/^[a-f0-9-]{36}$/.test(version))throw Error('EXPLICIT_VERSION_REQUIRED');
 const url='https://api.cloudflare.com/client/v4/accounts/'+encodeURIComponent(config.accountId)+'/workers/workers/'+encodeURIComponent(config.worker)+'/versions/'+version+'?include=modules';
 const r=await fetcher(url,{method:'GET',redirect:'error',headers:{authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});
 if(!r.ok||!r.body)throw Error('VERSION_CONTENT_READ_FAILED');
 const reader=r.body.getReader(),parts=[];let bytes=0;
 for(;;){const x=await reader.read();if(x.done)break;bytes+=x.value.length;if(bytes>4_000_000){await reader.cancel();throw Error('CONTENT_TOO_LARGE');}parts.push(x.value);}
 const data=JSON.parse(Buffer.concat(parts).toString('utf8'));
 if(data.success!==true||data.result?.id!==version||!Array.isArray(data.result.modules)||!data.result.modules.length)throw Error('VERSION_MODULES_UNVERIFIED');
 const modules=data.result.modules.filter(m=>m.content_type!=='application/source-map');
 if(!modules.length||modules.some(m=>typeof m.name!=='string'||typeof m.content_base64!=='string')||new Set(modules.map(m=>m.name)).size!==modules.length)throw Error('INVALID_MODULES');
 return modules.map(m=>({name:m.name,type:m.content_type,digest:createHash('sha256').update(Buffer.from(m.content_base64,'base64')).digest('hex')})).sort((a,b)=>a.name.localeCompare(b.name));
}
export async function auditDeskContent(config,token,baselineVersion,currentVersion,fetcher=fetch){
 const [baseline,current]=await Promise.all([versionModules(config,baselineVersion,token,fetcher),versionModules(config,currentVersion,token,fetcher)]);
 return {verified:JSON.stringify(baseline)===JSON.stringify(current),baselineVersion,currentVersion,baselineModules:baseline,currentModules:current,scope:'EXPLICIT_VERSION_MODULE_BYTES',deploymentAuthorized:false};
}
