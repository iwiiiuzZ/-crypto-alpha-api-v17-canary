// Signed Site callers only. This module is embedded in the Worker at release.
export function createDeskAiBridge() {
  const PREFIX = 'desk:ai:v1:';
  const reply = (status, body) => ({status, body});
  const error = (status, code) => reply(status, {error:code});
  const config = env => ({configured:Boolean(env.OPENAI_API_KEY?.trim() && env.CRYPTO_ALPHA_AI_MODEL?.trim()),
    model:env.CRYPTO_ALPHA_AI_MODEL?.trim() || null, transport:'cloudflare-worker', dailyLimit:6,
    missing:[!env.OPENAI_API_KEY?.trim() && 'OPENAI_API_KEY',!env.CRYPTO_ALPHA_AI_MODEL?.trim() && 'CRYPTO_ALPHA_AI_MODEL'].filter(Boolean)});
  async function provider(env, suffix, body) {
    let r;
    try { r=await fetch('https://api.openai.com/v1/responses'+suffix,{method:body?'POST':'GET',redirect:'error',
      headers:{Authorization:'Bearer '+env.OPENAI_API_KEY,'Content-Type':'application/json'},
      body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(body?20000:10000)}); }
    catch {throw Error(body?'MODEL_REQUEST_UNKNOWN':'MODEL_POLL_FAILED');}
    if(!r.ok)throw Error(r.status===401||r.status===403?'MODEL_AUTH':r.status===429?'MODEL_RATE_LIMIT':body?'MODEL_REQUEST_UNKNOWN':'MODEL_POLL_FAILED');
    const reader=r.body.getReader();let size=0,parts=[];
    for(;;){const p=await reader.read();if(p.done)break;size+=p.value.length;if(size>1200000){await reader.cancel();throw Error(body?'MODEL_REQUEST_UNKNOWN':'MODEL_POLL_FAILED');}parts.push(p.value);}
    const bytes=new Uint8Array(size);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.length;}
    try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw Error(body?'MODEL_REQUEST_UNKNOWN':'MODEL_POLL_FAILED');}
  }
  async function handle(owner,input) {
    const {env,ctx:{storage}}=owner;
    if(input.action==='config')return reply(200,config(env));
    const value=input.value;
    if(!value||!/^\w[\w-]{0,127}$/.test(value.owner)||!/^[a-f0-9-]{36}$/.test(value.id))return error(400,'INVALID_AI_REQUEST');
    const key=PREFIX+value.owner+':'+value.id;
    let row=await storage.get(key);
    if(input.action==='poll'){
      if(!row)return error(404,'AI_REQUEST_NOT_FOUND');
      if(row.error)return error(409,row.error);
      if(!row.responseId)return reply(202,{status:'submitting'});
      try { return reply(200,await provider(env,'/'+encodeURIComponent(row.responseId))); }
      catch(e){return error(503,e.message);}
    }
    if(input.action!=='submit')return error(400,'INVALID_AI_ACTION');
    // The provider response id is bound to an authenticated Site owner and UUID.
    // Never accept a caller-supplied provider URL, id or model.
    if(row)return row.error?error(409,row.error):reply(202,{id:row.responseId,status:row.responseId?'queued':'submitting'});
    if(!config(env).configured)return error(503,'NOT_CONFIGURED');
    const body=value.request;
    if(!body||typeof body.instructions!=='string'||body.instructions.length>150000||typeof body.input!=='string'||body.input.length>660000
      ||body.background!==true||body.store!==true||body.max_output_tokens!==14000||body.text?.format?.type!=='json_schema'||body.text.format.strict!==true
      ||JSON.stringify(body.text).length>30000)return error(400,'INVALID_AI_PAYLOAD');
    const now=Date.now(),day=Math.floor((now+28800000)/86400000);
    const reserved=await storage.transaction(async txn=>{
      if(await txn.get(key))return false;
      const limit=await txn.get(PREFIX+'budget')||{};
      if(now-(limit.last??0)<300000||(limit.day===day&&limit.count>=6))return false;
      await txn.put(PREFIX+'budget',{day,last:now,count:limit.day===day?limit.count+1:1});
      await txn.put(key,{created:now,responseId:null,error:null});return true;
    });
    if(!reserved){row=await storage.get(key);return row?reply(202,{id:row.responseId,status:row.responseId?'queued':'submitting'}):error(429,'REVIEW_RATE_LIMIT');}
    try {
      const response=await provider(env,'',{model:env.CRYPTO_ALPHA_AI_MODEL.trim(),instructions:body.instructions,input:body.input,
        background:true,store:true,max_output_tokens:14000,text:body.text});
      if(typeof response.id!=='string'||!/^resp_[A-Za-z0-9_-]+$/.test(response.id))throw Error('MODEL_REQUEST_UNKNOWN');
      await storage.put(key,{created:now,responseId:response.id,error:null});
      return reply(200,response);
    }catch(e){
      const code=['MODEL_AUTH','MODEL_RATE_LIMIT'].includes(e.message)?e.message:'MODEL_REQUEST_UNKNOWN';
      await storage.put(key,{created:now,responseId:null,error:code});return error(503,code);
    }
  }
  return {handle,config};
}
