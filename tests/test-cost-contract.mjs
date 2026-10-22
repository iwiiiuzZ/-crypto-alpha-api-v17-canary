import assert from 'node:assert/strict';
import {fixture} from './v24-fixtures.mjs';
const {t}=fixture();
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
console.log(JSON.stringify({suite:'independent-cost-contract',assertions:8,mode:'SYNTHETIC_NO_PROFITABILITY_CLAIM',passed:true}));
