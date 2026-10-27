import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {fixture} from './v24-fixtures.mjs';
const f=fixture(),x=vm.runInContext('({boundedMarketSnapshot,referenceRepeatedMarketEvidence,marketResponseSectionBytes})',f.c);
const plain=v=>JSON.parse(JSON.stringify(v)),size=v=>Buffer.byteLength(JSON.stringify(v));
const read=(root,path)=>path.split('.').reduce((v,k)=>v?.[k],root);
function expand(root,v=root,stack=[]){
 if(!v||typeof v!=='object')return v;
 if(Object.keys(v).length===1&&typeof v.sameAs==='string'){
  assert.ok(!stack.includes(v.sameAs),'No reference cycles');const target=read(root,v.sameAs);assert.notEqual(target,undefined,'Reference target exists');
  return expand(root,target,[...stack,v.sameAs]);
 }
 return Array.isArray(v)?v.map(x=>expand(root,x,stack)):Object.fromEntries(Object.entries(v).map(([k,x])=>[k,expand(root,x,stack)]));
}
const evidence={state:'WAIT_RETEST',prices:Array.from({length:80},(_,i)=>({price:2000+i/17,at:'2026-10-25T07:06:00.000Z',qualified:i%2===0})),reason:'保留完整证据 😀'.repeat(30)};
const model={submodel:'B1',candidate:{entry:2400.123456789,stopLoss:2370.111111111,target:2465.987654321,netRR:2.000000001,eventEvidence:evidence}};
const base={assets:{ETHUSDT:{opportunityEngine:{models:[model]},timeframes:{'15m':{quality:{passed:true},levels:evidence}},crossVenueLiquidity:{first:evidence,second:evidence},publicOrderflow:{details:evidence}},BTCUSDT:{capitalFlow:{details:evidence}}},newsContext:{sources:{},recentRiskHeadlines:[],headlines:[]},transportDiagnostics:{references:{}}};
const before=structuredClone(base),out=structuredClone(base);assert.ok(x.referenceRepeatedMarketEvidence(out)>=4);
assert.deepEqual(expand(out).assets,before.assets,'Every referenced value reconstructs exactly');
assert.deepEqual(out.assets.ETHUSDT.opportunityEngine,before.assets.ETHUSDT.opportunityEngine,'Models remain inline');
assert.deepEqual(out.assets.ETHUSDT.timeframes,before.assets.ETHUSDT.timeframes,'Structure remains inline');
assert.ok(size(out)<size(before));
for(const [from,to] of Object.entries(out.transportDiagnostics.references))assert.deepEqual(expand(out,read(out,from)),expand(out,read(out,to)));

const full=JSON.parse(fs.readFileSync(new URL('./fixtures/full-market-synthetic.json',import.meta.url),'utf8'));
full.assets.ETHUSDT.opportunityEngine.models[0]=model;
full.assets.ETHUSDT.crossVenueLiquidity={first:evidence,second:evidence,third:evidence};
full.assets.BTCUSDT.capitalFlow.extra=evidence;
const input=JSON.stringify(full),bounded=plain(x.boundedMarketSnapshot(full));
assert.notEqual(bounded.decisionState,'TRANSPORT_ERROR',JSON.stringify(bounded.transportDiagnostics));
assert.ok(size(bounded)<=90000);assert.equal(JSON.stringify(full),input);
assert.deepEqual(bounded.assets.ETHUSDT.opportunityEngine.models,full.assets.ETHUSDT.opportunityEngine.models);
assert.deepEqual(expand(bounded,bounded.assets.ETHUSDT.crossVenueLiquidity),full.assets.ETHUSDT.crossVenueLiquidity);
assert.deepEqual(expand(bounded,bounded.assets.BTCUSDT.capitalFlow.extra),evidence);
assert.ok(bounded.transportDiagnostics.omitted.includes('EXACT_REPEAT_EVIDENCE_REFERENCED_WITH_SAME_RESPONSE_PATHS'));
const impossible=structuredClone(full);impossible.unknown='unique-unmapped-field'.repeat(10000);
const rejected=plain(x.boundedMarketSnapshot(impossible));assert.equal(rejected.error.code,'MARKET_RESPONSE_BUDGET_EXCEEDED');
const diagnostic=JSON.stringify(rejected.transportDiagnostics.attemptedSectionUtf8Bytes);
assert.ok(!diagnostic.includes('2400.123456789'));assert.ok(!diagnostic.includes('保留完整证据'));assert.ok(rejected.transportDiagnostics.attemptedSectionUtf8Bytes.assets.ETHUSDT.opportunityEngine>0);

// Only one pressure-stage insertion and size-only failure diagnostics change
// the established projector. Every other line remains exactly the baseline.
const original=fs.readFileSync(new URL('./baselines/r2-bounded-market-function.txt',import.meta.url),'utf8');
const actual=x.boundedMarketSnapshot.toString();
const restored=actual.replace('  if(!fits()&&referenceRepeatedMarketEvidence(out))note("EXACT_REPEAT_EVIDENCE_REFERENCED_WITH_SAME_RESPONSE_PATHS");\n','').replace('attemptedSectionUtf8Bytes:marketResponseSectionBytes(out),','');
assert.equal(restored,original);
console.log(JSON.stringify({passed:true,scope:'LOSSLESS_TRANSPORT_FIXTURES_NOT_PRODUCTION',beforeBytes:size(full),afterBytes:size(bounded),modelEvidencePreserved:true}));
