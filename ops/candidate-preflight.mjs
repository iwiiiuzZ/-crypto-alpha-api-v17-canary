// This one-time engineering deployment is pinned to the audited source and baseline.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {cloudflareSnapshot,cloudflareBuildSnapshot} from './diagnostics.mjs';
const config=JSON.parse(fs.readFileSync(new URL('./config.json',import.meta.url),'utf8'));
assert.equal(createHash('sha256').update(fs.readFileSync(new URL('../main-v188.js',import.meta.url))).digest('hex'),'35802e78b6529a90cd83bb4cc4c5d4cec54f38de6dbe9dc3038d54a36fcb1b0f','UNREVIEWED_CANDIDATE_SOURCE');
const token=process.env.CLOUDFLARE_API_TOKEN;
const [snapshot,build]=await Promise.all([cloudflareSnapshot(fetch,config,token),cloudflareBuildSnapshot(fetch,config,token)]);
assert.equal(snapshot.deploymentId,'e4c13cb3-3de6-4bf7-b1a4-9ff75b77a771','BASELINE_DEPLOYMENT_CHANGED');
assert.equal(snapshot.singleVersion,true);
assert.equal(snapshot.versions[0].id,'2d167680-a6fb-4f67-9051-87d7e4e69ceb');
assert.equal(snapshot.bindingMatches,true);
assert.equal(snapshot.binding.namespaceFingerprint,'aedfbcd14cd1');
assert.ok(build.triggers.some(t=>t.id==='5827726d-2dc7-4544-ab7e-08a1169dcb20'&&t.checkedDeployCommand&&t.exactMainOnly&&t.rootDirectoryMatches),'CHECKED_BUILD_GATE_NOT_CONFIGURED');
console.log(JSON.stringify({status:'CANDIDATE_PREFLIGHT_PASSED',baseline:snapshot,checkedBuildGate:true,stableRelease:false}));
