import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../main-v188.js", import.meta.url), "utf8")
  .replaceAll("export class ", "class ")
  .replaceAll("export function ", "function ")
  .replace("export default {", "globalThis.worker = {")
  + "\n;globalThis.t={ScannerState,loadDurableStructureRecords,structureRecordUsable,TIMEFRAMES,STRUCTURE_REFRESH_SECONDS};";

let now = Math.floor(Date.now() / 900_000) * 900_000 + 10 * 60_000;
let gateFetches = 0;
let okxFetches = 0;
let gateFails = false;
let okxFails = false;

const FakeDate = class extends Date {
  static now() { return now; }
};

function intervalMs(value) {
  const interval = String(value).toLowerCase();
  if (interval === "15m") return 900_000;
  if (interval === "1h" || interval === "1h") return 3_600_000;
  return 14_400_000;
}

function candles(asset, timeframe, count) {
  const step = intervalMs(timeframe);
  const currentStart = Math.floor(now / step) * step;
  const base = asset === "BTC" ? 60_000 : 2_400;
  const slope = asset === "BTC" ? 0.6 : 0.02;
  return Array.from({ length: count }, (_, index) => {
    const timestamp = currentStart - (count - 1 - index) * step;
    const close = base + (index - count) * slope;
    return { timestamp, open: close - slope, high: close + 2 * slope, low: close - 2 * slope, close, volume: 1000 + index };
  });
}

const storage = new Map();
const durableContext = {
  storage: {
    async get(key) { return structuredClone(storage.get(key)); },
    async put(key, value) { storage.set(key, structuredClone(value)); },
    async delete(key) { storage.delete(key); },
  },
};

const context = {
  console, Math, JSON, URL, URLSearchParams, Request, Response, Headers,
  AbortController, crypto, structuredClone, setTimeout, clearTimeout, Date: FakeDate,
  caches: { default: { async match() { return undefined; }, async put() {} } },
  fetch: async (input) => {
    const url = new URL(input);
    if (url.hostname === "api.gateio.ws" && url.pathname.endsWith("/candlesticks")) {
      gateFetches += 1;
      if (gateFails) return new Response("", { status: 503 });
      const contract = url.searchParams.get("contract");
      const timeframe = url.searchParams.get("interval");
      const count = Number(url.searchParams.get("limit"));
      const rows = candles(contract.startsWith("BTC") ? "BTC" : "ETH", timeframe, count).map((row) => ({
        t: String(row.timestamp / 1000), o: String(row.open), h: String(row.high), l: String(row.low), c: String(row.close), v: String(row.volume), sum: String(row.volume * row.close),
      }));
      return Response.json(rows);
    }
    if (url.hostname === "www.okx.com" && url.pathname.endsWith("/candles")) {
      okxFetches += 1;
      if (okxFails) return new Response("", { status: 503 });
      const instrument = url.searchParams.get("instId");
      const bar = url.searchParams.get("bar");
      const timeframe = bar.toLowerCase();
      const count = Number(url.searchParams.get("limit"));
      const rows = candles(instrument.startsWith("BTC") ? "BTC" : "ETH", timeframe, count).map((row, index, all) => [
        String(row.timestamp), String(row.open), String(row.high), String(row.low), String(row.close), String(row.volume), String(row.volume), String(row.volume * row.close), index === all.length - 1 ? "0" : "1",
      ]).reverse();
      return Response.json({ code: "0", data: rows });
    }
    throw new Error(`Unexpected fetch ${url}`);
  },
};

vm.createContext(context);
vm.runInContext(source, context);
const { ScannerState, loadDurableStructureRecords, structureRecordUsable } = context.t;
const object = new ScannerState(durableContext);
const env = {
  SCANNER_STATE: {
    idFromName(name) { return name; },
    get() { return { fetch: (input, init) => object.fetch(new Request(input, init)) }; },
  },
};

let state = await loadDurableStructureRecords(env);
assert.equal(gateFetches, 6, "cold start must fetch six Gate baselines exactly once");
assert.equal(okxFetches, 0);
assert.equal(state.definitions.every(({ key, timeframe }) => structureRecordUsable(state.records[key], timeframe)), true);
assert.equal(state.definitions.every(({ key }) => state.records[key].candles.length === 240), true);

await loadDurableStructureRecords(env);
assert.equal(gateFetches, 6, "fresh persistent state must avoid all candle downloads");

now += 80_000;
await Promise.all(Array.from({ length: 10 }, () => loadDurableStructureRecords(env)));
assert.equal(gateFetches, 8, "ten concurrent callers must share one two-series 15M refresh");

gateFails = true;
now += 80_000;
state = await loadDurableStructureRecords(env);
assert.equal(okxFetches, 0, "fresh persisted Gate data must survive one refresh failure without source switching");
const fifteenMinute = state.definitions.filter(({ timeframe }) => timeframe === "15m");
assert.equal(fifteenMinute.every(({ key, timeframe }) => structureRecordUsable(state.records[key], timeframe)), true);
assert.equal(fifteenMinute.every(({ key }) => state.records[key].mode === "PERSISTED_BASELINE_AFTER_REFRESH_ERROR"), true);

now += 190_000;
state = await loadDurableStructureRecords(env);
assert.ok(okxFetches >= 2, "expired Gate records must attempt full OKX recovery");
assert.equal(fifteenMinute.every(({ key }) => state.records[key].source === "OKX_USDT_PERPETUAL"), true);

gateFails = true;
okxFails = true;
now += 700_000;
state = await loadDurableStructureRecords(env);
assert.equal(state.definitions.some(({ key, timeframe }) => !structureRecordUsable(state.records[key], timeframe)), true, "expired data with both sources down must remain blocked");

console.log(JSON.stringify({ gateFetches, okxFetches, records: state.definitions.length }, null, 2));
console.log("V22 durable baseline / incremental update / concurrency / failover / expiry tests PASS");
