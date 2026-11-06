import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// Add the dedicated repository secret atomically with the new Worker version.
// Never place it in argv, configuration, source, evidence or an intermediate live version.
export function withDispatchSecretFile(secret,action){
 if(!String(secret||'').trim())return action(null);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'crypto-dispatch-secret-'));
 try{
  fs.chmodSync(dir,0o700);
  const file=path.join(dir,'bindings.json');
  fs.writeFileSync(file,JSON.stringify({GITHUB_ACTIONS_DISPATCH_TOKEN:String(secret).trim()}),{mode:0o600,flag:'wx'});
  return action(file);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
