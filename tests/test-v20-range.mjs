import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

let source = fs.readFileSync(new URL("../main-v188.js", import.meta.url), "utf8")
  .replaceAll("export class ", "class ")
  .replaceAll("export function ", "function ")
  .replace("export default {", "globalThis.__worker = {");
source += ";globalThis.__test={buildRangeContext,buildMarketRegimeRouter,discoverRangeReversal,evaluateCourseDecision,normalizeTradingPlan,openApi,scannerConfiguration,RANGE_CONFIG};";
const context = { console, Date, Math, JSON, URL, URLSearchParams, Request, Response, Headers, crypto, fetch, setTimeout, clearTimeout, structuredClone };
vm.createContext(context);
vm.runInContext(source, context);
const { buildRangeContext, buildMarketRegimeRouter, discoverRangeReversal, evaluateCourseDecision, normalizeTradingPlan, openApi, scannerConfiguration } = context.__test;

function candles4h({ acceptedAbove = false } = {}) {
  const rows = Array.from({ length: 22 }, (_, i) => ({
    ts: new Date(Date.UTC(2026, 0, 1, i * 4)).toISOString(),
    o: 104 + (i % 3), h: i % 5 === 0 ? 110 : 108, l: i % 5 === 2 ? 100 : 102, c: 103 + (i % 4), confirmed: true,
  }));
  rows.push({ ts: "2026-01-05T00:00:00.000Z", o: 109, h: 112, l: 108, c: acceptedAbove ? 111 : 106, confirmed: true });
  rows.push({ ts: "2026-01-05T04:00:00.000Z", o: 111, h: 113, l: 109, c: acceptedAbove ? 112 : 105, confirmed: true });
  return rows;
}

function tf({ trend = "RANGE", structure = "RANGE", adx = 14, atr = 2, rows = candles4h(), source = "OKX_USDT_PERPETUAL" } = {}) {
  return {
    status: "ok", source, trend, structure, change20BarsPct: 0.5, lastClose: rows.at(-1).c,
    indicators: { adx14: adx, atr14: atr, atr14Pct: 1.9 },
    structureDetail: { baseStructure: structure }, recentCandles: rows,
    quality: { passed: true }, dataFreshness: { state: "fresh" }, levels: { support20: 100, resistance20: 110 },
  };
}

function asset(price = 105, options = {}) {
  return {
    ticker: { last: price },
    timeframes: {
      "4h": tf(options.fourHour),
      "1h": tf(options.oneHour),
      "15m": tf({ ...(options.fifteen || {}), rows: options.fifteen?.rows || candles4h() }),
    },
  };
}

{
  const a = asset(105, { fourHour: { trend: "UP", structure: "RANGE", adx: 10 }, oneHour: { trend: "DOWN", structure: "LH_LL", adx: 27 } });
  a.rangeContext = buildRangeContext(a);
  const router = buildMarketRegimeRouter(a);
  assert.equal(a.rangeContext.confirmed, true, "4H range should be confirmed");
  assert.equal(a.rangeContext.locationZone, "MIDDLE", "midpoint must be classified as middle");
  assert.equal(a.rangeContext.rangeLegDirection, "DOWN_LEG_INSIDE_RANGE", "1H down leg must remain an internal range leg");
  assert.equal(router.regime, "RANGE", "1H directional leg must not force Transition");
  assert.deepEqual([...router.directSubmodels], ["C1", "C2", "D1", "D2"]);
}

{
  const a = asset(101, { fourHour: { trend: "RANGE", structure: "RANGE", adx: 11 }, oneHour: { trend: "RANGE", structure: "RANGE", adx: 24 } });
  a.rangeContext = buildRangeContext(a);
  assert.equal(a.rangeContext.locationZone, "LOWER_EDGE");
  assert.equal(a.rangeContext.permissions.edgeCanEvaluateC1C2, true);
}

{
  const a = asset(112, { fourHour: { trend: "UP", structure: "RANGE", adx: 10, rows: candles4h({ acceptedAbove: true }) }, oneHour: { trend: "UP", structure: "HH_HL", adx: 26 } });
  a.rangeContext = buildRangeContext(a);
  assert.equal(a.rangeContext.confirmed, false, "two accepted closes outside must end range authority");
  assert.equal(a.rangeContext.boundaryState, "ACCEPTED_ABOVE");
  assert.notEqual(buildMarketRegimeRouter(a).regime, "RANGE");
}

