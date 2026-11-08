import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInContext } from "node:vm";
import { fixture, market } from "./v24-fixtures.mjs";

const source = await readFile(new URL("../main-v188.js", import.meta.url), "utf8");
const moduleSource = source + "\nexport {AlphaDeskDecision,AlphaDeskBridge,buildDeskOpportunityScan,discoverRangeReversalBase};";
const { AlphaDeskDecision, AlphaDeskBridge, buildDeskOpportunityScan, discoverRangeReversalBase, default: worker } = await import(
  "data:text/javascript;base64," + Buffer.from(moduleSource).toString("base64")
);

const { deskAnalysis, deskNetRR, expectedClosedAt } = {
  ...AlphaDeskDecision,
  expectedClosedAt: (time, duration) => Math.floor((time - 30000) / duration) * duration - duration,
};
const now = Date.now();
const iso = time => new Date(time).toISOString();
const closedBarAt = iso(expectedClosedAt(now, 900000));
const models = ["A1", "A2", "B1", "B2", "C1", "C2", "D1", "D2"];
function quote(time, prices = {}) {
  return { status: "ok", source: "OKX_USDT_PERPETUAL", priceType: "LAST_TRADE_PLUS_REAL_BOOK",
    last: 100, bid: 99.99, ask: 100, lastTradeTimestamp: iso(time - 20), bookTimestamp: iso(time),
    exchangeTimestamp: iso(time - 20), ...prices };
}
function pricing(target, zone, rest = {}) {
  return { status: "REFERENCE_PRICED", checkedAt: iso(now), validUntil: iso(now + 10000), freshRecheckPassed: true,
    entryReviewPassed: true, temporaryObstacleReviewRequired: false, reasons: [], liquidityAdjustedFirstTarget: target,
    rrQualifiedEntryZone: zone, ...rest };
}
function auditRows(...entries) {
  return models.map(submodel => entries.find(entry => entry.submodel === submodel) ?? { submodel, state: "NO_SETUP" });
}
function asset(symbol, target) {
  return {
    symbol: symbol + "USDT",
    ticker: quote(now),
    timeframes: Object.fromEntries(Object.entries({ "15m": 900000, "1h": 3600000, "4h": 14400000 }).map(([tf, length]) =>
      [tf, { status: "ok", source: "GATE_USDT_PERPETUAL", quality: { passed: true, newestClosedCandleAt: iso(expectedClosedAt(now, length)) },
        coordinator: { lastRefreshAt: iso(now) } }])),
    crossVenueLiquidity: { status: "ok", checkedAt: iso(now), connectedVenues: ["OKX", "BYBIT"],
      arrivalRecheck: { independentVenueCount: 2, passed: true } },
    opportunityEngine: { checkedAt: iso(now), closedBarAt, models: auditRows({ submodel: "B1", state: "CANDIDATE_FOR_REVIEW", direction: "LONG",
      eventEvidence: { eventAt: closedBarAt, eventKey: "B1:synthetic" },
      candidate: { direction: "LONG", modelInvalidationPrice: 97, stopLoss: 95, target, estimatedRoundTripCostPct: .15,
        rrQualifiedEntryZone: { min: 99, max: 100 }, expiresAt: iso(now + 900000),
        liquidityPricing: pricing(target, { min: 99, max: 100 }) },
    }) },
  };
}
const snapshot = { build: "fixture", apiVersion: "7.6.0", assets: { BTCUSDT: asset("BTC", 116), ETHUSDT: asset("ETH", 114) } };
let result = deskAnalysis(snapshot, { origin: "shared-worker", monitor: true, now });
assert.equal(result.assets.BTC.models.length, 8);
assert.equal(result.assets.ETH.models.length, 8);
assert.equal(result.assets.BTC.closedBarAt, closedBarAt);
assert.equal(result.assets.BTC.liquidity.passed, true);
assert.equal(result.best.asset, "BTC");

