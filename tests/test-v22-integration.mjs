import assert from "node:assert/strict";

let failBinance = false;
let badBinance = false;
let requestCount = 0;
let requestUrls = [];
let cacheMatchCount = 0;
let cachePutCount = 0;
let enforceCloudflareSubrequestLimit = false;
const subrequestBudgets = {};
function enforceSubrequestBudget() {
  if (enforceCloudflareSubrequestLimit && requestCount + cacheMatchCount + cachePutCount > 50) {
    throw new Error("Too many subrequests by single Worker invocation");
  }
}
let failOkxDerivatives = false;
let failOkxMarkPrice = false;
let failOkxTicker = false;
let failOkxTickerBody = false;
let failFuturesTicker = false;
let failBybitCandles = new Set();
let failGateCandles = new Set();
let failOkxCandles = new Set();
let failGateCapitalFlow = new Set();
let failGateOrderBookOnce = new Set();
let failKrakenSpotCandles = new Set();
let bybitBadPrice = false;
let gateBadPrice = false;
let gateZeroVolume = false;
let krakenSpotZeroVolume = false;
let importSequence = 0;
let barkPayloads = [];
let failBark = false;
let okxEthPrice = 2581.1;
let okxDirectEthPrice = null;
let failOkxDirectPrice = false;
let gateTouchOverride = null;
let gate15mSweepOverride = null;
let gateCrowdingExtreme = false;
let clock = Date.now();
Date.now = () => clock;

const cacheStore = new Map();
const durableStore = new Map();
let StateClass;
function durableBinding() {
  let tail=Promise.resolve();
  const storage={async get(k){return structuredClone(durableStore.get(k));},async put(k,v){durableStore.set(k,structuredClone(v));},async delete(k){durableStore.delete(k);},
    transaction(fn){const task=tail.then(()=>fn(storage));tail=task.catch(()=>{});return task;}};
  const object=new StateClass({storage});
  return {getByName(){return {fetch:(url,init)=>object.fetch(new Request(url,init))};}};
}
globalThis.caches = {
  default: {
    async match(request) {
      cacheMatchCount += 1;
      enforceSubrequestBudget();
      const key = typeof request === "string" ? request : request.url;
      const item = cacheStore.get(key);
      if (!item || item.expiresAt <= Date.now()) {
        cacheStore.delete(key);
        return undefined;
      }
      return item.response.clone();
    },
    async put(request, response) {
      cachePutCount += 1;
      enforceSubrequestBudget();
      const key = typeof request === "string" ? request : request.url;
      const control = response.headers.get("cache-control") || "";
      const seconds = Number(control.match(/s-maxage=(\d+)/)?.[1] || control.match(/max-age=(\d+)/)?.[1] || 0);
      cacheStore.set(key, { response: response.clone(), expiresAt: Date.now() + seconds * 1000 });
    },
  },
};

function resetState() {
  failBinance = false; badBinance = false;
  requestCount = 0;
  requestUrls = [];
  cacheMatchCount = 0;
  cachePutCount = 0;
  enforceCloudflareSubrequestLimit = false;
  failOkxDerivatives = false;
  failOkxMarkPrice = false;
  failOkxTicker = false;
  failOkxTickerBody = false;
  failFuturesTicker = false;
  failBybitCandles = new Set();
  failGateCandles = new Set();
  failOkxCandles = new Set();
  failGateCapitalFlow = new Set();
  failGateOrderBookOnce = new Set();
  failKrakenSpotCandles = new Set();
  bybitBadPrice = false;
  gateBadPrice = false;
  gateZeroVolume = false;
  krakenSpotZeroVolume = false;
  barkPayloads = [];
  failBark = false;
  okxEthPrice = 2581.1;
  okxDirectEthPrice = null;
  failOkxDirectPrice = false;
  gateTouchOverride = null;
  gate15mSweepOverride = null;
  gateCrowdingExtreme = false;
  cacheStore.clear();
  durableStore.clear();
}

function advance(ms) {
  clock += ms;
}

async function freshWorker() {
  importSequence += 1;
  const module=await import(`../main-v188.js?test=${importSequence}`);StateClass=module.ScannerState;return module.default;
}

function generatedCandles(asset, step, count = 240) {
  const base = asset === "BTC" ? 60_000 : 2_400;
  const slope = asset === "BTC" ? 18 : 0.8;
  return Array.from({ length: count }, (_, i) => {
    const close = base + i * slope + Math.sin(i / 5) * slope * 3;
    return {
      time: Math.floor(Date.now() / step) * step - (count - 1 - i) * step,
      open: close - slope / 2,
      high: close + slope * 2,
      low: close - slope * 2,
      close,
      volume: 1000 + i,
    };
  });
}

