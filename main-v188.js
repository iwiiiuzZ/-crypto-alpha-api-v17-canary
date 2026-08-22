const BUILD = "crypto-alpha-worker-v18.8.1-openapi-compat";
const API_VERSION = "3.8.1";
const KRAKEN_FUTURES_BASE = "https://futures.kraken.com";
const KRAKEN_SPOT_BASE = "https://api.kraken.com";
const OKX_BASE = "https://www.okx.com";
const GATE_BASE = "https://api.gateio.ws";
const CACHE_NAMESPACE = "v18.8.0-plan-linked-alerts";
const SNAPSHOT_CACHE_SECONDS = 3;
const CANDLE_LIMIT = 240;
const RECENT_CANDLE_COUNT = 24;
const MAX_OKX_CONCURRENCY = 2;
const ACTIVE_PLAN_KEY = "scanner:active-plan";
const SCANNER_RUNTIME_KEY = "scanner:runtime";
const SCANNER_HEARTBEAT_MS = 10 * 60_000;
const CONFIRMATION_COOLDOWN_MS = 14 * 60_000;
const DEFAULT_PLAN_HOURS = 24;

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
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "authorization,content-type",
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
        headers: { accept: "application/json", "user-agent": "CryptoAlpha/18.8.0" },
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

async function gateCapitalFlowRaw(symbol, options = {}) {
  const definitions = [
    { key: "stats", path: `/api/v4/futures/usdt/contract_stats?contract=${symbol}&interval=5m&limit=50`, label: "Gate Contract Stats", policy: CACHE_POLICY.gateContractStats },
    { key: "trades", path: `/api/v4/futures/usdt/trades?contract=${symbol}&limit=500`, label: "Gate Futures Trades", policy: CACHE_POLICY.gateTrades },
    { key: "orderBook", path: `/api/v4/futures/usdt/order_book?contract=${symbol}&limit=20`, label: "Gate Futures Order Book", policy: options.scannerMode ? { ...CACHE_POLICY.gateOrderBook, attempts: 1 } : CACHE_POLICY.gateOrderBook },
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

async function buildSnapshot(options = {}) {
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
  const capitalFlowResults = await mapLimit(capitalFlowEntries, 2, ([, config]) => gateCapitalFlowRaw(config.gateSymbol, options));

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

function scannerStateRequest(key) {
  return new Request(`https://crypto-alpha-cache.invalid/${CACHE_NAMESPACE}/scanner/${encodeURIComponent(key)}`);
}

function scannerStateStub(env) {
  const namespace = env?.SCANNER_STATE;
  if (!namespace) return null;
  if (typeof namespace.getByName === "function") return namespace.getByName("crypto-alpha-primary");
  if (typeof namespace.idFromName === "function" && typeof namespace.get === "function") {
    return namespace.get(namespace.idFromName("crypto-alpha-primary"));
  }
  return null;
}

async function durableStateCall(env, payload) {
  const stub = scannerStateStub(env);
  if (!stub?.fetch) return null;
  const response = await stub.fetch("https://scanner-state.internal/state", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Scanner state object HTTP ${response.status}`);
  return response.json();
}

async function scannerStateGet(env, key) {
  if (scannerStateStub(env)) {
    const result = await durableStateCall(env, { op: "get", keys: [key] });
    return result?.values?.[key] ?? null;
  }
  if (env?.ALERT_STATE?.get) {
    try { return await env.ALERT_STATE.get(key, "json"); } catch {}
  }
  const cache = globalThis.caches?.default;
  if (!cache) return null;
  try {
    const response = await cache.match(scannerStateRequest(key));
    return response ? await response.json() : null;
  } catch {
    return null;
  }
}

async function scannerStatePut(env, key, value, ttlSeconds = 30 * 24 * 60 * 60) {
  if (scannerStateStub(env)) {
    await durableStateCall(env, { op: "put", values: { [key]: { value, ttlSeconds } } });
    return "DURABLE_OBJECT";
  }
  if (env?.ALERT_STATE?.put) {
    await env.ALERT_STATE.put(key, JSON.stringify(value), { expirationTtl: Math.max(60, Math.floor(ttlSeconds)) });
    return "KV";
  }
  const cache = globalThis.caches?.default;
  if (!cache) throw new Error("ALERT_STATE KV binding is missing and Cache API is unavailable");
  await cache.put(scannerStateRequest(key), new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json", "cache-control": `public, max-age=${Math.max(60, Math.floor(ttlSeconds))}` },
  }));
  return "CACHE_FALLBACK";
}

async function scannerStateBundle(env, keys) {
  if (scannerStateStub(env)) {
    const result = await durableStateCall(env, { op: "get", keys });
    return result?.values || {};
  }
  const values = await Promise.all(keys.map((key) => scannerStateGet(env, key)));
  return Object.fromEntries(keys.map((key, index) => [key, values[index]]));
}

function scannerAuthorized(request, env) {
  const expected = String(env?.SCANNER_TOKEN || "").trim();
  const supplied = String(request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  return Boolean(expected && supplied && supplied === expected);
}

function scannerConfiguration(env) {
  return {
    barkConfigured: Boolean(String(env?.BARK_DEVICE_KEY || "").trim()),
    scannerTokenConfigured: Boolean(String(env?.SCANNER_TOKEN || "").trim()),
    stateConfigured: Boolean(scannerStateStub(env) || (env?.ALERT_STATE?.get && env?.ALERT_STATE?.put)),
    stateBackend: scannerStateStub(env) ? "DURABLE_OBJECT" : env?.ALERT_STATE?.get ? "KV" : "MISSING",
    cron: "* * * * *",
    mode: "GPT_PLAN_LINKED_VALIDATION_ONLY",
  };
}

function scannerNumber(value, name, options = {}) {
  const number = finite(value);
  if (!Number.isFinite(number)) throw new Error(`${name} must be a finite number`);
  if (options.positive && number <= 0) throw new Error(`${name} must be greater than zero`);
  return number;
}

function scannerText(value, fallback = "", maximum = 500) {
  return String(value ?? fallback).trim().slice(0, maximum);
}

function normalizeTradingPlan(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Plan body must be an object");
  const now = Date.now();
  const symbol = scannerText(input.symbol || "ETHUSDT", "ETHUSDT", 16).toUpperCase();
  if (!ASSETS[symbol]) throw new Error("symbol must be BTCUSDT or ETHUSDT");
  const direction = scannerText(input.direction, "", 16).toUpperCase();
  if (!['LONG', 'SHORT'].includes(direction)) throw new Error("direction must be LONG or SHORT");
  const entryMin = scannerNumber(input.entryZone?.min, "entryZone.min", { positive: true });
  const entryMax = scannerNumber(input.entryZone?.max, "entryZone.max", { positive: true });
  if (entryMin > entryMax) throw new Error("entryZone.min cannot exceed entryZone.max");
  const stopLoss = scannerNumber(input.stopLoss, "stopLoss", { positive: true });
  const invalidationPrice = scannerNumber(input.invalidationPrice ?? stopLoss, "invalidationPrice", { positive: true });
  if (direction === "LONG" && (stopLoss >= entryMin || invalidationPrice >= entryMin)) throw new Error("LONG stop/invalidation must be below entry zone");
  if (direction === "SHORT" && (stopLoss <= entryMax || invalidationPrice <= entryMax)) throw new Error("SHORT stop/invalidation must be above entry zone");
  const targets = (Array.isArray(input.takeProfits) ? input.takeProfits : [])
    .slice(0, 5)
    .map((target, index) => ({
      price: scannerNumber(typeof target === "number" ? target : target?.price, `takeProfits[${index}].price`, { positive: true }),
      allocationPct: round(scannerNumber(typeof target === "number" ? 100 / Math.max(1, input.takeProfits.length) : target?.allocationPct ?? 100 / Math.max(1, input.takeProfits.length), `takeProfits[${index}].allocationPct`, { positive: true }), 3),
    }))
    .sort((a, b) => direction === "LONG" ? a.price - b.price : b.price - a.price);
  if (!targets.length) throw new Error("At least one take-profit is required");
  if (direction === "LONG" && targets.some((target) => target.price <= entryMax)) throw new Error("LONG take-profits must be above entry zone");
  if (direction === "SHORT" && targets.some((target) => target.price >= entryMin)) throw new Error("SHORT take-profits must be below entry zone");
  const allocationTotal = targets.reduce((sum, target) => sum + target.allocationPct, 0);
  if (allocationTotal > 100.5) throw new Error("take-profit allocation total cannot exceed 100%");
  const expiresAtMs = Date.parse(input.expiresAt || "");
  const expiresAt = Number.isFinite(expiresAtMs)
    ? new Date(expiresAtMs).toISOString()
    : new Date(now + DEFAULT_PLAN_HOURS * 60 * 60_000).toISOString();
  if (Date.parse(expiresAt) <= now) throw new Error("expiresAt must be in the future");
  if (Date.parse(expiresAt) > now + 7 * 24 * 60 * 60_000) throw new Error("expiresAt cannot exceed 7 days");
  const confirmation = input.confirmation && typeof input.confirmation === "object" ? input.confirmation : {};
  const close15mAbove = finite(confirmation.close15mAbove);
  const close15mBelow = finite(confirmation.close15mBelow);
  if (direction === "LONG" && Number.isFinite(close15mBelow)) throw new Error("LONG confirmation should use close15mAbove");
  if (direction === "SHORT" && Number.isFinite(close15mAbove)) throw new Error("SHORT confirmation should use close15mBelow");
  const planId = scannerText(input.planId, "", 80) || `plan-${new Date(now).toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${crypto.randomUUID().slice(0, 8)}`;
  return {
    planId,
    revision: 1,
    status: "ARMED",
    symbol,
    direction,
    timeframe: scannerText(input.timeframe || "SHORT_TERM", "SHORT_TERM", 40),
    createdAt: new Date(now).toISOString(),
    expiresAt,
    entryZone: { min: round(entryMin, 8), max: round(entryMax, 8) },
    stopLoss: round(stopLoss, 8),
    invalidationPrice: round(invalidationPrice, 8),
    takeProfits: targets,
    maximumExecutionPrice: Number.isFinite(finite(input.maximumExecutionPrice)) ? round(finite(input.maximumExecutionPrice), 8) : null,
    minimumExecutionPrice: Number.isFinite(finite(input.minimumExecutionPrice)) ? round(finite(input.minimumExecutionPrice), 8) : null,
    minNetRR: round(Math.max(1, finite(input.minNetRR, 1.5)), 3),
    estimatedRoundTripCostPct: round(Math.max(0, finite(input.estimatedRoundTripCostPct, 0.15)), 4),
    confirmation: {
      close15mAbove: Number.isFinite(close15mAbove) ? round(close15mAbove, 8) : null,
      close15mBelow: Number.isFinite(close15mBelow) ? round(close15mBelow, 8) : null,
      requireFlowSupport: confirmation.requireFlowSupport !== false,
      requireOrderBookSupport: confirmation.requireOrderBookSupport === true,
      allowCountertrend: confirmation.allowCountertrend === true,
      btcMinimumPrice: Number.isFinite(finite(confirmation.btcMinimumPrice)) ? round(finite(confirmation.btcMinimumPrice), 8) : null,
      btcMaximumPrice: Number.isFinite(finite(confirmation.btcMaximumPrice)) ? round(finite(confirmation.btcMaximumPrice), 8) : null,
    },
    strategySummary: scannerText(input.strategySummary, `${symbol} ${direction} plan`, 500),
    triggerExplanation: scannerText(input.triggerExplanation, "Wait for the registered 15m confirmation inside the entry zone", 500),
    strongestCounterEvidence: scannerText(input.strongestCounterEvidence, "", 500),
    sourceAnalysisAt: scannerText(input.sourceAnalysisAt, new Date(now).toISOString(), 60),
    risk: {
      accountEquityUsdt: Number.isFinite(finite(input.risk?.accountEquityUsdt)) ? round(finite(input.risk.accountEquityUsdt), 2) : null,
      accountRiskPct: Number.isFinite(finite(input.risk?.accountRiskPct)) ? round(finite(input.risk.accountRiskPct), 3) : null,
      leverage: Number.isFinite(finite(input.risk?.leverage)) ? round(finite(input.risk.leverage), 2) : null,
      marginMode: scannerText(input.risk?.marginMode || "ISOLATED", "ISOLATED", 20).toUpperCase(),
    },
  };
}

function latestConfirmedCandle(timeframe) {
  const rows = Array.isArray(timeframe?.recentCandles) ? timeframe.recentCandles : [];
  return [...rows].reverse().find((candle) => candle?.confirmed === true) || null;
}

function trendAgainst(direction, timeframe) {
  if (!timeframe || timeframe.status !== "ok") return true;
  if (direction === "LONG") return timeframe.trend === "STRONG_DOWN" || (timeframe.trend === "DOWN" && timeframe.structure === "LH_LL");
  return timeframe.trend === "STRONG_UP" || (timeframe.trend === "UP" && timeframe.structure === "HH_HL");
}

function planNetRR(plan, entryPrice) {
  const cost = entryPrice * (plan.estimatedRoundTripCostPct / 100);
  const risk = Math.abs(entryPrice - plan.stopLoss) + cost;
  const target = plan.takeProfits[0]?.price;
  const reward = Math.abs(target - entryPrice) - cost;
  return risk > 0 ? round(reward / risk, 3) : null;
}

function capitalFlowEvidence(direction, asset, btcAsset) {
  const eth15 = asset?.capitalFlow?.periods?.["15m"];
  const eth1h = asset?.capitalFlow?.periods?.["1h"];
  const btc15 = btcAsset?.capitalFlow?.periods?.["15m"];
  const orderBook = asset?.capitalFlow?.orderBook;
  const ratios = {
    asset15m: finite(eth15?.takerBuySellRatio),
    asset1h: finite(eth1h?.takerBuySellRatio),
    btc15m: finite(btc15?.takerBuySellRatio),
    orderBookImbalancePct: finite(orderBook?.imbalancePct),
  };
  const available = Object.values(ratios).filter(Number.isFinite).length;
  if (available < 3) return { passed: false, hardAdverse: false, score: 0, available, ratios, reason: "Capital-flow evidence incomplete" };
  const long = direction === "LONG";
  const score = [
    long ? ratios.asset15m >= 0.95 : ratios.asset15m <= 1.053,
    long ? ratios.asset1h >= 0.95 : ratios.asset1h <= 1.053,
    long ? ratios.btc15m >= 0.9 : ratios.btc15m <= 1.111,
    long ? ratios.orderBookImbalancePct >= -15 : ratios.orderBookImbalancePct <= 15,
  ].filter(Boolean).length;
  const hardAdverse = long
    ? ratios.asset15m < 0.78 || ratios.orderBookImbalancePct < -35
    : ratios.asset15m > 1.282 || ratios.orderBookImbalancePct > 35;
  return {
    passed: !hardAdverse && score >= 2,
    hardAdverse,
    score,
    available,
    ratios,
    reason: hardAdverse ? "Capital flow is strongly adverse" : score >= 2 ? "Capital flow is supportive or neutral" : "Capital flow confirmation is insufficient",
  };
}

function evaluateTradingPlan(plan, snapshot, previousRuntime = null) {
  const now = Date.now();
  const asset = snapshot?.assets?.[plan.symbol];
  const btc = snapshot?.assets?.BTCUSDT;
  const price = finite(asset?.ticker?.last);
  const btcPrice = finite(btc?.ticker?.last);
  const tf15 = asset?.timeframes?.["15m"];
  const tf1h = asset?.timeframes?.["1h"];
  const tf4h = asset?.timeframes?.["4h"];
  const confirmed15m = latestConfirmedCandle(tf15);
  const directionLong = plan.direction === "LONG";
  const expired = now >= Date.parse(plan.expiresAt);
  const invalidated = Number.isFinite(price) && (directionLong ? price <= plan.invalidationPrice : price >= plan.invalidationPrice);
  const targetIndex = Number.isFinite(price)
    ? plan.takeProfits.reduce((hit, target, index) => directionLong ? (price >= target.price ? index : hit) : (price <= target.price ? index : hit), -1)
    : -1;
  if (expired) return { state: "EXPIRED", valid: false, price, btcPrice, reason: "GPT plan expired", planId: plan.planId, checkedAt: new Date(now).toISOString() };
  if (invalidated) return { state: "INVALIDATED", valid: false, price, btcPrice, reason: "Price crossed the GPT plan invalidation level", planId: plan.planId, checkedAt: new Date(now).toISOString() };
  if (targetIndex >= 0 && (previousRuntime?.state === "CONFIRMED" || previousRuntime?.activatedAt)) {
    return { state: `TP${targetIndex + 1}_HIT`, valid: true, price, btcPrice, reason: `Take-profit ${targetIndex + 1} reached`, targetIndex, planId: plan.planId, checkedAt: new Date(now).toISOString() };
  }
  if (snapshot?.decisionState !== "DATA_READY" || !Number.isFinite(price) || !confirmed15m) {
    return { state: "DATA_BLOCKED", valid: false, price, btcPrice, reason: "Realtime core data is not decision-ready", planId: plan.planId, checkedAt: new Date(now).toISOString() };
  }
  const inZone = price >= plan.entryZone.min && price <= plan.entryZone.max;
  const atr15 = finite(tf15?.indicators?.atr14, price * 0.003);
  const distanceToZone = price < plan.entryZone.min ? plan.entryZone.min - price : price > plan.entryZone.max ? price - plan.entryZone.max : 0;
  const nearZone = inZone || distanceToZone <= Math.max(atr15 * 0.5, price * 0.0015);
  const executionCapPassed = (!Number.isFinite(plan.maximumExecutionPrice) || price <= plan.maximumExecutionPrice)
    && (!Number.isFinite(plan.minimumExecutionPrice) || price >= plan.minimumExecutionPrice);
  const candleClose = finite(confirmed15m.c);
  const candleOpen = finite(confirmed15m.o);
  const explicitCandleRule = directionLong ? plan.confirmation.close15mAbove : plan.confirmation.close15mBelow;
  const candlePassed = Number.isFinite(explicitCandleRule)
    ? (directionLong ? candleClose >= explicitCandleRule : candleClose <= explicitCandleRule)
    : (directionLong ? candleClose > candleOpen : candleClose < candleOpen);
  const btcPricePassed = (!Number.isFinite(plan.confirmation.btcMinimumPrice) || btcPrice >= plan.confirmation.btcMinimumPrice)
    && (!Number.isFinite(plan.confirmation.btcMaximumPrice) || btcPrice <= plan.confirmation.btcMaximumPrice);
  const trendPassed = plan.confirmation.allowCountertrend || (!trendAgainst(plan.direction, tf4h) && !trendAgainst(plan.direction, tf1h));
  const rr = planNetRR(plan, price);
  const rrPassed = Number.isFinite(rr) && rr >= plan.minNetRR;
  const flow = capitalFlowEvidence(plan.direction, asset, btc);
  const flowPassed = !plan.confirmation.requireFlowSupport || flow.passed;
  const orderBookPassed = !plan.confirmation.requireOrderBookSupport || (
    Number.isFinite(flow.ratios.orderBookImbalancePct)
    && (directionLong ? flow.ratios.orderBookImbalancePct >= 0 : flow.ratios.orderBookImbalancePct <= 0)
  );
  const checks = { inZone, nearZone, executionCapPassed, candlePassed, btcPricePassed, trendPassed, rrPassed, flowPassed, orderBookPassed };
  const confirmationPassed = Object.entries(checks).filter(([name]) => name !== "nearZone").every(([, passed]) => passed);
  const state = confirmationPassed ? "CONFIRMED" : nearZone ? "WATCHING" : "ARMED";
  const failedChecks = Object.entries(checks).filter(([name, passed]) => name !== "nearZone" && !passed).map(([name]) => name);
  return {
    state,
    valid: confirmationPassed,
    price: round(price, 8),
    btcPrice: round(btcPrice, 8),
    entryZone: plan.entryZone,
    netRR: rr,
    confirmed15mAt: confirmed15m.ts,
    confirmed15mClose: candleClose,
    checks,
    failedChecks,
    flow,
    reason: confirmationPassed ? "All GPT-plan and realtime confirmation checks passed" : nearZone ? `Entry area reached; waiting for ${failedChecks.join(", ")}` : "Waiting for GPT plan entry area",
    planId: plan.planId,
    checkedAt: new Date(now).toISOString(),
  };
}

function scannerNotification(plan, evaluation) {
  const direction = plan.direction === "LONG" ? "做多" : "做空";
  const price = Number.isFinite(evaluation.price) ? evaluation.price : "未知";
  if (evaluation.state === "CONFIRMED") return {
    title: `✅ ${plan.symbol} ${direction}条件已确认`,
    body: `现价 ${price}\nGPT方案 ${plan.entryZone.min}-${plan.entryZone.max}｜止损 ${plan.stopLoss}｜TP ${plan.takeProfits.map((x) => x.price).join("/")}\n净RR ${evaluation.netRR}｜15M确认 ${evaluation.confirmed15mClose}\n依据：${plan.strategySummary}\n反向证据：${plan.strongestCounterEvidence || "无新增硬阻断"}`,
    level: "timeSensitive",
  };
  if (evaluation.state === "WATCHING") return {
    title: `👀 ${plan.symbol} 已接近GPT方案区`,
    body: `现价 ${price}，计划区 ${plan.entryZone.min}-${plan.entryZone.max}。尚未确认：${evaluation.failedChecks?.join("、") || evaluation.reason}。先不要开仓。`,
    level: "active",
  };
  if (evaluation.state === "INVALIDATED") return {
    title: `⛔ ${plan.symbol} GPT方案已失效`,
    body: `现价 ${price} 已触及失效位 ${plan.invalidationPrice}。取消本方案，不补仓、不沿用旧参数。`,
    level: "timeSensitive",
  };
  if (evaluation.state === "EXPIRED") return {
    title: `⌛ ${plan.symbol} GPT方案已过期`,
    body: `方案 ${plan.planId} 已到期，需要重新询问GPT并生成新方案。`,
    level: "active",
  };
  if (/^TP\d+_HIT$/.test(evaluation.state)) return {
    title: `🎯 ${plan.symbol} ${evaluation.state.replace("_HIT", "")} 已到达`,
    body: `现价 ${price}。按GPT方案执行对应止盈比例，并复核剩余仓位止损。`,
    level: "timeSensitive",
  };
  return null;
}

async function sendBark(env, notification) {
  const deviceKey = String(env?.BARK_DEVICE_KEY || "").trim();
  if (!deviceKey) return { sent: false, reason: "BARK_DEVICE_KEY_NOT_CONFIGURED" };
  const base = String(env?.BARK_SERVER_BASE || "https://api.day.app").replace(/\/+$/, "");
  const response = await fetch(`${base}/push`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      device_key: deviceKey,
      title: notification.title,
      body: notification.body,
      group: "CryptoAlpha",
      level: notification.level || "active",
      sound: notification.level === "timeSensitive" ? "alarm" : "bell",
      url: scannerText(env?.ALERT_OPEN_URL, "", 1000) || undefined,
    }),
  });
  if (!response.ok) throw new Error(`Bark HTTP ${response.status}`);
  const result = await response.json().catch(() => ({}));
  if (Number.isFinite(finite(result?.code)) && finite(result.code) !== 200) throw new Error(`Bark rejected push: ${result?.message || result.code}`);
  return { sent: true, provider: "BARK", status: response.status };
}

async function saveTradingPlan(env, input) {
  if (!scannerStateStub(env) && (!env?.ALERT_STATE?.get || !env?.ALERT_STATE?.put)) throw new Error("SCANNER_STATE durable binding is required before a plan can be armed");
  const plan = normalizeTradingPlan(input);
  const previousPlan = await scannerStateGet(env, ACTIVE_PLAN_KEY);
  if (previousPlan?.planId === plan.planId) plan.revision = finite(previousPlan.revision, 0) + 1;
  const ttlSeconds = Math.max(3600, Math.ceil((Date.parse(plan.expiresAt) - Date.now()) / 1000) + 24 * 60 * 60);
  const storage = await scannerStatePut(env, ACTIVE_PLAN_KEY, plan, ttlSeconds);
  const runtime = {
    planId: plan.planId,
    state: "ARMED",
    checkedAt: plan.createdAt,
    lastPersistedAt: plan.createdAt,
    lastAlertAt: null,
    lastAttemptAt: null,
    lastConfirmedCandleAt: null,
    evaluation: { state: "ARMED", reason: "GPT plan saved; waiting for scanner" },
  };
  await scannerStatePut(env, SCANNER_RUNTIME_KEY, runtime, ttlSeconds);
  let notification;
  try {
    notification = await sendBark(env, {
      title: `🛡️ ${plan.symbol} GPT方案已布防`,
      body: `${plan.direction === "LONG" ? "做多" : "做空"}｜入场 ${plan.entryZone.min}-${plan.entryZone.max}｜止损 ${plan.stopLoss}｜有效至 ${plan.expiresAt}\n扫描器将按这份方案验证，不会另造方向。`,
      level: "active",
    });
  } catch (error) {
    notification = { sent: false, reason: error?.message || String(error) };
  }
  return { status: "saved", build: BUILD, storage, plan, notification, next: "Cron scanner validates this exact GPT plan every minute" };
}

function scannerShouldNotify(previous, evaluation) {
  if (!["WATCHING", "CONFIRMED", "INVALIDATED", "EXPIRED"].includes(evaluation.state) && !/^TP\d+_HIT$/.test(evaluation.state)) return false;
  if (!previous || previous.planId !== evaluation.planId) return evaluation.state !== "ARMED";
  if (evaluation.state !== previous.state) return true;
  if (previous.notification?.sent === false) {
    const lastAttemptAt = Date.parse(previous.lastAttemptAt || "");
    return !Number.isFinite(lastAttemptAt) || Date.now() - lastAttemptAt >= 2 * 60_000;
  }
  if (evaluation.state === "CONFIRMED") {
    const lastAt = Date.parse(previous.lastAlertAt || "");
    return evaluation.confirmed15mAt !== previous.lastConfirmedCandleAt && (!Number.isFinite(lastAt) || Date.now() - lastAt >= CONFIRMATION_COOLDOWN_MS);
  }
  return false;
}

async function runScanner(env) {
  if (!scannerStateStub(env) && (!env?.ALERT_STATE?.get || !env?.ALERT_STATE?.put)) {
    return { status: "configuration_required", build: BUILD, reason: "SCANNER_STATE_BINDING_MISSING", configuration: scannerConfiguration(env) };
  }
  const state = await scannerStateBundle(env, [ACTIVE_PLAN_KEY, SCANNER_RUNTIME_KEY]);
  const plan = state[ACTIVE_PLAN_KEY];
  const previous = state[SCANNER_RUNTIME_KEY];
  if (!plan || plan.status !== "ARMED") {
    return { status: "idle", build: BUILD, reason: "NO_ACTIVE_GPT_PLAN", configuration: scannerConfiguration(env) };
  }
  let snapshot;
  try {
    snapshot = await buildSnapshot({ scannerMode: true });
  } catch (error) {
    snapshot = { decisionState: "DATA_BLOCKED", assets: {}, scannerError: error?.message || String(error) };
  }
  const evaluation = evaluateTradingPlan(plan, snapshot, previous);
  const shouldNotify = scannerShouldNotify(previous, evaluation);
  let notification = { sent: false, reason: "NO_STATE_TRANSITION" };
  if (shouldNotify) {
    try { notification = await sendBark(env, scannerNotification(plan, evaluation)); }
    catch (error) { notification = { sent: false, reason: error?.message || String(error) }; }
  }
  const nowIso = new Date().toISOString();
  const nextRuntime = {
    planId: plan.planId,
    state: evaluation.state,
    checkedAt: nowIso,
    lastPersistedAt: nowIso,
    lastAlertAt: notification.sent ? nowIso : previous?.lastAlertAt || null,
    lastAttemptAt: shouldNotify ? nowIso : previous?.lastAttemptAt || null,
    lastConfirmedCandleAt: evaluation.state === "CONFIRMED" ? evaluation.confirmed15mAt : previous?.lastConfirmedCandleAt || null,
    activatedAt: evaluation.state === "CONFIRMED" ? previous?.activatedAt || nowIso : previous?.activatedAt || null,
    evaluation,
    notification,
  };
  const previousPersistedAt = Date.parse(previous?.lastPersistedAt || "");
  const heartbeatDue = !Number.isFinite(previousPersistedAt) || Date.now() - previousPersistedAt >= SCANNER_HEARTBEAT_MS;
  if (!previous || previous.state !== evaluation.state || shouldNotify || heartbeatDue) {
    const ttlSeconds = Math.max(3600, Math.ceil((Date.parse(plan.expiresAt) - Date.now()) / 1000) + 24 * 60 * 60);
    await scannerStatePut(env, SCANNER_RUNTIME_KEY, nextRuntime, ttlSeconds);
  }
  return {
    status: "ok",
    build: BUILD,
    plan: { planId: plan.planId, symbol: plan.symbol, direction: plan.direction, expiresAt: plan.expiresAt },
    evaluation,
    notification,
    configuration: scannerConfiguration(env),
  };
}

async function scannerStatus(env) {
  const state = await scannerStateBundle(env, [ACTIVE_PLAN_KEY, SCANNER_RUNTIME_KEY]);
  const plan = state[ACTIVE_PLAN_KEY];
  const runtime = state[SCANNER_RUNTIME_KEY];
  return { status: "ok", build: BUILD, apiVersion: API_VERSION, configuration: scannerConfiguration(env), activePlan: plan || null, runtime: runtime || null };
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
  const planSchema = {
    type: "object",
    required: ["symbol", "direction", "entryZone", "stopLoss", "invalidationPrice", "takeProfits", "strategySummary", "triggerExplanation", "expiresAt"],
    properties: {
      planId: { type: "string", description: "Stable identifier for this exact final GPT plan; omit to auto-generate." },
      symbol: { type: "string", enum: ["ETHUSDT", "BTCUSDT"] },
      direction: { type: "string", enum: ["LONG", "SHORT"] },
      timeframe: { type: "string", description: "Holding horizon such as SHORT_TERM or SWING." },
      expiresAt: { type: "string", format: "date-time", description: "Hard expiry, no more than seven days from now." },
      entryZone: {
        type: "object",
        required: ["min", "max"],
        properties: { min: { type: "number" }, max: { type: "number" } },
      },
      stopLoss: { type: "number" },
      invalidationPrice: { type: "number" },
      maximumExecutionPrice: { type: ["number", "null"] },
      minimumExecutionPrice: { type: ["number", "null"] },
      takeProfits: {
        type: "array",
        minItems: 1,
        maxItems: 5,
        items: {
          type: "object",
          required: ["price", "allocationPct"],
          properties: { price: { type: "number" }, allocationPct: { type: "number" } },
        },
      },
      minNetRR: { type: "number", description: "Minimum net risk/reward ratio after estimated costs; default 1.5." },
      estimatedRoundTripCostPct: { type: "number", description: "Round-trip fees, slippage and funding as percent of notional; default 0.15." },
      confirmation: {
        type: "object",
        properties: {
          close15mAbove: { type: ["number", "null"], description: "LONG confirmation: latest completed 15m candle must close at or above this value." },
          close15mBelow: { type: ["number", "null"], description: "SHORT confirmation: latest completed 15m candle must close at or below this value." },
          requireFlowSupport: { type: "boolean", default: true },
          requireOrderBookSupport: { type: "boolean", default: false },
          allowCountertrend: { type: "boolean", default: false },
          btcMinimumPrice: { type: ["number", "null"] },
          btcMaximumPrice: { type: ["number", "null"] },
        },
      },
      strategySummary: { type: "string", description: "The causal thesis from the final answer. It is shown in alerts so context is preserved." },
      triggerExplanation: { type: "string", description: "Exact before/after reasoning for why the setup becomes valid." },
      strongestCounterEvidence: { type: "string", description: "Strongest contrary evidence from the same final answer." },
      sourceAnalysisAt: { type: "string", format: "date-time" },
      risk: {
        type: "object",
        properties: {
          accountEquityUsdt: { type: ["number", "null"] },
          accountRiskPct: { type: ["number", "null"] },
          leverage: { type: ["number", "null"] },
          marginMode: { type: "string" },
        },
      },
    },
  };
  return {
    openapi: "3.1.0",
    info: {
      title: "Crypto Alpha BTC ETH Realtime",
      description: "Realtime BTC/ETH perpetual data plus a GPT-plan-linked alert scanner. After producing a formal trading plan, GPT must save that exact plan with saveTradingPlan before replying, so minute scans preserve the original thesis, trigger, counter-evidence, invalidation and targets.",
      version: API_VERSION,
    },
    servers: [{ url: origin }],
    paths: {
      "/": {
        get: {
          operationId: "getCryptoAlphaData",
          summary: "Get realtime BTC and ETH perpetual market data",
          description: "Returns OKX BTC/ETH prices, OI changes and funding; Gate candles and auxiliary capital flow. Use this to analyze. If the answer contains an ARMED or executable plan, call saveTradingPlan with the exact final parameters before giving the final answer.",
          security: [],
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
      "/scanner/plan": {
        post: {
          operationId: "saveTradingPlan",
          summary: "Save the exact final GPT trading plan for automatic monitoring",
          description: "MANDATORY after GPT creates or changes a formal plan. Save the final direction, entry, 15m confirmation, stop, targets, expiry, thesis and strongest counter-evidence. This replaces the old plan and links Bark alerts to this answer. Do not call for DATA_BLOCKED or no valid plan.",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: planSchema } },
          },
          responses: {
            200: { description: "Plan saved and armed", content: { "application/json": { schema: { type: "object", properties: { status: { type: "string" }, plan: planSchema, notification: moduleSchema } } } } },
            400: { description: "Invalid plan" },
            401: { description: "Missing or invalid scanner bearer token" },
          },
          "x-openai-isConsequential": false,
        },
      },
      "/scanner/status": {
        get: {
          operationId: "getTradingPlanScannerStatus",
          summary: "Check the active GPT plan and automatic scanner state",
          description: "Returns the currently saved GPT plan, last minute-scan evaluation and alert configuration. Use when the user asks whether monitoring or reminders are active.",
          security: [{ bearerAuth: [] }],
          responses: {
            200: { description: "Scanner status", content: { "application/json": { schema: { type: "object", properties: { status: { type: "string" }, activePlan: { type: ["object", "null"], properties: planSchema.properties }, runtime: { type: ["object", "null"], additionalProperties: true } } } } } },
            401: { description: "Missing or invalid scanner bearer token" },
          },
        },
      },
      "/scanner/cancel": {
        post: {
          operationId: "cancelTradingPlanMonitoring",
          summary: "Cancel the previous GPT plan when the newest analysis has no valid setup",
          description: "MANDATORY before replying when a fresh market analysis concludes DATA_BLOCKED, no formal plan, no-trade, or that the previous setup is invalid. This prevents an older GPT plan from continuing to alert after the reasoning changed.",
          security: [{ bearerAuth: [] }],
          responses: {
            200: { description: "Previous plan cancelled or no active plan", content: { "application/json": { schema: { type: "object", properties: { status: { type: "string" }, planId: { type: "string" }, notification: moduleSchema } } } } },
            401: { description: "Missing or invalid scanner bearer token" },
          },
          "x-openai-isConsequential": false,
        },
      },
    },
    components: {
      schemas: {},
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "Scanner token" },
      },
    },
  };
}

function privacy(origin) {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Crypto Alpha Privacy</title><body style="font-family:system-ui;max-width:760px;margin:40px auto;padding:0 18px;line-height:1.7"><h1>Crypto Alpha 隐私政策</h1><p>本服务提供 BTC/ETH 市场数据、保存用户主动提交的交易监控参数并发送提醒；不自动下单，不接收交易所密钥，不收集姓名、邮箱、账户或付款信息。</p><p>监控参数包括方向、入场区、止损、止盈、失效价、有效期和方案摘要，保存在 Cloudflare Durable Object 中；Bark 设备密钥和扫描令牌以 Cloudflare Secret 保存，不写入接口响应。</p><p>为保障稳定性，服务提供商可能保留短期技术日志，例如请求时间、错误信息与网络元数据。日志仅用于故障排查。</p><p>执行数据来源：OKX USDT 永续的实时价格、标记价格、当前未平仓量、5分钟/15分钟/1小时未平仓量变化和资金费率。主K线使用 Gate USDT 永续；Gate 公共接口另提供主动买卖估算、大额成交估算、订单簿、强平及多空比等辅助证据。该资金流仅代表单一交易所，不能单独制造开仓方向。Kraken 现货仅作严格质量校验后的紧急保底。服务地址：${origin}</p><p>最后更新：2026-08-22</p></body></html>`;
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

async function readJsonRequest(request) {
  const length = finite(request.headers.get("content-length"), 0);
  if (length > 64_000) throw new Error("Request body exceeds 64KB");
  const text = await request.text();
  if (!text || text.length > 64_000) throw new Error("A JSON body under 64KB is required");
  try { return JSON.parse(text); } catch { throw new Error("Request body must be valid JSON"); }
}

async function cancelTradingPlan(env) {
  const plan = await scannerStateGet(env, ACTIVE_PLAN_KEY);
  if (!plan) return { status: "idle", reason: "NO_ACTIVE_PLAN" };
  const cancelled = { ...plan, status: "CANCELLED", cancelledAt: new Date().toISOString() };
  await scannerStatePut(env, ACTIVE_PLAN_KEY, cancelled, 24 * 60 * 60);
  await scannerStatePut(env, SCANNER_RUNTIME_KEY, {
    planId: plan.planId,
    state: "CANCELLED",
    checkedAt: cancelled.cancelledAt,
    lastPersistedAt: cancelled.cancelledAt,
    evaluation: { state: "CANCELLED", reason: "Plan cancelled by authenticated request" },
  }, 24 * 60 * 60);
  let notification;
  try { notification = await sendBark(env, { title: `🛑 ${plan.symbol} 监控方案已取消`, body: `方案 ${plan.planId} 已停止扫描。`, level: "active" }); }
  catch (error) { notification = { sent: false, reason: error?.message || String(error) }; }
  return { status: "cancelled", planId: plan.planId, notification };
}

export class ScannerState {
  constructor(ctx) {
    this.ctx = ctx;
  }

  async fetch(request) {
    if (request.method !== "POST") return Response.json({ error: "METHOD_NOT_ALLOWED" }, { status: 405 });
    let input;
    try { input = await request.json(); } catch { return Response.json({ error: "INVALID_JSON" }, { status: 400 }); }
    if (input?.op === "get" && Array.isArray(input.keys)) {
      const values = {};
      for (const key of input.keys.slice(0, 20)) {
        const record = await this.ctx.storage.get(String(key));
        if (!record) { values[key] = null; continue; }
        if (Number.isFinite(record.expiresAt) && record.expiresAt <= Date.now()) {
          await this.ctx.storage.delete(String(key));
          values[key] = null;
        } else values[key] = record.value;
      }
      return Response.json({ status: "ok", values });
    }
    if (input?.op === "put" && input.values && typeof input.values === "object") {
      const stored = [];
      for (const [key, item] of Object.entries(input.values).slice(0, 20)) {
        const ttlSeconds = Math.max(60, finite(item?.ttlSeconds, 30 * 24 * 60 * 60));
        await this.ctx.storage.put(String(key), { value: item?.value ?? null, expiresAt: Date.now() + ttlSeconds * 1000 });
        stored.push(key);
      }
      return Response.json({ status: "ok", stored });
    }
    return Response.json({ error: "INVALID_OPERATION" }, { status: 400 });
  }
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: JSON_HEADERS });
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const origin = url.origin;

    if (request.method === "GET" && path === "/") return handleSnapshot(request, ctx);
    if (path === "/health") {
      return json({ status: "ok", build: BUILD, apiVersion: API_VERSION, upstream: "OKX execution/OI/funding + Gate USDT perpetual primary candles/free auxiliary capital flow + Kraken Spot emergency fallback", normalOkxRequests: 7, gateCapitalFlowRequests: 6, coinGlassApiRequested: false, okxCandlesRequested: false, binanceRequested: false, bybitRequested: false, bytickRequested: false, bitgetRequested: false, actionCount: 4, scanner: scannerConfiguration(env), authentication: "market snapshot none; scanner endpoints bearer" });
    }
    if (path === "/openapi.json") return json(openApi(origin), 200, { "cache-control": "public, max-age=300" });
    if (path === "/privacy") {
      return new Response(privacy(origin), { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=3600" } });
    }
    if (path.startsWith("/scanner/")) {
      if (!scannerAuthorized(request, env)) return json({ error: "UNAUTHORIZED", message: "Configure SCANNER_TOKEN and send it as a Bearer token" }, 401);
      if (request.method === "GET" && path === "/scanner/status") return json(await scannerStatus(env));
      if (request.method === "POST" && path === "/scanner/plan") {
        try { return json(await saveTradingPlan(env, await readJsonRequest(request))); }
        catch (error) { return json({ error: "INVALID_PLAN", message: error?.message || String(error) }, 400); }
      }
      if (request.method === "POST" && path === "/scanner/run") {
        try { return json(await runScanner(env)); }
        catch (error) { return json({ error: "SCANNER_FAILED", message: error?.message || String(error) }, 503); }
      }
      if (request.method === "POST" && path === "/scanner/test") {
        try {
          const notification = await sendBark(env, { title: "✅ Crypto Alpha 提醒测试成功", body: "Bark、Worker 和扫描提醒线路已经连通。", level: "timeSensitive" });
          return json({ status: "ok", notification });
        } catch (error) { return json({ error: "BARK_TEST_FAILED", message: error?.message || String(error) }, 503); }
      }
      if (request.method === "POST" && path === "/scanner/cancel") return json(await cancelTradingPlan(env));
      return json({ error: "METHOD_NOT_ALLOWED_OR_UNKNOWN_SCANNER_ROUTE" }, 405, { allow: "GET,POST,OPTIONS" });
    }
    if (!["GET", "POST"].includes(request.method)) return json({ error: "METHOD_NOT_ALLOWED" }, 405, { allow: "GET,POST,OPTIONS" });
    return json({ error: "NOT_FOUND", available: ["/", "/health", "/openapi.json", "/privacy", "/scanner/status", "/scanner/plan", "/scanner/run", "/scanner/test", "/scanner/cancel"] }, 404);
  },

  async scheduled(_controller, env, ctx) {
    const task = runScanner(env).catch((error) => console.error("scheduled scanner failed", error));
    if (ctx?.waitUntil) ctx.waitUntil(task);
    else await task;
  },
};