// Exercise the production shared scan, including a concurrent ETH recheck.
const deskFixture = fixture();
deskFixture.advance(now - deskFixture.now());
const runtimeSnapshot = structuredClone(snapshot);
runtimeSnapshot.assets.ETHUSDT.crossVenueLiquidity.checkedAt = iso(now - 60000);
const ethStarted = Promise.withResolvers(), releaseEth = Promise.withResolvers();
const sampledSymbols = [], fallbackSymbols = [];
let ethUnavailable = false;
deskFixture.c.deskSnapshot = async () => structuredClone(runtimeSnapshot);
deskFixture.c.deskModels = asset => asset.opportunityEngine;
deskFixture.c.deskLiquidity = async (_owner, _publicOwner, _modules, symbol) => {
  sampledSymbols.push(symbol);
  if (symbol === "ETH") {
    ethStarted.resolve();
    await releaseEth.promise;
    if (ethUnavailable) throw Error("TEST_ETH_LIQUIDITY_OUTAGE");
  }
  return { ...runtimeSnapshot.assets[symbol + "USDT"].crossVenueLiquidity, checkedAt: iso(now), executionQuote: quote(now) };
};
deskFixture.c.deskFallback = async (_owner, symbol) => {
  fallbackSymbols.push(symbol);
  return quote(now);
};
const runtime = runInContext(`
  buildSnapshot = deskSnapshot;
  buildDeskOpportunityScan = deskModels;
  sampleCrossVenueLiquidity = deskLiquidity;
  deskDirectQuote = deskFallback;
  ({ scan: sharedDeskAnalysis, collect: collectCrossVenueLiquidity });
`, deskFixture.c);
const runtimeOwner = { ctx: {}, env: {} };
const scan = runtime.scan(runtimeOwner, true);
await ethStarted.promise;
const concurrentRecheck = runtime.collect(runtimeOwner, {});
releaseEth.resolve();
const [refreshed, ethRecheck] = await Promise.all([scan, concurrentRecheck]);
assert.deepEqual(sampledSymbols.sort(), ["BTC", "ETH"], "concurrent ETH readers share one fresh collection");
assert.deepEqual(fallbackSymbols, [], "fresh two-venue reports provide the execution quotes");
assert.equal(refreshed.assets.BTC.liquidity.checkedAt, iso(now));
assert.equal(refreshed.assets.ETH.liquidity.checkedAt, ethRecheck.checkedAt);
assert.equal(refreshed.assets.ETH.liquidity.passed, true, "the scan must replace the expired ETH cache");
ethUnavailable = true;
const unavailable = await runtime.scan(runtimeOwner, true);
assert.deepEqual(fallbackSymbols, ["ETH"]);
assert.equal(unavailable.assets.ETH.quote.ready, true);
assert.equal(unavailable.assets.ETH.liquidity.passed, false, "a current OKX quote cannot replace an unavailable cross-venue review");
assert.equal(unavailable.assets.ETH.liquidity.reason, "LIQUIDITY_RECHECK_FAILED");

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

// Recorded 2244.37 bid and D1 zone replayed as inputs, using a synthetic target.
// No target, fill or notification from the historical market is asserted.
const d1Asset = asset("ETH", 114);
const d1Zone = { min: 2241.265, max: 2242.4687 };
const d1Target = 2205;
const d1Stop = 2249.0532;
const d1 = { submodel: "D1", state: "WAIT_PRICE", direction: "SHORT", stopLoss: d1Stop, target: d1Target,
  estimatedRoundTripCostPct: .15, rrQualifiedEntryZone: d1Zone,
  eventEvidence: { eventAt: closedBarAt, eventKey: "D1:synthetic", expiresAt: iso(now + 900000), direction: "SHORT",
    boundary: 2242.5, protectivePrice: 2247.34, frozenEntryZone: d1Zone, triggerAt: closedBarAt },
  liquidityPricing: pricing(d1Target, d1Zone, { entryReviewPassed: false, reasons: ["CURRENT_PRICE_OUTSIDE_MODEL_ZONE"] }),
};
const b1 = { submodel: "B1", state: "WAIT_RETEST", direction: "SHORT", candidate: null,
  eventEvidence: { eventAt: closedBarAt, boundary: 2242.5, retestBand: { min: 2241.8, max: 2243.2 },
    retestCloseRule: { operator: "<", level: 2242.5 }, twoCloseInvalidation: { operator: ">", level: 2242.9, count: 2 } } };