function stepFromInterval(interval) {
  const value = String(interval).toLowerCase();
  return value === "1" || value === "1m" ? 60_000 : value === "15" || value === "15m" ? 15 * 60_000 : value === "60" || value === "1h" ? 60 * 60_000 : 4 * 60 * 60_000;
}

function bybitRows(symbol, interval) {
  const asset = symbol.startsWith("BTC") ? "BTC" : "ETH";
  const rows = generatedCandles(asset, stepFromInterval(interval)).map((c) => [
    String(c.time), String(c.open), String(c.high), String(c.low), String(bybitBadPrice ? c.close * 1.03 : c.close), String(c.volume), String(c.volume * c.close),
  ]);
  return rows.reverse();
}

function gateRows(symbol, interval) {
  const asset = symbol.startsWith("BTC") ? "BTC" : "ETH";
  const rows = generatedCandles(asset, stepFromInterval(interval)).map((c) => ({
    t: Math.floor(c.time / 1000),
    o: String(c.open),
    h: String(c.high),
    l: String(c.low),
    c: String(gateBadPrice ? c.close * 1.03 : c.close),
    v: String(gateZeroVolume ? 0 : c.volume),
    sum: String(gateZeroVolume ? 0 : c.volume * c.close),
  }));
  if (interval === "1m" && asset === "ETH" && gateTouchOverride) {
    Object.assign(rows.at(-1), {
      o: String(gateTouchOverride.open ?? gateTouchOverride.close),
      h: String(gateTouchOverride.high),
      l: String(gateTouchOverride.low),
      c: String(gateTouchOverride.close),
    });
  }
  if (interval === "15m" && asset === "ETH" && gate15mSweepOverride) {
    const candidateIndex = rows.length - 2;
    const priorHigh = Math.max(...rows.slice(candidateIndex - 12, candidateIndex).map((row) => Number(row.h)));
    Object.assign(rows[candidateIndex], {
      o: String(priorHigh + 0.5),
      h: String(priorHigh + 4),
      l: String(priorHigh - 2),
      c: String(priorHigh - 0.5),
    });
  }
  return rows;
}

function okxCandleRows(instrumentId, bar) {
  const asset = instrumentId.startsWith("BTC") ? "BTC" : "ETH";
  const rows = generatedCandles(asset, stepFromInterval(bar)).map((c, index, all) => [
    String(c.time), String(c.open), String(c.high), String(c.low), String(c.close),
    String(c.volume), String(c.volume), String(c.volume * c.close), index === all.length - 1 ? "0" : "1",
  ]);
  return rows.reverse();
}

function gateStatsRows(symbol) {
  const isBtc = symbol.startsWith("BTC");
  const price = isBtc ? 63818.2 : 2581.1;
  const oi = isBtc ? 2_048_000_000 : 2_270_000_000;
  return Array.from({ length: 50 }, (_, index) => ({
    time: Math.floor((Date.now() - (49 - index) * 5 * 60_000) / 1000),
    mark_price: String(price + Math.sin(index / 4) * (isBtc ? 20 : 1)),
    long_taker_size: String((isBtc ? 9000 : gateCrowdingExtreme ? 2600 : 1700) + index * 7),
    short_taker_size: String((isBtc ? 8200 : gateCrowdingExtreme ? 1200 : 1550) + index * 5),
    open_interest_usd: String(oi * (1 + index * (gateCrowdingExtreme && !isBtc ? 0.003 : 0.0001))),
    long_liq_usd: String(index % 9 === 0 ? 18_000 : 0),
    short_liq_usd: String(index % 11 === 0 ? 22_000 : 0),
    lsr_account: gateCrowdingExtreme && !isBtc ? "1.45" : "1.08",
    lsr_taker: "1.04",
    top_lsr_size: gateCrowdingExtreme && !isBtc ? "1.55" : "1.12",
    top_lsr_account: "1.06",
    long_users: "5200",
    short_users: "4800",
  }));
}

function gateTradeRows(symbol) {
  const isBtc = symbol.startsWith("BTC");
  const price = isBtc ? 63818.2 : 2581.1;
  return Array.from({ length: 200 }, (_, index) => ({
    id: index,
    create_time_ms: (Date.now() - (199 - index) * 1000) / 1000,
    price: String(price + Math.sin(index / 6) * (isBtc ? 5 : 0.25)),
    size: String((index % 3 === 0 ? -1 : 1) * ((isBtc ? 7000 : 1200) + index * (isBtc ? 45 : 8))),
  }));
}

