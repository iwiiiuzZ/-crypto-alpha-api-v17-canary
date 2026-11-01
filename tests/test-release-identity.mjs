import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const source=fs.readFileSync(new URL('../main-v188.js',import.meta.url));
const manifest=JSON.parse(fs.readFileSync(new URL('../ops/release-manifest.json',import.meta.url),'utf8'));
const content=source.toString('utf8');
const blobHeader=Buffer.concat([Buffer.from('blob '+source.length),Buffer.from([0])]);
const gitBlob=createHash('sha1').update(blobHeader).update(source).digest('hex');
const build=content.match(/^const BUILD = "([^"]+)";/m)?.[1];
const apiVersion=content.match(/^const API_VERSION = "([^"]+)";/m)?.[1];
const stateContract=content.match(/^const STATE_OWNER_CONTRACT="([^"]+)";/m)?.[1];
assert.equal(manifest.entry,'main-v188.js');
assert.equal(manifest.sourceGitBlobSha,gitBlob,'Worker source changed without updating the immutable build manifest');
assert.equal(manifest.build,build);
assert.equal(manifest.apiVersion,apiVersion);
assert.equal(manifest.stateOwnerContract,stateContract);
const wranglerBytes=fs.readFileSync(new URL('../wrangler.jsonc',import.meta.url));
assert.equal(manifest.wranglerSha256,createHash('sha256').update(wranglerBytes).digest('hex'),'Deployment configuration must match its reviewed manifest');
assert.equal(content.match(/^const BLS_COLLECTOR_REF = "([^"]+)";/m)?.[1],manifest.collectorRef);
assert.notEqual(build,manifest.priorLiveBuild,'Changed candidate must never impersonate currently deployed build');
assert.equal(build,'crypto-alpha-worker-v27.6.3-macro-r5g');
// User-created GitHub secrets cannot use its reserved GITHUB_ prefix.
const workflows=new URL('../.github/workflows/',import.meta.url);
for(const file of fs.readdirSync(workflows).filter(file=>/\.ya?ml$/.test(file))){
 const yaml=fs.readFileSync(new URL(file,workflows),'utf8');
 for(const [,name] of yaml.matchAll(/\bsecrets\.([A-Za-z0-9_-]+)/g)){
  if(name==='GITHUB_TOKEN')continue; // GitHub's built-in token is not user-created.
  assert.match(name,/^[A-Za-z_][A-Za-z0-9_]*$/,file+' contains an invalid repository secret name');
  assert.ok(!/^GITHUB_/i.test(name),file+' references a user secret with a reserved prefix: '+name);
 }
}
for(const file of ['bls-dispatch-egress.yml','maintenance.yml','r5-controlled-release.yml']){
 const yaml=fs.readFileSync(new URL(file,workflows),'utf8');
 assert.match(yaml,/^\s+GITHUB_ACTIONS_DISPATCH_TOKEN:\s*\$\{\{\s*secrets\.BLS_DISPATCH_TOKEN\s*\}\}\s*$/m,file+' must map the valid repository secret to the existing runtime binding');
}
assert.ok(['CANDIDATE_NOT_DEPLOYED','DEPLOYED_AWAITING_FINAL_ACCEPTANCE'].includes(manifest.status));
if(manifest.status==='DEPLOYED_AWAITING_FINAL_ACCEPTANCE'){
 const baseline=JSON.parse(fs.readFileSync(new URL('../ops/production-baseline.json',import.meta.url),'utf8'));
 assert.equal(baseline.build,build);assert.equal(baseline.sourceGitBlobSha,gitBlob);
 assert.equal(baseline.autonomousWindowPassed,true);assert.equal(baseline.blsFourSourceConsumptionVerified,true);
 assert.equal(baseline.finalDeliveryAccepted,false,'pending GPT acceptance is not stable final acceptance');
}
console.log('PASS candidate unique-build identity and immutable source lock',JSON.stringify({build,sourceGitBlobSha:gitBlob}));
