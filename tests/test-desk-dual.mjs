import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../main-v188.js", import.meta.url), "utf8");
const moduleSource = source + "\nexport {AlphaDeskDecision,AlphaDeskBridge};";
const { AlphaDeskDecision, AlphaDeskBridge, default: worker } = await import(
  "data:text/javascript;base64," + Buffer.from(moduleSource).toString("base64")
);

const { deskAnalysis, deskNetRR, expectedClosedAt } = {
  ...AlphaDeskDecision,
  expectedClosedAt: (time, duration) => Math.floor((time - 30000) / duration) * duration - duration,
};
const now = Date.now();
const iso = time => new Date(time).toISOString();
function quote(time, prices = {}) {
  return { status: "ok", source: "OKX_USDT_PERPETUAL", priceType: "LAST_TRADE_PLUS_REAL_BOOK",
    last: 100, bid: 99.99, ask: 100, lastTradeTimestamp: iso(time - 20), bookTimestamp: iso(time),
    exchangeTimestamp: iso(time - 20), ...prices };
}
function asset(symbol, target) {
  return {
    symbol: symbol + "USDT",
    ticker: quote(now),
    timeframes: Object.fromEntries(Object.entries({ "15m": 900000, "1h": 3600000, "4h": 14400000 }).map(([tf, length]) =>
      [tf, { status: "ok", source: "GATE_USDT_PERPETUAL", quality: { passed: true, newestClosedCandleAt: iso(expectedClosedAt(now, length)) },
        coordinator: { lastRefreshAt: iso(now) } }])),
    opportunityEngine: { checkedAt: iso(now), models: [{ submodel: "B1", state: "CANDIDATE_FOR_REVIEW", direction: "LONG",
      eventEvidence: { eventAt: iso(now - 60000), eventKey: "B1:synthetic" },
      candidate: { direction: "LONG", modelInvalidationPrice: 97, stopLoss: 95, target, estimatedRoundTripCostPct: .15,
        rrQualifiedEntryZone: { min: 99, max: 100 }, expiresAt: iso(now + 900000),
        liquidityPricing: { entryReviewPassed: true, liquidityAdjustedFirstTarget: target } },
    }] },
  };
}
const snapshot = { build: "fixture", apiVersion: "7.6.0", assets: { BTCUSDT: asset("BTC", 116), ETHUSDT: asset("ETH", 114) } };
let result = deskAnalysis(snapshot, { origin: "shared-worker", monitor: true, now });
assert.equal(result.assets.BTC.models.length, 8);
assert.equal(result.assets.ETH.models.length, 8);
assert.equal(result.best.asset, "BTC");
snapshot.assets.ETHUSDT = asset("ETH", 118);
result = deskAnalysis(snapshot, { origin: "shared-worker", monitor: true, now });
assert.equal(result.best.asset, "ETH");
assert.equal(deskNetRR("LONG", 100, 95, 110, .15) < 2, true);
assert.equal(deskNetRR("SHORT", 100, 105, 90, .15) < 2, true);
const btcPlan = result.assets.BTC.plans[0], ethPlan = result.assets.ETH.plans[0];
assert.equal(AlphaDeskBridge.confirmDeskArrival(btcPlan, [quote(now - 600), quote(now)], now).price, 100);
assert.equal(AlphaDeskBridge.confirmDeskArrival(btcPlan, [quote(now), quote(now)], now), null);
assert.equal(AlphaDeskBridge.confirmDeskArrival(btcPlan, [quote(now - 21000), quote(now)], now), null);
assert.equal(AlphaDeskBridge.confirmDeskArrival(btcPlan, [quote(now - 600), quote(now, { ask: 101, last: 101 })], now), null);
assert.equal(AlphaDeskBridge.confirmDeskArrival(btcPlan, [quote(now - 600), quote(now, { last: 120 })], now), null);
snapshot.assets.BTCUSDT.ticker = quote(now - 36000);
assert.equal(deskAnalysis(snapshot, { now }).assets.BTC.ready, false);

const state = new Map([["scanner:active-plan", { old: "ETH legacy" }]]);
const storage = {
  get: async key => structuredClone(state.get(key)),
  put: async (key, value) => state.set(key, structuredClone(value)),
  transaction: async operation => operation(storage),
};
const owner = { ctx: { storage } };
const bridge = AlphaDeskBridge.createDeskBridge({
  build: "fixture", analyse: async () => result, canMonitor: () => true,
  ensureMonitor: async () => ({ scheduled: true }), quote: async () => null, notify: async () => { throw new Error("unexpected"); },
});
let nonce = 0;
const change = (service, method, value) => service.change(owner, { method, value, nonce: String(++nonce) });
assert.equal((await change(bridge, "POST", btcPlan)).status, 200);
assert.equal((await change(bridge, "POST", ethPlan)).status, 200);
assert.equal((await change(bridge, "POST", btcPlan)).body.watches.length, 2);
const stopped = await change(bridge, "DELETE", btcPlan);
assert.equal(stopped.body.watches.find(w => w.plan.asset === "BTC").state, "CANCELLED");
assert.equal(stopped.body.watches.find(w => w.plan.asset === "ETH").state, "ACTIVE");
assert.equal((await bridge.status({ ctx: { storage } })).watches.length, 2);
assert.deepEqual(state.get("scanner:active-plan"), { old: "ETH legacy" });
const rejected = await worker.fetch(new Request("https://alpha.invalid/desk/v1/monitors"), {}, {});
assert.equal(rejected.status, 401);
console.log("PASS both asset ranking directions, 16 model rows, costs, stale samples, two fresh book samples, scoped cancellation, persistence, auth");