function gateOrderBook(symbol) {
  const isBtc = symbol.startsWith("BTC");
  const price = isBtc ? 63818.2 : 2581.1;
  const unit = isBtc ? 8500 : 1500;
  return {
    current: Math.floor(Date.now() / 1000),
    bids: Array.from({ length: 20 }, (_, index) => ({ p: String(price - (index + 1) * (isBtc ? 0.1 : 0.01)), s: String(unit + index * 20) })),
    asks: Array.from({ length: 20 }, (_, index) => ({ p: String(price + (index + 1) * (isBtc ? 0.1 : 0.01)), s: String(unit - 500 + index * 15) })),
  };
}

function krakenSpotRows(pair, interval) {
  const asset = pair.startsWith("XBT") ? "BTC" : "ETH";
  return generatedCandles(asset, stepFromInterval(interval)).map((c) => [
    Math.floor(c.time / 1000), String(c.open), String(c.high), String(c.low), String(c.close), String(c.close), String(krakenSpotZeroVolume ? 0 : c.volume), 10,
  ]);
}

function futuresTickers() {
  return [
    { symbol: "PI_XBTUSD", last: 63800, markPrice: 63801, bid: 63799, ask: 63801, high24h: 65000, low24h: 62000, open24h: 63000, volume24h: 123456, openInterest: 32100, fundingRate: 0.0001 },
    { symbol: "PI_ETHUSD", last: 2580, markPrice: 2580.1, bid: 2579.9, ask: 2580.1, high24h: 2650, low24h: 2500, open24h: 2550, volume24h: 654321, openInterest: 880000, fundingRate: 0.00008 },
  ];
}

function okxTickerRows(ethPrice = okxEthPrice) {
  return [
    { instType: "SWAP", instId: "BTC-USDT-SWAP", last: "63818.2", bidPx: "63818.1", askPx: "63818.3", high24h: "65000", low24h: "62000", open24h: "63000", vol24h: "123456", ts: String(Date.now()) },
    { instType: "SWAP", instId: "ETH-USDT-SWAP", last: String(ethPrice), bidPx: String(ethPrice - 0.1), askPx: String(ethPrice + 0.1), high24h: "2650", low24h: "2500", open24h: "2550", vol24h: "654321", ts: String(Date.now()) },
  ];
}

function okxMarkRows(ethPrice = okxEthPrice) {
  return [
    { instType: "SWAP", instId: "BTC-USDT-SWAP", markPx: "63820.5", ts: String(Date.now()) },
    { instType: "SWAP", instId: "ETH-USDT-SWAP", markPx: String(ethPrice + 0.15), ts: String(Date.now()) },
  ];
}

function okxOiHistoryRows(symbol) {
  const latest = symbol.startsWith("BTC") ? 2_086_000_000 : 1_320_000_000;
  return Array.from({ length: 20 }, (_, index) => {
    const minutesAgo = index * 5;
    const usd = latest * (1 - minutesAgo * 0.00008);
    return [
      String(Date.now() - minutesAgo * 60_000),
      String(usd / 650),
      String(usd / (symbol.startsWith("BTC") ? 64_000 : 1_900)),
      String(usd),
    ];
  });
}

