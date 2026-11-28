import assert from 'node:assert/strict';
import fs from 'node:fs';
import {scanMarketFrame,scanMarket} from '../modules/desk-market-scanner.mjs';
const now=Date.parse('2026-11-18T04:00:00Z'),ms=900000;
function frame(){return {status:'ok',quality:{passed:true},dataFreshness:{state:'fresh'},recentCandles:Array.from({length:60},(_,i)=>({ts:new Date(now-(60-i)*ms).toISOString(),o:100,c:100,h:101,l:99,volume:100,confirmed:true}))};}
let f=frame();Object.assign(f.recentCandles.at(-1),{o:100,c:103,h:103.5,l:99,volume:250});
let r=scanMarketFrame('BTC','15m',f,now);assert.equal(r.events[0].kind,'VOLUME_BREAKOUT');assert.equal(r.events[0].executionPermission,false);
assert.equal(scanMarketFrame('BTC','15m',f,now+ms).reason,'LATEST_CLOSED_BAR_MISSING');
f.recentCandles.at(-1).confirmed=false;assert.equal(scanMarketFrame('BTC','15m',f,now).events.length,0,'open candle cannot confirm');
f=frame();f.recentCandles.splice(40,1);assert.equal(scanMarketFrame('BTC','15m',f,now).reason,'INVALID_OR_GAPPED_BARS');
f=frame();Object.assign(f.recentCandles.at(-1),{o:100,c:100.1,h:104,l:99.8});assert(scanMarketFrame('ZEC','15m',f,now).events.some(e=>e.kind==='UPPER_WICK'));
f=frame();Object.assign(f.recentCandles.at(-1),{o:100,c:99.9,h:100.2,l:96});assert(scanMarketFrame('ZEC','15m',f,now).events.some(e=>e.kind==='LOWER_WICK'));
f=frame();Object.assign(f.recentCandles.at(-1),{o:100,c:100.1,h:100.2,l:99.8});assert.equal(scanMarketFrame('ZEC','15m',f,now).events.length,0,'small noisy wick excluded');
f=frame();f.quality.passed=false;assert.equal(scanMarketFrame('ZEC','15m',f,now).events.length,0);
// First strong rise, second weaker rise makes a confirmed bearish RSI divergence.
f=frame();const closes=[...Array.from({length:35},(_,i)=>100+i*.5),119,121,123,121,119,117,116,115,115.1,115.2,115.3,115.4,115.5,115.6,115.7,115.8,116,117,118,119,120,122,124,123,122];
assert.equal(closes.length,60);
f.recentCandles.forEach((r,i)=>Object.assign(r,{o:closes[i],c:closes[i],h:closes[i]+.5,l:closes[i]-.5}));
r=scanMarketFrame('ZEC','15m',f,now);assert(r.events.some(e=>e.kind==='BEARISH_DIVERGENCE'),'confirmed higher price / lower RSI');
f.recentCandles.forEach(r=>Object.assign(r,{o:250-r.o,c:250-r.c,h:250-r.l,l:250-r.h}));
assert(scanMarketFrame('ZEC','15m',f,now).events.some(e=>e.kind==='BULLISH_DIVERGENCE'));
const report=scanMarket({assets:{BTCUSDT:{timeframes:{'15m':f}}}},now);assert.equal(report.frames.length,3);
const source=fs.readFileSync(new URL('../main-v188.js',import.meta.url),'utf8'),module=fs.readFileSync(new URL('../modules/desk-market-scanner.mjs',import.meta.url),'utf8').replaceAll('export const ','const ').replaceAll('export function ','function ');assert(source.includes(module));
console.log('PASS closed-bar breakouts, volume, wicks, two-bar divergence, stale/gapped data rejection, embedded production parity');
