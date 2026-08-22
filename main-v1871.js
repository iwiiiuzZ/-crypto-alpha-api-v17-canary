const BUILD = "crypto-alpha-worker-v18.7.1-subrequest-safe";
const API_VERSION = "3.7.1";
const KRAKEN_FUTURES_BASE = "https://futures.kraken.com";
const KRAKEN_SPOT_BASE = "https://api.kraken.com";
const OKX_BASE = "https://www.okx.com";
const GATE_BASE = "https://api.gateio.ws";
const CACHE_NAMESPACE = "v18.7.1-subrequest-safe";
const SNAPSHOT_CACHE_SECONDS = 3;
const CANDLE_LIMIT = 240;
const RECENT_CANDLE_COUNT = 24;
const MAX_OKX_CONCURRENCY = 2;

const CACHE_POLICY = {
  ticker: { freshSeconds: 4, staleSeconds: 20, attempts: 2 },
  markPrice: { freshSeconds: 8, staleSeconds: 30, attempts: 2 },
  openInterest: { freshSeconds: 30, staleSeconds: 180, attempts: 1 },
  openInterestHistory: { freshSeconds: 60, staleSeconds: 600, attempts: 2, timeoutMs: 5000 },
  funding: { freshSeconds: 120, staleSeconds: 900, attempts: 1 },
  krakenTicker: { freshSeconds: 15, staleSeconds: 120, attempts: 1 },
  gateCandle15m: { freshSeconds: 45, staleSeconds: 180, attempts: 1, timeoutMs: 3500 },
  gateCandle1h: { freshSeconds: 90, staleSeconds: 360, attempts: 1, timeoutMs: 3500 },
  gateCandle4h: { freshSeconds: 120, staleSeconds: 720, attempts: 1, timeoutMs: 3500 },
  gateContractStats: { freshSeconds: 25, staleSeconds: 180, attempts: 1, timeoutMs: 4500 },
  gateTrades: { freshSeconds: 12, staleSeconds: 90, attempts: 1, timeoutMs: 4500 },
  gateOrderBook: { freshSeconds: 8, staleSeconds: 45, attempts: 2, timeoutMs: 4500 },
  krakenSpotCandle15m: { freshSeconds: 45, staleSeconds: 180, attempts: 1, timeoutMs: 3500 },
  krakenSpotCandle1h: { freshSeconds: 90, staleSeconds: 360, attempts: 1, timeoutMs: 3500 },
  krakenSpotCandle4h: { freshSeconds: 120, staleSeconds: 720, attempts: 1, timeoutMs: 3500 },
};

const memoryCache = new Map();
const inflight = new Map();
let okxActive = 0;
const okxWaiters = [];

const ASSETS = {
  BTCUSDT: { instrumentId: "BTC-USDT-SWAP", futuresSymbol: "PI_XBTUSD", gateSymbol: "BTC_USDT", gateQuantoMultiplier: 0.0001, largeTradeFloorUsd: 50_000, krakenSpotPair: "XBTUSD" },
  ETHUSDT: { instrumentId: "ETH-USDT-SWAP", futuresSymbol: "PI_ETHUSD", gateSymbol: "ETH_USDT", gateQuantoMultiplier: 0.01, largeTradeFloorUsd: 25_000, krakenSpotPair: "ETHUSD" },
};

const TIMEFRAMES = {
  "15m": { gateInterval: "15m", krakenSpotInterval: "15", intervalMs: 15 * 60_000, maxAgeSeconds: 45 * 60 },
  "1h": { gateInterval: "1h", krakenSpotInterval: "60", intervalMs: 60 * 60_000, maxAgeSeconds: 3 * 60 * 60 },
  "4h": { gateInterval: "4h", krakenSpotInterval: "240", intervalMs: 4 * 60 * 60_000, maxAgeSeconds: 12 * 60 * 60 },
};

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,OPTIONS",
  "cache-control": "public, max-age=3, s-maxage=15, stale-while-revalidate=30",
};

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

function finite(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 6) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function pct(value) {
  return Number.isFinite(value) ? round(value * 100, 6) : null;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function gatePolicyForTimeframe(timeframe) {
  return timeframe === "15m" ? CACHE_POLICY.gateCandle15m : timeframe === "1h" ? CACHE_POLICY.gateCandle1h : CACHE_POLICY.gateCandle4h;
}

function krakenSpotPolicyForTimeframe(timeframe) {
  return timeframe === "15m" ? CACHE_POLICY.krakenSpotCandle15m : timeframe === "1h" ? CACHE_POLICY.krakenSpotCandle1h : CACHE_POLICY.krakenSpotCandle4h;
}

function cacheRequest(key) {
  return new Request(`https://crypto-alpha-cache.invalid/${CACHE_NAMESPACE}/upstream/${encodeURIComponent(key)}`);
}

function attachCacheMeta(value, meta) {
  if (value && typeof value === "object") {
    Object.defineProperty(value, "__cache", { value: meta, enumerable: false, configurable: true });
  }
  return value;
}

async function readPersistentCache(key, persistentCache = true) {
  const memory = memoryCache.get(key);
  if (memory) return memory;
  if (!persistentCache) return null;
  const cache = globalThis.caches?.default;
  if (!cache) return null;
  try {
    const response = await cache.match(cacheRequest(key));
    if (!response) return null;
    const record = await response.json();
    if (!record || typeof record.storedAt !== "number" || !("value" in record)) return null;
    memoryCache.set(key, record);
    return record;
  } catch {
    return null;
  }
}

async function writePersistentCache(key, value, staleSeconds, persistentCache = true) {
  const record = { storedAt: Date.now(), value };
  memoryCache.set(key, record);
  if (!persistentCache) return record;
  const cache = globalThis.caches?.default;
  if (cache) {
    try {
      await cache.put(cacheRequest(key), new Response(JSON.stringify(record), {
        headers: { "content-type": "application/json", "cache-control": `public, max-age=${staleSeconds}` },
      }));
    } catch {
      // Memory cache remains available inside the current Worker isolate.
    }
  }
  return record;
}

function cacheResult(record, state) {
  const ageSeconds = Math.max(0, (Date.now() - record.storedAt) / 1000);
  return attachCacheMeta(record.value, {
    state,
    ageSeconds: round(ageSeconds, 3),
    storedAt: new Date(record.storedAt).toISOString(),
  });
}

async function acquireOkxPermit() {
  if (okxActive < MAX_OKX_CONCURRENCY) {
    okxActive += 1;
    return;
  }
  await new Promise((resolve) => okxWaiters.push(resolve));
  okxActive += 1;
}

function releaseOkxPermit() {
  okxActive = Math.max(0, okxActive - 1);
  const next = okxWaiters.shift();
  if (next) next();
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function runner() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => runner()));
  return results;
}

