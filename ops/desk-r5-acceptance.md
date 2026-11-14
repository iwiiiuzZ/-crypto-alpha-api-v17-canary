# R5 candidate — not production acceptance

Owner requirements added 2026-11-14 (Beijing):
- Use the complete original opening, instructions and knowledge with actual API receipts. A deterministic scan is not an LLM review.
- Automatically register each published paper plan, freeze its prices, simulate entry/exit and show per-trade net outcomes plus aggregate statistics. No real-account trading is authorized.
- Consume timestamped candles, order flow, CVD, footprint and liquidity as analysis evidence; disclose incomplete coverage and verify the backend receives the data shown in the browser.
- Diagnose recurring data failures and prevent recovery/failure notification chatter without hiding current faults.
- Add ZEC only after instrument metadata, data coverage, execution costs and model validation are implemented.

Implemented in this candidate:
- Signed Worker AI bridge using the existing Worker secret, strict request envelope, fixed provider destination, server-selected model, atomic budget/reservation and owner-bound response lookup. Unknown POST outcomes never cause automatic resubmission.
- One frozen paper ticket per event, including before entry. Recomputed model revisions do not replace that ticket. Arrival requires BOTH the original ticket and current model to pass.
- First fault alerts immediately; recovery requires at least 60 seconds of continuously healthy scans. Current health remains visible while recovering.

Outstanding acceptance (do not mark complete):
- Site adapter to this bridge, configured model, actual provider request and response validation; full rule/evidence hashes.
- Unattended AI re-evaluation and result notifications.
- Full ledger pagination/aggregate statistics, entry and exit replay using sufficiently complete price evidence; never invent profits in gaps or recast expired non-entries as losses.
- Investigate actual production data failure causes; notification debounce does not repair feeds.
- Browser/backend order-flow coverage parity and full footprint integration.
- ZEC exchange metadata, contract conversion, feeds, models, costs, forward simulation and interface.
- Full tests, controlled deployment, production identities and phone receipt acceptance.

ZEC research sources (retrieved 2026-11-14):
- https://www.okx.com/en-gb/help/okx-to-list-perpetual-futures-for-dash-zec-crypto — official listing reference; current contract parameters must be read dynamically, not copied from the old notice.
- https://jesse.trade/strategies/zecsttrend6538-31 — community historical backtest advertises 100% on only 3 trades. The page's date filter and equity dates differ. This is NOT proof of a high-win-rate system and is not adopted as a performance claim.

Candidate research families, not approved strategies: trend/pullback, breakout/retest with volume/OI confirmation, and range sweep/reclaim with flow confirmation. Compare untouched chronological holdouts including fees, funding and slippage; track sample count, net expectancy, win rate, drawdown and uncertainty. No guaranteed win rate.
