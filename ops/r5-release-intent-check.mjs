import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {PRIOR_BASELINE,R5_BUILD} from './r5-preflight.mjs';

export function verifyR5ReleaseIntent({intent,manifest,actualGitBlob,parentCommit,changedFiles}){
 const gates={
  explicitApproval:intent?.approved===true&&intent?.purpose==='R5_STABLE_PRODUCTION_RELEASE',
  reviewedCommit:typeof parentCommit==='string'&&/^[0-9a-f]{40}$/i.test(parentCommit)&&intent?.reviewedCommit===parentCommit,
  onlyIntentChanged:Array.isArray(changedFiles)&&changedFiles.length===1&&changedFiles[0]==='ops/r5-release-intent.json',
  immutableSource:actualGitBlob===manifest?.sourceGitBlobSha&&intent?.sourceGitBlobSha===actualGitBlob,
  candidateBuild:intent?.build===R5_BUILD&&manifest?.build===R5_BUILD&&manifest?.status==='CANDIDATE_NOT_DEPLOYED',
  lockedPriorProduction:intent?.priorDeploymentId===PRIOR_BASELINE.deploymentId&&manifest?.priorLiveBuild===PRIOR_BASELINE.build,
  rollbackRequired:intent?.rollbackOnFailure===true,
  noTradeMutation:intent?.noOrderExecution===true
 };
 return {passed:Object.values(gates).every(Boolean),gates,failedGates:Object.keys(gates).filter(k=>!gates[k]),scope:'R5_EXPLICIT_REVIEWED_COMMIT_RELEASE_INTENT'};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const intent=JSON.parse(fs.readFileSync(new URL('./r5-release-intent.json',import.meta.url),'utf8'));
 const manifest=JSON.parse(fs.readFileSync(new URL('./release-manifest.json',import.meta.url),'utf8'));
 const source=fs.readFileSync(new URL('../main-v188.js',import.meta.url));
 const actualGitBlob=createHash('sha1').update(Buffer.from('blob '+source.length)).update(Buffer.from([0])).update(source).digest('hex');
 const parentCommit=execFileSync('git',['rev-parse','HEAD^'],{encoding:'utf8'}).trim();
 const changedFiles=execFileSync('git',['diff','--name-only','HEAD^','HEAD'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
 const result=verifyR5ReleaseIntent({intent,manifest,actualGitBlob,parentCommit,changedFiles});
 console.log(JSON.stringify(result));
 if(!result.passed)process.exitCode=1;
}