d1Asset.opportunityEngine.models = auditRows(d1, b1);
d1Asset.ticker = quote(now, { last: 2244.38, bid: 2244.37, ask: 2244.38 });
const d1Scan = () => deskAnalysis({ assets: { ETHUSDT: d1Asset }, newsContext: { sources: { JIN10: {
  status: "unavailable", fetchedAt: iso(now - 5000), reason: "FIXTURE_ONLY", transportAgeSeconds: 5 } } } }, { now });
const waiting = d1Scan();
assert.equal(waiting.best, null);
assert.equal(waiting.waiting.state, "WAIT_PRICE");
assert.equal(waiting.waiting.current, 2244.37);
assert.equal(waiting.waiting.low, d1Zone.min);
assert.equal(waiting.waiting.high, d1Zone.max);
assert.equal(waiting.waiting.stop, d1Stop);
assert.equal(waiting.waiting.invalidation, 2247.34);
assert.equal(waiting.waiting.monitorable, true);
assert.equal(waiting.assets.ETH.models.find(row => row.model === "B1").next, "等 15 分钟收盘 < 2242.5");
assert.equal(waiting.assets.ETH.models.find(row => row.model === "D1").evidence.protectivePrice, 2247.34);
assert.equal(waiting.newsSources[0].reason, "FIXTURE_ONLY");
d1Asset.ticker = quote(now, { last: 2242.01, bid: 2242, ask: 2242.01 });
d1.liquidityPricing = undefined;
const absentLiquidity = d1Scan().waiting;
assert.equal(absentLiquidity.state, "WAIT_LIQUIDITY");
assert.equal(absentLiquidity.monitorable, false);
d1.liquidityPricing = pricing(d1Target, d1Zone, { entryReviewPassed: false, temporaryObstacleReviewRequired: true,
  reasons: ["TEMPORARY_OBSTACLE_RECHECK_REQUIRED"] });
const temporaryObstacle = d1Scan().waiting;
assert.equal(temporaryObstacle.state, "WAIT_LIQUIDITY");
assert.equal(temporaryObstacle.monitorable, false);
d1.liquidityPricing = pricing(d1Target, d1Zone, { checkedAt: iso(now - 15000), validUntil: iso(now - 5000) });
assert.equal(d1Scan().waiting.monitorable, false);
d1.liquidityPricing = pricing(d1Target, d1Zone);
assert.equal(d1Scan().best.state, "REVIEW");
d1Asset.ticker = quote(now, { last: 2247.35, bid: 2247.33, ask: 2247.35 });
assert.equal(d1Scan().assets.ETH.plans.length, 0);
d1Asset.ticker = quote(now, { last: 2242.01, bid: 2242, ask: 2242.01 });
d1Asset.opportunityEngine.models = [d1, b1];
assert.equal(d1Scan().assets.ETH.ready, false, "missing model rows never pass scan readiness");

const native = market(now).assets.BTCUSDT;
native.symbol = "BTCUSDT";
native.ticker = quote(now, { last: 103.8, bid: 103.79, ask: 103.81 });
native.rangeContext = { confirmed: false, locationZone: "MIDDLE" };
const nativeBars = native.timeframes["15m"].recentCandles;
nativeBars.forEach(c => Object.assign(c, { o: 100, h: 101, l: 99, c: 100, volume: 100 }));
Object.assign(nativeBars.at(-1), { o: 100.7, h: 104, l: 100.5, c: 103.8, volume: 220 });
native.timeframes["15m"].indicators.atr14 = 2;
const nativeD1 = (a, context) => buildDeskOpportunityScan(a, context).models.find(row => row.submodel === "D1");
assert.ok(nativeD1(native, null).candidate, "real BTC D1 must not require a separate BTC structure");
assert.equal(nativeD1({ ...native, symbol: "ETHUSDT" }, null).failedGate, "BTC_STRUCTURE_DATA_UNAVAILABLE");
Object.assign(nativeBars.at(-3), { o: 100.7, h: 104, l: 100.5, c: 103.8, volume: 220 });
Object.assign(nativeBars.at(-2), { o: 101.8, h: 102.4, l: 100.9, c: 101.4 });
Object.assign(nativeBars.at(-1), { o: 101.4, h: 103.5, l: 101.3, c: 103, volume: 100 });
native.ticker = quote(now, { last: 102.9, bid: 102.89, ask: 102.91 });
const nativeB1 = buildDeskOpportunityScan(native, null).models.find(row => row.submodel === "B1");
assert.ok(nativeB1.candidate, "real BTC B1 retest and trigger can qualify using its own structure");

