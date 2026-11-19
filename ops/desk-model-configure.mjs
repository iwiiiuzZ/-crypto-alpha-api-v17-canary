// Owner-requested repair: set only a missing model binding, preserve every secret and state namespace.
import fs from 'node:fs';
import {cloudflareSnapshot,requestJson} from './diagnostics.mjs';
const cfg=JSON.parse(fs.readFileSync(new URL('./config.json',import.meta.url)));
const env=process.env,event=JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH));
if(env.GITHUB_REPOSITORY!=='iwiiiuzZ/-crypto-alpha-api-v17-canary'||env.GITHUB_REF!=='refs/heads/main'||env.GITHUB_EVENT_NAME!=='push'||event.after!==env.GITHUB_SHA||event.head_commit?.message?.split('\n')[0]!=='Repair missing desk model configuration and inspect runtime usage')throw Error('REVIEWED_CONFIGURATION_EVENT_REQUIRED');
const token=env.CLOUDFLARE_API_TOKEN;
const base='https://api.cloudflare.com/client/v4/accounts/'+cfg.accountId+'/workers/scripts/'+cfg.worker;
const headers={authorization:'Bearer '+token};
const before=await cloudflareSnapshot(fetch,cfg,token);
if(!before.singleVersion||!before.bindingMatches||before.binding.namespaceFingerprint!=='aedfbcd14cd1'||before.versions[0].id!=='62a46fb6-e666-4cc7-9499-630815ba1c7b')throw Error('CONFIGURATION_BASELINE_CHANGED');
const fast=await requestJson(fetch,cfg.origin+'/?view=fast');
if(fast.build!=='crypto-alpha-worker-v27.6.3-desk-dual-r5'||fast.backendIdentity?.matched!==true)throw Error('RUNTIME_IDENTITY_REQUIRED');
const initial=await requestJson(fetch,base+'/settings',headers),bindings=initial.result.bindings;
if(!bindings.some(b=>b.name==='OPENAI_API_KEY'&&b.type==='secret_text'))throw Error('EXISTING_KEY_REQUIRED');
if(bindings.some(b=>b.name==='CRYPTO_ALPHA_AI_MODEL')){console.log(JSON.stringify({stage:'model-config',status:'ALREADY_PRESENT_NO_OVERWRITE'}));process.exit(0);}
const r=await fetch(base+'/secrets',{method:'PUT',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({name:'CRYPTO_ALPHA_AI_MODEL',type:'secret_text',text:'gpt-6.2-sol'}),signal:AbortSignal.timeout(20000)});
const p=await r.json();if(!r.ok||p.success!==true)throw Error('MODEL_CONFIGURATION_HTTP_'+r.status);
const after=await cloudflareSnapshot(fetch,cfg,token),final=await requestJson(fetch,base+'/settings',headers);
if(!after.singleVersion||!after.bindingMatches||after.binding.namespaceFingerprint!==before.binding.namespaceFingerprint||!bindings.every(b=>final.result.bindings.some(x=>x.name===b.name&&x.type===b.type))||!final.result.bindings.some(b=>b.name==='CRYPTO_ALPHA_AI_MODEL'))throw Error('CONFIGURATION_POSTCHECK_FAILED');
console.log(JSON.stringify({stage:'model-config',status:'SAVED',model:'gpt-6.2-sol',existingKeyUnchanged:true,stateNamespaceUnchanged:true,deploymentId:after.deploymentId,versionId:after.versions[0].id,providerCallVerified:false}));
