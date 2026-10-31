// An automatic rebuild of the same verified source is a no-op. A changed UUID,
// namespace, source blob or owner never authorizes an implicit redeployment.
export function assessCurrentRelease({manifest,sourceGitBlobSha,baseline,cloudflare,fast}){
 const id=fast?.backendIdentity||{};
 const gates={
  verifiedWindow:baseline?.status==='PRODUCTION_WINDOW_VERIFIED_AWAITING_FINAL_ACCEPTANCE'&&baseline?.autonomousWindowPassed===true,
  immutableSource:!!sourceGitBlobSha&&manifest?.sourceGitBlobSha===sourceGitBlobSha&&baseline?.sourceGitBlobSha===sourceGitBlobSha,
  sameBuild:!!manifest?.build&&baseline?.build===manifest.build&&fast?.build===manifest.build,
  exactDeployment:!!baseline?.deploymentId&&cloudflare?.deploymentId===baseline.deploymentId,
  exactVersion:!!baseline?.versionId&&cloudflare?.singleVersion===true&&cloudflare?.versions?.length===1&&cloudflare.versions[0].id===baseline.versionId&&cloudflare.versions[0].percentage===100,
  sameNamespace:baseline?.namespaceFingerprint==='aedfbcd14cd1'&&cloudflare?.bindingMatches===true&&cloudflare?.binding?.namespaceFingerprint===baseline.namespaceFingerprint,
  ownerMatches:id.matched===true&&id.frontendBuild===manifest?.build&&id.stateOwnerBuild===manifest?.build&&id.stateOwnerContract===manifest?.stateOwnerContract,
  correctApi:fast?.apiVersion===manifest?.apiVersion
 };
 return {alreadyDeployed:Object.values(gates).every(Boolean),gates,failedGates:Object.keys(gates).filter(k=>!gates[k]),
  scope:'EXACT_PREVIOUSLY_VERIFIED_PHYSICAL_SOURCE_NO_REDEPLOYMENT_NOT_NEW_ACCEPTANCE'};
}
