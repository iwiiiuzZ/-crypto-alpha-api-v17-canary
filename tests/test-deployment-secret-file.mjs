import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {withDispatchSecretFile} from '../ops/dispatch-secret-file.mjs';
let file;
const result=withDispatchSecretFile('  synthetic-dedicated-secret  ',p=>{
 file=p;assert.equal(fs.statSync(p).mode&0o777,0o600);assert.equal(fs.statSync(path.dirname(p)).mode&0o777,0o700);
 assert.deepEqual(JSON.parse(fs.readFileSync(p,'utf8')),{GITHUB_ACTIONS_DISPATCH_TOKEN:'synthetic-dedicated-secret'});
 return 'deployed-fixture';
});
assert.equal(result,'deployed-fixture');assert.equal(fs.existsSync(file),false);assert.equal(fs.existsSync(path.dirname(file)),false);
assert.throws(()=>withDispatchSecretFile('synthetic',p=>{file=p;throw Error('UPLOAD_FAILED');}),/UPLOAD_FAILED/);
assert.equal(fs.existsSync(path.dirname(file)),false);
let calls=0;assert.equal(withDispatchSecretFile('',p=>{calls++;assert.equal(p,null);return 42;}),42);assert.equal(calls,1);
console.log('PASS dedicated secret atomic-upload file permissions, exact binding and cleanup after success/failure; missing input creates no file');
