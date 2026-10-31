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
assert.notEqual(build,manifest.priorLiveBuild,'Changed candidate must never impersonate currently deployed build');
assert.equal(build,'crypto-alpha-worker-v27.6.3-macro-r5f');
assert.ok(['CANDIDATE_NOT_DEPLOYED','DEPLOYED_AWAITING_FINAL_ACCEPTANCE'].includes(manifest.status));
if(manifest.status==='DEPLOYED_AWAITING_FINAL_ACCEPTANCE'){
 const baseline=JSON.parse(fs.readFileSync(new URL('../ops/production-baseline.json',import.meta.url),'utf8'));
 assert.equal(baseline.build,build);assert.equal(baseline.sourceGitBlobSha,gitBlob);
 assert.equal(baseline.autonomousWindowPassed,true);assert.equal(baseline.blsFourSourceConsumptionVerified,true);
 assert.equal(baseline.finalDeliveryAccepted,false,'pending GPT acceptance is not stable final acceptance');
}
console.log('PASS candidate unique-build identity and immutable source lock',JSON.stringify({build,sourceGitBlobSha:gitBlob}));
