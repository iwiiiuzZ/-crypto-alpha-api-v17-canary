# Crypto Alpha Pro Ultimate V27.6.3 — GPT install and release handoff (candidate, NOT FINAL)

## Single installation target
- Cloudflare Worker repository: https://github.com/iwiiiuzZ/-crypto-alpha-api-v17-canary
- Reviewed candidate branch: integration/r3-macro-news-20261030
- Wrangler entry point: main-v188.js (never substitute the legacy worker.js files)
- Durable Object binding: SCANNER_STATE / ScannerState; retain the same state namespace and migration tags.
- Cron: `* * * * *`
- OpenAPI Action: https://crypto-alpha-api-v17-canary.id-mranran.workers.dev/openapi.json
- GPT builder: https://chatgpt.com/g/g-6a7aa3acb8e48191a49c95d59396fa77-crypto-alpha-pro-ultimate-v13-1
- Action authentication: existing Bearer SCANNER_TOKEN, configured privately in the GPT builder and Worker; do not print, embed or commit the token.
- GPT Instructions: see `GPT_OPENING_V27_6_3_CANDIDATE.txt`; it is the requested under-500-Chinese-character starter, not the full immutable rulebook.

## Mandatory release process
1. Ensure candidate `npm test` passes both Node unit and native workerd suites, plus macro feed regressions. No weakening or skipping tests to greenlight.
2. Review exact candidate versus currently live build `crypto-alpha-worker-v27.6.3-acceptance-candidate-r3` and preserve all newer functions. Validate BUILD and backend identity against state owner.
3. Confirm BLS source errors remain visible (403); live BEA/BOJ successful fetch and parse alone do not prove backend scanner consumed news.
4. Confirm actual news publication/fetch/consume timestamps and price response, not cached records. Validate DXY and Treasury yields real-time source separately; otherwise mark unavailable.
5. Prove 1m scanner heartbeats, dedup, expiry, retries, 3-tier alerts, read-only audit, no fake messages, and no unauthorized order.
6. Only after approval and actual deployment, verify frontendBuild/stateOwnerBuild/stateOwnerContract/matched, GPT Action import and an end-to-end authenticated read-only operation.
7. Produce an actual uploadable ZIP containing tested Worker and correct configuration, full acceptance report, exact upload steps, and versioned rollback artifact. Never mark complete based solely on GitHub unit tests.

## Deployment control
Production deployment requires Cloudflare API credentials and explicit version-safe workflow. Existing `ops/deploy.mjs` refuses deployment when the full regression fails. This candidate has not been deployed by the present handoff; never tell the user it is the final build.
