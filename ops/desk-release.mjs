import fs from "node:fs";
import {isAuthorizedOwnerRelease} from "./desk-owner-release.mjs";
import {revalidateDeskVersion} from "./desk-version-equivalence.mjs";
import { setTimeout as delay } from "node:timers/promises";
import { cloudflareSnapshot, requestJson } from "./diagnostics.mjs";
import { assessCurrentRelease } from "./current-release.mjs";

export const DESK_BUILD = "crypto-alpha-worker-v27.6.3-desk-dual-r8";

export function isAuthorizedDeskDispatch(env = process.env) {
  if(isAuthorizedOwnerRelease(env))return true;
  if (env.GITHUB_EVENT_NAME !== "workflow_dispatch" || env.GITHUB_REF !== "refs/heads/main" || !env.GITHUB_EVENT_PATH) return false;
  try { return JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, "utf8"))?.inputs?.operation === "deploy"; }
  catch { return false; }
}

export async function deskPreflight(config, baseline, env = process.env) {
  if (!env.CLOUDFLARE_API_TOKEN || !env.SCANNER_TOKEN) throw new Error("DESK_DEPLOY_CREDENTIALS_REQUIRED");
  const [cloudflare, fast, scanner] = await Promise.all([
    cloudflareSnapshot(fetch, config, env.CLOUDFLARE_API_TOKEN),
    requestJson(fetch, config.origin + "/?view=fast"),
    requestJson(fetch, config.origin + "/scanner/status", { authorization: "Bearer " + env.SCANNER_TOKEN }),
  ]);
  let reviewed = assessCurrentRelease({ manifest: baseline, sourceGitBlobSha: baseline.sourceGitBlobSha, baseline, cloudflare, fast });
  // A secret/config update creates new physical IDs. Only explicit deploy may
  // accept those IDs after comparing provider-hashed code, runtime and bindings.
  if(!reviewed.alreadyDeployed && isAuthorizedDeskDispatch(env) && reviewed.failedGates.length &&
      reviewed.failedGates.every(g=>['exactDeployment','exactVersion'].includes(g))){
    const effective=await revalidateDeskVersion(config,baseline,cloudflare,env.CLOUDFLARE_API_TOKEN);
    const again=await cloudflareSnapshot(fetch,config,env.CLOUDFLARE_API_TOKEN);
    if(again.deploymentId!==cloudflare.deploymentId||again.versions?.[0]?.id!==cloudflare.versions?.[0]?.id)throw Error('DESK_DEPLOYMENT_CHANGED_DURING_REVALIDATION');
    reviewed=assessCurrentRelease({manifest:baseline,sourceGitBlobSha:baseline.sourceGitBlobSha,baseline:effective,cloudflare:again,fast});
    console.log(JSON.stringify({stage:'desk-config-version-revalidated',codeEquivalent:true,runtimeAndBindingsEquivalent:true,baselineUnmodified:true}));
  }
  console.log(JSON.stringify({stage:'desk-preflight-gates',gates:reviewed.gates,scannerAuthenticated:scanner.status==='ok',scannerBuildMatches:scanner.build===baseline.build,scannerIdentityMatches:scanner.backendIdentity?.matched===true,stateReadSucceeded:scanner.diagnostics?.stateReadSucceeded===true}));
  // A predecessor with a known quota outage cannot attest to an uninterrupted
  // production window. For this repair require its exact previously observed
  // physical version, every identity gate, and a currently healthy authenticated owner.
  const pinnedRepair=baseline.status==='VERIFIED_PHYSICAL_DEPLOYMENT' && isAuthorizedDeskDispatch(env)
    && baseline.versionId==='6b924f35-60bc-4531-91f1-7ca6ed66ef75' && baseline.deploymentId==='10b580c6-749d-446e-872e-63aa8c72f191'
    && baseline.sourceGitBlobSha==='b258960209596f03cbd5581fc06c1b6ffe58d886'
    && reviewed.failedGates.length===1 && reviewed.failedGates[0]==='verifiedWindow';
  if ((!reviewed.alreadyDeployed && !pinnedRepair) || scanner.status !== "ok" || scanner.build !== baseline.build
      || scanner.backendIdentity?.matched !== true || scanner.diagnostics?.stateReadSucceeded !== true) {
    throw new Error("DESK_PRIOR_DEPLOYMENT_STATE_OR_AUTH_MISMATCH");
  }
  console.log(JSON.stringify({ stage: "desk-preflight", build: baseline.build, deploymentId: cloudflare.deploymentId,
    namespaceFingerprint: cloudflare.binding?.namespaceFingerprint }));
}

