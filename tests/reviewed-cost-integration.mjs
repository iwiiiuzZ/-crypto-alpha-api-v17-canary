import assert from 'node:assert/strict';

// Transform the OLD approved model text into the exact reviewed cost integration.
// Comparing the whole current function to this result still guards every structural gate.
export function expectedCostIntegration(name, old) {
  const once=(from,to)=>{
    assert.equal(old.split(from).length-1,1,`Expected one reviewed cost site: ${name}`);
    old=old.replace(from,to);
  };
  if(name==='adaptiveAssessment')once('estimatedCandidateCost(asset)','estimatedCandidateCost(asset,seed.direction)');
  else if(name==='opportunityAssessment')once('estimatedCandidateCost(asset)','estimatedCandidateCost(asset,direction)');
  else if(name==='discoverRangeReversal'){
    once('  const plan = { direction, stopLoss, takeProfits: [{ price: midpoint }], estimatedRoundTripCostPct: 0.15 };',
      '  const costPct=estimatedCandidateCost(asset,direction);\n  const plan = { direction, stopLoss, takeProfits: [{ price: midpoint }], estimatedRoundTripCostPct: costPct };');
    once('entry:price,estimatedRoundTripCostPct:0.15,stopLoss','entry:price,estimatedRoundTripCostPct:costPct,stopLoss');
  }else throw Error('Unreviewed model cost integration '+name);
  return old;
}
