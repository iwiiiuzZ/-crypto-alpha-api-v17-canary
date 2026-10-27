import assert from 'node:assert/strict';
// Exact expected changes to the old transport function, preserving every other line.
export function expectedResponseIsolation(old){
 const once=(a,b)=>{assert.equal(old.split(a).length-1,1);old=old.replace(a,b);};
 once('    const work=buildManualResponse(request,env,ctx);',
  '    // Share only inert data. A Response body belongs to its originating request\n'+
  '    // in workerd; cloning it from another handler fails or locks the stream.\n'+
  '    // Consume it in the creating handler, then build a fresh Response per caller.\n'+
  '    const work=buildManualResponse(request,env,ctx).then(async response=>({\n'+
  '      body:await response.text(),status:response.status,statusText:response.statusText,headers:[...response.headers],\n'+
  '    }));');
 once('timer=setTimeout(()=>resolve(marketFailureResponse("MARKET_RESPONSE_DEADLINE","SNAPSHOT_BUILD")),35000);','timer=setTimeout(()=>resolve(null),35000);');
 once('    return result.clone();','    if(result===null)return marketFailureResponse("MARKET_RESPONSE_DEADLINE","SNAPSHOT_BUILD");\n    return new Response(result.body,{status:result.status,statusText:result.statusText,headers:result.headers});');
 once('  if (!manualSnapshotWork) {','  const mode=new URL(request.url).searchParams.get("recheck")==="true"?"recheck":"normal";\n  if (!manualSnapshotWork.has(mode)) {');
 once('    manualSnapshotWork=work;','    manualSnapshotWork.set(mode,work);');
 once('work.finally(()=>{if(manualSnapshotWork===work)manualSnapshotWork=null;})','work.finally(()=>{if(manualSnapshotWork.get(mode)===work)manualSnapshotWork.delete(mode);})');
 once('Promise.race([manualSnapshotWork,new Promise(resolve=>{','Promise.race([manualSnapshotWork.get(mode),new Promise(resolve=>{');
 return old;
}
