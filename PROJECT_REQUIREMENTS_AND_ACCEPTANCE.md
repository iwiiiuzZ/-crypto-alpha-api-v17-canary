# Crypto Alpha Pro Ultimate — Project continuity and acceptance gates
Updated 2026-10-30. This is a consolidated working contract recovered from previous project conversations; where an older artifact conflicts, explicitly reconcile before release. No assertion that undocumented past requests have been independently re-verified.

## Product and scope
- ETH-USDT-SWAP (OKX USDT perpetual) is the sole executable market; BTC-USDT-SWAP acts as macro/market risk filter. Only true OKX executable bid, ask, last trades, verified timestamps and spreads qualify for execution; mark prices, stale caches or other exchange prices cannot masquerade as execution quotes.
- Primary holding period several days to approximately ten days or longer when warranted by structure. 4H for regime, 1H for confirmation and structure, 15m for execution triggers. 1D is supporting evidence; lack of 1D alone must not block a valid setup. Intraday opportunity model is subordinate.
- Scan all eight opportunity models A1,A2,B1,B2,C1,C2,D1,D2, including trend pullbacks, breakout/retest, compression/breakout, sweep/reversal, fake breakout/reentry and exceptional order-flow shocks, without artificially manufacturing trading opportunities. Per-model status, failed gate and next executable condition must be explicit.
- Net reward/risk >= 1:2 after realistic fees, spread and slippage. Entry, structural invalidation/stop, *first realistic target*, net RR, expiry and evidence timestamps must be checked before pre-executable observation and before trade permission.
- No automatic entry blocker from unverifiable psychology or unknown user's current leverage/position. Do retain risk disclosure, plan-level stop validity, exchange quotes/data permission gates and net RR checks. User's manual risk controls and historical loss lessons remain available.
- Final decision status: ✅ 允许开仓 / 🟡 等待确认 / 🔴 禁止开仓. Never claim market access/order execution when not actually configured.

## Market and event evidence
- OKX live quote and closed 15m/1h/4h bars checked first. Live trades, aggressive large orders, volume regime shift, OI, CVD and liquidity/price response are contextual, not guesses about individual whales. BTC can support/warn/veto ETH on measurable regime grounds.
- Sources: Jin10 authorized MCP, CoinDesk, Fed press and speeches, BLS CPI and employment releases plus release calendar, independent NY Fed calendar, BEA news releases and Bank of Japan official RSS (as new source additions). BLS HTTP 403 must be reported, never relabeled as success. Independent official alternatives must be labeled as alternatives rather than originating from BLS.
- Track FOMC/official speeches, CPI,PCE,PPI,payrolls,initial claims,BOJ, DXY, US 2Y/10Y yields, ETF/options and major geopolitical risks. **Do not represent a keyword mention as a confirmed rate decision, macro surprise, price cause or direction.** Distinguish feed HTTP status, parse validity, headline publication time, backend consumption time and price reaction. If direct DXY/yields/etc are unavailable, display NO_LIVE_QUOTE_CONNECTED.
- In high impact news, recompute eligibility against fresh market movement, do not chase expired entries or blindly convert a headline to trade direction.

## Continuous monitoring
- Cloudflare Worker + state owner (Durable Object) has per-minute cron, heartbeat, failure retries, cooldown, dedup, expiries and a stable notification queue. 3-level observation reminders: approaching / at price / conditions met. Observations must already have valid executable stop, first target, RR and permissions.
- Arrival alerts require two independent fresh OKX perpetual prices in the region; old candle extrema, fallback exchange, mark price and cached crossings are forbidden arrival proof.
- Scanner/news source checks must report each provider health; background refresh not equivalent to consumed current news; freshness may not be silently assumed after fetch failure.
- No synthetic signals, test notifications or changes to active plans during read-only acceptance.

## Deployment identity and delivery
- Current mainline SOURCE identifier as of project recovery: BUILD=crypto-alpha-worker-v27.6.2-owner-local-dispatch; API_VERSION=7.6.0; stateOwnerContract=owner-local-dispatch-v1. Verify **frontendBuild + stateOwnerBuild + stateOwnerContract + matched**, not frontend label alone. Canonical Wrangler main is `main-v188.js`.
- Production health, Cloudflare deployment, secrets, route authorization, durable-state owner identity, minute scanner persistence, notification delivery and latest news consumption all require live end-to-end verification. A passing synthetic unit test is not proof of production deployment.
- Preserve all previous requirements: zero recurring data cost where feasible, stable fallback without inventing live data, Chinese translations alongside English terms, eight-stage 32-lesson trading rules (30–32 reserved to study), separate winning/losing-trade archives, and historical losses included in pre-entry checks.
- Final user deliverable only after self-audit/regression: complete uploadable package, the exact number of files/locations to change, GitHub upload entry, OpenAPI architecture URL, sub-500-Chinese-character opening prompt, test and acceptance document, deployment identity verification, evidence for real news consumption and 3-level notification closed loop. User should not perform repeated intermediate tests.
- Make changes in an isolated branch; never overwrite production/main until verified. Do not expose bearer/Bark secrets.

## Known outstanding acceptance gates (2026-10-30)
1. Confirm the actual Cloudflare deployment matches the GitHub source and Durable Object state owner. External Worker URL could not be fetched in this chat; not accepted.
2. BLS release/CPI/employment endpoints reportedly HTTP 403 in old conversation. Preserve failure visibility; independent NY Fed calendar is only partial schedule coverage. The new BEA/BOJ branch is not deployed.
3. Integrate and test current, direct DXY and US Treasury 2Y/10Y yields if feasible without recurring paid source; if not, explicitly report no connected live source.
4. Demonstrate fresh headline ingestion and scanner consumption with timestamps (not just reachable feed), price response and no old-cache reuse.
5. Validate per-minute scanner, real notification retry/queue, observation triggers, no repeats, failure handling, clean version identities, UI GPT Action installation and no unauthorized signal/account mutation.
6. Full multi-cycle production regression and package-based final acceptance. Unit tests in the branch do not satisfy these gates.

## Critical source-of-truth divergence confirmed 2026-10-30
- Read-only production GET checks via GitHub Actions run [40996803289](https://github.com/iwiiiuzZ/-crypto-alpha-api-v17-canary/actions/runs/40996803289) returned: `/health` HTTP 200 with `build=crypto-alpha-worker-v27.6.3-acceptance-candidate-r3`, `apiVersion=7.6.0`, scanner configured; `/?view=diagnostics` HTTP 200 with scannerStateBinding=BOUND; `/openapi.json` HTTP 200 and 4 operations.
- GitHub `main` still reports `crypto-alpha-worker-v27.6.2-owner-local-dispatch`, API 7.6.0. The live V27.6.3-r3 source code has NOT been recovered and must be treated as authoritative where newer than repository baseline; **DO NOT merge/redeploy this branch over r3** until full source parity and newest fixes are reconciled.
- The live-readonly-probe failed its explicit v27.6.2 build-equality check because the actual live worker is *newer*, not because the endpoint was down. Code-only regression passed. Durable Object owner build and contract were not verified by these public GETs.
- Historical project notes say BOJ RSS had already parsed 45 items on 2026-10-29 in another workspace; our branch changes were prepared against an older GitHub source and must not be counted as shipping the live fix. BLS 403, full macro feeds, notification closed loop and GPT saved install remain unresolved.
- Old asset titled `Crypto_Alpha_V27_6_2_BackendFix(1).zip` exists in Project Library, but raw-byte materialization was denied here. Do not fabricate/recreate newest r3 source from a zip that cannot be read.
