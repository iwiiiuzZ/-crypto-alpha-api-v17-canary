import fs from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { cloudflareSnapshot, requestJson } from "./diagnostics.mjs";
import { assessCurrentRelease } from "./current-release.mjs";

export const DESK_BUILD = "crypto-alpha-worker-v27.6.3-desk-dual-r3";

export function isAuthorizedDeskDispatch(env = process.env) {
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
  const reviewed = assessCurrentRelease({ manifest: baseline, sourceGitBlobSha: baseline.sourceGitBlobSha, baseline, cloudflare, fast });
  if (!reviewed.alreadyDeployed || scanner.status !== "ok" || scanner.build !== baseline.build
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
