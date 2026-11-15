import assert from 'node:assert/strict';
import {createDeskAiBridge} from '../ops/desk-ai-bridge.mjs';
const bridge=createDeskAiBridge(),data=new Map();let tail=Promise.resolve();
const storage={get:async k=>structuredClone(data.get(k)),put:async(k,v)=>data.set(k,structuredClone(v)),transaction(fn){const p=tail.then(()=>fn(storage));tail=p.catch(()=>{});return p;}};
const owner={env:{OPENAI_API_KEY:'fixture-only',CRYPTO_ALPHA_AI_MODEL:'fixture-model'},ctx:{storage}};
const id='11111111-1111-4111-8111-111111111111';
const request={instructions:'rules',input:'evidence',background:true,store:true,max_output_tokens:14000,text:{format:{type:'json_schema',strict:true,schema:{type:'object'}}}};
const value={owner:'site-owner',id,request};let posts=0,mode='ok';const original=globalThis.fetch;
globalThis.fetch=async(url,options)=>{
  assert.ok(url.startsWith('https://api.openai.com/v1/responses'));
  assert.equal(options.headers.Authorization,'Bearer fixture-only');
  if(options.method==='POST'){posts++;assert.equal(JSON.parse(options.body).model,'fixture-model');if(mode==='timeout')throw Error('timeout');return Response.json({id:'resp_test',status:'queued'});}
  return Response.json({id:'resp_test',status:'completed'});
};
try{
  assert.equal((await bridge.handle({...owner,env:{}},{action:'config'})).body.configured,false);
  assert.ok(!JSON.stringify((await bridge.handle(owner,{action:'config'}))).includes('fixture-only'));
  const responses=await Promise.all([bridge.handle(owner,{action:'submit',value}),bridge.handle(owner,{action:'submit',value})]);
  assert.equal(posts,1,'concurrent duplicate requests cause one paid submission');
  assert.ok(responses.every(r=>[200,202].includes(r.status)));
  await bridge.handle(owner,{action:'submit',value});assert.equal(posts,1);
  assert.equal((await bridge.handle(owner,{action:'poll',value:{...value,owner:'other'}})).status,404);
  assert.equal((await bridge.handle(owner,{action:'poll',value})).body.status,'completed');
  assert.equal((await bridge.handle(owner,{action:'submit',value:{...value,id:'22222222-2222-4222-8222-222222222222'}})).status,429);
  data.clear();mode='timeout';assert.equal((await bridge.handle(owner,{action:'submit',value})).body.error,'MODEL_REQUEST_UNKNOWN');
  const count=posts;await bridge.handle(owner,{action:'submit',value});assert.equal(posts,count,'uncertain provider submission is never retried');
  data.clear();assert.equal((await bridge.handle(owner,{action:'submit',value:{...value,request:{...request,background:false}}})).status,400);
  assert.equal(posts,count);
  console.log('PASS signed-bridge core: configuration redaction, concurrent deduplication, owner isolation, rate limits, uncertain submissions, strict request envelope; mocked provider only');
}finally{globalThis.fetch=original;}