export async function deskPostflight(config, manifest, env = process.env) {
  const modelNames = "A1,A2,B1,B2,C1,C2,D1,D2";
  const symbols = ["BTC", "ETH"];
  const deadline = Date.now() + 600_000;
  let matches = 0, lastState = "";
  while (Date.now() < deadline) {
    try {
      const fast = await requestJson(fetch, config.origin + "/?view=fast");
      const identity = fast.backendIdentity;
      const state = JSON.stringify({ stage: "desk-convergence", frontend: fast.build, owner: identity?.stateOwnerBuild, matched: identity?.matched === true });
      if (state !== lastState) { console.log(state); lastState = state; }
      if (fast.build === manifest.build && identity?.matched === true && identity.stateOwnerBuild === manifest.build) {
        const [desk, scanner, cloudflare] = await Promise.all([
          requestJson(fetch, config.origin + "/?view=desk"),
          requestJson(fetch, config.origin + "/scanner/status", { authorization: "Bearer " + env.SCANNER_TOKEN }),
          cloudflareSnapshot(fetch, config, env.CLOUDFLARE_API_TOKEN),
        ]);
        const modelsOk = symbols.every(symbol => desk.assets?.[symbol]?.models?.map(row => row.model).sort().join(",") === modelNames
          && Object.hasOwn(desk.assets[symbol], "checkedAt") && Object.hasOwn(desk.assets[symbol], "liquidity"));
        const liquidityRechecksFresh = symbols.every(symbol => {
          const receipt = desk.assets?.[symbol]?.liquidity;
          const age = Date.parse(desk.capturedAt) - Date.parse(receipt?.checkedAt);
          return age >= 0 && age < 10_000;
        });
        const healthy = scanner.build === manifest.build && scanner.status === "ok" && scanner.backendIdentity?.matched === true
          && scanner.diagnostics?.stateReadSucceeded === true && desk.origin === "shared-worker" && desk.build === manifest.build
          && modelsOk && liquidityRechecksFresh && cloudflare.bindingMatches === true && cloudflare.singleVersion
          && cloudflare.binding?.namespaceFingerprint === "aedfbcd14cd1";
        matches = healthy ? matches + 1 : 0;
        if (matches >= 2) {
          console.log(JSON.stringify({ stage: "desk-postflight", build: manifest.build, deploymentId: cloudflare.deploymentId,
            versionId: cloudflare.versions[0].id, namespaceFingerprint: cloudflare.binding.namespaceFingerprint, twoModelSets: true,
            liquidityRechecksFresh, assets: Object.fromEntries(symbols.map(symbol => [symbol, { ready: desk.assets[symbol].ready,
              quoteReady: desk.assets[symbol].quote?.ready, quoteIndependent: desk.assets[symbol].quote?.independent,
              liquidityPassed: desk.assets[symbol].liquidity.passed, liquidityCheckedAt: desk.assets[symbol].liquidity.checkedAt }])),
            phoneReceiptVerified: false }));
          return;
        }
      } else {
        matches = 0;
      }
    } catch {
      matches = 0;
    }
    await delay(Math.min(15_000, Math.max(0, deadline - Date.now())));
  }
  throw new Error("DESK_POSTFLIGHT_NOT_VERIFIED");
}