{
  const a = asset(110.1, { fourHour: { trend: "RANGE", structure: "RANGE", adx: 10 }, oneHour: { trend: "RANGE", structure: "RANGE", adx: 20 } });
  a.rangeContext = buildRangeContext(a);
  assert.equal(a.rangeContext.confirmed, false, "price outside a prior boundary is an unresolved boundary auction");
  assert.equal(a.rangeContext.locationZone, "OUTSIDE");
  assert.equal(buildMarketRegimeRouter(a).regime, "TRANSITION");
}

{
  const a = asset(105, { fourHour: { trend: "RANGE", structure: "RANGE", adx: 10 }, oneHour: { trend: "RANGE", structure: "RANGE", adx: 12 }, fifteen: { trend: "RANGE", structure: "RANGE", adx: 12 } });
  a.rangeContext = buildRangeContext(a);
  assert.equal(buildMarketRegimeRouter(a).regime, "COMPRESSION");
}

{
  const a = asset(105, { fourHour: { trend: "UP", structure: "HH_HL", adx: 28 }, oneHour: { trend: "DOWN", structure: "LH_LL", adx: 28 } });
  a.rangeContext = buildRangeContext(a);
  assert.equal(buildMarketRegimeRouter(a).regime, "TREND", "Intact 4H trend permits a 1H pullback");
}

{
  const a = asset(105, { fourHour: { trend: "UP", structure: "RANGE", adx: 10 }, oneHour: { trend: "DOWN", structure: "LH_LL", adx: 27 } });
  a.rangeContext = buildRangeContext(a);
  a.marketRegimeRouter = buildMarketRegimeRouter(a);
  const decision = evaluateCourseDecision({
    marketRegime: "RANGE", model: "C", submodel: "C1", direction: "LONG",
    data: { requiredFieldsReady: true }, location: { good: false, rangeMiddle: true },
    setup: {}, trigger: {}, execution: {}, risk: {}, environment: {},
  });
  assert.equal(decision.finalState, "NO_TRADE", "range middle must not become generic Wait");
  assert.equal(decision.openNow, false);
}

{
  const latestStart = Math.floor(Date.now() / (15 * 60_000)) * 15 * 60_000 - 15 * 60_000;
  const firstStart = latestStart - 19 * 15 * 60_000;
  const rows15 = Array.from({ length: 17 }, (_, i) => ({ ts: new Date(firstStart + i * 15 * 60_000).toISOString(), o: 100.5, h: 100.75, l: 100.2, c: 100.5, confirmed: true }));
  rows15.push({ ts: new Date(firstStart + 17 * 15 * 60_000).toISOString(), o: 100.3, h: 100.7, l: 99.9, c: 100.35, confirmed: true });
  rows15.push({ ts: new Date(firstStart + 18 * 15 * 60_000).toISOString(), o: 100.35, h: 100.75, l: 100.25, c: 100.65, confirmed: true });
  rows15.push({ ts: new Date(firstStart + 19 * 15 * 60_000).toISOString(), o: 100.65, h: 101.1, l: 100.5, c: 101, confirmed: true });
  const a = asset(101, { fourHour: { trend: "RANGE", structure: "RANGE", adx: 10 }, oneHour: { trend: "DOWN", structure: "LH_LL", adx: 23 }, fifteen: { trend: "UP", structure: "HH_HL", adx: 25, atr: 1, rows: rows15 } });
  a.rangeContext = buildRangeContext(a);
  a.marketRegimeRouter = buildMarketRegimeRouter(a);
  const btc = asset(105);
  const candidate = discoverRangeReversal(a, btc);
  assert.equal(candidate?.model, "C");
  assert.equal(candidate?.submodel, "C1");
  assert.equal(candidate?.direction, "LONG");
  assert.equal(candidate?.openNowAllowed, false);
}

function recentRows15(basePrice, event, next, latest) {
  const latestStart = Math.floor(Date.now() / (15 * 60_000)) * 15 * 60_000 - 15 * 60_000;
  const firstStart = latestStart - 19 * 15 * 60_000;
  const rows = Array.from({ length: 17 }, (_, i) => ({ ts: new Date(firstStart + i * 15 * 60_000).toISOString(), o: basePrice, h: basePrice + 0.25, l: basePrice - 0.25, c: basePrice, confirmed: true }));
  for (const [offset, candle] of [event, next, latest].entries()) rows.push({ ts: new Date(firstStart + (17 + offset) * 15 * 60_000).toISOString(), ...candle, confirmed: true });
  return rows;
}

