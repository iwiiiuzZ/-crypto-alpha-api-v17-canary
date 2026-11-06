import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const source=fs.readFileSync(new URL('../ops/pin-bls-collector.mjs',import.meta.url),'utf8');
const saved={fetch:globalThis.fetch,cwd:process.cwd(),token:process.env.COLLECTOR_PIN_TOKEN};
const pinned='a'.repeat(40),reviewed='b'.repeat(40),ref='crypto-alpha-collector-r5g-20261101';
const blob=b=>createHash('sha1').update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex');
let passed=0;
async function check(options={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'collector-pin-'));
 const manifest={build:'candidate',sourceGitBlobSha:'locked',collectorRef:ref,collectorSourceCommit:pinned};
 const files={'ops/macro-reference.mjs':'reference-fixture','ops/official-bls-relay.mjs':'relay-fixture','.github/workflows/official-bls-relay.yml':'workflow-fixture'};
 const calls=[];
 try{
  fs.mkdirSync(path.join(dir,'ops'),{recursive:true});fs.mkdirSync(path.join(dir,'.github/workflows'),{recursive:true});
  for(const [name,content]of Object.entries(files))fs.writeFileSync(path.join(dir,name),content);
  fs.writeFileSync(path.join(dir,'ops/pin-bls-collector.mjs'),source);
  fs.writeFileSync(path.join(dir,'ops/release-manifest.json'),JSON.stringify(manifest));
  fs.writeFileSync(path.join(dir,'ops/production-baseline.json'),'{}');
  fs.writeFileSync(path.join(dir,'ops/r5-release-intent.json'),JSON.stringify({reviewedCommit:reviewed}));
  process.chdir(dir);process.env.COLLECTOR_PIN_TOKEN='synthetic-pin-token';
  globalThis.fetch=async(url,request)=>{
   const u=new URL(url);calls.push({url,method:request.method});
   assert.equal(u.origin,'https://api.github.com');assert.equal(request.redirect,'manual');
   if(u.pathname.endsWith('/contents/ops/release-manifest.json')){
    assert.equal(u.searchParams.get('ref'),pinned);
    return Response.json({content:Buffer.from(JSON.stringify({...manifest,...options.remoteManifest})).toString('base64')});
   }
   for(const [name,content]of Object.entries(files))if(u.pathname.endsWith('/contents/'+name)){
    assert.equal(u.searchParams.get('ref'),pinned);return Response.json({sha:options.changedCode?'changed':blob(Buffer.from(content))});
   }
   if(request.method==='GET'&&u.pathname.endsWith('/git/ref/tags/'+ref)){
    if(options.absent)return new Response(null,{status:404});
    return Response.json({ref:'refs/tags/'+ref,object:{type:'commit',sha:options.foreignTag?reviewed:pinned}});
   }
   if(request.method==='POST'&&u.pathname.endsWith('/git/refs')){
    const data=JSON.parse(request.body);assert.deepEqual(data,{ref:'refs/tags/'+ref,sha:pinned});
    return Response.json({ref:data.ref,object:{type:'commit',sha:data.sha}});
   }
   throw Error('UNEXPECTED_PIN_REQUEST');
  };
  const run=import(pathToFileURL(path.join(dir,'ops/pin-bls-collector.mjs')).href);
  if(options.error){await assert.rejects(run,new RegExp(options.error));assert.equal(calls.filter(c=>c.method==='POST').length,0);}
  else{await run;const e=JSON.parse(fs.readFileSync('r5-collector-pin-evidence.json'));assert.equal(e.collectorCommit,pinned);assert.equal(calls.filter(c=>c.method==='POST').length,options.absent?1:0);}
  passed++;
 }finally{process.chdir(saved.cwd);globalThis.fetch=saved.fetch;if(saved.token===undefined)delete process.env.COLLECTOR_PIN_TOKEN;else process.env.COLLECTOR_PIN_TOKEN=saved.token;fs.rmSync(dir,{recursive:true,force:true});}
}
await check();
await check({absent:true});
await check({foreignTag:true,error:'EXISTING_COLLECTOR_TAG_CHANGED_NO_OVERWRITE'});
await check({remoteManifest:{sourceGitBlobSha:'foreign'},error:'COLLECTOR_SOURCE_COMMIT_MISMATCH'});
await check({remoteManifest:{build:'foreign'},error:'COLLECTOR_SOURCE_COMMIT_MISMATCH'});
await check({changedCode:true,error:'PINNED_COLLECTOR_CODE_CHANGED_NEW_REVIEW_REQUIRED'});
console.log('PASS collector source remains pinned across release-tool changes',passed);
