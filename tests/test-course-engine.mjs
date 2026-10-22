import assert from "node:assert/strict";
import { evaluateCourseDecision } from "../main-v188.js";

function base(overrides = {}) {
  const value = {
    direction: "LONG",
    model: "A",
    submodel: "A1",
    marketRegime: "TREND",
    locationQuality: "GOOD",
    rangePosition: "EDGE",
    setup: { trendExists: true, pullbackAtMeaningfulLocation: true, counterMoveEfficiencyFaded: true },
    trigger: { complete: true, meaningful: true, protectiveStructure: true },
    confirmation: { minimumSufficientEvidence: true },
    environment: { btcSystemicConflict: false, majorNewsExecutionRisk: false, liquidityAbnormal: false },
    execution: { clearInvalidation: true, netRR: 2.2, minNetRR: 1.8, dangerousStopZone: false, slippageAbnormal: false },
    data: { requiredFieldsReady: true },
    risk: { riskAssessmentStatus: "VERIFIED_CLEAR", correlatedRiskPct: 0, dailyRiskLimitReached: false, psychologicalVeto: false },
    pendingTrigger: "15m close above registered control with protected HL",
    history: { nearbyFailures: 0, failurePatternRepeated: false },
    score: 90,
  };
  return {
    ...value,
    ...overrides,
    setup: { ...value.setup, ...(overrides.setup || {}) },
    trigger: { ...value.trigger, ...(overrides.trigger || {}) },
    confirmation: { ...value.confirmation, ...(overrides.confirmation || {}) },
    environment: { ...value.environment, ...(overrides.environment || {}) },
    execution: { ...value.execution, ...(overrides.execution || {}) },
    data: { ...value.data, ...(overrides.data || {}) },
    risk: { ...value.risk, ...(overrides.risk || {}) },
    history: { ...value.history, ...(overrides.history || {}) },
  };
}

const cases = [
  ["标准Model A做多", base(), "LONG", true],
  ["Model A条件未完成", base({ trigger: { complete: false } }), "WAIT", false],
  ["Model B真突破", base({ model: "B", submodel: "B1", setup: { breakout: true, retest: true, acceptance: true, rejection: false } }), "LONG", true],
  ["Model B假突破取消", base({ model: "B", submodel: "B1", setup: { breakout: true, retest: true, acceptance: false, rejection: true } }), "NO_TRADE", false],
  ["Model C扫损反转", base({ model: "C", submodel: "C1", marketRegime: "RANGE", setup: { sweep: true, reclaim: true, opposingProgressFailed: true, structureShift: true } }), "LONG", true],
  ["Sweep但未确认", base({ model: "C", submodel: "C1", marketRegime: "RANGE", setup: { sweep: true, reclaim: true, opposingProgressFailed: false, structureShift: false }, trigger: { complete: false } }), "WAIT", false],
  ["区间中部No Trade", base({ rangePosition: "MIDDLE" }), "NO_TRADE", false],
  ["RR不足", base({ execution: { netRR: 1.2, minNetRR: 1.8 } }), "NO_TRADE", false],
  ["BTC强反向", base({ environment: { btcSystemicConflict: true } }), "NO_TRADE", false],
  ["重大新闻Hard Blocker", base({ environment: { majorNewsExecutionRisk: true } }), "NO_TRADE", false],
  ["流动性异常", base({ environment: { liquidityAbnormal: true } }), "NO_TRADE", false],
  ["数据缺失", base({ data: { requiredFieldsReady: false } }), "NO_TRADE", false],
  ["扫描器到价但条件失效", base({ entryZoneReached: true, trigger: { complete: false, protectiveStructure: false } }), "WAIT", false],
  ["历史失败保留警告、旧心理字段不否决", base({ history: { nearbyFailures: 2, failurePatternRepeated: true }, risk: { psychologicalVeto: true } }), "LONG", true],
  ["高评分但存在Hard Blocker", base({ score: 99, execution: { dangerousStopZone: true, alignedSweepClearedStopPool: false } }), "NO_TRADE", false],
];

const results = [];
for (const [name, input, expectedState, expectedOpen] of cases) {
  const result = evaluateCourseDecision(input);
  assert.equal(result.finalState, expectedState, name);
  assert.equal(result.openNow, expectedOpen, name);
  if (result.hardBlockers.length) assert.equal(result.openNow, false, `${name}: hard blocker must veto`);
  results.push({ name, state: result.finalState, openNow: result.openNow, blockers: result.hardBlockers });
}

const crowdingOnly = evaluateCourseDecision(base({ confirmation: { extremeCrowding: true } }));
assert.equal(crowdingOnly.finalState, "LONG");
assert.ok(crowdingOnly.softWarnings.includes("EXTREME_CROWDING_REVIEW"));

const adverseSweepOnly = evaluateCourseDecision(base({ confirmation: { adverseSweep: true } }));
assert.equal(adverseSweepOnly.finalState, "LONG");
assert.ok(adverseSweepOnly.softWarnings.includes("ADVERSE_SWEEP_REQUIRES_STRUCTURE_REVIEW"));

console.log(JSON.stringify({ passed: true, count: results.length, results }, null, 2));

assert.ok(evaluateCourseDecision(base({history:{failurePatternRepeated:true}})).softWarnings.includes("HISTORICAL_FAILURE_PATTERN_REPEATED"));
