import fs from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { cloudflareSnapshot, requestJson } from "./diagnostics.mjs";
import { assessCurrentRelease } from "./current-release.mjs";

export const DESK_BUILD = "crypto-alpha-worker-v27.6.3-desk-dual-r1";

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
  if (!reviewed.alreadyDeployed || scanner.status !== "ok" || scanner.build !== baseline.build) {
    throw new Error("DESK_PRIOR_DEPLOYMENT_STATE_OR_AUTH_MISMATCH");
  }
  console.log(JSON.stringify({ stage: "desk-preflight", build: baseline.build, deploymentId: cloudflare.deploymentId,
    namespaceFingerprint: cloudflare.binding?.namespaceFingerprint }));
}

export async function deskPostflight(config, manifest, env = process.env) {
  const modelNames = "A1,A2,B1,B2,C1,C2,D1,D2";
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const [fast, desk, scanner, cloudflare] = await Promise.all([
        requestJson(fetch, config.origin + "/?view=fast"),
        requestJson(fetch, config.origin + "/?view=desk"),
        requestJson(fetch, config.origin + "/scanner/status", { authorization: "Bearer " + env.SCANNER_TOKEN }),
        cloudflareSnapshot(fetch, config, env.CLOUDFLARE_API_TOKEN),
      ]);
      const modelsOk = ["BTC", "ETH"].every(symbol => desk.assets?.[symbol]?.models?.map(row => row.model).sort().join(",") === modelNames);
      if (fast.build === manifest.build && fast.backendIdentity?.matched === true && scanner.build === manifest.build
          && scanner.status === "ok" && desk.origin === "shared-worker" && desk.build === manifest.build
          && modelsOk && cloudflare.bindingMatches === true && cloudflare.singleVersion) {
        console.log(JSON.stringify({ stage: "desk-postflight", build: manifest.build, deploymentId: cloudflare.deploymentId,
          namespaceFingerprint: cloudflare.binding?.namespaceFingerprint, twoModelSets: true,
          assets: Object.fromEntries(["BTC", "ETH"].map(symbol => [symbol, { ready: desk.assets[symbol].ready,
            quoteReady: desk.assets[symbol].quote?.ready, quoteIndependent: desk.assets[symbol].quote?.independent }])),
          phoneReceiptVerified: false }));
        return;
      }
    } catch { /* allow edge propagation before declaring the result unverified */ }
    await delay(6000);
  }
  throw new Error("DESK_POSTFLIGHT_NOT_VERIFIED");
}
