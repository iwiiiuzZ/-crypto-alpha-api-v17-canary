import fs from 'node:fs';
import {createHash} from 'node:crypto';
const repo='iwiiiuzZ/-crypto-alpha-api-v17-canary',testBaseline=process.argv.includes('--test-baseline');
const manifest=JSON.parse(fs.readFileSync(new URL('./release-manifest.json',import.meta.url),'utf8'));
const baseline=JSON.parse(fs.readFileSync(new URL('./production-baseline.json',import.meta.url),'utf8'));
const intent=testBaseline?null:JSON.parse(fs.readFileSync(new URL('./r5-release-intent.json',import.meta.url),'utf8'));
const tag=testBaseline?'crypto-alpha-collector-r5f-20261031':manifest.collectorRef;
// Release tooling can change without moving the already-reviewed collector tag.
const commit=testBaseline?'d5083d1ead0dbb2ea19ed624d11792bdfcbab7e0':manifest.collectorSourceCommit||intent.reviewedCommit;
const expected=testBaseline?baseline:manifest,token=process.env.COLLECTOR_PIN_TOKEN;
if(!token||!/^crypto-alpha-collector-r5[a-z]-\d{8}$/.test(tag||'')||!/^[a-f0-9]{40}$/.test(commit||''))throw Error('COLLECTOR_PIN_ARGUMENTS_REQUIRED');
const base='https://api.github.com/repos/'+repo;
async function api(path,method='GET',body,allowMissing=false){
 const r=await fetch(base+path,{method,redirect:'manual',headers:{authorization:'Bearer '+token,accept:'application/vnd.github+json','content-type':'application/json','User-Agent':'CryptoAlphaCollectorPin/1.0','X-GitHub-Api-Version':'2026-03-10'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(12000)});
 if(allowMissing&&r.status===404){await r.body?.cancel();return null;}
 if(!r.ok){await r.body?.cancel();throw Error('COLLECTOR_PIN_HTTP_'+r.status);}return r.json();
}
const remote=await api('/contents/ops/release-manifest.json?ref='+commit);
const pinned=JSON.parse(Buffer.from(remote.content,'base64').toString('utf8'));
if(pinned.build!==expected.build||pinned.sourceGitBlobSha!==expected.sourceGitBlobSha)throw Error('COLLECTOR_SOURCE_COMMIT_MISMATCH');
if(!testBaseline){
 for(const name of ['ops/official-bls-relay.mjs','.github/workflows/official-bls-relay.yml']){
  const bytes=fs.readFileSync(new URL('../'+name,import.meta.url));
  const sha=createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex');
  const file=await api('/contents/'+name+'?ref='+commit);
  if(file.sha!==sha)throw Error('PINNED_COLLECTOR_CODE_CHANGED_NEW_REVIEW_REQUIRED');
 }
}
let ref=await api('/git/ref/tags/'+tag,'GET',undefined,true);
if(!ref)ref=await api('/git/refs','POST',{ref:'refs/tags/'+tag,sha:commit});
if(ref.ref!=='refs/tags/'+tag||ref.object?.type!=='commit'||ref.object.sha!==commit)throw Error('EXISTING_COLLECTOR_TAG_CHANGED_NO_OVERWRITE');
const evidence={collectorRef:tag,collectorCommit:commit,build:pinned.build,sourceGitBlobSha:pinned.sourceGitBlobSha,verifiedAt:new Date().toISOString(),purpose:'IMMUTABLE_COLLECTOR_SOURCE_NOT_FINAL_STABLE_ACCEPTANCE'};
fs.writeFileSync(testBaseline?'bls-test-collector-pin.json':'r5-collector-pin-evidence.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