globalThis.fetch = async (input, options = {}) => {
  requestCount += 1;
  enforceSubrequestBudget();
  const url = new URL(String(input));
  requestUrls.push(url.toString());

  if (url.hostname === "fapi.binance.com") {
    if (failBinance) return new Response("rate limited", {status:429,headers:{"Retry-After":"60"}});
    const symbol=url.searchParams.get("symbol"), tf=url.searchParams.get("interval");
    const step=stepFromInterval(tf);
    const rows=generatedCandles(symbol.startsWith("BTC")?"BTC":"ETH",step).map(c=>[c.time,String(c.open),String(c.high),String(c.low),String(badBinance?c.close*1.04:c.close),String(c.volume),c.time+step-1,String(c.volume*c.close)]);
    return Response.json(rows);
  }
  if (url.hostname === "api.day.app" && url.pathname === "/push") {
    barkPayloads.push(JSON.parse(options.body));
    if (failBark) return new Response("temporary bark failure", { status: 503 });
    return Response.json({ code: 200, message: "success" });
  }

  if (url.hostname === "futures.kraken.com" && url.pathname.endsWith("/tickers")) {
    if (failFuturesTicker) return new Response("ticker failed", { status: 503 });
    return Response.json({ result: "success", tickers: futuresTickers() });
  }

  if (url.hostname === "api.coinalyze.net") {
    assert.equal(options.headers?.api_key, "coinalyze-test-key");
    if (url.pathname.endsWith("/future-markets")) {
      return Response.json([
        { symbol: "BTCUSDT_PERP.OKX", exchange: "OKX", symbol_on_exchange: "BTC-USDT-SWAP", base_asset: "BTC", quote_asset: "USDT", is_perpetual: true, margined: "STABLE" },
        { symbol: "BTCUSDT_PERP.BINANCE", exchange: "BINANCE", symbol_on_exchange: "BTCUSDT", base_asset: "BTC", quote_asset: "USDT", is_perpetual: true, margined: "STABLE" },
        { symbol: "BTCUSDT_PERP.BYBIT", exchange: "BYBIT", symbol_on_exchange: "BTCUSDT", base_asset: "BTC", quote_asset: "USDT", is_perpetual: true, margined: "STABLE" },
        { symbol: "ETHUSDT_PERP.OKX", exchange: "OKX", symbol_on_exchange: "ETH-USDT-SWAP", base_asset: "ETH", quote_asset: "USDT", is_perpetual: true, margined: "STABLE" },
        { symbol: "ETHUSDT_PERP.BINANCE", exchange: "BINANCE", symbol_on_exchange: "ETHUSDT", base_asset: "ETH", quote_asset: "USDT", is_perpetual: true, margined: "STABLE" },
        { symbol: "ETHUSDT_PERP.BYBIT", exchange: "BYBIT", symbol_on_exchange: "ETHUSDT", base_asset: "ETH", quote_asset: "USDT", is_perpetual: true, margined: "STABLE" },
      ]);
    }
    if (url.pathname.endsWith("/liquidation-history")) {
      assert.equal(url.searchParams.get("interval"), "5min");
      assert.equal(url.searchParams.get("convert_to_usd"), "true");
      const symbols = url.searchParams.get("symbols").split(",");
      assert.equal(symbols.length, 6);
      return Response.json(symbols.map((symbol) => ({
        symbol,
        history: Array.from({ length: 288 }, (_, index) => ({
          t: Math.floor(Date.now() / 1000) - (287 - index) * 300,
          l: index >= 285 ? 25_000 : 1_000,
          s: index >= 285 ? 5_000 : 900,
        })),
      })));
    }
  }

  if (url.hostname === "api.bybit.com" && url.pathname.endsWith("/v5/market/kline")) {
    const symbol = url.searchParams.get("symbol");
    const interval = url.searchParams.get("interval");
    const key = `${symbol}:${interval}`;
    assert.equal(url.searchParams.get("category"), "linear");
    if (failBybitCandles.has(key) || failBybitCandles.has("ALL")) return new Response("bybit failed", { status: 429 });
    return Response.json({ retCode: 0, retMsg: "OK", result: { symbol, category: "linear", list: bybitRows(symbol, interval) } });
  }

  if (url.hostname === "api.gateio.ws" && url.pathname.endsWith("/api/v4/futures/usdt/candlesticks")) {
    const symbol = url.searchParams.get("contract");
    const interval = url.searchParams.get("interval");
    const key = `${symbol}:${interval}`;
    if (failGateCandles.has(key) || failGateCandles.has("ALL")) return new Response("gate failed", { status: 403 });
    return Response.json(gateRows(symbol, interval));
  }

  if (url.hostname === "api.gateio.ws" && url.pathname.endsWith("/api/v4/futures/usdt/contract_stats")) {
    const symbol = url.searchParams.get("contract");
    if (failGateCapitalFlow.has("ALL") || failGateCapitalFlow.has(`${symbol}:stats`)) return new Response("gate stats failed", { status: 503 });
    assert.equal(url.searchParams.get("interval"), "5m");
    assert.equal(url.searchParams.get("limit"), "50");
    return Response.json(gateStatsRows(symbol));
  }

  if (url.hostname === "api.gateio.ws" && url.pathname.endsWith("/api/v4/futures/usdt/trades")) {
    const symbol = url.searchParams.get("contract");
    if (failGateCapitalFlow.has("ALL") || failGateCapitalFlow.has(`${symbol}:trades`)) return new Response("gate trades failed", { status: 503 });
    assert.equal(url.searchParams.get("limit"), "500");
    return Response.json(gateTradeRows(symbol));
  }

  if (url.hostname === "api.gateio.ws" && url.pathname.endsWith("/api/v4/futures/usdt/order_book")) {
    const symbol = url.searchParams.get("contract");
    if (failGateOrderBookOnce.has(`${symbol}:orderBook`)) {
      failGateOrderBookOnce.delete(`${symbol}:orderBook`);
      return new Response("gate order book transient failure", { status: 503 });
    }
    if (failGateCapitalFlow.has("ALL") || failGateCapitalFlow.has(`${symbol}:orderBook`)) return new Response("gate order book failed", { status: 503 });
    assert.equal(url.searchParams.get("limit"), "20");
    return Response.json(gateOrderBook(symbol));
  }

  if (url.hostname === "api.kraken.com" && url.pathname.endsWith("/0/public/OHLC")) {
    const pair = url.searchParams.get("pair");
    const interval = url.searchParams.get("interval");
    const key = `${pair}:${interval}`;
    if (failKrakenSpotCandles.has(key) || failKrakenSpotCandles.has("ALL")) return new Response("kraken failed", { status: 503 });
    return Response.json({ error: [], result: { [pair]: krakenSpotRows(pair, interval), last: String(Date.now()) } });
  }

  if (url.hostname === "www.okx.com") {
    if(failOkxDirectPrice && url.searchParams.get("instId")?.endsWith("-SWAP") && /\/market\/(trades|books|books-full)$/.test(url.pathname))return new Response("perpetual quote outage",{status:429});
    if (url.pathname.endsWith("/market/candles")) {
      const instrumentId = url.searchParams.get("instId");
      const bar = url.searchParams.get("bar");
      const key = `${instrumentId}:${bar}`;
      if (failOkxCandles.has(key) || failOkxCandles.has("ALL")) return new Response("OKX candles rate limited", { status: 429, headers: { "retry-after": "60" } });
      assert.equal(url.searchParams.get("limit"), "240");
      return Response.json({ code: "0", msg: "", data: okxCandleRows(instrumentId, bar) });
    }
    if (url.pathname.endsWith("/market/index-tickers")) {
      assert.equal(url.searchParams.get("quoteCcy"), "USDT");
      return Response.json({ code: "0", msg: "", data: [
        { instId: "BTC-USDT", idxPx: "63812.5", ts: String(Date.now()) },
        { instId: "ETH-USDT", idxPx: "2580.8", ts: String(Date.now()) },
      ] });
    }
    if (url.pathname.endsWith("/market/ticker")) {
      if (failOkxDirectPrice) return new Response("direct ticker unavailable", { status: 503 });
      const instId = url.searchParams.get("instId");
      const rows = okxTickerRows(okxDirectEthPrice ?? okxEthPrice);
      return Response.json({ code: "0", msg: "", data: rows.filter((row) => row.instId === instId) });
    }
    if (url.pathname.endsWith("/market/tickers")) {
      if (url.searchParams.get("instType") === "SPOT") {
        return Response.json({ code: "0", msg: "", data: [
          { instId: "BTC-USDT", last: "63810", bidPx: "63809.9", askPx: "63810.1", vol24h: "1000", volCcy24h: "63810000", ts: String(Date.now()) },
          { instId: "ETH-USDT", last: "2580.7", bidPx: "2580.6", askPx: "2580.8", vol24h: "5000", volCcy24h: "12903500", ts: String(Date.now()) },
        ] });
      }
      if (failOkxTicker) return new Response("ticker rate limited", { status: 429 });
      if (failOkxTickerBody) return Response.json({ code: "50011", msg: "Rate limit reached", data: [] });
      assert.equal(url.searchParams.get("instType"), "SWAP");
      assert.equal(url.searchParams.get("instId"), null);
      return Response.json({ code: "0", msg: "", data: okxTickerRows() });
    }
    if (url.pathname.endsWith("/market/trades")) {
      const instId = url.searchParams.get("instId");
      const price = instId.startsWith("BTC") ? 63810 : 2580.7;
      return Response.json({ code: "0", msg: "", data: Array.from({ length: 100 }, (_, index) => ({ tradeId: String(1000 - index), px: String(price + (index % 3 - 1) * 0.1), sz: String(instId.startsWith("BTC") ? 0.01 : 0.2), side: index % 3 ? "buy" : "sell", ts: String(Date.now() - index * 100) })) });
    }
    if (url.pathname.endsWith("/market/books")) {
      const instId = url.searchParams.get("instId");
      const price = instId.startsWith("BTC") ? 63810 : 2580.7;
      return Response.json({ code: "0", msg: "", data: [{ bids: Array.from({ length: 20 }, (_, index) => [String(price - 0.1 - index * 0.1), "1", "0", "1"]), asks: Array.from({ length: 20 }, (_, index) => [String(price + 0.1 + index * 0.1), "1", "0", "1"]), ts: String(Date.now()) }] });
    }
    if (url.pathname.endsWith("/mark-price")) {
      const instId = url.searchParams.get("instId");
      if (instId) {
        if (failOkxDirectPrice) return new Response("direct mark unavailable", { status: 503 });
        const rows = okxMarkRows(okxDirectEthPrice ?? okxEthPrice);
        return Response.json({ code: "0", msg: "", data: rows.filter((row) => row.instId === instId) });
      }
      if (failOkxMarkPrice) return new Response("mark price rate limited", { status: 429 });
      assert.equal(url.searchParams.get("instType"), "SWAP");
      assert.equal(url.searchParams.get("instId"), null);
      return Response.json({ code: "0", msg: "", data: okxMarkRows() });
    }
    if (url.pathname.endsWith("/open-interest")) {
      if (failOkxDerivatives) return new Response("derivatives rate limited", { status: 429 });
      assert.equal(url.searchParams.get("instType"), "SWAP");
      assert.equal(url.searchParams.get("instId"), null);
      return Response.json({ code: "0", msg: "", data: [
        { instId: "BTC-USDT-SWAP", oi: "32100", oiCcy: "500", oiUsd: "2048000000", ts: String(Date.now()) },
        { instId: "ETH-USDT-SWAP", oi: "880000", oiCcy: "3400", oiUsd: "2270000000", ts: String(Date.now()) },
      ] });
    }
    if (url.pathname.endsWith("/open-interest-history")) {
      if (failOkxDerivatives) return new Response("OI history rate limited", { status: 429 });
      const instrumentId = url.searchParams.get("instId");
      assert.equal(url.searchParams.get("period"), "5m");
      assert.equal(url.searchParams.get("limit"), "20");
      return Response.json({ code: "0", msg: "", data: okxOiHistoryRows(instrumentId) });
    }
    if (url.pathname.endsWith("/funding-rate")) {
      if (failOkxDerivatives) return new Response("derivatives rate limited", { status: 429 });
      const isBtc = url.searchParams.get("instId")?.startsWith("BTC");
      return Response.json({ code: "0", msg: "", data: [{ instId: url.searchParams.get("instId"), fundingRate: isBtc ? "0.0001" : gateCrowdingExtreme ? "0.0006" : "0.00008", fundingTime: String(Date.now()), nextFundingTime: String(Date.now() + 8 * 60 * 60_000) }] });
    }
  }

  throw new Error(`Unexpected URL: ${url}`);
};

