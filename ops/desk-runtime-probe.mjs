// Read-only production diagnosis. Never print requests, headers, keys or records.
import fs from 'node:fs';
const config=JSON.parse(fs.readFileSync(new URL('./config.json',import.meta.url)));
const base='https://api.cloudflare.com/client/v4/accounts/'+config.accountId+'/workers/scripts/'+config.worker;
const token=process.env.CLOUDFLARE_API_TOKEN;
const headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
async function cf(path,method='GET',body){
 const r=await fetch(base+path,{method,headers,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});
 const data=await r.json();if(!r.ok||!data.success)throw Error('PROVIDER_HTTP_'+r.status);return data.result;
}
const classify=text=>{
 const s=String(text).toLowerCase();
 if(/exceed|quota|limit/.test(s))return 'RESOURCE_LIMIT';
 if(/overload/.test(s))return 'OVERLOADED';
 if(/deadlock/.test(s))return 'DEADLOCK';
 if(/timeout|timed out/.test(s))return 'TIMEOUT';
 if(/storage|sqlite|database/.test(s))return 'STORAGE';
 if(/network|fetch|connection/.test(s))return 'NETWORK';
 if(/not defined|undefined|typeerror/.test(s))return 'RUNTIME';
 return 'OTHER';
};
const counts={};let tail=null,ws=null;
try{
 const settings=await cf('/settings');
 console.log(JSON.stringify({stage:'configuration',bindings:(settings.bindings||[]).map(b=>({name:b.name,type:b.type,...(b.name==='CRYPTO_ALPHA_AI_MODEL'&&b.type==='plain_text'?{model:b.text}:{})}))}));
 tail=await cf('/tails','POST',{});
 ws=new WebSocket(tail.url,'trace-v1');
 ws.addEventListener('message',event=>{
  try{const x=JSON.parse(String(event.data));const outcome=x.outcome||'unknown';counts[outcome]=(counts[outcome]||0)+1;
   for(const e of x.exceptions||[]){const k='exception:'+classify(e.message);counts[k]=(counts[k]||0)+1;}
   for(const l of x.logs||[]){if(l.level==='error'){const k='log:'+classify(JSON.stringify(l.message));counts[k]=(counts[k]||0)+1;}}
  }catch{}
 });
 await Promise.race([new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',()=>reject(Error('TAIL_CONNECTION_FAILED')),{once:true});}),new Promise((_,reject)=>setTimeout(()=>reject(Error('TAIL_OPEN_TIMEOUT')),15000))]);
 ws.send(JSON.stringify({debug:false}));
 for(const path of ['/?view=fast','/scanner/status']){
  const r=await fetch(config.origin+path,{headers:path==='/scanner/status'?{Authorization:'Bearer '+process.env.SCANNER_TOKEN}:{},signal:AbortSignal.timeout(55000)});
  const p=await r.json();console.log(JSON.stringify({stage:'runtime',path,http:r.status,build:p.build,status:p.status,identity:p.backendIdentity,diagnostics:p.diagnostics,fastStatus:p.fastMonitor?.status}));
 }
 await new Promise(resolve=>setTimeout(resolve,45000));
 console.log(JSON.stringify({stage:'tail-summary',counts}));
}catch(e){console.log(JSON.stringify({stage:'probe-error',code:/^[A-Z_0-9]+$/.test(e.message)?e.message:classify(e.message)}));process.exitCode=1;}
finally{ws?.close();if(tail)try{await cf('/tails/'+tail.id,'DELETE');}catch{console.log('{"stage":"tail-cleanup","status":"EXPIRES_AUTOMATICALLY"}');}}
