// Public reachability must match the pinned observed production baseline, never
// an obsolete build literal or an undeployed candidate manifest.
// NEVER requests full snapshot or scanner cycles,
// and never accesses plan, test-push or other authenticated/mutating endpoints.
import fs from 'node:fs';
const baseline=JSON.parse(fs.readFileSync(new URL('../ops/production-baseline.json',import.meta.url),'utf8'));
if(!baseline.build||!baseline.apiVersion)throw Error('PINNED_PRODUCTION_BASELINE_REQUIRED');
const base="https://crypto-alpha-api-v17-canary.id-mranran.workers.dev";
let failed=false;
for(const [name,path] of [["health","/health"],["diagnostics","/?view=diagnostics"],["openapi","/openapi.json"]]){
  try{
    const response=await fetch(base+path,{headers:{accept:"application/json"},signal:AbortSignal.timeout(12000)});
    const type=response.headers.get("content-type")||"";
    if(!type.includes("json"))throw new Error("NON_JSON_RESPONSE_HTTP_"+response.status);
    const data=await response.json();
    const detail=name==="health"
      ? {build:data.build,apiVersion:data.apiVersion,status:data.status,scannerConfigured:data.scanner?.stateConfigured}
      :name==="diagnostics"
      ? {build:data.build,apiVersion:data.apiVersion,workerReached:data.workerReached,scannerStateBinding:data.scannerStateBinding,monitoringState:data.monitoringState}
      :{version:data.info?.version,operationCount:Object.values(data.paths||{}).reduce((n,p)=>n+Object.keys(p).length,0)};
    const ok=response.ok&&(name==="health"
      ? detail.build===baseline.build&&detail.apiVersion===baseline.apiVersion&&detail.status==='ok'&&detail.scannerConfigured===true
      :name==="diagnostics"
      ? detail.build===baseline.build&&detail.apiVersion===baseline.apiVersion&&detail.workerReached===true&&detail.scannerStateBinding==='BOUND'
      :detail.version===baseline.apiVersion&&detail.operationCount===4);
    if(!ok)failed=true;
    console.log(JSON.stringify({probe:name,httpStatus:response.status,pass:ok,scope:'PUBLIC_REACHABILITY_NOT_FULL_PRODUCTION_ACCEPTANCE',...detail}));
  }catch(error){
    failed=true;
    console.log(JSON.stringify({probe:name,pass:false,error:String(error.message).slice(0,150)}));
  }
}
if(failed)process.exitCode=1;
