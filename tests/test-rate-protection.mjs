import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../main-v188.js', import.meta.url), 'utf8');
// Exercise the actual production functions, without exposing test HTTP routes.
const mod = await import('data:text/javascript;base64,' + Buffer.from(source + `
export { fetchJson, retryDeadline, cooldownKey, discoverBreakoutRetest, runDiscovery };
export function resetLocalRateCircuitForTest() {
  upstreamCooldowns.clear(); sharedCooldownChecks.clear(); sharedCooldownInflight.clear();
}
export function installDiscoveryFakes(f) {
  verifyOkxScannerPrice=f.price; okxKlines=f.candles; parseOkxCandles=x=>x;
  gateKlines=f.gateCandles || (async()=>{ throw new Error('GATE_DISABLED_IN_TEST'); }); parseGateCandles=x=>x;
  candleQuality=()=>({passed:true}); summarizeTimeframe=f.summary;
  buildMarketRegimeRouter=()=>({regime:'TREND'}); buildSnapshot=f.snapshot;
  verifyOkxScannerZone=f.zone; planLiquidityRisk=()=>({passed:true}); sendBark=f.notify;
}
`).toString('base64'));
let now = 1800000000000;
Date.now = () => now;
let calls = 0;
globalThis.fetch = async () => { calls++; return new Response('', { status: 429, headers: { 'Retry-After': '120' } }); };
await assert.rejects(mod.fetchJson('https://test.invalid/a?api_key=secret', 'test', 3, false), e => e.status === 429);
assert.equal(calls, 1, '429 must not be immediately retried');
await assert.rejects(mod.fetchJson('https://test.invalid/a?api_key=other', 'test', 3, false), e => e.retryAfterSeconds === 120);
assert.equal(calls, 1, 'same endpoint remains in cooldown');
now += 119000;
await assert.rejects(mod.fetchJson('https://test.invalid/a', 'test', 1, false));
assert.equal(calls, 1);
now += 1001;
globalThis.fetch = async () => { calls++; return Response.json({ ok: true }); };
assert.deepEqual(await mod.fetchJson('https://test.invalid/a', 'test', 1, false), { ok: true });
assert.equal(calls, 2);
assert.ok(!mod.cooldownKey('https://test.invalid/a?api_key=secret').includes('secret'));
assert.equal(mod.retryDeadline(new Headers({ 'retry-after': new Date(now + 90000).toUTCString() })), Math.floor((now + 90000) / 1000) * 1000);
assert.equal(mod.retryDeadline(new Headers({ 'x-gate-ratelimit-reset-timestamp': String((now + 180000) / 1000) })), now + 180000);
globalThis.fetch = async () => { calls++; return Response.json({ code: '50011' }); };
const validate = () => { const e = new Error('rate limit'); e.status = 429; throw e; };
await assert.rejects(mod.fetchJson('https://test.invalid/b', 'test', 3, false, validate));
const before = calls;
await assert.rejects(mod.fetchJson('https://test.invalid/b', 'test', 3, false, validate));
assert.equal(calls, before);
// A shared cache marker must survive local-memory reset (equivalent to a fresh isolate).
const sharedCircuit = new Map();
globalThis.caches = { default: {
  async match(request) { const response=sharedCircuit.get(request.url); return response ? response.clone() : undefined; },
  async put(request,response) { sharedCircuit.set(request.url,response.clone()); },
} };
let candleCalls=0;
globalThis.fetch = async () => { candleCalls++; return new Response('', { status: 429 }); };
await assert.rejects(mod.fetchJson('https://www.okx.com/api/v5/market/candles?instId=ETH-USDT-SWAP&bar=15m', 'candle', 1, true), e => e.status === 429);
assert.equal(candleCalls,1);
mod.resetLocalRateCircuitForTest();
await assert.rejects(mod.fetchJson('https://www.okx.com/api/v5/market/candles?instId=ETH-USDT-SWAP&bar=15m', 'candle', 1, true), e => e.status === 429 && e.message === 'UPSTREAM_RATE_LIMIT_COOLDOWN');
assert.equal(candleCalls,1,'shared candle circuit must block a fresh local instance without another upstream call');
const rows = Array.from({length: 20}, (_, i) => ({ts: new Date(now - (20-i)*900000).toISOString(), o:95,h:100,l:90,c:95,confirmed:true}));
Object.assign(rows[17], {o:99,h:103,l:99,c:102});
Object.assign(rows[18], {o:102,h:102,l:99,c:101});
Object.assign(rows[19], {o:101,h:105,l:100,c:104});
const tf = {status:'ok',source:'OKX_USDT_PERPETUAL', quality:{passed:true},dataFreshness:{state:'live'},recentCandles:rows,trend:'UP',structure:'HH_HL',indicators:{atr14:10}, levels:{resistance20:120,resistance50:130,support20:70,support50:60}};
const asset = {ticker:{last:104},marketRegimeRouter:{regime:'TREND'},timeframes:{'15m':structuredClone(tf),'1h':structuredClone(tf),'4h':structuredClone(tf)}};
assert.equal(mod.discoverBreakoutRetest(asset,asset),null,'The old 104 entry has net RR below 2 after the structural-pool stop buffer');
// The same confirmed pattern remains actionable at a better live price; do not
// lower the production RR gate or move the first realistic target for this test.
asset.ticker.last=103;
assert.equal(mod.discoverBreakoutRetest(asset,asset)?.submodel,'B1');
assert.ok(mod.discoverBreakoutRetest(asset,asset).netRR>=2);
const bad = structuredClone(asset); bad.timeframes['15m'].recentCandles[18].c=99;
assert.equal(mod.discoverBreakoutRetest(bad,asset),null, 'Failed acceptance must be silent');
const stale = structuredClone(asset); stale.timeframes['15m'].dataFreshness.state='stale-on-error';
assert.equal(mod.discoverBreakoutRetest(stale,asset),null);
const chase = structuredClone(asset); chase.ticker.last=115;
assert.equal(mod.discoverBreakoutRetest(chase,asset),null);
let notifications=0, loads=0;
const state=new Map();
const env={SCANNER_STATE:{getByName(){return {async fetch(url,options){
  const input=JSON.parse(options.body);
  if(input.op==='get')return Response.json({values:Object.fromEntries(input.keys.map(k=>[k,state.get(k)??null]))});
  if(input.op==='put'){for(const [k,v] of Object.entries(input.values))state.set(k,v.value);return Response.json({status:'ok'});}
  if(input.op==='compareAndPut'){
    for(const [k,v] of Object.entries(input.expected))if(JSON.stringify(state.get(k)??null)!==JSON.stringify(v))return Response.json({applied:false});
    for(const [k,v] of Object.entries(input.values))state.set(k,v.value);return Response.json({applied:true});
  }
}};}}};
const fullAsset={...asset,capitalFlow:{status:'ok'},executionLiquidity:{status:'ok'},derivatives:{openInterest:{status:'ok'},funding:{status:'ok'}}};
const zone=async()=>({passed:true,confirmed:true,current:{status:'ok',last:103,bid:102.99,ask:103.01,exchangeTimestamp:new Date(now).toISOString(),source:'OKX_USDT_PERPETUAL_DIRECT_VERIFIED',verification:{passed:true}},samples:[{last:103},{last:103}]});
mod.installDiscoveryFakes({price:async()=>{loads++;return {last:103};},candles:async()=>[{confirmed:true}],summary:()=>structuredClone(tf),snapshot:async()=>({coverage:{openNowDataReady:true},assets:{ETHUSDT:structuredClone(fullAsset),BTCUSDT:structuredClone(fullAsset)}}),zone,notify:async()=>{notifications++;return {sent:true};}});
const discovered=await mod.runDiscovery(env);
assert.equal(discovered.status,'candidate');
assert.equal(discovered.openNowAllowed,false);
assert.equal(notifications,1);
assert.equal(state.has('scanner:active-plan'),false,'Discovery cannot save plans');
const beforeLoads=loads;
assert.equal((await mod.runDiscovery(env)).reason,'DISCOVERY_INTERVAL_NOT_DUE');
assert.equal(loads,beforeLoads);
state.set('scanner:manual-priority',{until:now+60000});
state.delete('scanner:discovery');
assert.notEqual((await mod.runDiscovery(env)).reason,'MANUAL_REQUEST_PRIORITY','Manual requests must not starve discovery');
assert.equal(loads,beforeLoads);
state.clear();
mod.installDiscoveryFakes({price:async()=>{throw new Error('429');},candles:async()=>[],summary:()=>tf,snapshot:async()=>null,zone:async()=>null,notify:async()=>{notifications++;}});
assert.equal((await mod.runDiscovery(env)).status,'idle');
assert.equal(notifications,1,'Data failure must stay silent');
state.clear();
mod.installDiscoveryFakes({price:async()=>({last:103}),candles:async()=>{throw new Error('OKX 429');},gateCandles:async()=>[{confirmed:true}],summary:()=>structuredClone(tf),snapshot:async()=>({coverage:{openNowDataReady:true},assets:{ETHUSDT:structuredClone(fullAsset),BTCUSDT:structuredClone(fullAsset)}}),zone,notify:async()=>{notifications++;return {sent:true};}});
const gateDiscovered=await mod.runDiscovery(env);
assert.equal(gateDiscovered.status,'candidate','quality-approved Gate perpetual fallback may discover a candidate');
assert.equal(gateDiscovered.openNowAllowed,false);
assert.equal(state.has('scanner:active-plan'),false);
assert.equal(gateDiscovered.candidate.submodel,'B1');
console.log(JSON.stringify({ passed: true, tested: ['429-no-immediate-retry', 'cooldown-blocks-repeat', 'recovery-after-deadline', 'HTTP-date', 'Gate-reset-header', 'JSON-50011', 'no-key-in-diagnostics', 'persistent-candle-circuit-after-local-reset', 'B1-complete-chain', 'B1-net2-block-and-better-entry-pass', 'failed-retest-silent', 'stale-silent', 'no-chasing', 'discovery-one-minute-dedupe', 'manual-queries-do-not-starve-monitoring', 'discovery-data-failure-silent', 'discovery-gate-perpetual-fallback', 'discovery-never-saves-plan'] }));