{
  const rows15 = recentRows15(109.5,
    { o: 109.7, h: 110.1, l: 109.3, c: 109.65 },
    { o: 109.65, h: 109.7, l: 109.25, c: 109.4 },
    { o: 109.4, h: 109.45, l: 108.9, c: 109 });
  const a = asset(109, { fourHour: { trend: "RANGE", structure: "RANGE", adx: 10 }, oneHour: { trend: "UP", structure: "HH_HL", adx: 23 }, fifteen: { trend: "DOWN", structure: "LH_LL", adx: 25, atr: 1, rows: rows15 } });
  a.rangeContext = buildRangeContext(a); a.marketRegimeRouter = buildMarketRegimeRouter(a);
  const candidate = discoverRangeReversal(a, asset(105));
  assert.equal(candidate?.submodel, "C1");
  assert.equal(candidate?.direction, "SHORT");
}

{
  const rows15 = recentRows15(100.5,
    { o: 100.2, h: 100.25, l: 99.7, c: 99.8 },
    { o: 99.8, h: 100.6, l: 99.75, c: 100.4 },
    { o: 100.4, h: 101.1, l: 100.3, c: 101 });
  const a = asset(101, { fourHour: { trend: "RANGE", structure: "RANGE", adx: 10 }, oneHour: { trend: "DOWN", structure: "LH_LL", adx: 23 }, fifteen: { trend: "UP", structure: "HH_HL", adx: 25, atr: 1, rows: rows15 } });
  a.rangeContext = buildRangeContext(a); a.marketRegimeRouter = buildMarketRegimeRouter(a);
  assert.equal(discoverRangeReversal(a, asset(105))?.submodel, "C2");
}

{
  const rows15 = recentRows15(100.5,
    { o: 100.3, h: 100.7, l: 99.9, c: 100.35 },
    { o: 100.35, h: 100.7, l: 100.25, c: 100.55 },
    { o: 100.55, h: 100.7, l: 100.4, c: 100.6 });
  const a = asset(100.6, { fourHour: { trend: "RANGE", structure: "RANGE", adx: 10 }, oneHour: { trend: "DOWN", structure: "LH_LL", adx: 23 }, fifteen: { trend: "UP", structure: "RANGE", adx: 20, atr: 1, rows: rows15 } });
  a.rangeContext = buildRangeContext(a); a.marketRegimeRouter = buildMarketRegimeRouter(a);
  assert.equal(discoverRangeReversal(a, asset(105)), null, "sweep without meaningful structure shift must not alert");
}

function decisionInput(overrides = {}) {
  return {
    marketRegime: "TREND", model: "A", submodel: "A1", direction: "LONG",
    locationQuality: "GOOD", rangePosition: "EDGE",
    data: { requiredFieldsReady: true },
    setup: { trendExists: true, pullbackAtMeaningfulLocation: true, counterMoveEfficiencyFaded: true },
    trigger: { complete: true, meaningful: true, protectiveStructure: true },
    confirmation: { minimumSufficientEvidence: true },
    execution: { clearInvalidation: true, netRR: 2.2, minNetRR: 2 },
    environment: { btcSystemicConflict: false, majorNewsExecutionRisk: false, liquidityAbnormal: false },
    risk: { riskAssessmentStatus: "VERIFIED_CLEAR", correlatedRiskPct: 0, dailyRiskLimitReached: false, psychologicalVeto: false },
    pendingTrigger: "Registered 15m control break, acceptance and protected low/high",
    ...overrides,
  };
}

