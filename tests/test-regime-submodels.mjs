import assert from "node:assert/strict";
import { evaluateCourseDecision } from "../main-v188.js";

function candidate(model, submodel, marketRegime, setup) {
  return {
    direction: "LONG",
    model,
    submodel,
    marketRegime,
    locationQuality: "GOOD",
    rangePosition: "EDGE",
    setup,
    trigger: { complete: true, meaningful: true, protectiveStructure: true },
    confirmation: { minimumSufficientEvidence: true },
    environment: { btcSystemicConflict: false, majorNewsExecutionRisk: false, liquidityAbnormal: false },
    execution: { clearInvalidation: true, netRR: 2.2, minNetRR: 1.8, dangerousStopZone: false, slippageAbnormal: false },
    data: { requiredFieldsReady: true },
    risk: { riskAssessmentStatus: "VERIFIED_CLEAR", correlatedRiskPct: 0, dailyRiskLimitReached: false, psychologicalVeto: false },
    pendingTrigger: "Boundary breakout accepted after registered retest",
    history: { nearbyFailures: 0, failurePatternRepeated: false },
  };
}

const modelA = { trendExists: true, pullbackAtMeaningfulLocation: true, counterMoveEfficiencyFaded: true };
const modelB = { breakout: true, retest: true, acceptance: true, rejection: false };
const modelC = { sweep: true, reclaim: true, opposingProgressFailed: true, structureShift: true };
const direct = [
  ["A1", candidate("A", "A1", "TREND", modelA)],
  ["A2", candidate("A", "A2", "TREND", modelA)],
  ["B1", candidate("B", "B1", "TREND", modelB)],
  ["B2", candidate("B", "B2", "TREND", modelB)],
  ["C1", candidate("C", "C1", "RANGE", modelC)],
  ["C2", candidate("C", "C2", "RANGE", modelC)],
];

for (const [name, input] of direct) {
  const result = evaluateCourseDecision(input);
  assert.equal(result.finalState, "LONG", name);
  assert.equal(result.openNow, true, name);
  assert.equal(result.submodel, name, name);
  assert.equal(result.regimePermission, "DIRECT", name);
}

const compressionCandidate = evaluateCourseDecision(candidate("B", "B2", "COMPRESSION", modelB));
assert.equal(compressionCandidate.finalState, "WAIT");
assert.equal(compressionCandidate.regimePermission, "WAIT_ONLY");
assert.equal(compressionCandidate.openNow, false);

for (const input of [
  candidate("A", "A1", "RANGE", modelA),
  candidate("C", "C1", "TREND", modelC),
  candidate("A", "B1", "TREND", modelA),
]) {
  const result = evaluateCourseDecision(input);
  assert.equal(result.finalState, "NO_TRADE");
  assert.equal(result.openNow, false);
  assert.ok(result.hardBlockers.some((item) => item.includes("SUBMODEL") || item.includes("REGIME")));
}

console.log(JSON.stringify({ passed: true, directSubmodels: direct.map(([name]) => name), waitOnly: "B2_COMPRESSION", invalidMappingsBlocked: 3 }, null, 2));