async function snapshot(worker) {
  const response = await worker.fetch(new Request("https://example.test/"), {}, {});
  assert.equal(response.status, 200);
  return response.json();
}

function assertReady(body) {
  assert.equal(body.status, "ok");
  assert.equal(body.decisionState, "DATA_READY");
  assert.equal(body.coverage.coveragePct, 100);
  assert.equal(body.coverage.executionPriceReady, true);
  assert.equal(body.coverage.semanticQualityReady, true);
  assert.equal(body.coverage.criticalReady, true);
  assert.equal(body.analysisContract.timeframeFramework.marketTrendAndEnvironment, "4H");
  assert.equal(body.analysisContract.timeframeFramework.structureAndDirectionValidity, "1H");
  assert.equal(body.analysisContract.timeframeFramework.entryLocationAndTrigger, "15M");
  assert.equal(body.analysisContract.timeframeFramework.btcRole, "ETH_ENVIRONMENT_FILTER");
  assert.ok(body.analysisContract.timeframeFramework.dailyDataPolicy.includes("MISSING_1D_ALONE_MUST_NOT_CAUSE_DATA_BLOCKED"));
  assert.deepEqual(body.analysisContract.newsResearchContract.requiredEveryTradingAnalysis, ["JIN10", "COINDESK"]);
  assert.equal(body.analysisContract.scannerPriceContract.rule, "TWO_INDEPENDENT_CURRENT_OKX_SAMPLES_INSIDE_ZONE");
  assert.equal(body.analysisContract.scannerPriceContract.historicalCrossingAllowed, false);
  assert.equal(body.analysisContract.scannerPriceContract.oneMinuteCandleTouchAllowed, false);
  assert.ok(body.analysisContract.validationGovernance.requiredAudits.includes("WALK_FORWARD_OUT_OF_SAMPLE"));
  assert.ok(body.analysisContract.validationGovernance.requiredAudits.includes("RECURSIVE_INDICATOR_STABILITY"));
  assert.equal(body.analysisContract.executionRealityContract.directionAwareRiskReward, true);
  assert.equal(body.analysisContract.executionRealityContract.firstTargetMustRemainAheadOfCurrentPrice, true);
  assert.equal(body.analysisContract.executionRealityContract.optimisticSameBarFillAllowedInValidation, false);
  for (const symbol of ["BTCUSDT", "ETHUSDT"]) {
    assert.equal(body.assets[symbol].ticker.status, "ok");
    assert.equal(body.assets[symbol].ticker.source, "OKX_USDT_PERPETUAL");
    assert.equal(body.assets[symbol].indexPrice.status, "ok");
    assert.equal(body.assets[symbol].indexPrice.source, "OKX_INDEX_TICKER");
    assert.equal(body.assets[symbol].spotMarket.status, "ok");
    assert.equal(body.assets[symbol].spotMarket.source, "OKX_SPOT_PUBLIC");
    assert.equal(body.assets[symbol].spotMarket.recentTakerFlow.isTrueCvd, false);
    assert.ok(Number.isFinite(body.assets[symbol].spotMarket.recentTakerFlow.takerDeltaUsd));
    assert.equal(body.assets[symbol].estimatedLiquidationPressureZones.permissions.futureLiquidationMap, false);
    for (const zone of body.assets[symbol].estimatedLiquidationPressureZones.zones) {
      assert.equal(zone.side, zone.price < body.assets[symbol].ticker.last ? "DOWNSIDE" : "UPSIDE");
    }
    assert.equal(body.assets[symbol].largeParticipantProxy.permissions.exactWhalePositions, false);
    assert.equal(body.assets[symbol].derivatives.openInterest.status, "ok");
    if (body.assets[symbol].derivatives.openInterest.source === "OKX") {
      assert.equal(body.assets[symbol].derivatives.openInterest.changes.status, "ok");
      assert.ok(Number.isFinite(body.assets[symbol].derivatives.openInterest.change5mPct));
      assert.ok(Number.isFinite(body.assets[symbol].derivatives.openInterest.change15mPct));
      assert.ok(Number.isFinite(body.assets[symbol].derivatives.openInterest.change1hPct));
    }
    assert.equal(body.assets[symbol].derivatives.funding.status, "ok");
    assert.equal(body.assets[symbol].capitalFlow.status, "ok");
    assert.equal(body.assets[symbol].capitalFlow.source, "GATE_USDT_PERPETUAL_PUBLIC");
    assert.equal(body.assets[symbol].capitalFlow.role, "AUXILIARY_CONFIRMATION_ONLY");
    assert.equal(body.assets[symbol].capitalFlow.quality.passed, true);
    for (const period of ["5m", "15m", "1h", "4h"]) {
      const flow = body.assets[symbol].capitalFlow.periods[period];
      assert.equal(flow.status, "ok");
      assert.ok(Number.isFinite(flow.activeNetFlowUsdEstimate));
    }
    assert.equal(body.assets[symbol].capitalFlow.largeTrades.status, "ok");
    assert.ok(Number.isFinite(body.assets[symbol].capitalFlow.largeTrades.largeTrades.netFlowUsdEstimate));
    assert.ok(Date.parse(body.assets[symbol].capitalFlow.largeTrades.sampleEndAt) > Date.parse("2020-01-01T00:00:00Z"));
    assert.ok(body.assets[symbol].capitalFlow.largeTrades.dataFreshness.exchangeAgeSeconds <= 120);
    assert.equal(body.assets[symbol].capitalFlow.orderBook.status, "ok");
    assert.ok(Number.isFinite(body.assets[symbol].capitalFlow.orderBook.imbalancePct));
    assert.ok(Date.parse(body.assets[symbol].capitalFlow.orderBook.exchangeTimestamp) > Date.parse("2020-01-01T00:00:00Z"));
    assert.ok(body.assets[symbol].capitalFlow.orderBook.dataFreshness.exchangeAgeSeconds <= 60);
    if (body.assets[symbol].ticker.priceType === "LAST_BID_ASK_AND_MARK") {
      assert.equal(body.assets[symbol].executionLiquidity.status, "ok");
      assert.equal(body.assets[symbol].executionLiquidity.executionPrimary.source, "OKX_USDT_PERPETUAL");
      assert.ok(Number.isFinite(body.assets[symbol].executionLiquidity.executionPrimary.spreadBps));
    } else {
      assert.equal(body.assets[symbol].executionLiquidity.status, "unavailable");
    }
    assert.equal(body.assets[symbol].executionLiquidity.auxiliaryDepth.source, "GATE_USDT_PERPETUAL_PUBLIC");
    assert.equal(body.assets[symbol].executionLiquidity.policy.standaloneSignal, false);
    assert.equal(body.assets[symbol].liquidationRiskProxy.status, "fallback");
    assert.equal(body.assets[symbol].liquidationRiskProxy.source, "GATE_USDT_PERPETUAL_PUBLIC");
    assert.equal(body.assets[symbol].liquidationRiskProxy.permissions.fullMarketFutureLiquidationMap, false);
    assert.equal(body.assets[symbol].liquidationRiskProxy.permissions.createSetup, false);
    assert.ok(["ok", "partial"].includes(body.assets[symbol].liquidityRisk.status));
    assert.equal(body.assets[symbol].liquidityRisk.policy.exactWhalePositionsAvailable, false);
    assert.equal(body.assets[symbol].liquidityRisk.policy.noFutureData, true);
    assert.ok(Array.isArray(body.assets[symbol].liquidityRisk.visibleLiquidityPools.equalLowClusters));
    assert.ok(Array.isArray(body.assets[symbol].liquidityRisk.visibleLiquidityPools.equalHighClusters));
    assert.equal(body.assets[symbol].marketRegimeRouter.status, "ok");
    assert.ok(["TREND", "RANGE", "COMPRESSION", "TRANSITION"].includes(body.assets[symbol].marketRegimeRouter.regime));
    assert.equal(body.assets[symbol].marketRegimeRouter.standaloneSignal, false);
    for (const timeframe of ["15m", "1h", "4h"]) {
      const tf = body.assets[symbol].timeframes[timeframe];
      assert.equal(tf.status, "ok");
      assert.equal(tf.recentCandles.length, 24);
      assert.ok(Number.isFinite(tf.indicators.ema200));
      assert.ok(Number.isFinite(tf.indicators.rsi14));
      assert.ok(Number.isFinite(tf.indicators.atr14));
      assert.ok(Number.isFinite(tf.indicators.adx14));
      assert.equal(tf.volumeProfile.status, "ok");
      assert.equal(tf.structureDetail.status, "ok");
      assert.equal(tf.quality.passed, true);
      assert.ok(tf.quality.priceDeviationPct <= 0.75);
      assert.ok(tf.quality.nonZeroVolumeRatio >= 0.8);
      assert.ok(tf.quality.continuityRatio >= 0.95);
    }
  }
  assert.ok(JSON.stringify(body).length < 100_000);
}

