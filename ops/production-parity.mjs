import {readFileSync} from 'node:fs';
export const DEPLOYED_R4={
 build:'crypto-alpha-worker-v27.6.3-macro-r4',
 sourceCommit:'2dff0194d8',
 deploymentId:'f18315e1-0726-4d3d-9f5e-4011f7770b5d',
 evidenceRun:'https://github.com/iwiiiuzZ/-crypto-alpha-api-v17-canary/actions/runs/41020415424'
};
export function assessSourceParity({candidateCommit,actualBuild,actualDeploymentId,manifest}){
 const sameCommit=typeof candidateCommit==='string'&&candidateCommit.startsWith(DEPLOYED_R4.sourceCommit);
 const gates={
  buildIdentity:actualBuild===DEPLOYED_R4.build,
  deploymentIdentity:actualDeploymentId===DEPLOYED_R4.deploymentId,
  sourceCommitSameAsProduction:sameCommit,
  declaredBuildMatchesProduction:manifest?.build===DEPLOYED_R4.build
 };
 return {passed:Object.values(gates).every(Boolean),gates,sourceMismatch:!sameCommit,
  interpretation:'SOURCE_PARITY_REQUIRED_BEFORE_PRODUCTION_RELEASE_CLAIM'};
}
if(process.argv[1]&&process.argv[1].endsWith('production-parity.mjs')){
 const manifest=JSON.parse(readFileSync(new URL('./release-manifest.json',import.meta.url),'utf8'));
 const result=assessSourceParity({candidateCommit:process.env.GITHUB_SHA,actualBuild:process.env.ACTUAL_PRODUCTION_BUILD,actualDeploymentId:process.env.ACTUAL_PRODUCTION_DEPLOYMENT_ID,manifest});
 console.log(JSON.stringify(result));if(!result.passed)process.exitCode=1;
}
