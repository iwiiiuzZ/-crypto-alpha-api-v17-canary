import assert from 'node:assert/strict';
import {fixture} from './v24-fixtures.mjs';
import vm from 'node:vm';
const f=fixture(),{t}=f;
// Independent hand-calculated cash-flow examples, not historical performance.
for(const direction of ['LONG','SHORT']){
 const plan={direction,stopLoss:direction==='LONG'?95:105,takeProfits:[{price:direction==='LONG'?112:88},{price:direction==='LONG'?150:50}],estimatedRoundTripCostPct:1};
 assert.equal(t.planNetRR(plan,100),11/6,'first real target; cost reduces reward and increases risk');
 assert.equal(t.planNetRR(plan,100,1.5),10.5/6.5,'cost stress cannot improve RR');
 plan.takeProfits[0].price=direction==='LONG'?113:87;
 assert.equal(t.planNetRR(plan,100),2,'exact net RR 2 is the threshold');
 plan.stopLoss=direction==='LONG'?101:99;
 assert.equal(t.planNetRR(plan,100),null,'wrong-side stop is invalid');
}
const x=vm.runInContext('({estimatedCandidateCost,holdingFundingScenarios,parseOkxFunding})',f.c);
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-10,`${actual} != ${expected}`);
for(const sign of [1,-1]){
 const funding=x.parseOkxFunding([{fundingRate:String(sign*.001),fundingTime:String(f.now()),nextFundingTime:String(f.now()+8*3600000)}]);
 const asset={derivatives:{funding}},payer=sign===1?'LONG':'SHORT',receiver=sign===1?'SHORT':'LONG';
 near(funding.ratePct,sign*.1);
 near(x.estimatedCandidateCost(asset,payer),.24);
 near(x.estimatedCandidateCost(asset,receiver),.15);
 const paying=x.holdingFundingScenarios(asset,payer,100,payer==='LONG'?95:105,payer==='LONG'?120:80);
 assert.deepEqual(Array.from(paying.scenarios,s=>s.settlements),[6,21,42]);
 near(paying.scenarios[0].totalCostPct,.75);
 near(paying.scenarios[1].totalCostPct,2.25);
 near(paying.scenarios[2].totalCostPct,4.35);
 const receiving=x.holdingFundingScenarios(asset,receiver,100,receiver==='LONG'?95:105,receiver==='LONG'?120:80);
 near(receiving.scenarios[2].totalCostPct,.15);
 const boundary={direction:payer,stopLoss:payer==='LONG'?95:105,takeProfits:[{price:payer==='LONG'?110.5:89.5}]};
 assert.ok(t.planNetRR({...boundary,estimatedRoundTripCostPct:.15},100)>=2);
 assert.ok(t.planNetRR({...boundary,estimatedRoundTripCostPct:x.estimatedCandidateCost(asset,payer)},100)<2);
}
assert.equal(x.holdingFundingScenarios({derivatives:{funding:{status:'ok',ratePct:.1}}},'LONG',100,95,120).status,'UNKNOWN_INTERVAL_OR_RATE');
console.log(JSON.stringify({suite:'independent-cost-contract',assertions:29,mode:'SYNTHETIC_NO_PROFITABILITY_CLAIM',passed:true}));
