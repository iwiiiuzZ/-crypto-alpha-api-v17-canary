// This one-time engineering deployment is pinned to the audited source and baseline.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {cloudflareSnapshot,cloudflareBuildSnapshot} from './diagnostics.mjs';
const config=JSON.parse(fs.readFileSync(new URL('./config.json',import.meta.url),'utf8'));
assert.equal(createHash('sha256').update(fs.readFileSync(new URL('../main-v188.js',import.meta.url))).digest('hex'),'4f9c0ae7a01f4438d41f9d85a9cbdac2f4fe132f0add311b095309bcbc8a7f6e','UNREVIEWED_CANDIDATE_SOURCE');
const token=process.env.CLOUDFLARE_API_TOKEN;
const [snapshot,build]=await Promise.all([cloudflareSnapshot(fetch,config,token),cloudflareBuildSnapshot(fetch,config,token)]);
assert.equal(snapshot.deploymentId,'bafd666f-a3c9-4251-8754-734766c89c6a','BASELINE_DEPLOYMENT_CHANGED');
assert.equal(snapshot.singleVersion,true);
assert.equal(snapshot.versions[0].id,'49489199-bfb4-43de-a9e9-51dd1834ec9a');
assert.equal(snapshot.bindingMatches,true);
assert.equal(snapshot.binding.namespaceFingerprint,'aedfbcd14cd1');
assert.ok(build.triggers.some(t=>t.id==='5827726d-2dc7-4544-ab7e-08a1169dcb20'&&t.checkedDeployCommand&&t.exactMainOnly&&t.rootDirectoryMatches),'CHECKED_BUILD_GATE_NOT_CONFIGURED');
console.log(JSON.stringify({status:'CANDIDATE_PREFLIGHT_PASSED',baseline:snapshot,checkedBuildGate:true,stableRelease:false}));