const range = market(now).assets.BTCUSDT;
range.symbol = "BTCUSDT";
range.ticker = quote(now, { last: 101, bid: 100.99, ask: 101.01 });
range.rangeContext = { confirmed: true, locationZone: "LOWER_EDGE", lowerBoundary: 100, upperBoundary: 110, midpoint: 105 };
range.marketRegimeRouter = { regime: "RANGE" };
const rangeBars = range.timeframes["15m"].recentCandles;
rangeBars.forEach(row => Object.assign(row, { o: 100.5, h: 100.75, l: 100.2, c: 100.5 }));
Object.assign(rangeBars.at(-3), { o: 100.3, h: 100.7, l: 99.9, c: 100.35 });
Object.assign(rangeBars.at(-2), { o: 100.35, h: 100.75, l: 100.25, c: 100.65 });
Object.assign(rangeBars.at(-1), { o: 100.65, h: 101.1, l: 100.5, c: 101 });
range.timeframes["15m"].indicators.atr14 = 1;
const rangePlan = buildDeskOpportunityScan(range, null).models.find(row => row.submodel === "C1").candidate;
assert.equal(rangePlan.submodel, "C1");
assert.equal(rangePlan.eventAt, rangeBars.at(-3).ts);
assert.equal(rangePlan.expiresAt, iso(Date.parse(rangePlan.eventAt) + 9 * 900000));
assert.equal(rangePlan.protectivePrice, 99.9);
assert.ok(rangePlan.rrQualifiedEntryZone.min > rangePlan.protectivePrice);
assert.equal(discoverRangeReversalBase(range, native).expiresAt, undefined, "legacy C route keeps original response");
Object.assign(rangeBars.at(-3), { o: 100.2, h: 100.25, l: 99.7, c: 99.8 });
assert.ok(buildDeskOpportunityScan(range, null).models.find(row => row.submodel === "C2").candidate?.expiresAt);
rangeBars.splice(-2, 1);
assert.equal(buildDeskOpportunityScan(range, null).models.find(row => row.submodel === "C2").candidate?.expiresAt,
  undefined, "non-contiguous event cannot invent a lifecycle");

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
const blockedArm = AlphaDeskBridge.createDeskBridge({
  build: "fixture", analyse: async () => ({ assets: { ETH: { plans: [absentLiquidity, temporaryObstacle] } } }),
  canMonitor: () => true, ensureMonitor: async () => { throw new Error("unsafe alarm arm"); },
});
assert.equal((await change(blockedArm, "POST", absentLiquidity)).status, 409);

let sends = 0;
let phase = "WAIT_LIQUIDITY";
let tick = 0;
const arrivalBridge = AlphaDeskBridge.createDeskBridge({
  build: "fixture", canMonitor: () => true,
  analyse: async () => ({ assets: { ETH: { plans: [{ ...ethPlan, state: phase, monitorable: true,
    liquidity: { ...ethPlan.liquidity, checkedAt: iso(Date.now()), validUntil: iso(Date.now() + 10000) } }] } } }),
  quote: async () => quote(Date.now() + ++tick),
  notify: async (_, notice) => {
    sends++;
    assert.match(notice.url, /&revision=/);
    return { sent: true, providerAcceptedAt: iso(Date.now()), auditAttemptId: "fixture", auditPersisted: true };
  },
});
await arrivalBridge.check(owner);
assert.equal(sends, 0, "book arrival alone cannot push without fresh liquidity review");
phase = "REVIEW";
await arrivalBridge.check(owner);
assert.equal(sends, 1);
await arrivalBridge.check(owner);
assert.equal(sends, 1, "an accepted alert does not push a second time");
const receipt = (await arrivalBridge.status(owner)).watches.find(watch => watch.plan.asset === "ETH").deliveryReceipt;
assert.equal(receipt.auditPersisted, true);
assert.equal(receipt.deviceReceiptVerified, false);
const rejected = await worker.fetch(new Request("https://alpha.invalid/desk/v1/monitors"), {}, {});
assert.equal(rejected.status, 401);
console.log("PASS ranking and 16 model rows, native BTC detectors and exact C lifecycle, D1/B1 evidence, liquidity gates, two independent samples, scoped persistence, alert receipt and deduplication");