async function fetchJson(url, label, attempts, isOkx, validate, timeoutMs = 4500) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (isOkx) await acquireOkxPermit();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(`${label} timeout`), timeoutMs);
    try {
      const response = await fetch(url, {
        headers: { accept: "application/json", "user-agent": "CryptoAlpha/18.7.1" },
        signal: controller.signal,
      });
      if (!response.ok) {
        const error = new Error(`${label} HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      const body = await response.json();
      return validate ? validate(body) : body;
    } catch (error) {
      lastError = error;
      const retryable = controller.signal.aborted || error?.status === 429 || (Number(error?.status) >= 500 && Number(error?.status) <= 599);
      if (!retryable || attempt >= attempts) throw error;
      await delay(250 * (2 ** (attempt - 1)) + 100);
    } finally {
      clearTimeout(timer);
      if (isOkx) {
        releaseOkxPermit();
        await delay(80);
      }
    }
  }
  throw lastError || new Error(`${label} request failed`);
}

async function cachedJson({ key, url, label, policy, isOkx = false, validate, persistentCache = true }) {
  const cached = await readPersistentCache(key, persistentCache);
  if (cached) {
    const ageSeconds = (Date.now() - cached.storedAt) / 1000;
    if (ageSeconds <= policy.freshSeconds) return cacheResult(cached, "fresh-cache");
  }

  if (inflight.has(key)) return inflight.get(key);
  const work = (async () => {
    try {
      const value = await fetchJson(url, label, policy.attempts, isOkx, validate, policy.timeoutMs);
      const stored = await writePersistentCache(key, value, policy.staleSeconds, persistentCache);
      return cacheResult(stored, "live");
    } catch (error) {
      if (cached) {
        const ageSeconds = (Date.now() - cached.storedAt) / 1000;
        if (ageSeconds <= policy.staleSeconds) {
          const value = cacheResult(cached, "stale-on-error");
          Object.defineProperty(value, "__refreshError", { value: error?.message || String(error), enumerable: false, configurable: true });
          return value;
        }
      }
      throw error;
    }
  })();
  inflight.set(key, work);
  try {
    return await work;
  } finally {
    inflight.delete(key);
  }
}

async function cachedComputed({ key, policy, loader }) {
  const cached = await readPersistentCache(key);
  if (cached) {
    const ageSeconds = (Date.now() - cached.storedAt) / 1000;
    if (ageSeconds <= policy.freshSeconds) return cacheResult(cached, "fresh-cache");
  }
  if (inflight.has(key)) return inflight.get(key);
  const work = (async () => {
    try {
      const value = await loader();
      const stored = await writePersistentCache(key, value, policy.staleSeconds);
      return cacheResult(stored, "live");
    } catch (error) {
      if (cached && (Date.now() - cached.storedAt) / 1000 <= policy.staleSeconds) {
        const value = cacheResult(cached, "stale-on-error");
        Object.defineProperty(value, "__refreshError", { value: error?.message || String(error), enumerable: false, configurable: true });
        return value;
      }
      throw error;
    }
  })();
  inflight.set(key, work);
  try {
    return await work;
  } finally {
    inflight.delete(key);
  }
}

async function okx(path, policy) {
  return cachedJson({
    key: `okx:${path}`,
    url: `${OKX_BASE}${path}`,
    label: "OKX",
    policy,
    isOkx: true,
    validate(body) {
      if (body?.code !== "0" || !Array.isArray(body?.data)) {
        const error = new Error(`OKX ${body?.code || "invalid response"}: ${body?.msg || "no data"}`);
        if (String(body?.code) === "50011") error.status = 429;
        throw error;
      }
      return body.data;
    },
  });
}

async function upstream(base, path, label, policy) {
  return cachedJson({
    key: `${label}:${path}`,
    url: `${base}${path}`,
    label,
    policy,
    persistentCache: false,
    validate: (body) => body,
  });
}

function krakenFutures(path, policy = CACHE_POLICY.krakenTicker) {
  return upstream(KRAKEN_FUTURES_BASE, path, "Kraken Futures", policy);
}

async function gateKlines(symbol, timeframe, tfConfig) {
  const body = await upstream(
    GATE_BASE,
    `/api/v4/futures/usdt/candlesticks?contract=${symbol}&interval=${tfConfig.gateInterval}&limit=${CANDLE_LIMIT}`,
    "Gate USDT Futures",
    gatePolicyForTimeframe(timeframe),
  );
  if (!Array.isArray(body)) throw new Error("Gate USDT Futures candles are empty");
  return attachCacheMeta(body, body.__cache);
}

async function gateCapitalFlowRaw(symbol) {
  const definitions = [
    { key: "stats", path: `/api/v4/futures/usdt/contract_stats?contract=${symbol}&interval=5m&limit=50`, label: "Gate Contract Stats", policy: CACHE_POLICY.gateContractStats },
    { key: "trades", path: `/api/v4/futures/usdt/trades?contract=${symbol}&limit=500`, label: "Gate Futures Trades", policy: CACHE_POLICY.gateTrades },
    { key: "orderBook", path: `/api/v4/futures/usdt/order_book?contract=${symbol}&limit=20`, label: "Gate Futures Order Book", policy: CACHE_POLICY.gateOrderBook },
  ];
  const results = await mapLimit(definitions, 2, async (definition) => {
    try {
      return { key: definition.key, status: "fulfilled", value: await upstream(GATE_BASE, definition.path, definition.label, definition.policy) };
    } catch (reason) {
      return { key: definition.key, status: "rejected", reason };
    }
  });
  return Object.fromEntries(results.map((result) => [result.key, result]));
}

function percentile(values, quantile) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((sorted.length - 1) * quantile)));
  return sorted[index];
}

function gateStatsPoint(row, multiplier) {
  const markPrice = finite(row?.mark_price);
  const timestamp = finite(row?.time);
  const longTakerContracts = Math.abs(finite(row?.long_taker_size, 0));
  const shortTakerContracts = Math.abs(finite(row?.short_taker_size, 0));
  return {
    timestamp,
    markPrice,
    buyUsd: Number.isFinite(markPrice) ? longTakerContracts * multiplier * markPrice : 0,
    sellUsd: Number.isFinite(markPrice) ? shortTakerContracts * multiplier * markPrice : 0,
    openInterestUsd: finite(row?.open_interest_usd),
    longLiquidationUsd: Math.abs(finite(row?.long_liq_usd_new, finite(row?.long_liq_usd, 0))),
    shortLiquidationUsd: Math.abs(finite(row?.short_liq_usd_new, finite(row?.short_liq_usd, 0))),
    accountLongShortRatio: finite(row?.lsr_account),
    takerLongShortRatio: finite(row?.lsr_taker),
    topTraderPositionLongShortRatio: finite(row?.top_lsr_size),
    topTraderAccountLongShortRatio: finite(row?.top_lsr_account),
    longUsers: finite(row?.long_users),
    shortUsers: finite(row?.short_users),
  };
}

function aggregateGateStats(points, bars, label) {
  const sample = points.slice(-bars);
  if (!sample.length) return errorModule(`No Gate ${label} capital-flow samples`);
  const buyUsd = sample.reduce((sum, point) => sum + point.buyUsd, 0);
  const sellUsd = sample.reduce((sum, point) => sum + point.sellUsd, 0);
  const totalUsd = buyUsd + sellUsd;
  const oiReference = points.at(-(bars + 1));
  const firstOi = Number.isFinite(oiReference?.openInterestUsd) ? oiReference.openInterestUsd : sample.find((point) => Number.isFinite(point.openInterestUsd))?.openInterestUsd;
  const lastOi = [...sample].reverse().find((point) => Number.isFinite(point.openInterestUsd))?.openInterestUsd;
  const longLiquidationUsd = sample.reduce((sum, point) => sum + point.longLiquidationUsd, 0);
  const shortLiquidationUsd = sample.reduce((sum, point) => sum + point.shortLiquidationUsd, 0);
  return {
    status: "ok",
    interval: label,
    sampleCount: sample.length,
    activeBuyUsdEstimate: round(buyUsd, 2),
    activeSellUsdEstimate: round(sellUsd, 2),
    activeNetFlowUsdEstimate: round(buyUsd - sellUsd, 2),
    buySharePct: totalUsd ? round(buyUsd / totalUsd * 100, 3) : null,
    sellSharePct: totalUsd ? round(sellUsd / totalUsd * 100, 3) : null,
    takerBuySellRatio: sellUsd ? round(buyUsd / sellUsd, 5) : null,
    openInterestStartUsd: round(firstOi, 2),
    openInterestEndUsd: round(lastOi, 2),
    openInterestChangePct: Number.isFinite(firstOi) && firstOi > 0 && Number.isFinite(lastOi)
      ? round((lastOi - firstOi) / firstOi * 100, 6)
      : null,
    longLiquidationUsd: round(longLiquidationUsd, 2),
    shortLiquidationUsd: round(shortLiquidationUsd, 2),
    netLiquidationUsd: round(shortLiquidationUsd - longLiquidationUsd, 2),
    startAt: Number.isFinite(sample[0].timestamp) ? new Date(sample[0].timestamp * 1000).toISOString() : null,
    endAt: Number.isFinite(sample.at(-1).timestamp) ? new Date(sample.at(-1).timestamp * 1000).toISOString() : null,
    openInterestReferenceAt: Number.isFinite(oiReference?.timestamp) ? new Date(oiReference.timestamp * 1000).toISOString() : null,
    includesCurrentPartialBucket: true,
  };
}

function parseGateStats(rows, multiplier) {
  if (!Array.isArray(rows) || rows.length < 12) throw new Error(`Gate contract stats have only ${Array.isArray(rows) ? rows.length : 0} samples`);
  const points = rows
    .map((row) => gateStatsPoint(row, multiplier))
    .filter((point) => Number.isFinite(point.timestamp) && Number.isFinite(point.markPrice))
    .sort((a, b) => a.timestamp - b.timestamp);
  if (points.length < 12) throw new Error(`Gate contract stats have only ${points.length} valid samples`);
  const latest = points.at(-1);
  const ageSeconds = Math.max(0, Date.now() / 1000 - latest.timestamp);
  if (ageSeconds > 15 * 60) throw new Error(`Gate contract stats are stale by ${round(ageSeconds, 1)} seconds`);
  return {
    periods: {
      "5m": aggregateGateStats(points, 1, "5m"),
      "15m": aggregateGateStats(points, 3, "15m"),
      "1h": aggregateGateStats(points, 12, "1h"),
      "4h": aggregateGateStats(points, 48, "4h"),
    },
    positioning: {
      accountLongShortRatio: round(latest.accountLongShortRatio, 6),
      takerLongShortRatio: round(latest.takerLongShortRatio, 6),
      topTraderPositionLongShortRatio: round(latest.topTraderPositionLongShortRatio, 6),
      topTraderAccountLongShortRatio: round(latest.topTraderAccountLongShortRatio, 6),
      longUsers: round(latest.longUsers, 0),
      shortUsers: round(latest.shortUsers, 0),
    },
    quality: {
      sampleCount: points.length,
      latestAt: new Date(latest.timestamp * 1000).toISOString(),
      latestAgeSeconds: round(ageSeconds, 3),
      dataFreshness: freshness(rows),
    },
  };
}

function parseGateLargeTrades(rows, multiplier, minimumUsd) {
  if (!Array.isArray(rows) || rows.length < 20) throw new Error(`Gate trade sample has only ${Array.isArray(rows) ? rows.length : 0} trades`);
  const trades = rows.map((row) => {
    const size = finite(row?.size);
    const price = finite(row?.price);
    const timestampMs = finite(row?.create_time_ms, Number.isFinite(finite(row?.create_time)) ? finite(row?.create_time) * 1000 : null);
    return {
      side: size > 0 ? "buy" : size < 0 ? "sell" : null,
      notionalUsd: Number.isFinite(size) && Number.isFinite(price) ? Math.abs(size) * multiplier * price : null,
      timestampMs,
    };
  }).filter((trade) => trade.side && Number.isFinite(trade.notionalUsd) && trade.notionalUsd > 0 && Number.isFinite(trade.timestampMs));
  if (trades.length < 20) throw new Error(`Gate trade sample has only ${trades.length} valid trades`);
  trades.sort((a, b) => a.timestampMs - b.timestampMs);
  const buyUsd = trades.filter((trade) => trade.side === "buy").reduce((sum, trade) => sum + trade.notionalUsd, 0);
  const sellUsd = trades.filter((trade) => trade.side === "sell").reduce((sum, trade) => sum + trade.notionalUsd, 0);
  const thresholdUsd = Math.max(minimumUsd, percentile(trades.map((trade) => trade.notionalUsd), 0.9) || 0);
  const large = trades.filter((trade) => trade.notionalUsd >= thresholdUsd);
  const largeBuy = large.filter((trade) => trade.side === "buy");
  const largeSell = large.filter((trade) => trade.side === "sell");
  const largeBuyUsd = largeBuy.reduce((sum, trade) => sum + trade.notionalUsd, 0);
  const largeSellUsd = largeSell.reduce((sum, trade) => sum + trade.notionalUsd, 0);
  return {
    status: "ok",
    definition: "ESTIMATED_LARGE_TAKER_TRADES_P90_WITH_MINIMUM_NOTIONAL",
    identityWarning: "Large trades are an estimate; they do not identify institutions or individual traders.",
    thresholdUsd: round(thresholdUsd, 2),
    sampleTradeCount: trades.length,
    sampleStartAt: new Date(trades[0].timestampMs).toISOString(),
    sampleEndAt: new Date(trades.at(-1).timestampMs).toISOString(),
    coverageSeconds: round((trades.at(-1).timestampMs - trades[0].timestampMs) / 1000, 3),
    allTrades: {
      activeBuyUsdEstimate: round(buyUsd, 2),
      activeSellUsdEstimate: round(sellUsd, 2),
      activeNetFlowUsdEstimate: round(buyUsd - sellUsd, 2),
    },
    largeTrades: {
      buyCount: largeBuy.length,
      sellCount: largeSell.length,
      buyUsdEstimate: round(largeBuyUsd, 2),
      sellUsdEstimate: round(largeSellUsd, 2),
      netFlowUsdEstimate: round(largeBuyUsd - largeSellUsd, 2),
    },
    dataFreshness: freshness(rows),
  };
}

function parseGateOrderBook(body, multiplier) {
  const parseSide = (rows) => (Array.isArray(rows) ? rows : []).map((row) => {
    const price = finite(Array.isArray(row) ? row[0] : row?.p);
    const size = Math.abs(finite(Array.isArray(row) ? row[1] : row?.s, 0));
    return { price, notionalUsd: Number.isFinite(price) ? price * size * multiplier : null };
  }).filter((level) => Number.isFinite(level.price) && Number.isFinite(level.notionalUsd) && level.notionalUsd > 0);
  const bids = parseSide(body?.bids);
  const asks = parseSide(body?.asks);
  if (!bids.length || !asks.length) throw new Error("Gate order book has no valid bid/ask levels");
  const bidUsd = bids.reduce((sum, level) => sum + level.notionalUsd, 0);
  const askUsd = asks.reduce((sum, level) => sum + level.notionalUsd, 0);
  const totalUsd = bidUsd + askUsd;
  const bidWall = bids.reduce((largest, level) => level.notionalUsd > largest.notionalUsd ? level : largest, bids[0]);
  const askWall = asks.reduce((largest, level) => level.notionalUsd > largest.notionalUsd ? level : largest, asks[0]);
  const bestBid = Math.max(...bids.map((level) => level.price));
  const bestAsk = Math.min(...asks.map((level) => level.price));
  const midpoint = (bestBid + bestAsk) / 2;
  return {
    status: "ok",
    depthLevelsPerSide: Math.min(bids.length, asks.length),
    bidDepthUsdEstimate: round(bidUsd, 2),
    askDepthUsdEstimate: round(askUsd, 2),
    imbalancePct: totalUsd ? round((bidUsd - askUsd) / totalUsd * 100, 4) : null,
    bidSharePct: totalUsd ? round(bidUsd / totalUsd * 100, 4) : null,
    askSharePct: totalUsd ? round(askUsd / totalUsd * 100, 4) : null,
    bestBid: round(bestBid, 8),
    bestAsk: round(bestAsk, 8),
    spreadBps: midpoint ? round((bestAsk - bestBid) / midpoint * 10_000, 4) : null,
    largestBidWall: { price: round(bidWall.price, 8), notionalUsdEstimate: round(bidWall.notionalUsd, 2) },
    largestAskWall: { price: round(askWall.price, 8), notionalUsdEstimate: round(askWall.notionalUsd, 2) },
    exchangeTimestamp: Number.isFinite(finite(body?.current)) ? new Date(finite(body.current)).toISOString() : null,
    dataFreshness: freshness(body),
  };
}

function buildGateCapitalFlow(raw, config) {
  const errors = [];
  let stats = null;
  let largeTrades = null;
  let orderBook = null;
  if (raw.stats.status === "fulfilled") {
    try { stats = parseGateStats(raw.stats.value, config.gateQuantoMultiplier); } catch (error) { errors.push({ module: "contractStats", error: error?.message || String(error) }); }
  } else errors.push({ module: "contractStats", error: raw.stats.reason?.message || String(raw.stats.reason) });
  if (raw.trades.status === "fulfilled") {
    try { largeTrades = parseGateLargeTrades(raw.trades.value, config.gateQuantoMultiplier, config.largeTradeFloorUsd); } catch (error) { errors.push({ module: "trades", error: error?.message || String(error) }); }
  } else errors.push({ module: "trades", error: raw.trades.reason?.message || String(raw.trades.reason) });
  if (raw.orderBook.status === "fulfilled") {
    try { orderBook = parseGateOrderBook(raw.orderBook.value, config.gateQuantoMultiplier); } catch (error) { errors.push({ module: "orderBook", error: error?.message || String(error) }); }
  } else errors.push({ module: "orderBook", error: raw.orderBook.reason?.message || String(raw.orderBook.reason) });
  const availableComponents = [stats, largeTrades, orderBook].filter(Boolean).length;
  return {
    status: availableComponents === 3 ? "ok" : availableComponents ? "partial" : "unavailable",
    source: "GATE_USDT_PERPETUAL_PUBLIC",
    role: "AUXILIARY_CONFIRMATION_ONLY",
    scope: "SINGLE_EXCHANGE_ESTIMATE_NOT_GLOBAL_MARKET_FLOW",
    coinGlassApiUsed: false,
    periods: stats?.periods || {},
    positioning: stats?.positioning || errorModule("Gate positioning unavailable"),
    largeTrades: largeTrades || errorModule("Gate large trades unavailable"),
    orderBook: orderBook || errorModule("Gate order book unavailable"),
    quality: {
      passed: availableComponents === 3,
      availableComponents,
      totalComponents: 3,
      stats: stats?.quality || null,
      warnings: [
        "Capital flow is estimated from Gate public derivatives data and must not independently create a trade direction.",
        "Active flow means taker buy minus taker sell; large-trade flow does not identify institutions.",
      ],
      errors,
    },
  };
}

async function krakenSpotKlines(pair, timeframe, tfConfig) {
  const body = await upstream(
    KRAKEN_SPOT_BASE,
    `/0/public/OHLC?pair=${pair}&interval=${tfConfig.krakenSpotInterval}`,
    "Kraken Spot",
    krakenSpotPolicyForTimeframe(timeframe),
  );
  if (!body || !Array.isArray(body.error) || body.error.length) {
    throw new Error(`Kraken Spot ${body?.error?.join(", ") || "invalid response"}`);
  }
  const key = Object.keys(body.result || {}).find((name) => name !== "last");
  const rows = key ? body.result[key] : null;
  if (!Array.isArray(rows)) throw new Error("Kraken Spot candles are empty");
  return attachCacheMeta(rows.slice(-CANDLE_LIMIT), body.__cache);
}

function parseGateCandles(rows) {
  if (!Array.isArray(rows)) throw new Error("Gate USDT Futures candles are empty");
  const candles = rows
    .map((row) => ({
      ts: new Date(Number(row.t) * 1000).toISOString(),
      open: finite(row.o),
      high: finite(row.h),
      low: finite(row.l),
      close: finite(row.c),
      volumeBase: finite(row.v),
      volumeQuote: finite(row.sum),
      volumeContracts: finite(row.v),
      confirmed: true,
    }))
    .filter((c) => [c.open, c.high, c.low, c.close].every(Number.isFinite))
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  if (candles.length) candles[candles.length - 1].confirmed = false;
  return attachCacheMeta(candles, rows.__cache);
}

function parseKrakenSpotCandles(rows) {
  if (!Array.isArray(rows)) throw new Error("Kraken Spot candles are empty");
  const candles = rows
    .map((row) => ({
      ts: new Date(Number(row[0]) * 1000).toISOString(),
      open: finite(row[1]),
      high: finite(row[2]),
      low: finite(row[3]),
      close: finite(row[4]),
      volumeBase: finite(row[6]),
      volumeQuote: null,
      volumeContracts: null,
      confirmed: true,
    }))
    .filter((c) => [c.open, c.high, c.low, c.close].every(Number.isFinite))
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  if (candles.length) candles[candles.length - 1].confirmed = false;
  return attachCacheMeta(candles, rows.__cache);
}

function candleQuality(candles, referencePrice, timeframe, tfConfig, source) {
  const reasons = [];
  const last = candles.at(-1);
  const lastTimestamp = Date.parse(last?.ts || "");
  const latestCandleAgeSeconds = Number.isFinite(lastTimestamp) ? Math.max(0, (Date.now() - lastTimestamp) / 1000) : null;
  const priceDeviationPct = Number.isFinite(last?.close) && Number.isFinite(referencePrice) && referencePrice > 0
    ? Math.abs(last.close - referencePrice) / referencePrice * 100
    : null;
  const recent = candles.slice(-24);
  const nonZeroVolumes = recent.filter((c) => finite(c.volumeBase, finite(c.volumeContracts, 0)) > 0).length;
  const nonZeroVolumeRatio = recent.length ? nonZeroVolumes / recent.length : 0;
  const recentContinuity = candles.slice(-50);
  let validGaps = 0;
  for (let i = 1; i < recentContinuity.length; i += 1) {
    const gap = Date.parse(recentContinuity[i].ts) - Date.parse(recentContinuity[i - 1].ts);
    if (gap >= tfConfig.intervalMs * 0.9 && gap <= tfConfig.intervalMs * 1.1) validGaps += 1;
  }
  const continuityRatio = recentContinuity.length > 1 ? validGaps / (recentContinuity.length - 1) : 0;
  const validOhlc = candles.every((c) =>
    [c.open, c.high, c.low, c.close].every(Number.isFinite) && c.high >= Math.max(c.open, c.close) && c.low <= Math.min(c.open, c.close) && c.low > 0,
  );

  if (candles.length < 200) reasons.push(`candle_count_${candles.length}_below_200`);
  if (!Number.isFinite(latestCandleAgeSeconds) || latestCandleAgeSeconds > tfConfig.maxAgeSeconds) reasons.push("latest_candle_stale");
  if (!Number.isFinite(priceDeviationPct) || priceDeviationPct > 0.75) reasons.push("price_deviation_above_0.75pct");
  if (nonZeroVolumeRatio < 0.8) reasons.push("recent_volume_quality_below_80pct");
  if (continuityRatio < 0.95) reasons.push("time_continuity_below_95pct");
  if (!validOhlc) reasons.push("invalid_ohlc");

  return {
    passed: reasons.length === 0,
    referenceSource: "OKX_USDT_PERPETUAL",
    referencePrice: round(referencePrice, 8),
    priceDeviationPct: round(priceDeviationPct, 4),
    latestCandleAgeSeconds: round(latestCandleAgeSeconds, 3),
    nonZeroVolumeRatio: round(nonZeroVolumeRatio, 4),
    continuityRatio: round(continuityRatio, 4),
    contractCompatibility: source === "OKX_USDT_PERPETUAL"
      ? "EXACT_OKX_USDT_PERPETUAL"
      : source === "KRAKEN_SPOT_EMERGENCY"
        ? "SPOT_EMERGENCY_CROSS_MARKET"
        : "USDT_PERPETUAL_CROSS_EXCHANGE",
    reasons,
  };
}

function ema(values, period) {
  if (!Array.isArray(values) || values.length < period) return null;
  const seed = values.slice(0, period).reduce((sum, x) => sum + x, 0) / period;
  const k = 2 / (period + 1);
  let result = seed;
  for (let i = period; i < values.length; i += 1) result = values[i] * k + result * (1 - k);
  return result;
}

function rsi(values, period = 14) {
  if (values.length <= period) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i += 1) {
    const delta = values[i] - values[i - 1];
    gains += Math.max(delta, 0);
    losses += Math.max(-delta, 0);
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < values.length; i += 1) {
    const delta = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(delta, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-delta, 0)) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function trueRanges(candles) {
  const values = [];
  for (let i = 1; i < candles.length; i += 1) {
    const c = candles[i];
    const previousClose = candles[i - 1].close;
    values.push(Math.max(c.high - c.low, Math.abs(c.high - previousClose), Math.abs(c.low - previousClose)));
  }
  return values;
}

function wilder(values, period) {
  if (values.length < period) return null;
  let average = values.slice(0, period).reduce((sum, x) => sum + x, 0) / period;
  for (let i = period; i < values.length; i += 1) average = (average * (period - 1) + values[i]) / period;
  return average;
}

function atr(candles, period = 14) {
  return wilder(trueRanges(candles), period);
}

function adx(candles, period = 14) {
  if (candles.length < period * 2 + 1) return null;
  const trs = [];
  const plusDm = [];
  const minusDm = [];
  for (let i = 1; i < candles.length; i += 1) {
    const current = candles[i];
    const previous = candles[i - 1];
    const up = current.high - previous.high;
    const down = previous.low - current.low;
    trs.push(Math.max(current.high - current.low, Math.abs(current.high - previous.close), Math.abs(current.low - previous.close)));
    plusDm.push(up > down && up > 0 ? up : 0);
    minusDm.push(down > up && down > 0 ? down : 0);
  }
  let smoothedTr = trs.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothedPlus = plusDm.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothedMinus = minusDm.slice(0, period).reduce((a, b) => a + b, 0);
  const dxValues = [];
  for (let i = period; i < trs.length; i += 1) {
    smoothedTr = smoothedTr - smoothedTr / period + trs[i];
    smoothedPlus = smoothedPlus - smoothedPlus / period + plusDm[i];
    smoothedMinus = smoothedMinus - smoothedMinus / period + minusDm[i];
    const plusDi = smoothedTr ? (100 * smoothedPlus) / smoothedTr : 0;
    const minusDi = smoothedTr ? (100 * smoothedMinus) / smoothedTr : 0;
    const denominator = plusDi + minusDi;
    dxValues.push(denominator ? (100 * Math.abs(plusDi - minusDi)) / denominator : 0);
  }
  return wilder(dxValues, period);
}

function vwap(candles, period = 20) {
  const sample = candles.slice(-period);
  let numerator = 0;
  let denominator = 0;
  for (const candle of sample) {
    const volume = finite(candle.volumeBase, finite(candle.volumeContracts, 0));
    const typical = (candle.high + candle.low + candle.close) / 3;
    numerator += typical * volume;
    denominator += volume;
  }
  return denominator ? numerator / denominator : null;
}

function localSwings(candles, left = 2, right = 2) {
  const highs = [];
  const lows = [];
  for (let i = left; i < candles.length - right; i += 1) {
    const window = candles.slice(i - left, i + right + 1);
    if (window.every((c, j) => j === left || candles[i].high >= c.high)) highs.push(candles[i].high);
    if (window.every((c, j) => j === left || candles[i].low <= c.low)) lows.push(candles[i].low);
  }
  return { highs, lows };
}

function structure(candles) {
  const sample = candles.slice(-80);
  const swings = localSwings(sample);
  const lastHighs = swings.highs.slice(-2);
  const lastLows = swings.lows.slice(-2);
  if (lastHighs.length < 2 || lastLows.length < 2) return "RANGE";
  if (lastHighs[1] > lastHighs[0] && lastLows[1] > lastLows[0]) return "HH_HL";
  if (lastHighs[1] < lastHighs[0] && lastLows[1] < lastLows[0]) return "LH_LL";
  return "RANGE";
}

function summarizeTimeframe(candles) {
  if (candles.length < 200) throw new Error(`Only ${candles.length} valid candles`);
  const closes = candles.map((c) => c.close);
  const last = candles.at(-1);
  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  const e200 = ema(closes, 200);
  const a14 = atr(candles, 14);
  const d14 = adx(candles, 14);
  const currentStructure = structure(candles);
  const recent20 = candles.slice(-20);
  const recent50 = candles.slice(-50);
  let trend = "RANGE";
  if (last.close > e20 && e20 > e50 && e50 > e200) trend = d14 >= 25 ? "STRONG_UP" : "UP";
  else if (last.close < e20 && e20 < e50 && e50 < e200) trend = d14 >= 25 ? "STRONG_DOWN" : "DOWN";
  else if (last.close > e50 && e20 > e50) trend = "UP";
  else if (last.close < e50 && e20 < e50) trend = "DOWN";

  const base = candles.at(-21)?.close;
  return {
    status: "ok",
    candleCount: candles.length,
    dataFreshness: freshness(candles),
    lastCandleAt: last.ts,
    lastClose: round(last.close, 8),
    change20BarsPct: base ? round(((last.close - base) / base) * 100, 4) : null,
    trend,
    structure: currentStructure,
    indicators: {
      ema20: round(e20, 8),
      ema50: round(e50, 8),
      ema200: round(e200, 8),
      rsi14: round(rsi(closes, 14), 3),
      atr14: round(a14, 8),
      atr14Pct: a14 ? round((a14 / last.close) * 100, 4) : null,
      adx14: round(d14, 3),
      vwap20: round(vwap(candles, 20), 8),
    },
    levels: {
      support20: round(Math.min(...recent20.map((c) => c.low)), 8),
      resistance20: round(Math.max(...recent20.map((c) => c.high)), 8),
      support50: round(Math.min(...recent50.map((c) => c.low)), 8),
      resistance50: round(Math.max(...recent50.map((c) => c.high)), 8),
    },
    recentCandles: candles.slice(-RECENT_CANDLE_COUNT).map((c) => ({
      ts: c.ts,
      o: round(c.open, 8),
      h: round(c.high, 8),
      l: round(c.low, 8),
      c: round(c.close, 8),
      volume: round(finite(c.volumeBase, c.volumeContracts), 4),
      confirmed: c.confirmed,
    })),
  };
}

function errorModule(message) {
  return { status: "unavailable", error: String(message || "Unknown error") };
}

function freshness(value) {
  const meta = value?.__cache;
  if (!meta) return { state: "unknown", ageSeconds: null, storedAt: null };
  return { state: meta.state, ageSeconds: meta.ageSeconds, storedAt: meta.storedAt };
}

function parseOkxExecutionPrice(markRows, tickerRows, instrumentId) {
  const markRow = markRows?.find((item) => item?.instId === instrumentId);
  const tickerRow = tickerRows?.find((item) => item?.instId === instrumentId);
  const markPrice = finite(markRow?.markPx);
  const tickerLast = finite(tickerRow?.last);
  const tickerTimestamp = Number(tickerRow?.ts);
  const markTimestamp = Number(markRow?.ts);
  const tickerAgeSeconds = Number.isFinite(tickerTimestamp) ? Math.max(0, (Date.now() - tickerTimestamp) / 1000) : Infinity;
  const markAgeSeconds = Number.isFinite(markTimestamp) ? Math.max(0, (Date.now() - markTimestamp) / 1000) : Infinity;
  const usableTicker = Number.isFinite(tickerLast) && tickerAgeSeconds <= 35;
  const usableMark = Number.isFinite(markPrice) && markAgeSeconds <= 35;
  if (!usableTicker && !usableMark) {
    throw new Error(`OKX realtime ticker and mark price unavailable for ${instrumentId}`);
  }
  const last = usableTicker ? tickerLast : markPrice;
  const open24h = usableTicker ? finite(tickerRow?.open24h) : null;
  return {
    status: "ok",
    source: "OKX_USDT_PERPETUAL",
    priceType: usableTicker && usableMark ? "LAST_BID_ASK_AND_MARK" : usableTicker ? "LAST_BID_ASK" : "MARK_PRICE_ONLY",
    primaryEndpoint: "/api/v5/market/tickers?instType=SWAP",
    fallbackEndpoint: "/api/v5/public/mark-price?instType=SWAP",
    last: round(last, 8),
    markPrice: usableMark ? round(markPrice, 8) : null,
    bid: usableTicker ? round(finite(tickerRow?.bidPx), 8) : null,
    ask: usableTicker ? round(finite(tickerRow?.askPx), 8) : null,
    high24h: usableTicker ? round(finite(tickerRow?.high24h), 8) : null,
    low24h: usableTicker ? round(finite(tickerRow?.low24h), 8) : null,
    volume24hContracts: usableTicker ? round(finite(tickerRow?.vol24h), 4) : null,
    change24hPct: open24h ? round(((last - open24h) / open24h) * 100, 4) : null,
    dataFreshness: freshness(usableTicker ? tickerRows : markRows),
    exchangeTimestamp: new Date(usableTicker ? tickerTimestamp : markTimestamp).toISOString(),
  };
}

function parseFuturesTicker(row, rows = null) {
  if (!row) throw new Error("Kraken Futures ticker is empty");
  const last = finite(row.last, finite(row.markPrice));
  const open24h = finite(row.open24h);
  if (!Number.isFinite(last)) throw new Error("Kraken Futures ticker has no price");
  return {
    status: "ok",
    source: "KRAKEN_FUTURES",
    priceType: "FALLBACK_REFERENCE",
    last: round(last, 8),
    markPrice: round(finite(row.markPrice), 8),
    bid: round(finite(row.bid), 8),
    ask: round(finite(row.ask), 8),
    high24h: round(finite(row.high24h, finite(row.high)), 8),
    low24h: round(finite(row.low24h, finite(row.low)), 8),
    volume24hContracts: round(finite(row.vol24h, finite(row.volume)), 4),
    change24hPct: Number.isFinite(finite(row.change24h))
      ? round(finite(row.change24h), 4)
      : open24h ? round(((last - open24h) / open24h) * 100, 4) : null,
    dataFreshness: freshness(rows),
    exchangeTimestamp: row.lastTime || new Date().toISOString(),
  };
}

function tickerFromCandles(asset) {
  const timeframe = asset.timeframes["1h"].status === "ok" ? asset.timeframes["1h"] : Object.values(asset.timeframes).find((tf) => tf.status === "ok");
  if (!timeframe) throw new Error("No candle price available");
  return {
    status: "ok",
    source: `${timeframe.source}_CANDLES`,
    priceType: "FALLBACK_REFERENCE",
    last: timeframe.lastClose,
    markPrice: timeframe.lastClose,
    bid: null,
    ask: null,
    high24h: timeframe.levels?.resistance20 ?? null,
    low24h: timeframe.levels?.support20 ?? null,
    volume24hContracts: null,
    change24hPct: timeframe.change20BarsPct,
    exchangeTimestamp: timeframe.lastCandleAt,
  };
}

function parseOkxOpenInterest(rows, instrumentId) {
  const row = rows.find((item) => item?.instId === instrumentId);
  if (!row) throw new Error("OKX open interest is empty");
  return {
    status: "ok",
    source: "OKX",
    contracts: round(finite(row.oi), 4),
    baseCurrency: round(finite(row.oiCcy), 8),
    usdValue: round(finite(row.oiUsd), 2),
    dataFreshness: freshness(rows),
    exchangeTimestamp: row.ts ? new Date(Number(row.ts)).toISOString() : null,
  };
}

function parseOkxOpenInterestChanges(rows) {
  const points = (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      ts: finite(Array.isArray(row) ? row[0] : row?.ts),
      contracts: finite(Array.isArray(row) ? row[1] : row?.oi),
      baseCurrency: finite(Array.isArray(row) ? row[2] : row?.oiCcy),
      usdValue: finite(Array.isArray(row) ? row[3] : row?.oiUsd),
    }))
    .filter((point) => Number.isFinite(point.ts) && Number.isFinite(point.usdValue) && point.usdValue > 0)
    .sort((a, b) => a.ts - b.ts);
  if (points.length < 13) throw new Error(`OKX OI history has only ${points.length} valid 5m samples`);

  const latest = points.at(-1);
  const atOrBefore = (minutes) => {
    const target = latest.ts - minutes * 60_000;
    const eligible = points.filter((point) => point.ts <= target);
    return eligible.at(-1) || null;
  };
  const changePct = (reference) => reference && reference.usdValue > 0
    ? round((latest.usdValue - reference.usdValue) / reference.usdValue * 100, 6)
    : null;
  const reference5m = atOrBefore(5);
  const reference15m = atOrBefore(15);
  const reference1h = atOrBefore(60);
  const ageSeconds = Math.max(0, (Date.now() - latest.ts) / 1000);
  if (ageSeconds > 15 * 60) throw new Error(`OKX OI history is stale by ${round(ageSeconds, 1)} seconds`);

  return {
    status: "ok",
    source: "OKX",
    period: "5m",
    sampleCount: points.length,
    latestUsdValue: round(latest.usdValue, 2),
    change5mPct: changePct(reference5m),
    change15mPct: changePct(reference15m),
    change1hPct: changePct(reference1h),
    latestAt: new Date(latest.ts).toISOString(),
    ageSeconds: round(ageSeconds, 3),
    dataFreshness: freshness(rows),
  };
}

function parseOkxFunding(rows) {
  const row = rows[0];
  if (!row) throw new Error("OKX funding rate is empty");
  const rate = finite(row.fundingRate);
  return {
    status: "ok",
    source: "OKX",
    rate: round(rate, 10),
    ratePct: pct(rate),
    annualizedPctEstimate: Number.isFinite(rate) ? round(rate * 3 * 365 * 100, 4) : null,
    dataFreshness: freshness(rows),
    fundingAt: row.fundingTime ? new Date(Number(row.fundingTime)).toISOString() : null,
    nextFundingAt: row.nextFundingTime ? new Date(Number(row.nextFundingTime)).toISOString() : null,
  };
}

function parseFuturesOpenInterest(row) {
  if (!row || !Number.isFinite(finite(row.openInterest))) throw new Error("Kraken Futures open interest is empty");
  return {
    status: "ok",
    source: "KRAKEN_FUTURES",
    contracts: round(finite(row.openInterest), 4),
    baseCurrency: null,
    usdValue: null,
    exchangeTimestamp: new Date().toISOString(),
  };
}

function parseFuturesFunding(row) {
  const rate = finite(row?.fundingRate);
  if (!Number.isFinite(rate)) throw new Error("Kraken Futures funding rate is empty");
  return {
    status: "ok",
    source: "KRAKEN_FUTURES",
    rate: round(rate, 10),
    ratePct: pct(rate),
    annualizedPctEstimate: round(rate * 3 * 365 * 100, 4),
    fundingAt: null,
    nextFundingAt: null,
  };
}

async function buildSnapshot() {
  const assets = {};
  const errors = [];
  const supplementalErrors = [];
  const fallbacks = [];
  for (const [symbol, config] of Object.entries(ASSETS)) {
    assets[symbol] = {
      symbol,
      instrumentId: config.instrumentId,
      futuresSymbol: config.futuresSymbol,
      ticker: errorModule("Not loaded"),
      timeframes: Object.fromEntries(Object.keys(TIMEFRAMES).map((tf) => [tf, errorModule("Not loaded")])),
      derivatives: { openInterest: errorModule("Not loaded"), funding: errorModule("Not loaded") },
      capitalFlow: errorModule("Not loaded"),
    };
  }

  let krakenTickerPromise;
  async function getKrakenTickers() {
    if (!krakenTickerPromise) {
      krakenTickerPromise = krakenFutures("/derivatives/api/v3/tickers", CACHE_POLICY.krakenTicker).then((body) => {
        const rows = Array.isArray(body?.tickers) ? body.tickers : [];
        if (!rows.length) throw new Error("Kraken Futures tickers are empty");
        return attachCacheMeta(rows, body.__cache);
      });
    }
    return krakenTickerPromise;
  }

  const priceResults = await Promise.allSettled([
    okx("/api/v5/market/tickers?instType=SWAP", CACHE_POLICY.ticker),
    okx("/api/v5/public/mark-price?instType=SWAP", CACHE_POLICY.markPrice),
  ]);
  const tickerRows = priceResults[0].status === "fulfilled" ? priceResults[0].value : null;
  const markRows = priceResults[1].status === "fulfilled" ? priceResults[1].value : null;
  if (priceResults[0].status === "rejected") supplementalErrors.push({ source: "OKX", module: "tickerBatch", error: priceResults[0].reason?.message || String(priceResults[0].reason) });
  if (priceResults[1].status === "rejected") supplementalErrors.push({ source: "OKX", module: "markPriceBatch", error: priceResults[1].reason?.message || String(priceResults[1].reason) });
  for (const rows of [tickerRows, markRows]) {
    if (rows?.__refreshError) supplementalErrors.push({ source: "OKX", module: "priceRefresh", servedFromCache: true, error: rows.__refreshError });
  }

  for (const [symbol, config] of Object.entries(ASSETS)) {
    try {
      assets[symbol].ticker = parseOkxExecutionPrice(markRows, tickerRows, config.instrumentId);
    } catch (error) {
      const message = `Exact OKX USDT perpetual realtime price unavailable: ${error?.message || String(error)}`;
      errors.push({ symbol, module: "executionPrice", timeframe: null, error: message });
      try {
        const rows = await getKrakenTickers();
        const row = rows.find((item) => item?.symbol === config.futuresSymbol);
        assets[symbol].ticker = row ? parseFuturesTicker(row, rows) : errorModule(message);
      } catch {
        assets[symbol].ticker = errorModule(message);
      }
    }
  }

  const candleDefinitions = Object.entries(ASSETS).flatMap(([symbol, config]) =>
    Object.entries(TIMEFRAMES).map(([timeframe, tfConfig]) => ({ symbol, config, timeframe, tfConfig })),
  );
  const candleWork = mapLimit(candleDefinitions, 3, async ({ symbol, config, timeframe, tfConfig }) => {
    try {
      const executionPrice = assets[symbol].ticker;
      if (executionPrice.status !== "ok" || executionPrice.source !== "OKX_USDT_PERPETUAL" || !Number.isFinite(executionPrice.last)) {
        throw new Error("Exact OKX USDT perpetual reference price unavailable for candle validation");
      }
      const attempts = [
        {
          source: "GATE_USDT_PERPETUAL",
          load: async () => parseGateCandles(await gateKlines(config.gateSymbol, timeframe, tfConfig)),
        },
        {
          source: "KRAKEN_SPOT_EMERGENCY",
          load: async () => parseKrakenSpotCandles(await krakenSpotKlines(config.krakenSpotPair, timeframe, tfConfig)),
        },
      ];
      const rejected = [];
      let selected = null;
      for (const candidate of attempts) {
        try {
          const candles = await candidate.load();
          const quality = candleQuality(candles, executionPrice.last, timeframe, tfConfig, candidate.source);
          if (!quality.passed) throw new Error(`quality rejected: ${quality.reasons.join(",")}`);
          selected = { candles, source: candidate.source, quality };
          break;
        } catch (error) {
          rejected.push({ source: candidate.source, error: error?.message || String(error) });
        }
      }
      if (!selected) throw new Error(`No quality-approved candle source: ${rejected.map((item) => `${item.source}=${item.error}`).join("; ")}`);
      const fallbackUsed = selected.source !== "GATE_USDT_PERPETUAL";
      if (fallbackUsed) {
        fallbacks.push({
          symbol,
          timeframe,
          primary: "GATE_USDT_PERPETUAL",
          fallback: selected.source,
          reason: rejected.map((item) => `${item.source}: ${item.error}`).join("; "),
        });
      }
      assets[symbol].timeframes[timeframe] = {
        ...summarizeTimeframe(selected.candles),
        source: selected.source,
        fallbackUsed,
        quality: selected.quality,
      };
    } catch (error) {
      const message = error?.message || String(error);
      assets[symbol].timeframes[timeframe] = errorModule(message);
      errors.push({ symbol, module: "candles", timeframe, error: message });
    }
  });

  const derivativeDefinitions = [
    { type: "openInterestBatch", path: "/api/v5/public/open-interest?instType=SWAP", policy: CACHE_POLICY.openInterest },
    ...Object.entries(ASSETS).map(([symbol, config]) => ({ symbol, type: "funding", path: `/api/v5/public/funding-rate?instId=${config.instrumentId}`, policy: CACHE_POLICY.funding })),
    ...Object.entries(ASSETS).map(([symbol, config]) => ({ symbol, type: "openInterestHistory", path: `/api/v5/rubik/stat/contracts/open-interest-history?instId=${config.instrumentId}&period=5m&limit=20`, policy: CACHE_POLICY.openInterestHistory })),
  ];
  const derivativeWork = Promise.allSettled(derivativeDefinitions.map((item) => okx(item.path, item.policy)));
  const capitalFlowEntries = Object.entries(ASSETS);
  const [, derivativeResults] = await Promise.all([candleWork, derivativeWork]);
  const capitalFlowResults = await mapLimit(capitalFlowEntries, 2, ([, config]) => gateCapitalFlowRaw(config.gateSymbol));

  for (let index = 0; index < capitalFlowEntries.length; index += 1) {
    const [symbol, config] = capitalFlowEntries[index];
    assets[symbol].capitalFlow = buildGateCapitalFlow(capitalFlowResults[index], config);
    if (assets[symbol].capitalFlow.status !== "ok") {
      for (const issue of assets[symbol].capitalFlow.quality.errors) {
        supplementalErrors.push({ source: "GATE_USDT_PERPETUAL_PUBLIC", symbol, module: `capitalFlow.${issue.module}`, error: issue.error });
      }
    }
  }

  const openInterestResult = derivativeResults[0];
  for (const [symbol, config] of Object.entries(ASSETS)) {
    if (openInterestResult.status === "fulfilled") {
      try {
        assets[symbol].derivatives.openInterest = parseOkxOpenInterest(openInterestResult.value, config.instrumentId);
      } catch (error) {
        supplementalErrors.push({ source: "OKX", symbol, module: "openInterest", error: error?.message || String(error) });
      }
    } else {
      supplementalErrors.push({ source: "OKX", symbol, module: "openInterest", error: openInterestResult.reason?.message || String(openInterestResult.reason) });
    }
    const historyIndex = derivativeDefinitions.findIndex((item) => item.symbol === symbol && item.type === "openInterestHistory");
    const historyResult = derivativeResults[historyIndex];
    if (historyResult?.status === "fulfilled") {
      try {
        const changes = parseOkxOpenInterestChanges(historyResult.value);
        assets[symbol].derivatives.openInterest.changes = changes;
        assets[symbol].derivatives.openInterest.change5mPct = changes.change5mPct;
        assets[symbol].derivatives.openInterest.change15mPct = changes.change15mPct;
        assets[symbol].derivatives.openInterest.change1hPct = changes.change1hPct;
      } catch (error) {
        assets[symbol].derivatives.openInterest.changes = errorModule(error?.message || String(error));
        supplementalErrors.push({ source: "OKX", symbol, module: "openInterestHistory", error: error?.message || String(error) });
      }
    } else {
      const message = historyResult?.reason?.message || String(historyResult?.reason || "No result");
      assets[symbol].derivatives.openInterest.changes = errorModule(message);
      supplementalErrors.push({ source: "OKX", symbol, module: "openInterestHistory", error: message });
    }
    const fundingIndex = derivativeDefinitions.findIndex((item) => item.symbol === symbol && item.type === "funding");
    const fundingResult = derivativeResults[fundingIndex];
    if (fundingResult?.status === "fulfilled") {
      try {
        assets[symbol].derivatives.funding = parseOkxFunding(fundingResult.value);
      } catch (error) {
        supplementalErrors.push({ source: "OKX", symbol, module: "funding", error: error?.message || String(error) });
      }
    } else {
      supplementalErrors.push({ source: "OKX", symbol, module: "funding", error: fundingResult?.reason?.message || String(fundingResult?.reason || "No result") });
    }
  }

  const needsKrakenDerivatives = Object.values(assets).some((asset) =>
    asset.derivatives.openInterest.status !== "ok" || asset.derivatives.funding.status !== "ok",
  );
  if (needsKrakenDerivatives) {
    try {
      const rows = await getKrakenTickers();
      for (const [symbol, config] of Object.entries(ASSETS)) {
        const row = rows.find((item) => item?.symbol === config.futuresSymbol);
        if (assets[symbol].derivatives.openInterest.status !== "ok") {
          try { assets[symbol].derivatives.openInterest = parseFuturesOpenInterest(row); } catch {}
        }
        if (assets[symbol].derivatives.funding.status !== "ok") {
          try { assets[symbol].derivatives.funding = parseFuturesFunding(row); } catch {}
        }
      }
    } catch (error) {
      supplementalErrors.push({ source: "KRAKEN_FUTURES", module: "tickerBatch", error: error?.message || String(error) });
    }
  }

  for (const [symbol, asset] of Object.entries(assets)) {
    for (const type of ["openInterest", "funding"]) {
      if (asset.derivatives[type].status !== "ok") {
        const message = `No usable ${type} source`;
        asset.derivatives[type] = errorModule(message);
        errors.push({ symbol, module: type, timeframe: null, error: message });
      }
    }
  }

  const modules = [];
  for (const asset of Object.values(assets)) modules.push(asset.ticker, ...Object.values(asset.timeframes), asset.derivatives.openInterest, asset.derivatives.funding);
  const available = modules.filter((module) => module.status === "ok").length;
  const coveragePct = round((available / modules.length) * 100, 2);
  const priceAgeSeconds = Object.fromEntries(Object.entries(assets).map(([symbol, asset]) => {
    const timestamp = Date.parse(asset.ticker.exchangeTimestamp || "");
    return [symbol, Number.isFinite(timestamp) ? round(Math.max(0, (Date.now() - timestamp) / 1000), 3) : null];
  }));
  const executionPriceReady = Object.entries(assets).every(([symbol, asset]) =>
    asset.ticker.status === "ok" && asset.ticker.source === "OKX_USDT_PERPETUAL" && Number.isFinite(priceAgeSeconds[symbol]) && priceAgeSeconds[symbol] <= 35,
  );
  const semanticQualityReady = Object.values(assets).every((asset) =>
    Object.values(asset.timeframes).every((tf) => tf.status === "ok" && tf.quality?.passed === true),
  );
  const criticalReady = Object.values(assets).every((asset) =>
    asset.ticker.status === "ok" &&
    Object.values(asset.timeframes).every((tf) => tf.status === "ok" && tf.quality?.passed === true) &&
    asset.derivatives.openInterest.status === "ok" &&
    asset.derivatives.funding.status === "ok",
  ) && executionPriceReady && semanticQualityReady;
  const capitalFlowReady = Object.fromEntries(Object.entries(assets).map(([symbol, asset]) => [symbol, asset.capitalFlow.status === "ok"]));
  const capitalFlowAvailable = Object.values(assets).filter((asset) => asset.capitalFlow.status !== "unavailable").length;

  return {
    status: criticalReady ? "ok" : "partial",
    decisionState: criticalReady ? "DATA_READY" : "DATA_BLOCKED",
    build: BUILD,
    apiVersion: API_VERSION,
    generatedAt: new Date().toISOString(),
    timezone: "UTC",
    source: "OKX USDT perpetual execution price, mark price, current OI, OI 5m/15m/1h changes and funding; Gate USDT perpetual primary candles and free auxiliary capital flow; Kraken Spot emergency fallback",
    requestBudget: {
      plannedOkx: 7,
      plannedUpstreamFetches: 19,
      plannedCloudflareSubrequestsCold: 35,
      maximumCloudflareSubrequestsWithAllFallbacksAndRetries: 48,
      cloudflareFreeLimit: 50,
      persistentPerModuleCache: "OKX_ONLY",
    },
    reliability: {
      okxConcurrency: MAX_OKX_CONCURRENCY,
      persistentRouteCache: true,
      staleOnError: true,
      exactExecutionPriceMaxAgeSeconds: 35,
      candleQualityGate: { maxPriceDeviationPct: 0.75, minimumNonZeroVolumeRatio: 0.8, minimumContinuityRatio: 0.95 },
      capitalFlowPolicy: "Gate single-exchange estimate, confirmation only, never a standalone trigger or DATA_READY blocker",
    },
    coverage: { availableModules: available, totalModules: modules.length, coveragePct, executionPriceReady, semanticQualityReady, priceAgeSeconds, criticalReady, capitalFlowReady, capitalFlowAvailable, capitalFlowTotal: Object.keys(assets).length },
    assets,
    fallbacks,
    supplementalErrors,
    errors,
  };
}

function openApi(origin) {
  const moduleSchema = {
    type: "object",
    properties: {
      status: { type: "string" },
      source: { type: "string" },
      error: { type: "string" },
    },
    additionalProperties: true,
  };
  const assetSchema = {
    type: "object",
    properties: {
      symbol: { type: "string" },
      instrumentId: { type: "string" },
      ticker: moduleSchema,
      timeframes: {
        type: "object",
        properties: { "15m": moduleSchema, "1h": moduleSchema, "4h": moduleSchema },
      },
      derivatives: {
        type: "object",
        properties: { openInterest: moduleSchema, funding: moduleSchema },
      },
      capitalFlow: moduleSchema,
    },
  };
  return {
    openapi: "3.1.0",
    info: {
      title: "Crypto Alpha BTC ETH Realtime",
      description: "Realtime BTC/ETH perpetual data for OKX execution, including OI changes. Gate supplies validated candles and free auxiliary taker flow, large trades, order-book imbalance, liquidations and positioning. Kraken Spot is emergency-only.",
      version: API_VERSION,
    },
    servers: [{ url: origin }],
    paths: {
      "/": {
        get: {
          operationId: "getCryptoAlphaData",
          summary: "Get realtime BTC and ETH perpetual market data",
          description: "Returns OKX BTC/ETH prices, OI changes and funding; Gate 15m/1h/4h candles plus auxiliary capital-flow estimates. Capital flow confirms only and never blocks DATA_READY. No authentication.",
          responses: {
            200: {
              description: "Realtime market snapshot",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      status: { type: "string", enum: ["ok", "partial"] },
                      decisionState: { type: "string", enum: ["DATA_READY", "DATA_BLOCKED"] },
                      build: { type: "string" },
                      apiVersion: { type: "string" },
                      generatedAt: { type: "string", format: "date-time" },
                      source: { type: "string" },
                      requestBudget: {
                        type: "object",
                        properties: {
                          plannedOkx: { type: "integer" },
                          plannedUpstreamFetches: { type: "integer" },
                          plannedCloudflareSubrequestsCold: { type: "integer" },
                          maximumCloudflareSubrequestsWithAllFallbacksAndRetries: { type: "integer" },
                          cloudflareFreeLimit: { type: "integer" },
                          persistentPerModuleCache: { type: "string" },
                        },
                      },
                      coverage: {
                        type: "object",
                        properties: {
                          availableModules: { type: "integer" },
                          totalModules: { type: "integer" },
                          coveragePct: { type: "number" },
                          executionPriceReady: { type: "boolean" },
                          semanticQualityReady: { type: "boolean" },
                          criticalReady: { type: "boolean" },
                          capitalFlowAvailable: { type: "integer" },
                          capitalFlowTotal: { type: "integer" },
                        },
                      },
                      assets: {
                        type: "object",
                        properties: { BTCUSDT: assetSchema, ETHUSDT: assetSchema },
                      },
                      fallbacks: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            symbol: { type: "string" },
                            timeframe: { type: "string" },
                            primary: { type: "string" },
                            fallback: { type: "string" },
                            reason: { type: "string" },
                          },
                        },
                      },
                      errors: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            symbol: { type: "string" },
                            module: { type: "string" },
                            timeframe: { type: ["string", "null"] },
                            error: { type: "string" },
                          },
                        },
                      },
                    },
                    required: ["status", "decisionState", "build", "generatedAt", "assets"],
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}

function privacy(origin) {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Crypto Alpha Privacy</title><body style="font-family:system-ui;max-width:760px;margin:40px auto;padding:0 18px;line-height:1.7"><h1>Crypto Alpha 隐私政策</h1><p>本服务仅提供只读的 BTC/ETH 市场数据，不执行交易，不接收交易所密钥，不收集姓名、邮箱、账户或付款信息。</p><p>为保障稳定性，服务提供商可能保留短期技术日志，例如请求时间、错误信息与网络元数据。日志仅用于故障排查。</p><p>执行数据来源：OKX USDT 永续的实时价格、标记价格、当前未平仓量、5分钟/15分钟/1小时未平仓量变化和资金费率。主K线使用 Gate USDT 永续；Gate 公共接口另提供主动买卖估算、大额成交估算、订单簿、强平及多空比等辅助证据。该资金流仅代表单一交易所，不能单独制造开仓方向。Kraken 现货仅作严格质量校验后的紧急保底。服务地址：${origin}</p><p>最后更新：2026-08-22</p></body></html>`;
}

async function handleSnapshot(request, ctx) {
  const cache = globalThis.caches?.default;
  const cacheKey = new Request(`https://crypto-alpha-cache.invalid/${CACHE_NAMESPACE}/realtime`);
  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) return new Response(cached.body, cached);
  }
  const snapshot = await buildSnapshot();
  const response = json(snapshot, 200, { "cache-control": `public, max-age=1, s-maxage=${SNAPSHOT_CACHE_SECONDS}` });
  if (cache) {
    const write = cache.put(cacheKey, response.clone()).catch(() => {});
    if (ctx?.waitUntil) ctx.waitUntil(write);
    else await write;
  }
  return response;
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: JSON_HEADERS });
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const origin = url.origin;

    if (request.method !== "GET") return json({ error: "METHOD_NOT_ALLOWED" }, 405, { allow: "GET,OPTIONS" });
    if (path === "/") return handleSnapshot(request, ctx);
    if (path === "/health") {
      return json({ status: "ok", build: BUILD, apiVersion: API_VERSION, upstream: "OKX execution/OI/funding + Gate USDT perpetual primary candles/free auxiliary capital flow + Kraken Spot emergency fallback", normalOkxRequests: 7, gateCapitalFlowRequests: 6, coinGlassApiRequested: false, okxCandlesRequested: false, binanceRequested: false, bybitRequested: false, bytickRequested: false, bitgetRequested: false, actionCount: 1, authentication: "none" });
    }
    if (path === "/openapi.json") return json(openApi(origin), 200, { "cache-control": "public, max-age=300" });
    if (path === "/privacy") {
      return new Response(privacy(origin), { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=3600" } });
    }
    return json({ error: "NOT_FOUND", available: ["/", "/health", "/openapi.json", "/privacy"] }, 404);
  },

  async scheduled() {
    // The existing cron may remain configured. Realtime chat data does not depend on it.
  },
};