const results=[];
for (const scenario of ["primary", "gate-down", "all-candles-down", "coinalyze", "auxiliary-failure", "batch-fallback", "mark-only", "no-okx-quotes"]) {
 resetState();
 if (["gate-down", "all-candles-down"].includes(scenario)) failGateCandles.add("ALL");
 if(scenario==="all-candles-down") failOkxCandles.add("ALL");
 if(scenario==="auxiliary-failure") { failGateCapitalFlow.add("ALL"); failOkxDerivatives=true; }
 if(["batch-fallback","mark-only","no-okx-quotes"].includes(scenario))failOkxTicker=true;
 if(["mark-only","no-okx-quotes"].includes(scenario))failOkxDirectPrice=true;
 if(scenario==="no-okx-quotes")failOkxMarkPrice=true;
 const worker=await freshWorker(); enforceCloudflareSubrequestLimit=true;
 const env={SCANNER_STATE:durableBinding(), ...(scenario==="coinalyze"?{COINALYZE_API_KEY:"coinalyze-test-key"}:{})};
 const r=await worker.fetch(new Request("https://test.invalid/"),env,{waitUntil(){}});
 const b=await r.json();
 const sources=Object.values(b.assets).flatMap(a=>Object.values(a.timeframes).map(t=>t.source));
 assert.ok(requestCount+cacheMatchCount+cachePutCount<=50,scenario+" budget");
 if(scenario==="all-candles-down") {assert.equal(b.coverage.openNowDataReady,false); assert.equal(b.decisionState,"DATA_BLOCKED");}
 else {assert.equal(b.coverage.perpetualStructureReady,true,JSON.stringify({scenario,errors:b.errors}));}
 if(["mark-only","no-okx-quotes"].includes(scenario)){
   assert.equal(b.decisionState,"DATA_BLOCKED");assert.equal(b.coverage.observationDataReady,true);
   assert.equal(b.coverage.executionDataReady,false);
   if(scenario==="mark-only")assert.equal(b.assets.ETHUSDT.ticker.last,null);
 }
 if(scenario==="batch-fallback")assert.equal(b.decisionState,"DATA_READY");
 assert.ok(Buffer.byteLength(JSON.stringify(b))<=90000,"Actual UTF8 Action response budget");
 assert.equal(b.assets.ETHUSDT.opportunityEngine.models.length,8,"All eight model assessments transmitted");
 if(["primary","coinalyze"].includes(scenario))assert.equal(b.decisionState,"DATA_READY",JSON.stringify(b.errors));
 if(["primary", "coinalyze", "auxiliary-failure"].includes(scenario)) assert.ok(sources.every(s=>s==="GATE_USDT_PERPETUAL"));
 if(scenario==="gate-down") assert.ok(sources.every(s=>s==="OKX_USDT_PERPETUAL"));
 assert.ok(!requestUrls.some(u=>u.includes("api.kraken.com/0/public/OHLC")));
 results.push({scenario,responseCharacters:JSON.stringify(b).length,requests:requestCount,cacheOps:cacheMatchCount+cachePutCount,total:requestCount+cacheMatchCount+cachePutCount,state:b.decisionState,sources});
}
console.log(JSON.stringify(results,null,2));
console.log("V22 durable Gate-primary / OKX-recovery and request-budget tests PASS");
