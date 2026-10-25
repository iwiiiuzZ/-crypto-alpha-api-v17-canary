import assert from 'node:assert/strict';
import {configureBuildGate,EXPECTED_TRIGGER} from '../ops/configure-build-gate.mjs';
const config={accountId:'test-account',worker:'target'};
function fixture(change=()=>{},rejectPatch=false){
 const t={trigger_uuid:EXPECTED_TRIGGER,external_script_id:'tag',branch_includes:['main'],branch_excludes:[],root_directory:'/',deploy_command:'npx wrangler deploy',build_command:'',repo_connection_uuid:'private-repo-id',build_token_uuid:'private-token-id'};change(t);
 const preview={trigger_uuid:'preview',branch_includes:['*'],branch_excludes:['main'],deploy_command:'npx wrangler versions upload'};
 const requests=[];let patches=0;
 return {requests,get patches(){return patches;},fetch:async(u,o)=>{
  assert.equal(o.redirect,'error');requests.push({u,method:o.method});
  if(u.endsWith('/workers/scripts'))return Response.json({success:true,result:[{id:'unrelated',tag:'other'},{id:'target',tag:'tag'}]});
  if(o.method==='PATCH'){patches++;assert.equal(u,'https://api.cloudflare.com/client/v4/accounts/test-account/builds/triggers/'+EXPECTED_TRIGGER);assert.deepEqual(JSON.parse(o.body),{deploy_command:'npm run deploy:checked'});if(rejectPatch)return new Response('private-denial',{status:403});t.deploy_command='npm run deploy:checked';return Response.json({success:true,result:t});}
  assert.equal(u,'https://api.cloudflare.com/client/v4/accounts/test-account/builds/workers/tag/triggers');return Response.json({success:true,result:[t,preview]});
 }};
}
let f=fixture();let r=await configureBuildGate(f.fetch,config,'private-secret');assert.equal(r.status,'READY_TO_CONFIGURE');assert.equal(f.patches,0);
r=await configureBuildGate(f.fetch,config,'private-secret',{apply:true});assert.equal(r.status,'CONFIGURED_AND_READ_BACK');assert.equal(f.patches,1);assert.equal(r.buildStarted,false);assert.ok(!JSON.stringify(r).includes('private-'));
r=await configureBuildGate(f.fetch,config,'private-secret',{apply:true});assert.equal(r.status,'ALREADY_CONFIGURED');assert.equal(f.patches,1);
for(const change of [t=>t.branch_includes=['*'],t=>t.branch_excludes=['main'],t=>t.root_directory='/other',t=>t.external_script_id='other',t=>t.trigger_uuid='other',t=>t.build_command='unknown',t=>t.deploy_command='unknown']){
 f=fixture(change);await assert.rejects(()=>configureBuildGate(f.fetch,config,'private-secret',{apply:true}));assert.equal(f.patches,0);
}
f=fixture(()=>{},true);await assert.rejects(()=>configureBuildGate(f.fetch,config,'private-secret',{apply:true}),/^Error: BUILD_GATE_HTTP_403$/);
f=fixture();await assert.rejects(()=>configureBuildGate(f.fetch,config,'',{apply:true}),/MISSING_TOKEN/);assert.equal(f.requests.length,0);
console.log(JSON.stringify({passed:true,scope:'ISOLATED_BUILD_CONFIGURATION_GUARDS',productionChanged:false}));