assert.equal(evaluateCourseDecision(decisionInput()).finalState, "LONG");
assert.equal(evaluateCourseDecision(decisionInput({ trigger: { complete: false, meaningful: false, protectiveStructure: false } })).finalState, "WAIT");
assert.equal(evaluateCourseDecision(decisionInput({ model: "B", submodel: "B1", setup: { breakout: true, retest: true, acceptance: true, rejection: false } })).finalState, "LONG");
assert.equal(evaluateCourseDecision(decisionInput({ model: "B", submodel: "B1", setup: { breakout: true, retest: false, acceptance: false, rejection: false } })).finalState, "WAIT");
assert.equal(evaluateCourseDecision(decisionInput({ marketRegime: "RANGE", model: "C", submodel: "C1", direction: "SHORT", setup: { sweep: true, reclaim: true, opposingProgressFailed: true, structureShift: true } })).finalState, "SHORT");
assert.equal(evaluateCourseDecision(decisionInput({ marketRegime: "RANGE", model: "C", submodel: "C1", setup: { sweep: true, reclaim: true, opposingProgressFailed: false, structureShift: false } })).finalState, "WAIT");
assert.equal(evaluateCourseDecision(decisionInput({ rangePosition: "MIDDLE" })).finalState, "NO_TRADE");
assert.equal(evaluateCourseDecision(decisionInput({ execution: { clearInvalidation: true, netRR: 1.2, minNetRR: 2 } })).finalState, "NO_TRADE");
assert.equal(evaluateCourseDecision(decisionInput({ environment: { btcSystemicConflict: true } })).finalState, "NO_TRADE");
assert.equal(evaluateCourseDecision(decisionInput({ environment: { majorNewsExecutionRisk: true } })).finalState, "NO_TRADE");
assert.equal(evaluateCourseDecision(decisionInput({ environment: { liquidityAbnormal: true } })).finalState, "NO_TRADE");
assert.equal(evaluateCourseDecision(decisionInput({ data: { requiredFieldsReady: false } })).operationalState, "DATA_BLOCKED");
assert.equal(evaluateCourseDecision(decisionInput({ marketRegime: "TRANSITION", model: "C", submodel: "C1", setup: { sweep: true, reclaim: true, opposingProgressFailed: true, structureShift: true } })).finalState, "WAIT");
assert.equal(evaluateCourseDecision(decisionInput({ risk: { dailyRiskLimitReached: true }, score: 99 })).openNow, true);

{
  const now = new Date();
  const input = {
    symbol: "ETHUSDT", direction: "LONG", model: "C", submodel: "C1", marketRegime: "RANGE", opportunityGrade: "B", timeframe: "SHORT",
    modelInvalidation: "Accepted below the reclaimed range boundary and structural low",
    location: { quality: "GOOD", type: "LOWER_EDGE", rangePosition: "LOWER_EDGE", rationale: "Confirmed 4H range lower edge" },
    trigger: { type: "CHOCH", meaningful: true, level: 101, reclaimLevel: 100, protectiveStructure: { type: "HL", price: 99 } },
    entryZone: { min: 100, max: 101 }, stopLoss: 98, invalidationPrice: 98,
    takeProfits: [{ price: 105, allocationPct: 100 }], firstRealisticTarget: { price: 105, basis: "Confirmed range midpoint" },
    minNetRR: 2, confirmation: { close15mAbove: 101 }, hardBlockers: [],
    risk: { accountEquityUsdt: 17000, accountRiskPct: 3, leverage: 3, riskAssessmentStatus: "VERIFIED_CLEAR", dailyRiskLimitReached: false, psychologicalVeto: false, correlatedRiskPct: 0 },
    strategySummary: "C1 lower-edge reversal", triggerExplanation: "Sweep, reclaim, meaningful shift and protected HL",
    sourceAnalysisAt: now.toISOString(), expiresAt: new Date(now.getTime() + 6 * 3600_000).toISOString(),
  };
  assert.equal(normalizeTradingPlan(input).submodel, "C1", "scanner must preserve a valid range C1 plan");
  assert.throws(() => normalizeTradingPlan({ ...input, location: { ...input.location, rangePosition: "MIDDLE" } }), /Range-middle/);
}

{
  const api = openApi("https://example.test");
  const operations = Object.values(api.paths).flatMap(path => Object.values(path).map(operation => operation.operationId).filter(Boolean));
  assert.deepEqual([...operations], ["getCryptoAlphaData", "saveTradingPlan", "getTradingPlanScannerStatus", "cancelTradingPlanMonitoring"]);
  assert.ok(api.paths["/"].get.responses[200].content["application/json"].schema.properties.assets.properties.ETHUSDT.properties.rangeContext);
  assert.deepEqual([...scannerConfiguration({}).discovery.supportedSubmodels], ["A1", "A2", "B1", "B2", "C1", "C2", "D1", "D2"]);
}

console.log("V20 range-aware regression: PASS");
