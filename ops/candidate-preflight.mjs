// This one-time engineering deployment is pinned to the audited source and baseline.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {cloudflareSnapshot,cloudflareBuildSnapshot} from './diagnostics.mjs';
const config=JSON.parse(fs.readFileSync(new URL('./config.json',import.meta.url),'utf8'));
assert.equal(createHash('sha256').update(fs.readFileSync(new URL('../main-v188.js',import.meta.url))).digest('hex'),'01cd317f84491a16e4d6753ef15dc7a0391814ed42218b94f19beb43d1fb3708','UNREVIEWED_CANDIDATE_SOURCE');
const token=process.env.CLOUDFLARE_API_TOKEN;
const [snapshot,build]=await Promise.all([cloudflareSnapshot(fetch,config,token),cloudflareBuildSnapshot(fetch,config,token)]);
assert.equal(snapshot.deploymentId,'2b81dd1d-1e68-42a5-aaa7-8891877a225f','BASELINE_DEPLOYMENT_CHANGED');
assert.equal(snapshot.singleVersion,true);
assert.equal(snapshot.versions[0].id,'01262a00-bd64-4051-a979-c0aeba40dbf0');
assert.equal(snapshot.bindingMatches,true);
assert.equal(snapshot.binding.namespaceFingerprint,'aedfbcd14cd1');
assert.ok(build.triggers.some(t=>t.id==='5827726d-2dc7-4544-ab7e-08a1169dcb20'&&t.checkedDeployCommand&&t.exactMainOnly&&t.rootDirectoryMatches),'CHECKED_BUILD_GATE_NOT_CONFIGURED');
console.log(JSON.stringify({status:'CANDIDATE_PREFLIGHT_PASSED',baseline:snapshot,checkedBuildGate:true,stableRelease:false}));
