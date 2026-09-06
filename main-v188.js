const BUILD = "crypto-alpha-worker-v19.4.0-validation-reality-governance";
const API_VERSION = "4.4.0";
const KRAKEN_FUTURES_BASE = "https://futures.kraken.com";
const KRAKEN_SPOT_BASE = "https://api.kraken.com";
const OKX_BASE = "https://www.okx.com";
const GATE_BASE = "https://api.gateio.ws";
const COINALYZE_BASE = "https://api.coinalyze.net/v1";
const CACHE_NAMESPACE = "v19.4.0-validation-reality-governance";
const SNAPSHOT_CACHE_SECONDS = 3;
const CANDLE_LIMIT = 240;
const RECENT_CANDLE_COUNT = 24;
const MAX_OKX_CONCURRENCY = 2;
const ACTIVE_PLAN_KEY = "scanner:active-plan";
const SCANNER_RUNTIME_KEY = "scanner:runtime";
const SCANNER_FAILURE_HISTORY_KEY = "scanner:failure-history";
const SCANNER_LEASE_KEY = "scanner:lease";
const CONFIRMATION_COOLDOWN_MS = 14 * 60_000;
const DEFAULT_PLAN_HOURS = 24;
const SCANNER_DOUBLE_SAMPLE_DELAY_MS = 400;
const FAILURE_HISTORY_DAYS = 7;
const MAX_SOURCE_ANALYSIS_AGE_MS = 15 * 60_000;
const MAX_SOURCE_ANALYSIS_FUTURE_SKEW_MS = 2 * 60_000;
const STOP_INVALIDATION_TOLERANCE_PCT = 0.05;
const MAX_LEVERAGE = 50;

const LEGACY_CONFIG = {
  status: "LEGACY_CONFIG_UNVALIDATED",
  accountEquityUsdt: 17_000,
  absolutePlanRiskCapPct: 8,
  correlatedRiskCapPct: 8,
  dailyRiskStopPct: 8,
  consecutiveFullStopLimit: 2,
  riskByGradePct: { "A+": [5, 6], A: [4, 5], B: [2.5, 3.5], C: [0, 0], D: [0, 0] },
  minimumNetRR: {
    SHORT: { B: 1.5, A: 1.8, "A+": 2.2 },
    MEDIUM_SHORT: { B: 1.7, A: 2.0, "A+": 2.5 },
    SWING: { B: 2.0, A: 2.3, "A+": 2.8 },
  },
  policy: "These values remain configurable safety defaults pending separate Model A/B/C backtests; they are not course truths.",
};

const SUBMODEL_DEFINITIONS = {
  A1: { parent: "A", name: "DEEP_TREND_PULLBACK", directRegimes: ["TREND"] },
  A2: { parent: "A", name: "SHALLOW_TREND_CONTINUATION", directRegimes: ["TREND"] },
  B1: { parent: "B", name: "RANGE_BREAKOUT_RETEST", directRegimes: ["TREND"], watchRegimes: ["RANGE", "COMPRESSION", "TRANSITION"] },
  B2: { parent: "B", name: "VOLATILITY_COMPRESSION_BREAKOUT_RETEST", directRegimes: ["TREND"], watchRegimes: ["COMPRESSION", "RANGE", "TRANSITION"] },
  C1: { parent: "C", name: "EXTERNAL_LIQUIDITY_SWEEP_REVERSAL", directRegimes: ["RANGE"], watchRegimes: ["TRANSITION"] },
  C2: { parent: "C", name: "FAILED_BREAKOUT_REVERSION", directRegimes: ["RANGE"], watchRegimes: ["TRANSITION"] },
};

function submodelRegimePermission(model, submodel, regime) {
  const definition = SUBMODEL_DEFINITIONS[submodel];
  if (!definition || definition.parent !== model) return "BLOCKED";
  if (definition.directRegimes.includes(regime)) return "DIRECT";
  if ((definition.watchRegimes || []).includes(regime)) return "WAIT_ONLY";
  return "BLOCKED";
}

const CACHE_POLICY = {
  ticker: { freshSeconds: 4, staleSeconds: 20, attempts: 2 },
  markPrice: { freshSeconds: 8, staleSeconds: 30, attempts: 2 },
  openInterest: { freshSeconds: 30, staleSeconds: 180, attempts: 1 },
  openInterestHistory: { freshSeconds: 60, staleSeconds: 600, attempts: 2, timeoutMs: 5000 },
  funding: { freshSeconds: 120, staleSeconds: 900, attempts: 1 },
  krakenTicker: { freshSeconds: 15, staleSeconds: 120, attempts: 1 },
  gateCandle15m: { freshSeconds: 45, staleSeconds: 180, attempts: 1, timeoutMs: 3500 },
  gateCandle1m: { freshSeconds: 8, staleSeconds: 75, attempts: 1, timeoutMs: 3000 },
  gateCandle1h: { freshSeconds: 90, staleSeconds: 360, attempts: 1, timeoutMs: 3500 },
  gateCandle4h: { freshSeconds: 120, staleSeconds: 720, attempts: 1, timeoutMs: 3500 },
  gateContractStats: { freshSeconds: 25, staleSeconds: 180, attempts: 1, timeoutMs: 4500 },
  gateTrades: { freshSeconds: 12, staleSeconds: 90, attempts: 1, timeoutMs: 4500 },
  gateOrderBook: { freshSeconds: 8, staleSeconds: 45, attempts: 2, timeoutMs: 4500 },
  okxSpotTicker: { freshSeconds: 4, staleSeconds: 20, attempts: 1, timeoutMs: 3500 },
  okxSpotTrades: { freshSeconds: 8, staleSeconds: 45, attempts: 1, timeoutMs: 4000 },
  okxSpotBook: { freshSeconds: 5, staleSeconds: 30, attempts: 1, timeoutMs: 4000 },
  krakenSpotCandle15m: { freshSeconds: 45, staleSeconds: 180, attempts: 1, timeoutMs: 3500 },
  krakenSpotCandle1h: { freshSeconds: 90, staleSeconds: 360, attempts: 1, timeoutMs: 3500 },
  krakenSpotCandle4h: { freshSeconds: 120, staleSeconds: 720, attempts: 1, timeoutMs: 3500 },
  coinalyzeMarkets: { freshSeconds: 6 * 60 * 60, staleSeconds: 24 * 60 * 60, attempts: 1, timeoutMs: 5000 },
  coinalyzeLiquidations: { freshSeconds: 60, staleSeconds: 10 * 60, attempts: 1, timeoutMs: 5000 },
};

const memoryCache = new Map();
const inflight = new Map();
let okxActive = 0;
const okxWaiters = [];

const ASSETS = {
  BTCUSDT: { instrumentId: "BTC-USDT-SWAP", spotInstrumentId: "BTC-USDT", futuresSymbol: "PI_XBTUSD", gateSymbol: "BTC_USDT", gateQuantoMultiplier: 0.0001, largeTradeFloorUsd: 50_000, krakenSpotPair: "XBTUSD" },
  ETHUSDT: { instrumentId: "ETH-USDT-SWAP", spotInstrumentId: "ETH-USDT", futuresSymbol: "PI_ETHUSD", gateSymbol: "ETH_USDT", gateQuantoMultiplier: 0.01, largeTradeFloorUsd: 25_000, krakenSpotPair: "ETHUSD" },
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

function epochMilliseconds(value) {
  const number = finite(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  if (number >= 1e15) return Math.floor(number / 1000);
  if (number >= 1e12) return Math.floor(number);
  if (number >= 1e9) return Math.floor(number * 1000);
  return null;
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

async function fetchJson(url, label, attempts, isOkx, validate, timeoutMs = 4500, extraHeaders = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (isOkx) await acquireOkxPermit();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(`${label} timeout`), timeoutMs);
    try {
      const response = await fetch(url, {
        headers: { accept: "application/json", "user-agent": "CryptoAlpha/19.4.0", ...extraHeaders },
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

async function cachedJson({ key, url, label, policy, isOkx = false, validate, persistentCache = true, headers = {} }) {
  const cached = await readPersistentCache(key, persistentCache);
  if (cached) {
    const ageSeconds = (Date.now() - cached.storedAt) / 1000;
    if (ageSeconds <= policy.freshSeconds) return cacheResult(cached, "fresh-cache");
  }

  if (inflight.has(key)) return inflight.get(key);
  const work = (async () => {
    try {
      const value = await fetchJson(url, label, policy.attempts, isOkx, validate, policy.timeoutMs, headers);
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
    persistentCache: false,
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

async function scannerTouchProbe(plan, snapshot) {
  const config = ASSETS[plan.symbol];
  const referencePrice = finite(snapshot?.assets?.[plan.symbol]?.ticker?.last);
  if (!config || !Number.isFinite(referencePrice)) return { status: "unavailable", reason: "OKX reference price unavailable" };
  try {
    const rows = await upstream(
      GATE_BASE,
      `/api/v4/futures/usdt/candlesticks?contract=${config.gateSymbol}&interval=1m&limit=3`,
      "Gate USDT Futures Touch Probe",
      CACHE_POLICY.gateCandle1m,
    );
    const latest = parseGateCandles(rows).at(-1);
    if (!latest) throw new Error("No valid Gate 1m candle");
    const ageSeconds = Math.max(0, (Date.now() - Date.parse(latest.ts)) / 1000);
    if (!Number.isFinite(ageSeconds) || ageSeconds > 120) throw new Error(`Gate 1m candle stale by ${round(ageSeconds, 1)} seconds`);
    const deviationPct = Math.abs(latest.close - referencePrice) / referencePrice * 100;
    if (!Number.isFinite(deviationPct) || deviationPct > 0.75) throw new Error(`Gate 1m close deviates ${round(deviationPct, 4)}% from OKX`);
    return {
      status: "ok",
      source: "GATE_USDT_PERPETUAL_1M_CROSS_VALIDATED_BY_OKX",
      startedAt: latest.ts,
      high: round(latest.high, 8),
      low: round(latest.low, 8),
      close: round(latest.close, 8),
      ageSeconds: round(ageSeconds, 3),
      deviationPct: round(deviationPct, 6),
    };
  } catch (error) {
    return { status: "unavailable", reason: error?.message || String(error) };
  }
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
    const timestampMs = epochMilliseconds(row?.create_time_ms) ?? epochMilliseconds(row?.create_time);
    return {
      side: size > 0 ? "buy" : size < 0 ? "sell" : null,
      notionalUsd: Number.isFinite(size) && Number.isFinite(price) ? Math.abs(size) * multiplier * price : null,
      timestampMs,
    };
  }).filter((trade) => trade.side && Number.isFinite(trade.notionalUsd) && trade.notionalUsd > 0 && Number.isFinite(trade.timestampMs));
  if (trades.length < 20) throw new Error(`Gate trade sample has only ${trades.length} valid trades`);
  trades.sort((a, b) => a.timestampMs - b.timestampMs);
  const latestAgeSeconds = Math.max(0, (Date.now() - trades.at(-1).timestampMs) / 1000);
  if (!Number.isFinite(latestAgeSeconds) || latestAgeSeconds > 120) throw new Error(`Gate trade sample is stale by ${round(latestAgeSeconds, 1)} seconds`);
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
    dataFreshness: { ...freshness(rows), exchangeAgeSeconds: round(latestAgeSeconds, 3) },
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
  const exchangeTimestampMs = epochMilliseconds(body?.current);
  const exchangeAgeSeconds = Number.isFinite(exchangeTimestampMs) ? Math.max(0, (Date.now() - exchangeTimestampMs) / 1000) : Infinity;
  if (!Number.isFinite(exchangeAgeSeconds) || exchangeAgeSeconds > 60) throw new Error(`Gate order book timestamp is missing or stale by ${round(exchangeAgeSeconds, 1)} seconds`);
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
    exchangeTimestamp: new Date(exchangeTimestampMs).toISOString(),
    dataFreshness: { ...freshness(body), exchangeAgeSeconds: round(exchangeAgeSeconds, 3) },
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

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function chooseCoinalyzeMarkets(markets, baseAsset) {
  const preferred = ["OKX", "BINANCE", "BYBIT", "GATE", "BITGET", "KRAKEN"];
  const candidates = (Array.isArray(markets) ? markets : []).filter((market) =>
    String(market?.base_asset || "").toUpperCase() === baseAsset
    && market?.is_perpetual === true
    && String(market?.margined || "").toUpperCase() === "STABLE"
    && ["USDT", "USDC", "USD"].includes(String(market?.quote_asset || "").toUpperCase())
    && typeof market?.symbol === "string"
    && market.symbol.length <= 80,
  );
  candidates.sort((left, right) => {
    const rank = (market) => {
      const label = `${market?.exchange || ""} ${market?.symbol_on_exchange || ""}`.toUpperCase();
      const preferredRank = preferred.findIndex((name) => label.includes(name));
      const quoteRank = String(market?.quote_asset || "").toUpperCase() === "USDT" ? 0 : 1;
      return (preferredRank < 0 ? 100 : preferredRank) * 10 + quoteRank;
    };
    return rank(left) - rank(right);
  });
  const selected = [];
  const exchanges = new Set();
  for (const market of candidates) {
    const exchange = String(market.exchange || market.symbol.split(".").at(-1) || "UNKNOWN");
    if (exchanges.has(exchange)) continue;
    exchanges.add(exchange);
    selected.push({
      symbol: market.symbol,
      exchange,
      symbolOnExchange: market.symbol_on_exchange || null,
      quoteAsset: market.quote_asset || null,
    });
    if (selected.length >= 3) break;
  }
  return selected;
}

function aggregateCoinalyzeHistory(historyResponses, selectedMarkets) {
  const selectedSymbols = new Set(selectedMarkets.map((market) => market.symbol));
  const buckets = new Map();
  for (const response of Array.isArray(historyResponses) ? historyResponses : []) {
    if (!selectedSymbols.has(response?.symbol) || !Array.isArray(response?.history)) continue;
    for (const row of response.history) {
      const timestamp = finite(row?.t);
      if (!Number.isFinite(timestamp)) continue;
      const bucket = buckets.get(timestamp) || { timestamp, longLiquidationUsd: 0, shortLiquidationUsd: 0, marketCount: 0 };
      bucket.longLiquidationUsd += Math.max(0, finite(row?.l, 0));
      bucket.shortLiquidationUsd += Math.max(0, finite(row?.s, 0));
      bucket.marketCount += 1;
      buckets.set(timestamp, bucket);
    }
  }
  return [...buckets.values()].sort((a, b) => a.timestamp - b.timestamp);
}

function liquidationPeriod(points, bars, label) {
  const sample = points.slice(-bars);
  if (!sample.length) return errorModule(`No Coinalyze ${label} liquidation samples`);
  const longLiquidationUsd = sample.reduce((sum, point) => sum + point.longLiquidationUsd, 0);
  const shortLiquidationUsd = sample.reduce((sum, point) => sum + point.shortLiquidationUsd, 0);
  const totalLiquidationUsd = longLiquidationUsd + shortLiquidationUsd;
  return {
    status: "ok",
    interval: label,
    sampleCount: sample.length,
    longLiquidationUsd: round(longLiquidationUsd, 2),
    shortLiquidationUsd: round(shortLiquidationUsd, 2),
    totalLiquidationUsd: round(totalLiquidationUsd, 2),
    dominantSide: !totalLiquidationUsd ? "NONE" : longLiquidationUsd >= shortLiquidationUsd * 1.25 ? "LONG_LIQUIDATIONS" : shortLiquidationUsd >= longLiquidationUsd * 1.25 ? "SHORT_LIQUIDATIONS" : "BALANCED",
    startAt: new Date(sample[0].timestamp * 1000).toISOString(),
    endAt: new Date(sample.at(-1).timestamp * 1000).toISOString(),
  };
}

function buildCoinalyzeAssetModule(historyResponses, selectedMarkets) {
  const points = aggregateCoinalyzeHistory(historyResponses, selectedMarkets);
  if (!points.length) return errorModule("Coinalyze returned no usable realized-liquidation history for selected markets");
  const periods = {
    "5m": liquidationPeriod(points, 1, "5m"),
    "15m": liquidationPeriod(points, 3, "15m"),
    "1h": liquidationPeriod(points, 12, "1h"),
    "4h": liquidationPeriod(points, 48, "4h"),
    "24h": liquidationPeriod(points, 288, "24h"),
  };
  const baseline = median(points.slice(-288).map((point) => point.longLiquidationUsd + point.shortLiquidationUsd).filter((value) => value > 0));
  const latest15m = finite(periods["15m"].totalLiquidationUsd);
  const intensityMultiple = Number.isFinite(baseline) && baseline > 0 && Number.isFinite(latest15m) ? latest15m / (baseline * 3) : null;
  const latestTimestampMs = points.at(-1).timestamp * 1000;
  const latestAgeSeconds = Math.max(0, (Date.now() - latestTimestampMs) / 1000);
  const recentCoverage = points.slice(-3).map((point) => point.marketCount);
  const minimumRecentMarketCount = recentCoverage.length ? Math.min(...recentCoverage) : 0;
  const selectedSymbols = new Set(selectedMarkets.map((market) => market.symbol));
  const respondingMarketCount = new Set((Array.isArray(historyResponses) ? historyResponses : [])
    .filter((response) => selectedSymbols.has(response?.symbol) && Array.isArray(response?.history) && response.history.length)
    .map((response) => response.symbol)).size;
  const qualityPassed = selectedMarkets.length >= 2 && respondingMarketCount >= 2 && points.length >= 12 && latestAgeSeconds <= 20 * 60;
  return {
    status: qualityPassed ? "ok" : "partial",
    source: "COINALYZE_FREE_API",
    role: "OPTIONAL_REALIZED_LIQUIDATION_CONFIRMATION_ONLY",
    scope: "SELECTED_EXCHANGES_REALIZED_LIQUIDATIONS_NOT_FULL_MARKET_FUTURE_MAP",
    selectedMarkets,
    periods,
    intensityMultipleVs24hMedian5m: Number.isFinite(intensityMultiple) ? round(intensityMultiple, 4) : null,
    intensity: !Number.isFinite(intensityMultiple) ? "UNKNOWN" : intensityMultiple >= 3 ? "EXTREME" : intensityMultiple >= 1.5 ? "ELEVATED" : "NORMAL",
    latestAt: new Date(latestTimestampMs).toISOString(),
    quality: {
      passed: qualityPassed,
      latestAgeSeconds: round(latestAgeSeconds, 3),
      selectedMarketCount: selectedMarkets.length,
      respondingMarketCount,
      minimumRecentMarketCount,
      sampleCount5m: points.length,
      rule: "At least two selected and responding markets, twelve aggregated 5m samples and latest sample within twenty minutes; zero-liquidation gaps are not treated as provider failure",
    },
    providerFieldSemantics: { l: "LONG_LIQUIDATIONS", s: "SHORT_LIQUIDATIONS" },
    standaloneSignal: false,
  };
}

async function loadCoinalyzeLiquidations(apiKey) {
  if (!apiKey) return { configured: false, status: "configuration_required", reason: "COINALYZE_API_KEY_NOT_CONFIGURED", assets: {} };
  const headers = { api_key: String(apiKey) };
  try {
    const markets = await cachedJson({
      key: "coinalyze:future-markets",
      url: `${COINALYZE_BASE}/future-markets`,
      label: "Coinalyze future markets",
      policy: CACHE_POLICY.coinalyzeMarkets,
      headers,
      validate: (body) => {
        if (!Array.isArray(body) || !body.length) throw new Error("Coinalyze future markets are empty");
        return body;
      },
    });
    const selected = {
      BTCUSDT: chooseCoinalyzeMarkets(markets, "BTC"),
      ETHUSDT: chooseCoinalyzeMarkets(markets, "ETH"),
    };
    const symbols = [...new Set(Object.values(selected).flat().map((market) => market.symbol))].slice(0, 20);
    if (!symbols.length) throw new Error("No supported BTC/ETH stable-margined perpetual markets found on Coinalyze");
    const now = Math.floor(Date.now() / 1000);
    const from = now - 24 * 60 * 60;
    const query = new URLSearchParams({ symbols: symbols.join(","), interval: "5min", from: String(from), to: String(now), convert_to_usd: "true" });
    const history = await cachedJson({
      key: `coinalyze:liquidations:${symbols.join("|")}`,
      url: `${COINALYZE_BASE}/liquidation-history?${query.toString()}`,
      label: "Coinalyze liquidation history",
      policy: CACHE_POLICY.coinalyzeLiquidations,
      headers,
      validate: (body) => {
        if (!Array.isArray(body)) throw new Error("Coinalyze liquidation history is invalid");
        return body;
      },
    });
    return {
      configured: true,
      status: "ok",
      requestSymbolCount: symbols.length,
      rateLimitAccounting: "EACH_SYMBOL_COUNTS_AS_ONE_PROVIDER_API_CALL",
      assets: Object.fromEntries(Object.entries(selected).map(([symbol, marketsForAsset]) => [symbol, buildCoinalyzeAssetModule(history, marketsForAsset)])),
    };
  } catch (error) {
    return { configured: true, status: "unavailable", reason: error?.message || String(error), assets: {} };
  }
}

function gateLiquidationFallback(asset) {
  const periods = {};
  for (const label of ["5m", "15m", "1h", "4h"]) {
    const source = asset?.capitalFlow?.periods?.[label];
    if (source?.status !== "ok") continue;
    const longLiquidationUsd = finite(source.longLiquidationUsd, 0);
    const shortLiquidationUsd = finite(source.shortLiquidationUsd, 0);
    const totalLiquidationUsd = longLiquidationUsd + shortLiquidationUsd;
    periods[label] = {
      status: "ok",
      interval: label,
      longLiquidationUsd: round(longLiquidationUsd, 2),
      shortLiquidationUsd: round(shortLiquidationUsd, 2),
      totalLiquidationUsd: round(totalLiquidationUsd, 2),
      dominantSide: !totalLiquidationUsd ? "NONE" : longLiquidationUsd >= shortLiquidationUsd * 1.25 ? "LONG_LIQUIDATIONS" : shortLiquidationUsd >= longLiquidationUsd * 1.25 ? "SHORT_LIQUIDATIONS" : "BALANCED",
      startAt: source.startAt || null,
      endAt: source.endAt || null,
    };
  }
  if (!Object.keys(periods).length) return errorModule("No realized-liquidation history source is available");
  return {
    status: "fallback",
    source: "GATE_USDT_PERPETUAL_PUBLIC",
    role: "SINGLE_EXCHANGE_REALIZED_LIQUIDATION_FALLBACK_ONLY",
    scope: "SINGLE_EXCHANGE_REALIZED_LIQUIDATIONS_NOT_FULL_MARKET_FUTURE_MAP",
    periods,
    intensity: "UNKNOWN",
    selectedMarkets: [{ exchange: "GATE", symbolOnExchange: asset?.symbol || null }],
    standaloneSignal: false,
  };
}

function buildLiquidationRiskProxy(asset, coinalyzeModule) {
  const usingCoinalyze = coinalyzeModule?.status === "ok";
  const source = usingCoinalyze ? coinalyzeModule : gateLiquidationFallback(asset);
  const period = source?.periods?.["15m"] || {};
  const confirmed = confirmedRecentCandles(asset?.timeframes?.["15m"], 3);
  const first = finite(confirmed.at(-2)?.c);
  const last = finite(confirmed.at(-1)?.c);
  const priceChange15mPct = Number.isFinite(first) && first > 0 && Number.isFinite(last) ? (last - first) / first * 100 : null;
  const oiChange15mPct = finite(asset?.derivatives?.openInterest?.change15mPct, finite(asset?.capitalFlow?.periods?.["15m"]?.openInterestChangePct));
  const dominantSide = period?.dominantSide || "UNKNOWN";
  const intensity = source?.intensity || "UNKNOWN";
  const longFlush = dominantSide === "LONG_LIQUIDATIONS";
  const shortSqueeze = dominantSide === "SHORT_LIQUIDATIONS";
  const cascadeContinuation = intensity === "EXTREME" && ((longFlush && Number.isFinite(priceChange15mPct) && priceChange15mPct <= -0.2) || (shortSqueeze && Number.isFinite(priceChange15mPct) && priceChange15mPct >= 0.2));
  const exhaustionCandidate = (longFlush && Number.isFinite(priceChange15mPct) && priceChange15mPct >= -0.05)
    || (shortSqueeze && Number.isFinite(priceChange15mPct) && priceChange15mPct <= 0.05);
  return {
    ...source,
    upstreamAttempt: usingCoinalyze ? null : {
      source: coinalyzeModule?.source || "COINALYZE_FREE_API",
      status: coinalyzeModule?.status || "unavailable",
      reason: coinalyzeModule?.error || coinalyzeModule?.reason || "Quality gate did not pass",
      quality: coinalyzeModule?.quality || null,
    },
    riskClassification: cascadeContinuation ? "CASCADE_CONTINUATION_RISK" : exhaustionCandidate ? "LIQUIDATION_EXHAUSTION_OR_ABSORPTION_CANDIDATE" : intensity === "EXTREME" || intensity === "ELEVATED" ? "ELEVATED_REALIZED_LIQUIDATIONS" : "NORMAL_OR_INCONCLUSIVE",
    evidence: {
      dominantSide15m: dominantSide,
      priceChange15mPct: Number.isFinite(priceChange15mPct) ? round(priceChange15mPct, 5) : null,
      openInterestChange15mPct: Number.isFinite(oiChange15mPct) ? round(oiChange15mPct, 5) : null,
      cascadeContinuation,
      exhaustionCandidate,
    },
    permissions: {
      fullMarketFutureLiquidationMap: false,
      exactWhalePositions: false,
      standaloneDirection: false,
      createSetup: false,
      hardBlockerByItself: false,
      requirePriceStructureConfirmation: true,
    },
    limitation: "This proxy measures already-realized liquidations on selected markets. It does not reveal future liquidation levels, exact whale positions or guaranteed price magnets.",
  };
}

function buildExecutionLiquidity(asset) {
  const ticker = asset?.ticker || {};
  const orderBook = asset?.capitalFlow?.orderBook || {};
  const last = finite(ticker.last);
  const markPrice = finite(ticker.markPrice);
  const indexPrice = finite(asset?.indexPrice?.price);
  const bid = finite(ticker.bid);
  const ask = finite(ticker.ask);
  const midpoint = Number.isFinite(bid) && Number.isFinite(ask) && bid <= ask ? (bid + ask) / 2 : null;
  const executionReady = ticker.status === "ok"
    && ticker.source === "OKX_USDT_PERPETUAL"
    && [last, markPrice, bid, ask, midpoint].every((value) => Number.isFinite(value) && value > 0);
  const auxiliaryReady = orderBook.status === "ok";
  return {
    status: executionReady ? "ok" : "unavailable",
    executionPrimary: executionReady ? {
      source: "OKX_USDT_PERPETUAL",
      last: round(last, 8),
      markPrice: round(markPrice, 8),
      bid: round(bid, 8),
      ask: round(ask, 8),
      midpoint: round(midpoint, 8),
      spreadBps: round((ask - bid) / midpoint * 10_000, 4),
      markBasisBps: round((last - markPrice) / markPrice * 10_000, 4),
      indexPrice: Number.isFinite(indexPrice) ? round(indexPrice, 8) : null,
      perpetualIndexBasisBps: Number.isFinite(indexPrice) && indexPrice > 0 ? round((last - indexPrice) / indexPrice * 10_000, 4) : null,
      exchangeTimestamp: ticker.exchangeTimestamp || null,
    } : errorModule("Exact OKX bid/ask/mark execution liquidity unavailable"),
    auxiliaryDepth: auxiliaryReady ? {
      source: "GATE_USDT_PERPETUAL_PUBLIC",
      role: "AUXILIARY_CONFIRMATION_ONLY",
      bidDepthUsdEstimate: orderBook.bidDepthUsdEstimate,
      askDepthUsdEstimate: orderBook.askDepthUsdEstimate,
      imbalancePct: orderBook.imbalancePct,
      largestBidWall: orderBook.largestBidWall,
      largestAskWall: orderBook.largestAskWall,
      spreadBps: orderBook.spreadBps,
      exchangeTimestamp: orderBook.exchangeTimestamp,
    } : errorModule("Gate auxiliary order-book depth unavailable"),
    policy: {
      executionAndSlippage: "Use OKX bid/ask and mark price only",
      depthAndWalls: "Gate single-exchange order book is auxiliary confirmation only",
      standaloneSignal: false,
      automaticOrderPlacement: false,
    },
  };
}

function confirmedRecentCandles(timeframe, limit = 24) {
  const rows = Array.isArray(timeframe?.recentCandles) ? timeframe.recentCandles : [];
  return rows.filter((candle) => candle?.confirmed === true).slice(-limit);
}

function clusteredLiquidityLevels(values, tolerance, minimumTouches = 2) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const clusters = [];
  for (const value of sorted) {
    const cluster = clusters.find((item) => Math.abs(value - item.average) <= tolerance);
    if (cluster) {
      cluster.values.push(value);
      cluster.average = cluster.values.reduce((sum, item) => sum + item, 0) / cluster.values.length;
    } else clusters.push({ values: [value], average: value });
  }
  return clusters
    .filter((cluster) => cluster.values.length >= minimumTouches)
    .map((cluster) => ({ price: round(cluster.average, 8), touches: cluster.values.length }))
    .sort((a, b) => b.touches - a.touches);
}

function detectRecentLiquiditySweep(timeframe) {
  const rows = confirmedRecentCandles(timeframe, 24);
  const atrValue = finite(timeframe?.indicators?.atr14);
  if (rows.length < 14 || !Number.isFinite(atrValue) || atrValue <= 0) {
    return { status: "unavailable", bullishSweepReclaim: false, bearishSweepReclaim: false, reason: "Insufficient confirmed candles or ATR" };
  }
  const candidate = rows.at(-1);
  const prior = rows.slice(-13, -1);
  const priorLow = Math.min(...prior.map((candle) => finite(candle.l)).filter(Number.isFinite));
  const priorHigh = Math.max(...prior.map((candle) => finite(candle.h)).filter(Number.isFinite));
  const open = finite(candidate?.o);
  const high = finite(candidate?.h);
  const low = finite(candidate?.l);
  const close = finite(candidate?.c);
  if (![open, high, low, close, priorLow, priorHigh].every(Number.isFinite)) {
    return { status: "unavailable", bullishSweepReclaim: false, bearishSweepReclaim: false, reason: "Invalid confirmed candle values" };
  }
  const body = Math.max(Math.abs(close - open), atrValue * 0.04);
  const lowerWick = Math.min(open, close) - low;
  const upperWick = high - Math.max(open, close);
  const bullishSweepReclaim = low < priorLow - atrValue * 0.03 && close > priorLow && close > open && lowerWick >= body * 0.8;
  const bearishSweepReclaim = high > priorHigh + atrValue * 0.03 && close < priorHigh && close < open && upperWick >= body * 0.8;
  return {
    status: "ok",
    candleAt: candidate.ts,
    priorLow: round(priorLow, 8),
    priorHigh: round(priorHigh, 8),
    bullishSweepReclaim,
    bearishSweepReclaim,
    sweptLow: bullishSweepReclaim ? round(low, 8) : null,
    sweptHigh: bearishSweepReclaim ? round(high, 8) : null,
    close: round(close, 8),
    policy: "Only a closed 15m candle that pierces a prior 12-candle extreme and closes back inside counts as a sweep-and-reclaim",
  };
}

function directionalCrowding(direction, asset) {
  const long = direction === "LONG";
  const fundingRate = finite(asset?.derivatives?.funding?.rate);
  const positioning = asset?.capitalFlow?.positioning || {};
  const period15 = asset?.capitalFlow?.periods?.["15m"] || {};
  const period1h = asset?.capitalFlow?.periods?.["1h"] || {};
  const accountRatio = finite(positioning.accountLongShortRatio);
  const topPositionRatio = finite(positioning.topTraderPositionLongShortRatio);
  const takerRatio = finite(period15.takerBuySellRatio);
  const oi15m = finite(period15.openInterestChangePct);
  const oi1h = finite(period1h.openInterestChangePct);
  const signals = [];
  if (Number.isFinite(fundingRate) && (long ? fundingRate >= 0.0003 : fundingRate <= -0.0003)) signals.push("EXTREME_DIRECTIONAL_FUNDING");
  if (Number.isFinite(accountRatio) && (long ? accountRatio >= 1.3 : accountRatio <= 0.77)) signals.push("CROWDED_ACCOUNTS");
  if (Number.isFinite(topPositionRatio) && (long ? topPositionRatio >= 1.35 : topPositionRatio <= 0.74)) signals.push("CROWDED_TOP_TRADER_POSITION_PROXY");
  if (Number.isFinite(takerRatio) && (long ? takerRatio >= 1.25 : takerRatio <= 0.8)) signals.push("ONE_SIDED_TAKER_FLOW");
  if ((Number.isFinite(oi15m) && oi15m >= 0.8) || (Number.isFinite(oi1h) && oi1h >= 1.5)) signals.push("FAST_OI_BUILDUP");
  return {
    direction,
    score: signals.length,
    hardAdverse: signals.length >= 3,
    signals,
    metrics: {
      fundingRate,
      fundingRatePct: Number.isFinite(fundingRate) ? round(fundingRate * 100, 6) : null,
      accountLongShortRatio: accountRatio,
      topTraderPositionLongShortRatio: topPositionRatio,
      takerBuySellRatio15m: takerRatio,
      openInterestChange15mPct: oi15m,
      openInterestChange1hPct: oi1h,
    },
    identityWarning: "Exchange positioning and large-trade fields are crowding proxies, not exact whale account positions.",
  };
}

function largeParticipantFootprint(direction, asset) {
  const large = asset?.capitalFlow?.largeTrades?.largeTrades || {};
  const net = finite(large.netFlowUsdEstimate);
  const buy = finite(large.buyUsdEstimate, 0);
  const sell = finite(large.sellUsdEstimate, 0);
  const total = buy + sell;
  const directionalShare = total > 0 ? (direction === "LONG" ? buy : sell) / total : null;
  const adverseShare = Number.isFinite(directionalShare) ? 1 - directionalShare : null;
  return {
    status: Number.isFinite(net) && total > 0 ? "ok" : "unavailable",
    classification: !Number.isFinite(directionalShare) ? "UNKNOWN" : directionalShare >= 0.62 ? "SUPPORTIVE" : adverseShare >= 0.62 ? "ADVERSE" : "MIXED",
    directionalSharePct: Number.isFinite(directionalShare) ? round(directionalShare * 100, 3) : null,
    netFlowUsdEstimate: net,
    sampleNotionalUsdEstimate: total > 0 ? round(total, 2) : null,
    identityWarning: "This is a percentile-based large taker-trade footprint, not proof of a named institution or whale position.",
  };
}

function buildMarketLiquidityContext(asset) {
  const timeframe = asset?.timeframes?.["15m"];
  const rows = confirmedRecentCandles(timeframe, 24);
  const atrValue = finite(timeframe?.indicators?.atr14);
  const tolerance = Number.isFinite(atrValue) ? Math.max(atrValue * 0.12, finite(asset?.ticker?.last, 0) * 0.0005) : 0;
  const lows = clusteredLiquidityLevels(rows.map((candle) => finite(candle.l)), tolerance).slice(0, 4);
  const highs = clusteredLiquidityLevels(rows.map((candle) => finite(candle.h)), tolerance).slice(0, 4);
  return {
    status: rows.length >= 14 && Number.isFinite(atrValue) ? "ok" : "partial",
    source: "CLOSED_15M_CANDLES_PLUS_FREE_DERIVATIVES_PROXIES",
    visibleLiquidityPools: { equalLowClusters: lows, equalHighClusters: highs, tolerance: round(tolerance, 8) },
    recentSweep: detectRecentLiquiditySweep(timeframe),
    crowding: { long: directionalCrowding("LONG", asset), short: directionalCrowding("SHORT", asset) },
    largeParticipantFootprint: {
      long: largeParticipantFootprint("LONG", asset),
      short: largeParticipantFootprint("SHORT", asset),
    },
    realizedLiquidationRisk: asset?.liquidationRiskProxy || errorModule("Realized-liquidation proxy unavailable"),
    policy: {
      exactWhalePositionsAvailable: false,
      inferredPsychologyOnly: true,
      standaloneDirectionSignal: false,
      noFutureData: true,
    },
  };
}

function buildEstimatedLiquidationPressureZones(asset) {
  const price = finite(asset?.ticker?.last);
  const atr15 = finite(asset?.timeframes?.["15m"]?.indicators?.atr14);
  const pools = asset?.liquidityRisk?.visibleLiquidityPools || {};
  const oi15m = finite(asset?.derivatives?.openInterest?.change15mPct);
  const realized = asset?.liquidationRiskProxy || {};
  if (!Number.isFinite(price) || !Number.isFinite(atr15) || atr15 <= 0) {
    return { status: "unavailable", reason: "Execution price or 15m ATR unavailable", permissions: { futureLiquidationMap: false, exactLiquidationPrices: false } };
  }
  const clusterLevels = [
    ...(Array.isArray(pools.equalLowClusters) ? pools.equalLowClusters.map((row) => ({ price: finite(row?.price), evidence: "EQUAL_LOW_CLUSTER" })) : []),
    ...(Array.isArray(pools.equalHighClusters) ? pools.equalHighClusters.map((row) => ({ price: finite(row?.price), evidence: "EQUAL_HIGH_CLUSTER" })) : []),
  ]
    .filter((row) => Number.isFinite(row.price))
    .map((row) => ({ ...row, side: row.price < price ? "DOWNSIDE" : "UPSIDE" }));
  const volatilityLevels = [0.5, 1, 1.5].flatMap((multiple) => [
    { side: "DOWNSIDE", price: price - atr15 * multiple, evidence: `${multiple}_ATR_FROM_LAST` },
    { side: "UPSIDE", price: price + atr15 * multiple, evidence: `${multiple}_ATR_FROM_LAST` },
  ]).filter((row) => row.price > 0);
  const zones = [...clusterLevels, ...volatilityLevels]
    .map((row) => ({ ...row, price: round(row.price, 8), distancePct: round(Math.abs(row.price - price) / price * 100, 4) }))
    .sort((a, b) => a.distancePct - b.distancePct)
    .slice(0, 10);
  return {
    status: zones.length ? "ok" : "partial",
    source: "STRUCTURE_ATR_OI_AND_REALIZED_LIQUIDATION_MODEL",
    scope: "ESTIMATED_PRESSURE_ZONES_NOT_FUTURE_LIQUIDATION_MAP",
    zones,
    context: {
      openInterestChange15mPct: Number.isFinite(oi15m) ? round(oi15m, 5) : null,
      realizedLiquidationIntensity: realized.intensity || "UNKNOWN",
      realizedLiquidationClassification: realized.riskClassification || "UNKNOWN",
    },
    permissions: {
      futureLiquidationMap: false,
      exactLiquidationPrices: false,
      exactLeverageDistribution: false,
      standaloneDirection: false,
      createSetup: false,
      hardBlockerByItself: false,
    },
    limitation: "These are estimated pressure zones derived from visible structure, ATR, OI and already-realized liquidations. They are not exchange account liquidation prices or a full-market future liquidation heatmap.",
  };
}

function buildLargeParticipantProxy(asset) {
  const derivative = asset?.capitalFlow?.largeTrades || {};
  const spot = asset?.spotMarket?.recentTakerFlow || {};
  const orderBook = asset?.capitalFlow?.orderBook || {};
  const derivativeNet = finite(derivative?.largeTrades?.netFlowUsdEstimate);
  const spotNet = finite(spot?.takerDeltaUsd);
  const bookImbalance = finite(orderBook?.imbalancePct);
  const available = [derivativeNet, spotNet, bookImbalance].filter(Number.isFinite).length;
  const score = (Number.isFinite(derivativeNet) ? Math.sign(derivativeNet) : 0)
    + (Number.isFinite(spotNet) ? Math.sign(spotNet) : 0)
    + (Number.isFinite(bookImbalance) && Math.abs(bookImbalance) >= 8 ? Math.sign(bookImbalance) : 0);
  return {
    status: available >= 2 ? "ok" : available ? "partial" : "unavailable",
    source: "OBSERVED_LARGE_TAKER_TRADES_PLUS_SPOT_FLOW_AND_ORDER_BOOK",
    classification: score >= 2 ? "BUY_SIDE_FOOTPRINT" : score <= -2 ? "SELL_SIDE_FOOTPRINT" : "MIXED_OR_INCONCLUSIVE",
    evidence: {
      derivativeLargeTakerNetUsdEstimate: Number.isFinite(derivativeNet) ? round(derivativeNet, 2) : null,
      okxSpotRecentTakerDeltaUsd: Number.isFinite(spotNet) ? round(spotNet, 2) : null,
      derivativeOrderBookImbalancePct: Number.isFinite(bookImbalance) ? round(bookImbalance, 4) : null,
    },
    permissions: { exactWhalePositions: false, walletIdentity: false, standaloneDirection: false, createSetup: false },
    limitation: "Observed market footprint only. Public feeds do not identify exact whale accounts, average entry, leverage or liquidation price.",
  };
}

function buildEffortVsResult(asset) {
  const tf15 = asset?.timeframes?.["15m"];
  const rows = confirmedRecentCandles(tf15, 12);
  const flow15 = asset?.capitalFlow?.periods?.["15m"] || {};
  const netFlow = finite(flow15.activeNetFlowUsdEstimate);
  const buyUsd = finite(flow15.activeBuyUsdEstimate);
  const sellUsd = finite(flow15.activeSellUsdEstimate);
  const atrValue = finite(tf15?.indicators?.atr14);
  const start = finite(rows[0]?.c);
  const end = finite(rows.at(-1)?.c);
  const priceChange = Number.isFinite(start) && Number.isFinite(end) ? end - start : null;
  const priceResultAtr = Number.isFinite(priceChange) && Number.isFinite(atrValue) && atrValue > 0 ? priceChange / atrValue : null;
  const totalAggression = Number.isFinite(buyUsd) && Number.isFinite(sellUsd) ? buyUsd + sellUsd : null;
  const imbalanceShare = Number.isFinite(netFlow) && Number.isFinite(totalAggression) && totalAggression > 0 ? netFlow / totalAggression : null;
  if (![netFlow, priceResultAtr, imbalanceShare].every(Number.isFinite)) {
    return { status: "unavailable", classification: "UNKNOWN", reason: "Taker-flow or confirmed price-response data unavailable" };
  }
  const strongBuyEffort = imbalanceShare >= 0.12;
  const strongSellEffort = imbalanceShare <= -0.12;
  const poorUpResult = priceResultAtr <= 0.2;
  const poorDownResult = priceResultAtr >= -0.2;
  const classification = strongSellEffort && poorDownResult
    ? "SELL_ABSORPTION_CANDIDATE"
    : strongBuyEffort && poorUpResult
      ? "BUY_ABSORPTION_CANDIDATE"
      : "EFFORT_AND_RESULT_ALIGNED_OR_INCONCLUSIVE";
  return {
    status: "ok",
    source: "GATE_TAKER_FLOW_PLUS_CONFIRMED_15M_PRICE_RESPONSE",
    classification,
    activeNetFlowUsdEstimate: round(netFlow, 2),
    aggressionImbalancePct: round(imbalanceShare * 100, 4),
    priceChangeAtr: round(priceResultAtr, 4),
    windowStartAt: rows[0]?.ts || null,
    windowEndAt: rows.at(-1)?.ts || null,
    standaloneSignal: false,
    limitation: "Candidate confirmation only; it cannot create direction, a setup or an entry without meaningful structure.",
  };
}

function buildMarketRegimeRouter(asset) {
  const tf4h = asset?.timeframes?.["4h"];
  const tf1h = asset?.timeframes?.["1h"];
  const tf15 = asset?.timeframes?.["15m"];
  if (![tf4h, tf1h, tf15].every((timeframe) => timeframe?.status === "ok")) {
    return { status: "unavailable", regime: "UNKNOWN", directSubmodels: [], watchSubmodels: [], reason: "Required 4H/1H/15M structure is unavailable", standaloneSignal: false };
  }
  const adx1h = finite(tf1h?.indicators?.adx14);
  const adx15m = finite(tf15?.indicators?.adx14);
  const fourHourRange = tf4h.structure === "RANGE";
  const oneHourRange = tf1h.structure === "RANGE";
  const compressed = fourHourRange && oneHourRange && Number.isFinite(adx1h) && Number.isFinite(adx15m) && adx1h < 20 && adx15m < 18;
  const fourHourUp = ["UP", "STRONG_UP"].includes(tf4h.trend) || tf4h.structure === "HH_HL";
  const fourHourDown = ["DOWN", "STRONG_DOWN"].includes(tf4h.trend) || tf4h.structure === "LH_LL";
  const oneHourOpposes = fourHourUp
    ? ["DOWN", "STRONG_DOWN"].includes(tf1h.trend) && tf1h.structure === "LH_LL"
    : fourHourDown
      ? ["UP", "STRONG_UP"].includes(tf1h.trend) && tf1h.structure === "HH_HL"
      : false;
  const regime = compressed
    ? "COMPRESSION"
    : fourHourRange && oneHourRange
      ? "RANGE"
      : (fourHourUp || fourHourDown) && !oneHourOpposes
        ? "TREND"
        : "TRANSITION";
  const entries = Object.entries(SUBMODEL_DEFINITIONS);
  const directSubmodels = entries.filter(([, definition]) => definition.directRegimes.includes(regime)).map(([key]) => key);
  const watchSubmodels = entries.filter(([, definition]) => (definition.watchRegimes || []).includes(regime)).map(([key]) => key);
  return {
    status: "ok",
    source: "CONFIRMED_4H_1H_15M_STRUCTURE_ADX_ROUTER",
    regime,
    directSubmodels,
    watchSubmodels,
    permission: directSubmodels.length ? "EVALUATE_DIRECT_MODELS" : watchSubmodels.length ? "WAIT_FOR_COMPLETION" : "NO_TRADE",
    evidence: { trend4h: tf4h.trend, structure4h: tf4h.structure, trend1h: tf1h.trend, structure1h: tf1h.structure, adx1h: Number.isFinite(adx1h) ? round(adx1h, 4) : null, adx15m: Number.isFinite(adx15m) ? round(adx15m, 4) : null },
    eventAndLiquidityOverrideRequired: true,
    standaloneSignal: false,
    limitation: "Technical router only. News, exchange anomalies and execution liquidity can still downgrade or veto every submodel.",
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

function indexedSwings(candles, left = 2, right = 2) {
  const highs = [];
  const lows = [];
  for (let i = left; i < candles.length - right; i += 1) {
    const window = candles.slice(i - left, i + right + 1);
    if (window.every((c, j) => j === left || candles[i].high >= c.high)) highs.push({ index: i, price: candles[i].high, ts: candles[i].ts });
    if (window.every((c, j) => j === left || candles[i].low <= c.low)) lows.push({ index: i, price: candles[i].low, ts: candles[i].ts });
  }
  return { highs, lows };
}

function volumeProfile(candles, binCount = 32) {
  const rows = candles.filter((candle) => candle?.confirmed === true && Number.isFinite(finite(candle.volumeBase, finite(candle.volumeContracts))));
  if (rows.length < 30) return errorModule("Insufficient confirmed candles for volume-profile estimate");
  const low = Math.min(...rows.map((candle) => candle.low));
  const high = Math.max(...rows.map((candle) => candle.high));
  const width = (high - low) / binCount;
  if (!Number.isFinite(width) || width <= 0) return errorModule("Invalid price range for volume-profile estimate");
  const bins = Array.from({ length: binCount }, (_, index) => ({
    index,
    low: low + index * width,
    high: low + (index + 1) * width,
    volume: 0,
  }));
  for (const candle of rows) {
    const typical = (candle.high + candle.low + candle.close) / 3;
    const index = Math.min(binCount - 1, Math.max(0, Math.floor((typical - low) / width)));
    bins[index].volume += Math.max(0, finite(candle.volumeBase, finite(candle.volumeContracts, 0)));
  }
  const totalVolume = bins.reduce((sum, bin) => sum + bin.volume, 0);
  if (!totalVolume) return errorModule("No usable volume for volume-profile estimate");
  const pocIndex = bins.reduce((best, bin) => bin.volume > bins[best].volume ? bin.index : best, 0);
  const selected = new Set([pocIndex]);
  let selectedVolume = bins[pocIndex].volume;
  let left = pocIndex - 1;
  let right = pocIndex + 1;
  while (selectedVolume / totalVolume < 0.7 && (left >= 0 || right < bins.length)) {
    const leftVolume = left >= 0 ? bins[left].volume : -1;
    const rightVolume = right < bins.length ? bins[right].volume : -1;
    if (rightVolume > leftVolume) { selected.add(right); selectedVolume += Math.max(0, rightVolume); right += 1; }
    else { selected.add(left); selectedVolume += Math.max(0, leftVolume); left -= 1; }
  }
  const selectedIndexes = [...selected].sort((a, b) => a - b);
  const midpoint = (bin) => round((bin.low + bin.high) / 2, 8);
  const rankedHigh = [...bins].sort((a, b) => b.volume - a.volume).slice(0, 3);
  const rankedLow = [...bins].filter((bin) => bin.volume > 0).sort((a, b) => a.volume - b.volume).slice(0, 3);
  return {
    status: "ok",
    source: "CANDLE_TYPICAL_PRICE_VOLUME_BIN_ESTIMATE",
    exactExchangeVolumeProfile: false,
    lookbackCandles: rows.length,
    binCount,
    valueAreaPct: 70,
    poc: midpoint(bins[pocIndex]),
    vah: midpoint(bins[selectedIndexes.at(-1)]),
    val: midpoint(bins[selectedIndexes[0]]),
    hvn: rankedHigh.map((bin) => ({ price: midpoint(bin), sharePct: round(bin.volume / totalVolume * 100, 4) })),
    lvn: rankedLow.map((bin) => ({ price: midpoint(bin), sharePct: round(bin.volume / totalVolume * 100, 4) })),
    limitation: "Estimated from candle volume assigned to typical-price bins; not tick-level traded volume at price.",
  };
}

function structureDetail(candles, atrValue) {
  const rows = candles.filter((candle) => candle?.confirmed === true).slice(-100);
  if (rows.length < 20) return errorModule("Insufficient confirmed candles for structure detail");
  const swings = indexedSwings(rows);
  const latest = rows.at(-1);
  const controlHigh = swings.highs.at(-1) || null;
  const controlLow = swings.lows.at(-1) || null;
  const lastTwoHighs = swings.highs.slice(-2);
  const lastTwoLows = swings.lows.slice(-2);
  const baseStructure = lastTwoHighs.length >= 2 && lastTwoLows.length >= 2
    ? lastTwoHighs[1].price > lastTwoHighs[0].price && lastTwoLows[1].price > lastTwoLows[0].price
      ? "HH_HL"
      : lastTwoHighs[1].price < lastTwoHighs[0].price && lastTwoLows[1].price < lastTwoLows[0].price
        ? "LH_LL"
        : "RANGE"
    : "RANGE";
  const upwardBreak = controlHigh && latest.close > controlHigh.price;
  const downwardBreak = controlLow && latest.close < controlLow.price;
  const breakDistance = upwardBreak ? latest.close - controlHigh.price : downwardBreak ? controlLow.price - latest.close : 0;
  const meaningful = Boolean((upwardBreak || downwardBreak) && Number.isFinite(atrValue) && atrValue > 0 && breakDistance >= atrValue * 0.15);
  const event = upwardBreak
    ? baseStructure === "LH_LL" ? "BULLISH_CHOCH_CANDIDATE" : "BULLISH_BOS_CANDIDATE"
    : downwardBreak
      ? baseStructure === "HH_HL" ? "BEARISH_CHOCH_CANDIDATE" : "BEARISH_BOS_CANDIDATE"
      : "NONE";
  return {
    status: "ok",
    source: "CONFIRMED_CANDLE_SWING_CANDIDATE",
    baseStructure,
    event,
    meaningfulCandidate: meaningful,
    internalStructureWarning: event !== "NONE" && !meaningful,
    latestConfirmedAt: latest.ts,
    latestConfirmedClose: round(latest.close, 8),
    controlHigh: controlHigh ? { price: round(controlHigh.price, 8), ts: controlHigh.ts } : null,
    controlLow: controlLow ? { price: round(controlLow.price, 8), ts: controlLow.ts } : null,
    protectiveLowCandidate: swings.lows.at(-1) ? { price: round(swings.lows.at(-1).price, 8), ts: swings.lows.at(-1).ts } : null,
    protectiveHighCandidate: swings.highs.at(-1) ? { price: round(swings.highs.at(-1).price, 8), ts: swings.highs.at(-1).ts } : null,
    limitation: "Candidate only. GPT must verify location, acceptance/rejection and whether the swing meaningfully controls the setup.",
  };
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
  const confirmed = candles.filter((candle) => candle?.confirmed === true);
  const currentStructure = structure(confirmed);
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
    structureDetail: structureDetail(candles, a14),
    volumeProfile: volumeProfile(candles),
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

function parseOkxSpotMarket(tickerRows, tradesRows, bookRows, instrumentId) {
  const ticker = (Array.isArray(tickerRows) ? tickerRows : []).find((row) => row?.instId === instrumentId);
  const last = finite(ticker?.last);
  const tickerTs = finite(ticker?.ts);
  if (!Number.isFinite(last) || last <= 0 || !Number.isFinite(tickerTs)) throw new Error(`OKX spot ticker unavailable for ${instrumentId}`);
  const tickerAgeSeconds = Math.max(0, (Date.now() - tickerTs) / 1000);
  if (tickerAgeSeconds > 35) throw new Error(`OKX spot ticker stale for ${instrumentId}`);

  const trades = (Array.isArray(tradesRows) ? tradesRows : []).map((row) => {
    const price = finite(row?.px);
    const size = finite(row?.sz);
    const timestampMs = finite(row?.ts);
    const side = String(row?.side || "").toLowerCase();
    return { tradeId: String(row?.tradeId || ""), side, price, size, timestampMs, notionalUsd: Number.isFinite(price) && Number.isFinite(size) ? price * size : null };
  }).filter((row) => ["buy", "sell"].includes(row.side) && Number.isFinite(row.notionalUsd) && row.notionalUsd > 0 && Number.isFinite(row.timestampMs));
  const buyUsd = trades.filter((row) => row.side === "buy").reduce((sum, row) => sum + row.notionalUsd, 0);
  const sellUsd = trades.filter((row) => row.side === "sell").reduce((sum, row) => sum + row.notionalUsd, 0);
  const tradeTotal = buyUsd + sellUsd;
  const newestTradeTs = trades.length ? Math.max(...trades.map((row) => row.timestampMs)) : null;
  const oldestTradeTs = trades.length ? Math.min(...trades.map((row) => row.timestampMs)) : null;
  const newestTradeAgeSeconds = Number.isFinite(newestTradeTs) ? Math.max(0, (Date.now() - newestTradeTs) / 1000) : Infinity;

  const book = Array.isArray(bookRows) ? bookRows[0] : null;
  const parseLevels = (levels) => (Array.isArray(levels) ? levels : []).map((row) => {
    const price = finite(row?.[0]);
    const size = finite(row?.[1]);
    return { price, size, notionalUsd: Number.isFinite(price) && Number.isFinite(size) ? price * size : null };
  }).filter((row) => Number.isFinite(row.notionalUsd) && row.notionalUsd > 0);
  const bids = parseLevels(book?.bids);
  const asks = parseLevels(book?.asks);
  const bidDepth = bids.reduce((sum, row) => sum + row.notionalUsd, 0);
  const askDepth = asks.reduce((sum, row) => sum + row.notionalUsd, 0);
  const totalDepth = bidDepth + askDepth;
  const bestBid = bids[0]?.price;
  const bestAsk = asks[0]?.price;
  const midpoint = Number.isFinite(bestBid) && Number.isFinite(bestAsk) ? (bestBid + bestAsk) / 2 : null;
  const bookTimestamp = finite(book?.ts);
  const bookAgeSeconds = Number.isFinite(bookTimestamp) ? Math.max(0, (Date.now() - bookTimestamp) / 1000) : Infinity;
  const sampleFresh = newestTradeAgeSeconds <= 60;
  const bookFresh = bookAgeSeconds <= 35;

  return {
    status: trades.length >= 10 && bids.length && asks.length && sampleFresh && bookFresh ? "ok" : "partial",
    source: "OKX_SPOT_PUBLIC",
    instrumentId,
    ticker: {
      last: round(last, 8),
      bid: round(finite(ticker?.bidPx), 8),
      ask: round(finite(ticker?.askPx), 8),
      volume24hBase: round(finite(ticker?.vol24h), 4),
      volume24hQuote: round(finite(ticker?.volCcy24h), 2),
      exchangeTimestamp: new Date(tickerTs).toISOString(),
      ageSeconds: round(tickerAgeSeconds, 3),
    },
    recentTakerFlow: {
      definition: "ACTUAL_OKX_SPOT_RECENT_TRADES_WINDOW_NOT_PERSISTENT_CVD",
      sampleTradeCount: trades.length,
      sampleStartAt: Number.isFinite(oldestTradeTs) ? new Date(oldestTradeTs).toISOString() : null,
      sampleEndAt: Number.isFinite(newestTradeTs) ? new Date(newestTradeTs).toISOString() : null,
      newestTradeAgeSeconds: Number.isFinite(newestTradeAgeSeconds) ? round(newestTradeAgeSeconds, 3) : null,
      coverageSeconds: Number.isFinite(oldestTradeTs) && Number.isFinite(newestTradeTs) ? round((newestTradeTs - oldestTradeTs) / 1000, 3) : null,
      takerBuyUsd: round(buyUsd, 2),
      takerSellUsd: round(sellUsd, 2),
      takerDeltaUsd: round(buyUsd - sellUsd, 2),
      takerBuySharePct: tradeTotal > 0 ? round(buyUsd / tradeTotal * 100, 4) : null,
      isTrueCvd: false,
      limitation: "Real OKX spot trades for the returned sample window. It is not a persistent historical Spot CVD series.",
    },
    orderBook: {
      depthLevelsPerSide: Math.min(bids.length, asks.length),
      bidDepthUsd: round(bidDepth, 2),
      askDepthUsd: round(askDepth, 2),
      imbalancePct: totalDepth > 0 ? round((bidDepth - askDepth) / totalDepth * 100, 4) : null,
      bestBid: round(bestBid, 8),
      bestAsk: round(bestAsk, 8),
      spreadBps: midpoint ? round((bestAsk - bestBid) / midpoint * 10_000, 4) : null,
      exchangeTimestamp: Number.isFinite(bookTimestamp) ? new Date(bookTimestamp).toISOString() : null,
      ageSeconds: Number.isFinite(bookAgeSeconds) ? round(bookAgeSeconds, 3) : null,
    },
    permissions: { standaloneDirection: false, createSetup: false, exactWhaleIdentity: false },
  };
}

function parseOkxIndexPrice(rows, symbol) {
  const instId = symbol === "BTCUSDT" ? "BTC-USDT" : "ETH-USDT";
  const row = (Array.isArray(rows) ? rows : []).find((item) => item?.instId === instId);
  const price = finite(row?.idxPx);
  const timestamp = finite(row?.ts);
  if (!row || !Number.isFinite(price) || price <= 0 || !Number.isFinite(timestamp)) throw new Error(`OKX index price unavailable for ${instId}`);
  const ageSeconds = Math.max(0, (Date.now() - timestamp) / 1000);
  if (ageSeconds > 60) throw new Error(`OKX index price stale for ${instId}`);
  return {
    status: "ok",
    source: "OKX_INDEX_TICKER",
    instrumentId: instId,
    price: round(price, 8),
    exchangeTimestamp: new Date(timestamp).toISOString(),
    dataFreshness: { state: "live-direct", ageSeconds: round(ageSeconds, 3), storedAt: new Date().toISOString() },
  };
}

async function verifyOkxScannerPrice(symbol) {
  const asset = ASSETS[symbol];
  if (!asset) throw new Error(`Unsupported scanner symbol ${symbol}`);
  const instId = asset.instrumentId;
  const validate = (body) => {
    if (body?.code !== "0" || !Array.isArray(body?.data) || body.data.length === 0) {
      throw new Error(`OKX direct response invalid for ${instId}`);
    }
    return body.data;
  };
  const [tickerRows, markRows] = await Promise.all([
    fetchJson(
      `${OKX_BASE}/api/v5/market/ticker?instId=${encodeURIComponent(instId)}`,
      `OKX direct ticker ${instId}`,
      2,
      true,
      validate,
      3500,
    ),
    fetchJson(
      `${OKX_BASE}/api/v5/public/mark-price?instType=SWAP&instId=${encodeURIComponent(instId)}`,
      `OKX direct mark price ${instId}`,
      2,
      true,
      validate,
      3500,
    ),
  ]);
  const ticker = tickerRows.find((row) => row?.instId === instId);
  const mark = markRows.find((row) => row?.instId === instId);
  if (!ticker || !mark) throw new Error(`OKX exact instrument ${instId} missing from direct response`);
  const last = finite(ticker?.last);
  const markPrice = finite(mark?.markPx);
  const bid = finite(ticker?.bidPx);
  const ask = finite(ticker?.askPx);
  const tickerTs = finite(ticker?.ts);
  const markTs = finite(mark?.ts);
  const checkedAtMs = Date.now();
  const tickerAgeSeconds = Number.isFinite(tickerTs) ? Math.max(0, (checkedAtMs - tickerTs) / 1000) : Infinity;
  const markAgeSeconds = Number.isFinite(markTs) ? Math.max(0, (checkedAtMs - markTs) / 1000) : Infinity;
  if (![last, markPrice, bid, ask].every((value) => Number.isFinite(value) && value > 0)) throw new Error(`OKX direct last/mark/bid/ask missing for ${instId}`);
  if (bid > ask) throw new Error(`OKX direct bid exceeds ask for ${instId}`);
  if (tickerAgeSeconds > 20 || markAgeSeconds > 20) throw new Error(`OKX direct price stale for ${instId}`);
  const deviationPct = Math.abs(last - markPrice) / markPrice * 100;
  if (!Number.isFinite(deviationPct) || deviationPct > 0.35) throw new Error(`OKX direct ticker/mark deviation ${round(deviationPct, 6)}% for ${instId}`);
  const midpoint = (bid + ask) / 2;
  const spreadBps = (ask - bid) / midpoint * 10_000;
  const lastToMidBps = Math.abs(last - midpoint) / midpoint * 10_000;
  if (!Number.isFinite(spreadBps) || spreadBps > 20) throw new Error(`OKX direct spread ${round(spreadBps, 4)}bps is abnormal for ${instId}`);
  if (!Number.isFinite(lastToMidBps) || lastToMidBps > 25) throw new Error(`OKX last/mid deviation ${round(lastToMidBps, 4)}bps is abnormal for ${instId}`);
  const open24h = finite(ticker?.open24h);
  const checkedAt = new Date(checkedAtMs).toISOString();
  return {
    status: "ok",
    source: "OKX_USDT_PERPETUAL_DIRECT_VERIFIED",
    priceType: "LAST_AND_MARK_DIRECT_VERIFIED",
    primaryEndpoint: `/api/v5/market/ticker?instId=${instId}`,
    fallbackEndpoint: null,
    last: round(last, 8),
    markPrice: round(markPrice, 8),
    bid: round(bid, 8),
    ask: round(ask, 8),
    midpoint: round(midpoint, 8),
    spreadBps: round(spreadBps, 4),
    high24h: round(finite(ticker?.high24h), 8),
    low24h: round(finite(ticker?.low24h), 8),
    volume24hContracts: round(finite(ticker?.vol24h), 4),
    change24hPct: open24h ? round(((last - open24h) / open24h) * 100, 4) : null,
    exchangeTimestamp: new Date(tickerTs).toISOString(),
    dataFreshness: { state: "live-direct", ageSeconds: round(tickerAgeSeconds, 3), storedAt: checkedAt },
    verification: {
      passed: true,
      checkedAt,
      deviationPct: round(deviationPct, 6),
      spreadBps: round(spreadBps, 4),
      lastToMidBps: round(lastToMidBps, 4),
      tickerAgeSeconds: round(tickerAgeSeconds, 3),
      markAgeSeconds: round(markAgeSeconds, 3),
    },
  };
}

function priceInsideEntryZone(price, entryZone) {
  return Number.isFinite(price)
    && Number.isFinite(finite(entryZone?.min))
    && Number.isFinite(finite(entryZone?.max))
    && price >= finite(entryZone.min)
    && price <= finite(entryZone.max);
}

async function verifyOkxScannerZone(symbol, entryZone) {
  const first = await verifyOkxScannerPrice(symbol);
  await delay(SCANNER_DOUBLE_SAMPLE_DELAY_MS);
  const second = await verifyOkxScannerPrice(symbol);
  const samples = [first, second].map((sample) => ({
    last: sample.last,
    markPrice: sample.markPrice,
    bid: sample.bid,
    ask: sample.ask,
    midpoint: sample.midpoint,
    exchangeTimestamp: sample.exchangeTimestamp,
    checkedAt: sample.verification?.checkedAt,
    insideEntryZone: priceInsideEntryZone(sample.last, entryZone),
  }));
  const confirmed = samples.every((sample) => sample.insideEntryZone === true);
  return {
    status: "ok",
    passed: true,
    confirmed,
    rule: "TWO_INDEPENDENT_CURRENT_OKX_SAMPLES_INSIDE_ZONE",
    delayMs: SCANNER_DOUBLE_SAMPLE_DELAY_MS,
    entryZone,
    samples,
    current: second,
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
      indexPrice: errorModule("Not loaded"),
      spotMarket: errorModule("Not loaded"),
      timeframes: Object.fromEntries(Object.keys(TIMEFRAMES).map((tf) => [tf, errorModule("Not loaded")])),
      derivatives: { openInterest: errorModule("Not loaded"), funding: errorModule("Not loaded") },
      capitalFlow: errorModule("Not loaded"),
      executionLiquidity: errorModule("Not loaded"),
      liquidationRiskProxy: errorModule("Not loaded"),
    };
  }

  const coinalyzePromise = loadCoinalyzeLiquidations(options.coinalyzeApiKey);

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
    fetchJson(
      `${OKX_BASE}/api/v5/market/index-tickers?quoteCcy=USDT`,
      "OKX index tickers",
      1,
      true,
      (body) => {
        if (body?.code !== "0" || !Array.isArray(body?.data)) throw new Error(`OKX index ${body?.code || "invalid response"}`);
        return body.data;
      },
      3500,
    ),
    okx("/api/v5/market/tickers?instType=SPOT", CACHE_POLICY.okxSpotTicker),
  ]);
  const tickerRows = priceResults[0].status === "fulfilled" ? priceResults[0].value : null;
  const markRows = priceResults[1].status === "fulfilled" ? priceResults[1].value : null;
  const indexRows = priceResults[2].status === "fulfilled" ? priceResults[2].value : null;
  const spotTickerRows = priceResults[3].status === "fulfilled" ? priceResults[3].value : null;
  if (priceResults[0].status === "rejected") supplementalErrors.push({ source: "OKX", module: "tickerBatch", error: priceResults[0].reason?.message || String(priceResults[0].reason) });
  if (priceResults[1].status === "rejected") supplementalErrors.push({ source: "OKX", module: "markPriceBatch", error: priceResults[1].reason?.message || String(priceResults[1].reason) });
  if (priceResults[2].status === "rejected") supplementalErrors.push({ source: "OKX", module: "indexPriceBatch", error: priceResults[2].reason?.message || String(priceResults[2].reason) });
  if (priceResults[3].status === "rejected") supplementalErrors.push({ source: "OKX_SPOT", module: "tickerBatch", error: priceResults[3].reason?.message || String(priceResults[3].reason) });
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
    try {
      assets[symbol].indexPrice = parseOkxIndexPrice(indexRows, symbol);
    } catch (error) {
      assets[symbol].indexPrice = errorModule(error?.message || String(error));
      supplementalErrors.push({ source: "OKX", symbol, module: "indexPrice", error: error?.message || String(error) });
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

  const spotWork = mapLimit(Object.entries(ASSETS), 2, async ([symbol, config]) => {
    try {
      const [trades, book] = await Promise.all([
        okx(`/api/v5/market/trades?instId=${encodeURIComponent(config.spotInstrumentId)}&limit=100`, CACHE_POLICY.okxSpotTrades),
        okx(`/api/v5/market/books?instId=${encodeURIComponent(config.spotInstrumentId)}&sz=20`, CACHE_POLICY.okxSpotBook),
      ]);
      assets[symbol].spotMarket = parseOkxSpotMarket(spotTickerRows, trades, book, config.spotInstrumentId);
    } catch (error) {
      const message = error?.message || String(error);
      assets[symbol].spotMarket = errorModule(message);
      supplementalErrors.push({ source: "OKX_SPOT", symbol, module: "spotMarket", error: message });
    }
  });

  const derivativeDefinitions = [
    { type: "openInterestBatch", path: "/api/v5/public/open-interest?instType=SWAP", policy: CACHE_POLICY.openInterest },
    ...Object.entries(ASSETS).map(([symbol, config]) => ({ symbol, type: "funding", path: `/api/v5/public/funding-rate?instId=${config.instrumentId}`, policy: CACHE_POLICY.funding })),
    ...Object.entries(ASSETS).map(([symbol, config]) => ({ symbol, type: "openInterestHistory", path: `/api/v5/rubik/stat/contracts/open-interest-history?instId=${config.instrumentId}&period=5m&limit=20`, policy: CACHE_POLICY.openInterestHistory })),
  ];
  const derivativeWork = Promise.allSettled(derivativeDefinitions.map((item) => okx(item.path, item.policy)));
  const capitalFlowEntries = Object.entries(ASSETS);
  const [, derivativeResults] = await Promise.all([Promise.all([candleWork, spotWork]), derivativeWork]);
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

  const coinalyze = await coinalyzePromise;
  if (coinalyze.configured && coinalyze.status !== "ok") {
    supplementalErrors.push({ source: "COINALYZE_FREE_API", module: "realizedLiquidations", error: coinalyze.reason || "Unavailable" });
  }

  for (const [symbol, asset] of Object.entries(assets)) {
    for (const type of ["openInterest", "funding"]) {
      if (asset.derivatives[type].status !== "ok") {
        const message = `No usable ${type} source`;
        asset.derivatives[type] = errorModule(message);
        errors.push({ symbol, module: type, timeframe: null, error: message });
      }
    }
    asset.executionLiquidity = buildExecutionLiquidity(asset);
    asset.liquidationRiskProxy = buildLiquidationRiskProxy(asset, coinalyze.assets?.[symbol]);
    asset.liquidityRisk = buildMarketLiquidityContext(asset);
    asset.estimatedLiquidationPressureZones = buildEstimatedLiquidationPressureZones(asset);
    asset.largeParticipantProxy = buildLargeParticipantProxy(asset);
    asset.effortVsResult = buildEffortVsResult(asset);
    asset.marketRegimeRouter = buildMarketRegimeRouter(asset);
    asset.dataGaps = {
      spotCvd: asset.spotMarket?.status === "ok"
        ? { status: "proxy_available", reason: "Real OKX spot trades and sample-window taker delta are available, but this is not a persistent historical Spot CVD series." }
        : { status: "unavailable", reason: "OKX spot trades are unavailable; no other flow is relabeled as Spot CVD." },
      perpetualCvd: { status: "proxy_available", reason: "Real Gate perpetual taker flow is available for its returned window, but it is not relabeled as a persistent multi-exchange Perpetual CVD series." },
      globalLiquidationMap: { status: "unavailable", reason: "A realized-liquidation risk proxy is available, but it is not a future-price liquidation map and must not be presented as one." },
      futureLiquidationLevels: { status: "unavailable", reason: "Free public data does not reveal exact future liquidation clusters across the whole market." },
      exactWhalePositions: { status: "unavailable", reason: "Public data cannot identify exact whale account holdings." },
      newsAndMacro: { status: "external_research_required", reason: "GPT must verify current official/news sources separately before a final trade decision." },
    };
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
  const perpetualStructureReady = Object.values(assets).every((asset) =>
    Object.values(asset.timeframes).every((tf) => tf.status === "ok" && tf.source === "GATE_USDT_PERPETUAL" && tf.quality?.passed === true),
  );
  const criticalReady = Object.values(assets).every((asset) =>
    asset.ticker.status === "ok" &&
    Object.values(asset.timeframes).every((tf) => tf.status === "ok" && tf.quality?.passed === true) &&
    asset.derivatives.openInterest.status === "ok" &&
    asset.derivatives.funding.status === "ok",
  ) && executionPriceReady && semanticQualityReady;
  const capitalFlowReady = Object.fromEntries(Object.entries(assets).map(([symbol, asset]) => [symbol, asset.capitalFlow.status === "ok"]));
  const capitalFlowAvailable = Object.values(assets).filter((asset) => asset.capitalFlow.status !== "unavailable").length;
  const coinalyzeAssetStatus = Object.fromEntries(Object.keys(ASSETS).map((symbol) => [symbol, {
    status: coinalyze.assets?.[symbol]?.status || "unavailable",
    quality: coinalyze.assets?.[symbol]?.quality || null,
  }]));
  const coinalyzeEffectiveStatus = !coinalyze.configured ? "not_configured"
    : Object.values(coinalyzeAssetStatus).every((item) => item.status === "ok") ? "ok"
      : coinalyze.status === "unavailable" ? "unavailable" : "partial_fallback_active";

  return {
    status: criticalReady ? "ok" : "partial",
    decisionState: criticalReady ? "DATA_READY" : "DATA_BLOCKED",
    build: BUILD,
    apiVersion: API_VERSION,
    generatedAt: new Date().toISOString(),
    timezone: "UTC",
    source: "OKX USDT perpetual execution/index/mark price/OI/funding plus OKX spot ticker/order book/recent trades; Gate USDT perpetual primary candles/free auxiliary capital flow; optional Coinalyze free realized-liquidation history; Kraken Spot emergency structure fallback",
    dataProviders: {
      coinalyze: {
        configured: coinalyze.configured,
        status: coinalyzeEffectiveStatus,
        reason: coinalyze.reason || null,
        requestSymbolCount: coinalyze.requestSymbolCount || 0,
        assets: coinalyzeAssetStatus,
      },
    },
    requestBudget: {
      plannedOkx: 13,
      plannedUpstreamFetches: coinalyze.configured ? 27 : 25,
      plannedCloudflareSubrequestsCold: coinalyze.configured ? 29 : 27,
      maximumCloudflareSubrequestsWithAllFallbacksAndRetries: 45,
      cloudflareFreeLimit: 50,
      persistentPerModuleCache: "GATE_KRAKEN_AND_OPTIONAL_COINALYZE; OKX_USES_MEMORY_PLUS_ROUTE_CACHE_TO_PROTECT_FREE_SUBREQUEST_BUDGET",
      coinalyzeConfigured: coinalyze.configured,
      coinalyzeProviderCallUnits: coinalyze.requestSymbolCount || 0,
    },
    reliability: {
      okxConcurrency: MAX_OKX_CONCURRENCY,
      persistentRouteCache: true,
      staleOnError: true,
      exactExecutionPriceMaxAgeSeconds: 35,
      openNowRequiresPerpetualStructureSource: true,
      candleQualityGate: { maxPriceDeviationPct: 0.75, minimumNonZeroVolumeRatio: 0.8, minimumContinuityRatio: 0.95 },
      capitalFlowPolicy: "Gate single-exchange estimate, confirmation only, never a standalone trigger or DATA_READY blocker",
      liquidityRiskPolicy: "Closed-candle sweep/reclaim, visible stop-pool proximity, quantified crowding and large-taker footprints are veto/context layers; no exact whale identity is claimed",
      liquidationRiskProxyPolicy: "Optional Coinalyze realized-liquidation history with Gate fallback; never a future liquidation map, direction engine, setup creator or DATA_READY blocker",
    },
    analysisContract: {
      decisionOrder: ["DATA_TRUTH", "STRUCTURE", "MODEL", "LOCATION", "TRIGGER", "CONFIRMATION", "BTC_ENVIRONMENT", "EXECUTION", "HARD_BLOCKER", "RR_RISK", "FINAL_DECISION"],
      allowedModels: {
        priority: ["MODEL_A_TREND_PULLBACK", "MODEL_B_BREAKOUT_RETEST_CONTINUATION", "MODEL_C_LIQUIDITY_SWEEP_REVERSAL"],
        submodels: SUBMODEL_DEFINITIONS,
        noModelPolicy: "NO_MODEL_EQUALS_NO_TRADE",
        confirmationCannotCreateModel: true,
      },
      marketRegimeRouter: {
        regimes: ["TREND", "RANGE", "COMPRESSION", "TRANSITION"],
        eventRiskAndAbnormalLiquidity: "HARD_BLOCKER_OVERRIDE",
        policy: "The router selects which A/B/C submodels may be evaluated; it never creates direction or bypasses structure.",
      },
      stateMapping: {
        courseStates: ["LONG", "SHORT", "WAIT", "NO_TRADE"],
        operational: { OPEN_NOW: "LONG_OR_SHORT", ARMED: "WAIT", NO_TRADE: "NO_TRADE", DATA_BLOCKED: "NO_TRADE_WITH_DATA_GAP" },
      },
      legacyConfig: LEGACY_CONFIG,
      timeframeFramework: {
        defaultHorizon: "FLEXIBLE_NOT_MECHANICALLY_SHORT_TERM",
        marketTrendAndEnvironment: "4H",
        structureAndDirectionValidity: "1H",
        entryLocationAndTrigger: "15M",
        btcRole: "ETH_ENVIRONMENT_FILTER",
        dailyDataPolicy: "MISSING_1D_ALONE_MUST_NOT_CAUSE_DATA_BLOCKED_UNLESS_USER_EXPLICITLY_REQUESTS_LONGER_HORIZON",
      },
      newsResearchContract: {
        requiredEveryTradingAnalysis: ["JIN10", "COINDESK"],
        primaryOfficialSources: ["FEDERAL_RESERVE", "BLS", "BEA", "SEC", "CFTC"],
        secondaryVerification: ["REUTERS"],
        policy: [
          "Search current relevant news and upcoming event windows before the final plan",
          "Distinguish publication time from event time and cite direct sources",
          "If Jin10 or CoinDesk is unavailable, state that explicitly instead of inventing a result",
          "News is a risk filter and must not replace live market structure",
        ],
      },
      microstructureContract: {
        executionPrimary: "OKX_BID_ASK_MARK_PRICE",
        auxiliary: ["OKX_SPOT_RECENT_TRADES_AND_BOOK", "GATE_ORDER_BOOK_DEPTH", "GATE_LARGE_TAKER_TRADES", "GATE_ACTIVE_FLOW", "COINALYZE_REALIZED_LIQUIDATIONS_OPTIONAL"],
        liquidityProtection: ["CLOSED_15M_SWEEP_RECLAIM", "VISIBLE_EQUAL_HIGH_LOW_POOLS", "ESTIMATED_PRESSURE_ZONES_NOT_FUTURE_MAP", "REALIZED_LIQUIDATION_RISK_PROXY", "QUANTIFIED_CROWDING", "REPEATED_FAILURE_ZONE_COOLDOWN"],
        exactWhaleAccountPositionsClaimed: false,
        standaloneSignal: false,
        automaticOrderPlacement: false,
      },
      validationGovernance: {
        requiredAudits: ["LOOKAHEAD_BIAS", "RECURSIVE_INDICATOR_STABILITY", "WALK_FORWARD_OUT_OF_SAMPLE", "FILL_FEE_SLIPPAGE_FUNDING_REALITY", "PARAMETER_STABILITY", "REGIME_AND_SUBMODEL_DRIFT"],
        promotionPath: ["RESEARCH", "OUT_OF_SAMPLE", "FORWARD_TEST", "SMALL_SIZE_LIVE", "FORMAL_RULE"],
        policy: "AI or external strategies remain shadow evidence until regime-specific out-of-sample, forward and small-live results improve expectancy or drawdown; they cannot create direction or a fourth model.",
      },
      executionRealityContract: {
        directionAwareRiskReward: true,
        firstTargetMustRemainAheadOfCurrentPrice: true,
        stopMustRemainOnInvalidationSide: true,
        costsIncluded: ["FEES", "SLIPPAGE", "FUNDING"],
        costStressMultiplier: 1.5,
        optimisticSameBarFillAllowedInValidation: false,
      },
      scannerPriceContract: {
        rule: "TWO_INDEPENDENT_CURRENT_OKX_SAMPLES_INSIDE_ZONE",
        historicalCrossingAllowed: false,
        oneMinuteCandleTouchAllowed: false,
      },
    },
    coverage: { availableModules: available, totalModules: modules.length, coveragePct, executionPriceReady, semanticQualityReady, perpetualStructureReady, openNowDataReady: criticalReady && perpetualStructureReady, priceAgeSeconds, criticalReady, capitalFlowReady, capitalFlowAvailable, capitalFlowTotal: Object.keys(assets).length },
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

async function scannerAcquireLease(env, token, ttlMs = 55_000) {
  if (scannerStateStub(env)) {
    const result = await durableStateCall(env, { op: "acquireLease", key: SCANNER_LEASE_KEY, token, ttlMs });
    return result?.acquired === true;
  }
  const current = await scannerStateGet(env, SCANNER_LEASE_KEY);
  if (current?.expiresAt > Date.now()) return false;
  await scannerStatePut(env, SCANNER_LEASE_KEY, { token, expiresAt: Date.now() + ttlMs }, Math.ceil(ttlMs / 1000) + 60);
  const verified = await scannerStateGet(env, SCANNER_LEASE_KEY);
  return verified?.token === token;
}

async function scannerReleaseLease(env, token) {
  if (scannerStateStub(env)) {
    await durableStateCall(env, { op: "releaseLease", key: SCANNER_LEASE_KEY, token });
    return;
  }
  const current = await scannerStateGet(env, SCANNER_LEASE_KEY);
  if (current?.token === token) await scannerStatePut(env, SCANNER_LEASE_KEY, { token: null, expiresAt: 0 }, 60);
}

async function scannerPlanIsCurrent(env, plan) {
  const current = await scannerStateGet(env, ACTIVE_PLAN_KEY);
  return current?.status === "ARMED" && current?.planId === plan?.planId && finite(current?.revision, 0) === finite(plan?.revision, 0);
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
  const modelAliases = { A: "A", MODEL_A: "A", B: "B", MODEL_B: "B", C: "C", MODEL_C: "C" };
  const model = modelAliases[scannerText(input.model, "", 24).toUpperCase()];
  if (!model) throw new Error("model must be A, B or C; no model means no trading plan");
  const submodel = scannerText(input.submodel, "", 8).toUpperCase();
  const submodelDefinition = SUBMODEL_DEFINITIONS[submodel];
  if (!submodelDefinition || submodelDefinition.parent !== model) throw new Error("submodel must match its parent model: A1/A2, B1/B2 or C1/C2");
  const marketRegime = scannerText(input.marketRegime, "", 24).toUpperCase();
  if (!["TREND", "RANGE", "COMPRESSION", "TRANSITION"].includes(marketRegime)) throw new Error("marketRegime must be TREND, RANGE, COMPRESSION or TRANSITION");
  const regimePermission = submodelRegimePermission(model, submodel, marketRegime);
  if (regimePermission === "BLOCKED") throw new Error(`${submodel} is not permitted in ${marketRegime}`);
  const opportunityGrade = scannerText(input.opportunityGrade, "", 4).toUpperCase();
  if (!["A+", "A", "B"].includes(opportunityGrade)) throw new Error("opportunityGrade must be A+, A or B; C/D opportunities cannot arm a plan");
  const modelInvalidation = scannerText(input.modelInvalidation, "", 500);
  if (!modelInvalidation) throw new Error("modelInvalidation is required");
  const locationInput = input.location && typeof input.location === "object" ? input.location : {};
  const locationQuality = scannerText(locationInput.quality, "", 20).toUpperCase();
  if (locationQuality !== "GOOD") throw new Error("location.quality must be GOOD before a plan can be armed");
  const locationType = scannerText(locationInput.type, "", 80);
  const locationRationale = scannerText(locationInput.rationale, "", 500);
  if (!locationType || !locationRationale) throw new Error("location.type and location.rationale are required");
  const triggerInput = input.trigger && typeof input.trigger === "object" ? input.trigger : {};
  const triggerType = scannerText(triggerInput.type, "", 40).toUpperCase();
  if (!["BOS", "CHOCH", "RECLAIM", "ACCEPTANCE", "REJECTION"].includes(triggerType)) throw new Error("trigger.type must be BOS, CHOCH, RECLAIM, ACCEPTANCE or REJECTION");
  if (triggerInput.meaningful !== true) throw new Error("trigger.meaningful must be true; internal structure cannot arm a plan");
  const triggerLevel = scannerNumber(triggerInput.level, "trigger.level", { positive: true });
  const protectiveInput = triggerInput.protectiveStructure && typeof triggerInput.protectiveStructure === "object" ? triggerInput.protectiveStructure : {};
  const protectiveType = scannerText(protectiveInput.type, "", 16).toUpperCase();
  if (direction === "LONG" && protectiveType !== "HL") throw new Error("LONG trigger.protectiveStructure.type must be HL");
  if (direction === "SHORT" && protectiveType !== "LH") throw new Error("SHORT trigger.protectiveStructure.type must be LH");
  const protectivePrice = scannerNumber(protectiveInput.price, "trigger.protectiveStructure.price", { positive: true });
  if (scannerText(locationInput.rangePosition, "UNKNOWN", 30).toUpperCase() === "MIDDLE") throw new Error("Range-middle location cannot arm a plan");
  const entryMin = scannerNumber(input.entryZone?.min, "entryZone.min", { positive: true });
  const entryMax = scannerNumber(input.entryZone?.max, "entryZone.max", { positive: true });
  if (entryMin > entryMax) throw new Error("entryZone.min cannot exceed entryZone.max");
  const stopLoss = scannerNumber(input.stopLoss, "stopLoss", { positive: true });
  const invalidationPrice = scannerNumber(input.invalidationPrice ?? stopLoss, "invalidationPrice", { positive: true });
  if (direction === "LONG" && (stopLoss >= entryMin || invalidationPrice >= entryMin)) throw new Error("LONG stop/invalidation must be below entry zone");
  if (direction === "SHORT" && (stopLoss <= entryMax || invalidationPrice <= entryMax)) throw new Error("SHORT stop/invalidation must be above entry zone");
  const stopInvalidationDifferencePct = Math.abs(stopLoss - invalidationPrice) / invalidationPrice * 100;
  if (stopInvalidationDifferencePct > STOP_INVALIDATION_TOLERANCE_PCT) throw new Error(`stopLoss must match structural invalidation within ${STOP_INVALIDATION_TOLERANCE_PCT}%`);
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
  const firstRealisticInput = input.firstRealisticTarget && typeof input.firstRealisticTarget === "object" ? input.firstRealisticTarget : {};
  const firstRealisticPrice = scannerNumber(firstRealisticInput.price, "firstRealisticTarget.price", { positive: true });
  const firstRealisticBasis = scannerText(firstRealisticInput.basis, "", 500);
  if (!firstRealisticBasis) throw new Error("firstRealisticTarget.basis is required");
  if (Math.abs(firstRealisticPrice - targets[0].price) / targets[0].price > 0.000001) throw new Error("firstRealisticTarget.price must equal the first take-profit");
  const expiresSupplied = input.expiresAt !== undefined && input.expiresAt !== null && String(input.expiresAt).trim() !== "";
  const expiresAtMs = Date.parse(input.expiresAt || "");
  if (expiresSupplied && !Number.isFinite(expiresAtMs)) throw new Error("expiresAt must be a valid ISO date-time");
  const expiresAt = Number.isFinite(expiresAtMs) ? new Date(expiresAtMs).toISOString() : new Date(now + DEFAULT_PLAN_HOURS * 60 * 60_000).toISOString();
  if (Date.parse(expiresAt) <= now) throw new Error("expiresAt must be in the future");
  if (Date.parse(expiresAt) > now + 7 * 24 * 60 * 60_000) throw new Error("expiresAt cannot exceed 7 days");
  const confirmation = input.confirmation && typeof input.confirmation === "object" ? input.confirmation : {};
  const close15mAbove = finite(confirmation.close15mAbove);
  const close15mBelow = finite(confirmation.close15mBelow);
  if (direction === "LONG" && Number.isFinite(close15mBelow)) throw new Error("LONG confirmation should use close15mAbove");
  if (direction === "SHORT" && Number.isFinite(close15mAbove)) throw new Error("SHORT confirmation should use close15mBelow");
  if (direction === "LONG" && !Number.isFinite(close15mAbove)) throw new Error("LONG requires explicit confirmation.close15mAbove");
  if (direction === "SHORT" && !Number.isFinite(close15mBelow)) throw new Error("SHORT requires explicit confirmation.close15mBelow");
  if (direction === "LONG" && protectivePrice >= entryMax) throw new Error("LONG protective HL must be below the entry-zone maximum");
  if (direction === "SHORT" && protectivePrice <= entryMin) throw new Error("SHORT protective LH must be above the entry-zone minimum");
  if (direction === "LONG" && stopLoss > protectivePrice) throw new Error("LONG stopLoss must be at or below the protective HL");
  if (direction === "SHORT" && stopLoss < protectivePrice) throw new Error("SHORT stopLoss must be at or above the protective LH");
  if (model === "B" && !Number.isFinite(finite(triggerInput.acceptanceLevel))) throw new Error("Model B requires trigger.acceptanceLevel");
  if (model === "C" && !Number.isFinite(finite(triggerInput.reclaimLevel))) throw new Error("Model C requires trigger.reclaimLevel");
  const hardBlockers = (Array.isArray(input.hardBlockers) ? input.hardBlockers : []).map((item) => scannerText(item, "", 160)).filter(Boolean);
  if (hardBlockers.length) throw new Error("A plan with hardBlockers cannot be armed");
  const riskInput = input.risk && typeof input.risk === "object" ? input.risk : null;
  if (!riskInput) throw new Error("risk context is required");
  const accountEquityUsdt = scannerNumber(riskInput.accountEquityUsdt, "risk.accountEquityUsdt", { positive: true });
  const accountRiskPct = scannerNumber(riskInput.accountRiskPct, "risk.accountRiskPct", { positive: true });
  const leverage = scannerNumber(riskInput.leverage, "risk.leverage", { positive: true });
  const gradeRiskRange = LEGACY_CONFIG.riskByGradePct[opportunityGrade];
  const gradeRiskCapPct = Math.min(LEGACY_CONFIG.absolutePlanRiskCapPct, gradeRiskRange?.[1] ?? 0);
  if (accountRiskPct > gradeRiskCapPct) throw new Error(`risk.accountRiskPct exceeds ${opportunityGrade} configured cap ${gradeRiskCapPct}%`);
  if (leverage > MAX_LEVERAGE) throw new Error(`risk.leverage cannot exceed ${MAX_LEVERAGE}x safety ceiling`);
  const riskAssessmentStatus = scannerText(riskInput.riskAssessmentStatus, "", 32).toUpperCase();
  if (riskAssessmentStatus !== "VERIFIED_CLEAR") throw new Error("risk.riskAssessmentStatus must be VERIFIED_CLEAR; unknown account or psychology state cannot arm a plan");
  if (riskInput.dailyRiskLimitReached !== false) throw new Error("risk.dailyRiskLimitReached must be explicitly false");
  if (riskInput.psychologicalVeto !== false) throw new Error("risk.psychologicalVeto must be explicitly false");
  const correlatedRiskPct = finite(riskInput.correlatedRiskPct, 0);
  if (correlatedRiskPct < 0 || correlatedRiskPct > LEGACY_CONFIG.correlatedRiskCapPct) throw new Error("risk.correlatedRiskPct exceeds configured correlated-risk cap");
  const timeframeAliases = { SHORT_TERM: "SHORT", SHORT: "SHORT", MEDIUM_SHORT: "MEDIUM_SHORT", SWING: "SWING" };
  const timeframe = timeframeAliases[scannerText(input.timeframe || "SHORT", "SHORT", 40).toUpperCase()];
  if (!timeframe) throw new Error("timeframe must be SHORT, MEDIUM_SHORT or SWING");
  const configuredMinNetRR = LEGACY_CONFIG.minimumNetRR[timeframe]?.[opportunityGrade];
  const requestedMinNetRR = scannerNumber(input.minNetRR, "minNetRR", { positive: true });
  if (!Number.isFinite(configuredMinNetRR) || requestedMinNetRR < configuredMinNetRR) throw new Error(`minNetRR must be at least configured ${configuredMinNetRR} for ${timeframe}/${opportunityGrade}`);
  const sourceAnalysisMs = Date.parse(input.sourceAnalysisAt || "");
  if (!Number.isFinite(sourceAnalysisMs)) throw new Error("sourceAnalysisAt must be a valid ISO date-time");
  if (sourceAnalysisMs < now - MAX_SOURCE_ANALYSIS_AGE_MS) throw new Error("sourceAnalysisAt is stale; refresh realtime Action data before arming");
  if (sourceAnalysisMs > now + MAX_SOURCE_ANALYSIS_FUTURE_SKEW_MS) throw new Error("sourceAnalysisAt is in the future");
  const entryReference = (entryMin + entryMax) / 2;
  const stopDistance = Math.abs(entryReference - stopLoss);
  const stopDistancePct = stopDistance / entryReference * 100;
  if (!Number.isFinite(stopDistancePct) || stopDistancePct <= 0) throw new Error("Structural stop distance is invalid");
  const allowedLossUsdt = accountEquityUsdt * accountRiskPct / 100;
  const quantity = allowedLossUsdt / stopDistance;
  const notionalUsdt = quantity * entryReference;
  const requiredMarginUsdt = notionalUsdt / leverage;
  const planId = scannerText(input.planId, "", 80) || `plan-${new Date(now).toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${crypto.randomUUID().slice(0, 8)}`;
  return {
    planId,
    revision: 1,
    status: "ARMED",
    symbol,
    direction,
    model,
    submodel,
    submodelName: submodelDefinition.name,
    opportunityGrade,
    marketRegime,
    regimePermission,
    modelPriority: { A: 1, B: 2, C: 3 }[model],
    modelConfluence: (Array.isArray(input.modelConfluence) ? input.modelConfluence : []).map((item) => scannerText(item, "", 40)).filter(Boolean).slice(0, 3),
    modelInvalidation,
    location: {
      quality: locationQuality,
      type: locationType,
      rationale: locationRationale,
      rangePosition: scannerText(locationInput.rangePosition, "UNKNOWN", 30).toUpperCase(),
    },
    trigger: {
      type: triggerType,
      level: round(triggerLevel, 8),
      meaningful: true,
      completedAtSave: triggerInput.completedAtSave === true,
      reclaimLevel: Number.isFinite(finite(triggerInput.reclaimLevel)) ? round(finite(triggerInput.reclaimLevel), 8) : null,
      acceptanceLevel: Number.isFinite(finite(triggerInput.acceptanceLevel)) ? round(finite(triggerInput.acceptanceLevel), 8) : null,
      protectiveStructure: { type: protectiveType, price: round(protectivePrice, 8) },
    },
    timeframe,
    createdAt: new Date(now).toISOString(),
    expiresAt,
    entryZone: { min: round(entryMin, 8), max: round(entryMax, 8) },
    stopLoss: round(stopLoss, 8),
    invalidationPrice: round(invalidationPrice, 8),
    takeProfits: targets,
    firstRealisticTarget: { price: round(firstRealisticPrice, 8), basis: firstRealisticBasis },
    maximumExecutionPrice: Number.isFinite(finite(input.maximumExecutionPrice)) ? round(finite(input.maximumExecutionPrice), 8) : null,
    minimumExecutionPrice: Number.isFinite(finite(input.minimumExecutionPrice)) ? round(finite(input.minimumExecutionPrice), 8) : null,
    minNetRR: round(requestedMinNetRR, 3),
    configuredMinNetRR: round(configuredMinNetRR, 3),
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
    liquidityProtection: {
      blockDangerousStopPool: input.liquidityProtection?.blockDangerousStopPool !== false,
      crowdingAdverseSweepAndFailureZonesAreSoftWarnings: true,
      failureCooldownHours: round(Math.min(168, Math.max(12, finite(input.liquidityProtection?.failureCooldownHours, 72))), 2),
      maximumFailuresNearZone: Math.min(5, Math.max(1, Math.floor(finite(input.liquidityProtection?.maximumFailuresNearZone, 2)))),
    },
    strategySummary: scannerText(input.strategySummary, `${symbol} ${direction} plan`, 500),
    triggerExplanation: scannerText(input.triggerExplanation, "Wait for the registered 15m confirmation inside the entry zone", 500),
    strongestCounterEvidence: scannerText(input.strongestCounterEvidence, "", 500),
    hardBlockers: [],
    softWarnings: (Array.isArray(input.softWarnings) ? input.softWarnings : []).map((item) => scannerText(item, "", 160)).filter(Boolean).slice(0, 12),
    sourceAnalysisAt: new Date(sourceAnalysisMs).toISOString(),
    risk: {
      accountEquityUsdt: round(accountEquityUsdt, 2),
      accountRiskPct: round(accountRiskPct, 3),
      leverage: round(leverage, 2),
      marginMode: scannerText(riskInput.marginMode || "ISOLATED", "ISOLATED", 20).toUpperCase(),
      configStatus: scannerText(riskInput.configStatus || LEGACY_CONFIG.status, LEGACY_CONFIG.status, 50),
      riskAssessmentStatus,
      dailyRiskLimitReached: false,
      psychologicalVeto: false,
      correlatedRiskPct: round(correlatedRiskPct, 3),
      derivedSizing: {
        entryReference: round(entryReference, 8),
        structuralStopDistance: round(stopDistance, 8),
        structuralStopDistancePct: round(stopDistancePct, 5),
        allowedLossUsdt: round(allowedLossUsdt, 2),
        quantity: round(quantity, 8),
        notionalUsdt: round(notionalUsdt, 2),
        requiredMarginUsdt: round(requiredMarginUsdt, 2),
        formula: "quantity=allowedLoss/structuralStopDistance; leverage changes margin, not risk",
      },
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

function planNetRR(plan, entryPrice, costMultiplier = 1) {
  const target = finite(plan.takeProfits[0]?.price);
  const stop = finite(plan.stopLoss);
  if (![entryPrice, target, stop].every(Number.isFinite)) return null;
  const long = plan.direction === "LONG";
  const rawRisk = long ? entryPrice - stop : stop - entryPrice;
  const rawReward = long ? target - entryPrice : entryPrice - target;
  if (!(rawRisk > 0) || !(rawReward > 0)) return null;
  const cost = entryPrice * (plan.estimatedRoundTripCostPct / 100) * Math.max(1, finite(costMultiplier, 1));
  const risk = rawRisk + cost;
  const reward = rawReward - cost;
  return risk > 0 && reward > 0 ? round(reward / risk, 3) : null;
}

function planExecutionReality(plan, asset, entryPrice) {
  const target = finite(plan.takeProfits[0]?.price);
  const stop = finite(plan.stopLoss);
  const long = plan.direction === "LONG";
  const targetAhead = Number.isFinite(target) && Number.isFinite(entryPrice) && (long ? target > entryPrice : target < entryPrice);
  const stopOnInvalidationSide = Number.isFinite(stop) && Number.isFinite(entryPrice) && (long ? stop < entryPrice : stop > entryPrice);
  const bid = finite(asset?.ticker?.bid);
  const ask = finite(asset?.ticker?.ask);
  const spreadBps = Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 ? ((ask - bid) / bid) * 10_000 : null;
  const baselineNetRR = planNetRR(plan, entryPrice, 1);
  const stressedNetRR = planNetRR(plan, entryPrice, 1.5);
  return {
    passed: targetAhead && stopOnInvalidationSide && Number.isFinite(baselineNetRR),
    targetAhead,
    stopOnInvalidationSide,
    firstRealisticTarget: Number.isFinite(target) ? target : null,
    baselineNetRR,
    stressedNetRR,
    estimatedRoundTripCostPct: plan.estimatedRoundTripCostPct,
    stressedRoundTripCostPct: round(plan.estimatedRoundTripCostPct * 1.5, 4),
    liveSpreadBps: Number.isFinite(spreadBps) ? round(spreadBps, 4) : null,
    policy: "Direction-aware reward/risk; TP1 must still be ahead of current price and the stop must remain beyond invalidation. Stress RR is advisory until calibrated by model/regime samples.",
  };
}

function failureZoneEvidence(plan, failureHistory = []) {
  const midpoint = (plan.entryZone.min + plan.entryZone.max) / 2;
  const cutoff = Date.now() - plan.liquidityProtection.failureCooldownHours * 60 * 60_000;
  const matching = (Array.isArray(failureHistory) ? failureHistory : []).filter((item) => {
    if (item?.symbol !== plan.symbol || item?.direction !== plan.direction) return false;
    const failedAt = Date.parse(item.failedAt || "");
    if (!Number.isFinite(failedAt) || failedAt < cutoff) return false;
    const previousMidpoint = finite(item.entryMidpoint);
    const overlaps = finite(item.entryMin) <= plan.entryZone.max && finite(item.entryMax) >= plan.entryZone.min;
    return overlaps || (Number.isFinite(previousMidpoint) && Math.abs(previousMidpoint - midpoint) / midpoint <= 0.0035);
  });
  return {
    count: matching.length,
    thresholdReached: matching.length >= plan.liquidityProtection.maximumFailuresNearZone,
    cooldownHours: plan.liquidityProtection.failureCooldownHours,
    maximumFailuresNearZone: plan.liquidityProtection.maximumFailuresNearZone,
    matches: matching.slice(-5),
  };
}

function planLiquidityRisk(plan, asset, failureHistory = []) {
  const context = asset?.liquidityRisk || buildMarketLiquidityContext(asset);
  const timeframe = asset?.timeframes?.["15m"];
  const atrValue = finite(timeframe?.indicators?.atr14);
  const long = plan.direction === "LONG";
  const pools = long ? context?.visibleLiquidityPools?.equalLowClusters : context?.visibleLiquidityPools?.equalHighClusters;
  const fallbackLevels = long
    ? [finite(timeframe?.levels?.support20), finite(timeframe?.levels?.support50)]
    : [finite(timeframe?.levels?.resistance20), finite(timeframe?.levels?.resistance50)];
  const allPools = [
    ...(Array.isArray(pools) ? pools.map((pool) => ({ price: finite(pool.price), touches: finite(pool.touches, 2), source: "EQUAL_EXTREME_CLUSTER" })) : []),
    ...fallbackLevels.filter(Number.isFinite).map((price) => ({ price, touches: 1, source: "ROLLING_RANGE_EXTREME" })),
  ].filter((pool) => Number.isFinite(pool.price));
  const nearestPool = allPools.sort((a, b) => Math.abs(plan.stopLoss - a.price) - Math.abs(plan.stopLoss - b.price))[0] || null;
  const stopDistance = nearestPool ? Math.abs(plan.stopLoss - nearestPool.price) : null;
  const stopDistanceAtr = Number.isFinite(stopDistance) && Number.isFinite(atrValue) && atrValue > 0 ? stopDistance / atrValue : null;
  const stopNearPool = Number.isFinite(stopDistanceAtr) && stopDistanceAtr <= 0.35;
  const stopInsideStructure = nearestPool && (long ? plan.stopLoss >= nearestPool.price : plan.stopLoss <= nearestPool.price);
  const dangerousStop = Boolean(stopNearPool && (nearestPool.touches >= 2 || stopInsideStructure));
  const sweep = context?.recentSweep || {};
  const alignedSweep = long ? sweep.bullishSweepReclaim === true : sweep.bearishSweepReclaim === true;
  const adverseSweep = long ? sweep.bearishSweepReclaim === true : sweep.bullishSweepReclaim === true;
  const crowding = directionalCrowding(plan.direction, asset);
  const participant = largeParticipantFootprint(plan.direction, asset);
  const liquidationProxy = asset?.liquidationRiskProxy || {};
  const failures = failureZoneEvidence(plan, failureHistory);
  const blockers = [];
  if (plan.liquidityProtection.blockDangerousStopPool && dangerousStop && !alignedSweep) blockers.push("STOP_INSIDE_OR_JUST_BEYOND_VISIBLE_LIQUIDITY_POOL_WITHOUT_RECLAIM");
  const warnings = [];
  if (stopNearPool && !dangerousStop) warnings.push("STOP_NEAR_VISIBLE_RANGE_EXTREME");
  if (crowding.score >= 3) warnings.push("DIRECTION_EXTREMELY_CROWDED_SOFT_WARNING");
  else if (crowding.score === 2) warnings.push("DIRECTION_MODERATELY_CROWDED");
  if (adverseSweep) warnings.push("RECENT_ADVERSE_SWEEP_RECLAIM_REQUIRES_STRUCTURE_REVIEW");
  if (failures.thresholdReached) warnings.push("REPEATED_FAILURE_ZONE_REQUIRES_REVIEW");
  if (participant.classification === "ADVERSE") warnings.push("LARGE_TAKER_FOOTPRINT_ADVERSE");
  if (liquidationProxy.riskClassification === "CASCADE_CONTINUATION_RISK") {
    const dominant = liquidationProxy?.evidence?.dominantSide15m;
    if ((long && dominant === "LONG_LIQUIDATIONS") || (!long && dominant === "SHORT_LIQUIDATIONS")) warnings.push("REALIZED_LIQUIDATION_CASCADE_ADVERSE_TO_PLAN");
  }
  if (liquidationProxy.riskClassification === "LIQUIDATION_EXHAUSTION_OR_ABSORPTION_CANDIDATE") warnings.push("LIQUIDATION_EXHAUSTION_REQUIRES_STRUCTURE_CONFIRMATION");
  if (!alignedSweep) warnings.push("NO_CONFIRMED_ALIGNED_15M_SWEEP_RECLAIM");
  return {
    passed: blockers.length === 0,
    verdict: blockers.length ? "BLOCK" : warnings.length ? "CAUTION" : "PASS",
    blockers,
    warnings,
    stopPlacement: {
      stopLoss: plan.stopLoss,
      nearestVisiblePool: nearestPool,
      distance: Number.isFinite(stopDistance) ? round(stopDistance, 8) : null,
      distanceAtr: Number.isFinite(stopDistanceAtr) ? round(stopDistanceAtr, 4) : null,
      dangerous: dangerousStop,
      rule: "A stop within 0.35 ATR of a repeated/structural extreme is an execution blocker unless a closed 15m aligned sweep-and-reclaim has already cleared that pool",
    },
    sweep: { ...sweep, alignedWithPlan: alignedSweep, adverseToPlan: adverseSweep },
    crowding,
    largeParticipantFootprint: participant,
    realizedLiquidationRisk: liquidationProxy,
    historicalFailureZone: failures,
    limitations: [
      "The free liquidation proxy measures realized liquidations only; it does not reveal exact future liquidation levels or account-level holdings.",
      "Gate positioning, taker flow and large trades are single-exchange proxies and cannot independently create direction.",
      "Crowding, one adverse sweep and two nearby failures are soft warnings unless price structure or execution evidence independently creates a hard blocker.",
    ],
  };
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

function evaluateTradingPlan(plan, snapshot, previousRuntime = null, zoneVerification = null, failureHistory = []) {
  const now = Date.now();
  const asset = snapshot?.assets?.[plan.symbol];
  const btc = snapshot?.assets?.BTCUSDT;
  const price = finite(asset?.ticker?.last);
  const btcPrice = finite(btc?.ticker?.last);
  const priceSource = asset?.ticker?.source || "UNKNOWN";
  const priceExchangeTimestamp = asset?.ticker?.exchangeTimestamp || null;
  const tf15 = asset?.timeframes?.["15m"];
  const tf1h = asset?.timeframes?.["1h"];
  const tf4h = asset?.timeframes?.["4h"];
  const confirmed15m = latestConfirmedCandle(tf15);
  const directionLong = plan.direction === "LONG";
  const expired = now >= Date.parse(plan.expiresAt);
  const invalidated = Number.isFinite(price) && (directionLong ? price <= plan.invalidationPrice : price >= plan.invalidationPrice);
  if (expired) return { state: "EXPIRED", valid: false, price, btcPrice, priceSource, priceExchangeTimestamp, reason: "GPT plan expired", planId: plan.planId, checkedAt: new Date(now).toISOString() };
  if (invalidated) return { state: "INVALIDATED", valid: false, price, btcPrice, priceSource, priceExchangeTimestamp, reason: "Price crossed the GPT plan invalidation level", planId: plan.planId, checkedAt: new Date(now).toISOString() };
  const currentInZone = zoneVerification?.confirmed === true
    && zoneVerification?.rule === "TWO_INDEPENDENT_CURRENT_OKX_SAMPLES_INSIDE_ZONE";
  const zoneTouched = currentInZone;
  const touch = {
    touched: zoneTouched,
    method: currentInZone ? "DOUBLE_CURRENT_OKX" : null,
    currentInZone,
    confirmedByTwoCurrentSamples: currentInZone,
    samples: Array.isArray(zoneVerification?.samples) ? zoneVerification.samples : [],
    crossedZone: false,
    candleTouchedZone: false,
    previousPrice: null,
    probe: null,
    historicalCrossingIgnored: true,
    oneMinuteCandleTouchIgnored: true,
  };
  if (zoneTouched && !previousRuntime?.zoneAlertSentAt) {
    return {
      state: "ZONE_REACHED",
      valid: false,
      price: round(price, 8),
      btcPrice: round(btcPrice, 8),
      priceSource,
      priceExchangeTimestamp,
      entryZone: plan.entryZone,
      touch,
      reason: "Two independent current OKX samples are inside the GPT plan entry zone; waiting for execution confirmation",
      planId: plan.planId,
      checkedAt: new Date(now).toISOString(),
    };
  }
  if (snapshot?.decisionState !== "DATA_READY" || !Number.isFinite(price) || !confirmed15m) {
    return { state: zoneTouched ? "WATCHING" : "DATA_BLOCKED", valid: false, price, btcPrice, priceSource, priceExchangeTimestamp, touch, reason: "Realtime core data is not decision-ready", planId: plan.planId, checkedAt: new Date(now).toISOString() };
  }
  const inZone = currentInZone;
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
    : false;
  const btcPricePassed = (!Number.isFinite(plan.confirmation.btcMinimumPrice) || btcPrice >= plan.confirmation.btcMinimumPrice)
    && (!Number.isFinite(plan.confirmation.btcMaximumPrice) || btcPrice <= plan.confirmation.btcMaximumPrice);
  const trendPassed = plan.confirmation.allowCountertrend || (!trendAgainst(plan.direction, tf4h) && !trendAgainst(plan.direction, tf1h));
  const executionReality = planExecutionReality(plan, asset, price);
  const rr = executionReality.baselineNetRR;
  const rrPassed = Number.isFinite(rr) && rr >= plan.minNetRR;
  const flow = capitalFlowEvidence(plan.direction, asset, btc);
  const flowPassed = !plan.confirmation.requireFlowSupport || flow.passed;
  const orderBookPassed = !plan.confirmation.requireOrderBookSupport || (
    Number.isFinite(flow.ratios.orderBookImbalancePct)
    && (directionLong ? flow.ratios.orderBookImbalancePct >= 0 : flow.ratios.orderBookImbalancePct <= 0)
  );
  const liquidityRisk = planLiquidityRisk(plan, asset, failureHistory);
  const liquidityRiskPassed = liquidityRisk.passed;
  const registeredModel = ["A", "B", "C"].includes(plan.model);
  const registeredSubmodel = Boolean(SUBMODEL_DEFINITIONS[plan.submodel]?.parent === plan.model);
  const currentRegime = scannerText(asset?.marketRegimeRouter?.regime, "UNKNOWN", 24).toUpperCase();
  const regimePermission = submodelRegimePermission(plan.model, plan.submodel, currentRegime);
  const regimeDirectPermission = regimePermission === "DIRECT";
  const regimeChanged = currentRegime !== plan.marketRegime;
  const perpetualStructureReady = [tf15, tf1h, tf4h].every((tf) => tf?.status === "ok" && tf?.source === "GATE_USDT_PERPETUAL" && tf?.quality?.passed === true);
  const locationPassed = plan.location?.quality === "GOOD" && plan.location?.rangePosition !== "MIDDLE";
  const meaningfulTriggerPassed = plan.trigger?.meaningful === true && Number.isFinite(finite(plan.trigger?.level));
  const protectivePrice = finite(plan.trigger?.protectiveStructure?.price);
  const protectiveStructurePassed = Number.isFinite(protectivePrice)
    && (directionLong ? price > protectivePrice && candleClose > protectivePrice : price < protectivePrice && candleClose < protectivePrice);
  const modelAConditionPassed = plan.model !== "A" || trendPassed;
  const acceptanceLevel = finite(plan.trigger?.acceptanceLevel);
  const modelBConditionPassed = plan.model !== "B" || (
    Number.isFinite(acceptanceLevel)
    && (directionLong ? candleClose >= acceptanceLevel : candleClose <= acceptanceLevel)
    && protectiveStructurePassed
  );
  const reclaimLevel = finite(plan.trigger?.reclaimLevel);
  const modelCConditionPassed = plan.model !== "C" || (
    liquidityRisk.sweep?.alignedWithPlan === true
    && Number.isFinite(reclaimLevel)
    && (directionLong ? candleClose >= reclaimLevel : candleClose <= reclaimLevel)
    && meaningfulTriggerPassed
    && protectiveStructurePassed
  );
  const riskContextPassed = plan.risk?.riskAssessmentStatus === "VERIFIED_CLEAR" && plan.risk?.dailyRiskLimitReached !== true && plan.risk?.psychologicalVeto !== true;
  const explicitHardBlockersPassed = !Array.isArray(plan.hardBlockers) || plan.hardBlockers.length === 0;
  const checks = {
    registeredModel,
    registeredSubmodel,
    regimeDirectPermission,
    currentRegimeMatchesSavedPlan: !regimeChanged,
    perpetualStructureReady,
    locationPassed,
    meaningfulTriggerPassed,
    protectiveStructurePassed,
    modelAConditionPassed,
    modelBConditionPassed,
    modelCConditionPassed,
    inZone,
    nearZone,
    executionCapPassed,
    candlePassed,
    btcPricePassed,
    trendPassed,
    executionRealityPassed: executionReality.passed,
    rrPassed,
    flowPassed,
    orderBookPassed,
    liquidityRiskPassed,
    riskContextPassed,
    explicitHardBlockersPassed,
  };
  const confirmationPassed = Object.entries(checks).filter(([name]) => name !== "nearZone").every(([, passed]) => passed);
  const hardBlockers = [];
  if (!registeredModel) hardBlockers.push("NO_REGISTERED_MODEL");
  if (!registeredSubmodel || regimePermission === "BLOCKED") hardBlockers.push("INVALID_SUBMODEL_OR_REGIME_PERMISSION");
  if (regimeChanged) hardBlockers.push("MARKET_REGIME_CHANGED_REQUIRES_NEW_GPT_PLAN");
  if (!perpetualStructureReady) hardBlockers.push("PERPETUAL_STRUCTURE_SOURCE_REQUIRED_FOR_EXECUTION");
  if (!locationPassed) hardBlockers.push("BAD_OR_MIDDLE_LOCATION");
  if (!protectiveStructurePassed) hardBlockers.push("NO_VALID_PROTECTIVE_STRUCTURE");
  if (!executionReality.targetAhead) hardBlockers.push("FIRST_REALISTIC_TARGET_ALREADY_PASSED_OR_WRONG_SIDE");
  if (!executionReality.stopOnInvalidationSide) hardBlockers.push("STOP_NO_LONGER_ON_INVALIDATION_SIDE");
  if (!rrPassed) hardBlockers.push("NET_RR_BELOW_CONFIGURED_THRESHOLD");
  if (!liquidityRiskPassed) hardBlockers.push(...liquidityRisk.blockers);
  if (!riskContextPassed) {
    if (plan.risk?.riskAssessmentStatus !== "VERIFIED_CLEAR") hardBlockers.push("ACCOUNT_OR_PSYCHOLOGY_STATE_NOT_VERIFIED");
    if (plan.risk?.dailyRiskLimitReached) hardBlockers.push("DAILY_RISK_LIMIT_REACHED");
    if (plan.risk?.psychologicalVeto) hardBlockers.push("PSYCHOLOGICAL_VETO");
  }
  if (!explicitHardBlockersPassed) hardBlockers.push(...plan.hardBlockers);
  const state = confirmationPassed ? "MARKET_CONFIRMED" : nearZone && hardBlockers.length ? "RISK_BLOCKED" : nearZone ? "WATCHING" : "ARMED";
  const failedChecks = Object.entries(checks).filter(([name, passed]) => name !== "nearZone" && !passed).map(([name]) => name);
  return {
    state,
    valid: false,
    openNowAllowed: false,
    finalReviewRequired: ["LATEST_NEWS_AND_MACRO", "ACCOUNT_DAILY_RISK", "PSYCHOLOGICAL_STATE", "FRESH_ACTION_RECHECK"],
    price: round(price, 8),
    btcPrice: round(btcPrice, 8),
    priceSource,
    priceExchangeTimestamp,
    entryZone: plan.entryZone,
    netRR: rr,
    executionReality,
    confirmed15mAt: confirmed15m.ts,
    confirmed15mClose: candleClose,
    checks,
    failedChecks,
    flow,
    liquidityRisk,
    hardBlockerScan: { passed: hardBlockers.length === 0, blockers: [...new Set(hardBlockers)], cannotBeOverriddenByScore: true },
    softWarnings: [...new Set([
      ...(plan.softWarnings || []),
      ...(liquidityRisk.warnings || []),
      ...(Number.isFinite(executionReality.stressedNetRR) && executionReality.stressedNetRR < plan.minNetRR ? ["COST_STRESS_NET_RR_BELOW_THRESHOLD_REQUIRES_REVIEW"] : []),
    ])],
    touch,
    regimePermission,
    savedMarketRegime: plan.marketRegime,
    currentMarketRegime: currentRegime,
    reason: confirmationPassed ? "Market checks passed; OPEN_NOW remains false until GPT completes fresh news, account-risk and psychology review" : state === "RISK_BLOCKED" ? `Hard blocker prevented entry: ${[...new Set(hardBlockers)].join(", ")}` : nearZone ? `Entry area reached; waiting for ${failedChecks.join(", ")}` : "Waiting for GPT plan entry area",
    planId: plan.planId,
    checkedAt: new Date(now).toISOString(),
  };
}

function scannerNotification(plan, evaluation) {
  const direction = plan.direction === "LONG" ? "做多" : "做空";
  const price = Number.isFinite(evaluation.price) ? evaluation.price : "未知";
  if (evaluation.state === "MARKET_CONFIRMED") return {
    title: `✅ ${plan.symbol} 市场条件通过，等待最终复核`,
    body: `${direction}候选｜当前市场状态 ${evaluation.currentMarketRegime}｜现价 ${price}\nGPT方案 ${plan.entryZone.min}-${plan.entryZone.max}｜止损 ${plan.stopLoss}｜TP ${plan.takeProfits.map((x) => x.price).join("/")}\n净RR ${evaluation.netRR}｜15M关键触发 ${evaluation.confirmed15mClose}\nOPEN_NOW仍为false；请调用GPT复核最新新闻、账户日内风险和心理状态。`,
    level: "timeSensitive",
  };
  if (evaluation.state === "ZONE_REACHED") return {
    title: `🔔 ${plan.symbol} 两次OKX当前价确认进入GPT计划区`,
    body: `两次独立OKX当前成交价 ${evaluation.touch?.samples?.map((sample) => sample.last).join(" / ") || price}，计划区 ${plan.entryZone.min}-${plan.entryZone.max}。\n第二次复核价 ${price}｜交易所时间 ${evaluation.priceExchangeTimestamp || evaluation.checkedAt}。\n本提醒不使用历史价格穿越或1分钟K线影线；已到价但仍需完成15M、BTC、RR和资金流确认。`,
    level: "timeSensitive",
  };
  if (evaluation.state === "WATCHING") return {
    title: `👀 ${plan.symbol} 已接近GPT方案区`,
    body: `现价 ${price}，计划区 ${plan.entryZone.min}-${plan.entryZone.max}。尚未确认：${evaluation.failedChecks?.join("、") || evaluation.reason}。先不要开仓。`,
    level: "active",
  };
  if (evaluation.state === "RISK_BLOCKED") return {
    title: `⛔ ${plan.symbol} 课程硬阻断禁止开仓`,
    body: `现价 ${price}，虽已到计划区，但禁止开仓。\n硬阻断：${evaluation.hardBlockerScan?.blockers?.join("、") || "必要闸门未通过"}\n止损池距离：${evaluation.liquidityRisk?.stopPlacement?.distanceAtr ?? "未知"} ATR｜拥挤仅作警告分 ${evaluation.liquidityRisk?.crowding?.score ?? "未知"}\n不得用评分抵消硬阻断；等待原模型重新满足，不得临时另造方向。`,
    level: "timeSensitive",
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
    lastObservedPrice: null,
    lastObservedAt: null,
    lastObservedPriceVerified: false,
    lastObservedPriceSource: null,
    lastObservedExchangeTimestamp: null,
    zoneReachedAt: null,
    zoneAlertSentAt: null,
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
  if (!["ZONE_REACHED", "MARKET_CONFIRMED", "RISK_BLOCKED", "INVALIDATED", "EXPIRED"].includes(evaluation.state)) return false;
  if (!previous || previous.planId !== evaluation.planId) return evaluation.state !== "ARMED";
  if (evaluation.state !== previous.state) return true;
  if (previous.notification?.sent === false) {
    const lastAttemptAt = Date.parse(previous.lastAttemptAt || "");
    return !Number.isFinite(lastAttemptAt) || Date.now() - lastAttemptAt >= 2 * 60_000;
  }
  if (evaluation.state === "MARKET_CONFIRMED") {
    const lastAt = Date.parse(previous.lastAlertAt || "");
    return evaluation.confirmed15mAt !== previous.lastConfirmedCandleAt && (!Number.isFinite(lastAt) || Date.now() - lastAt >= CONFIRMATION_COOLDOWN_MS);
  }
  return false;
}

async function runScannerUnlocked(env) {
  if (!scannerStateStub(env) && (!env?.ALERT_STATE?.get || !env?.ALERT_STATE?.put)) {
    return { status: "configuration_required", build: BUILD, reason: "SCANNER_STATE_BINDING_MISSING", configuration: scannerConfiguration(env) };
  }
  const state = await scannerStateBundle(env, [ACTIVE_PLAN_KEY, SCANNER_RUNTIME_KEY, SCANNER_FAILURE_HISTORY_KEY]);
  const plan = state[ACTIVE_PLAN_KEY];
  const previous = state[SCANNER_RUNTIME_KEY];
  let failureHistory = Array.isArray(state[SCANNER_FAILURE_HISTORY_KEY]) ? state[SCANNER_FAILURE_HISTORY_KEY] : [];
  if (!plan || plan.status !== "ARMED") {
    return { status: "idle", build: BUILD, reason: "NO_ACTIVE_GPT_PLAN", configuration: scannerConfiguration(env) };
  }
  let snapshot;
  try {
    snapshot = await buildSnapshot({ scannerMode: true, coinalyzeApiKey: env?.COINALYZE_API_KEY });
  } catch (error) {
    snapshot = { decisionState: "DATA_BLOCKED", assets: {}, scannerError: error?.message || String(error) };
  }
  let zoneVerification;
  try {
    zoneVerification = await verifyOkxScannerZone(plan.symbol, plan.entryZone);
    if (!snapshot.assets) snapshot.assets = {};
    if (!snapshot.assets[plan.symbol]) snapshot.assets[plan.symbol] = {};
    snapshot.assets[plan.symbol].ticker = zoneVerification.current;
  } catch (error) {
    zoneVerification = { passed: false, error: error?.message || String(error), checkedAt: new Date(Date.now()).toISOString(), samples: [] };
  }
  const directVerified = zoneVerification?.passed === true
    && zoneVerification?.current?.source === "OKX_USDT_PERPETUAL_DIRECT_VERIFIED"
    && zoneVerification?.current?.verification?.passed === true;
  const evaluation = directVerified
    ? evaluateTradingPlan(plan, snapshot, previous, zoneVerification, failureHistory)
    : {
      state: "DATA_BLOCKED",
      valid: false,
      price: null,
      btcPrice: finite(snapshot?.assets?.BTCUSDT?.ticker?.last),
      priceSource: null,
      priceExchangeTimestamp: null,
      touch: { touched: false, method: null, currentInZone: false, confirmedByTwoCurrentSamples: false, samples: [], crossedZone: false, candleTouchedZone: false, previousPrice: null, probe: null, historicalCrossingIgnored: true, oneMinuteCandleTouchIgnored: true },
      verification: zoneVerification,
      reason: "DIRECT_OKX_PRICE_VERIFICATION_FAILED",
      planId: plan.planId,
      checkedAt: new Date(Date.now()).toISOString(),
    };
  if (!(await scannerPlanIsCurrent(env, plan))) {
    return { status: "stale_aborted", build: BUILD, reason: "ACTIVE_PLAN_CHANGED_DURING_SCAN", notification: { sent: false, reason: "STALE_PLAN" } };
  }
  if (evaluation.state === "INVALIDATED" && previous?.state !== "INVALIDATED") {
    const cutoff = Date.now() - FAILURE_HISTORY_DAYS * 24 * 60 * 60_000;
    failureHistory = failureHistory
      .filter((item) => Date.parse(item?.failedAt || "") >= cutoff)
      .concat({
        planId: plan.planId,
        symbol: plan.symbol,
        direction: plan.direction,
        entryMin: plan.entryZone.min,
        entryMax: plan.entryZone.max,
        entryMidpoint: round((plan.entryZone.min + plan.entryZone.max) / 2, 8),
        stopLoss: plan.stopLoss,
        invalidationPrice: plan.invalidationPrice,
        failedAt: new Date(Date.now()).toISOString(),
        failurePrice: evaluation.price,
        reason: evaluation.reason,
        outcomeType: "SETUP_INVALIDATION_NOT_CONFIRMED_TRADE_LOSS",
        executionWasAssumed: false,
      })
      .slice(-50);
    await scannerStatePut(env, SCANNER_FAILURE_HISTORY_KEY, failureHistory, FAILURE_HISTORY_DAYS * 24 * 60 * 60);
  }
  const shouldNotify = scannerShouldNotify(previous, evaluation);
  let notification = { sent: false, reason: "NO_STATE_TRANSITION" };
  if (shouldNotify) {
    if (!(await scannerPlanIsCurrent(env, plan))) return { status: "stale_aborted", build: BUILD, reason: "ACTIVE_PLAN_CHANGED_BEFORE_NOTIFICATION", notification: { sent: false, reason: "STALE_PLAN" } };
    try { notification = await sendBark(env, scannerNotification(plan, evaluation)); }
    catch (error) { notification = { sent: false, reason: error?.message || String(error) }; }
  }
  // Use the same clock source as direct verification/evaluation. Mixing the
  // implicit Date constructor clock with Date.now() can make the prior sample
  // appear to come from the future and corrupt crossing detection.
  const nowIso = new Date(Date.now()).toISOString();
  const verifiedObservation = evaluation.priceSource === "OKX_USDT_PERPETUAL_DIRECT_VERIFIED"
    && Number.isFinite(evaluation.price);
  const nextRuntime = {
    planId: plan.planId,
    state: evaluation.state,
    checkedAt: nowIso,
    lastPersistedAt: nowIso,
    lastAlertAt: notification.sent ? nowIso : previous?.lastAlertAt || null,
    lastAttemptAt: shouldNotify ? nowIso : previous?.lastAttemptAt || null,
    lastConfirmedCandleAt: evaluation.state === "MARKET_CONFIRMED" ? evaluation.confirmed15mAt : previous?.lastConfirmedCandleAt || null,
    activatedAt: null,
    lastObservedPrice: verifiedObservation ? evaluation.price : previous?.lastObservedPrice || null,
    lastObservedAt: verifiedObservation ? nowIso : previous?.lastObservedAt || null,
    lastObservedPriceVerified: verifiedObservation ? true : previous?.lastObservedPriceVerified === true,
    lastObservedPriceSource: verifiedObservation ? evaluation.priceSource : previous?.lastObservedPriceSource || null,
    lastObservedExchangeTimestamp: verifiedObservation ? evaluation.priceExchangeTimestamp : previous?.lastObservedExchangeTimestamp || null,
    zoneReachedAt: evaluation.touch?.touched ? previous?.zoneReachedAt || nowIso : previous?.zoneReachedAt || null,
    zoneAlertSentAt: evaluation.state === "ZONE_REACHED" && notification.sent ? nowIso : previous?.zoneAlertSentAt || null,
    evaluation,
    notification,
  };
  const ttlSeconds = Math.max(3600, Math.ceil((Date.parse(plan.expiresAt) - Date.now()) / 1000) + 24 * 60 * 60);
  if (!(await scannerPlanIsCurrent(env, plan))) return { status: "stale_aborted", build: BUILD, reason: "ACTIVE_PLAN_CHANGED_BEFORE_RUNTIME_WRITE", notification };
  await scannerStatePut(env, SCANNER_RUNTIME_KEY, nextRuntime, ttlSeconds);
  return {
    status: "ok",
    build: BUILD,
    plan: { planId: plan.planId, symbol: plan.symbol, direction: plan.direction, expiresAt: plan.expiresAt },
    evaluation,
    notification,
    configuration: scannerConfiguration(env),
  };
}

async function runScanner(env) {
  const configuration = scannerConfiguration(env);
  if (!configuration.barkConfigured || !configuration.scannerTokenConfigured || !configuration.stateConfigured) {
    return { status: "configuration_error", build: BUILD, configuration };
  }
  const token = crypto.randomUUID();
  if (!(await scannerAcquireLease(env, token))) return { status: "busy", build: BUILD, reason: "SCANNER_RUN_ALREADY_IN_PROGRESS" };
  try {
    return await runScannerUnlocked(env);
  } finally {
    await scannerReleaseLease(env, token).catch(() => {});
  }
}

async function scannerStatus(env) {
  const state = await scannerStateBundle(env, [ACTIVE_PLAN_KEY, SCANNER_RUNTIME_KEY, SCANNER_FAILURE_HISTORY_KEY]);
  const plan = state[ACTIVE_PLAN_KEY];
  const runtime = state[SCANNER_RUNTIME_KEY];
  return { status: "ok", build: BUILD, apiVersion: API_VERSION, configuration: scannerConfiguration(env), activePlan: plan || null, runtime: runtime || null, failureHistory: Array.isArray(state[SCANNER_FAILURE_HISTORY_KEY]) ? state[SCANNER_FAILURE_HISTORY_KEY] : [] };
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
      indexPrice: moduleSchema,
      spotMarket: moduleSchema,
      timeframes: {
        type: "object",
        properties: { "15m": moduleSchema, "1h": moduleSchema, "4h": moduleSchema },
      },
      derivatives: {
        type: "object",
        properties: { openInterest: moduleSchema, funding: moduleSchema },
      },
      capitalFlow: moduleSchema,
      executionLiquidity: moduleSchema,
      liquidationRiskProxy: moduleSchema,
      estimatedLiquidationPressureZones: moduleSchema,
      largeParticipantProxy: moduleSchema,
      liquidityRisk: moduleSchema,
      effortVsResult: moduleSchema,
      marketRegimeRouter: moduleSchema,
      dataGaps: moduleSchema,
    },
  };
  const planSchema = {
    type: "object",
    required: ["symbol", "direction", "model", "submodel", "marketRegime", "opportunityGrade", "modelInvalidation", "location", "trigger", "entryZone", "stopLoss", "invalidationPrice", "takeProfits", "firstRealisticTarget", "minNetRR", "hardBlockers", "risk", "strategySummary", "triggerExplanation", "sourceAnalysisAt", "expiresAt"],
    properties: {
      planId: { type: "string", description: "Stable identifier for this exact final GPT plan; omit to auto-generate." },
      symbol: { type: "string", enum: ["ETHUSDT", "BTCUSDT"] },
      direction: { type: "string", enum: ["LONG", "SHORT"] },
      model: { type: "string", enum: ["A", "B", "C"], description: "The only allowed course setup models. No model means no plan." },
      submodel: { type: "string", enum: ["A1", "A2", "B1", "B2", "C1", "C2"], description: "Required child of A/B/C; it cannot create a fourth parent model." },
      marketRegime: { type: "string", enum: ["TREND", "RANGE", "COMPRESSION", "TRANSITION"], description: "Technical regime selected before setup evaluation. Event and abnormal-liquidity risk remain independent hard blockers." },
      opportunityGrade: { type: "string", enum: ["A+", "A", "B"], description: "C/D opportunities cannot be armed. Grade selects the configured risk and minimum-net-RR ceiling." },
      modelConfluence: { type: "array", items: { type: "string" }, description: "Optional supporting overlap; priority remains A then B then C." },
      modelInvalidation: { type: "string", description: "Causal model invalidation, not merely a price number." },
      location: {
        type: "object",
        required: ["quality", "type", "rationale"],
        properties: {
          quality: { type: "string", enum: ["GOOD"] },
          type: { type: "string" },
          rationale: { type: "string" },
          rangePosition: { type: "string", enum: ["EDGE", "BREAKOUT_RETEST", "TREND_PULLBACK", "LIQUIDITY_EXTREME", "UNKNOWN"] },
        },
      },
      trigger: {
        type: "object",
        required: ["type", "level", "meaningful", "protectiveStructure"],
        properties: {
          type: { type: "string", enum: ["BOS", "CHOCH", "RECLAIM", "ACCEPTANCE", "REJECTION"] },
          level: { type: "number" },
          meaningful: { type: "boolean", enum: [true], description: "Must be meaningful structure, never a minor internal break." },
          completedAtSave: { type: "boolean" },
          reclaimLevel: { type: ["number", "null"], description: "Required for Model C." },
          acceptanceLevel: { type: ["number", "null"], description: "Required for Model B." },
          protectiveStructure: {
            type: "object",
            required: ["type", "price"],
            properties: { type: { type: "string", enum: ["HL", "LH"] }, price: { type: "number" } },
          },
        },
      },
      timeframe: { type: "string", enum: ["SHORT", "MEDIUM_SHORT", "SWING"], description: "Flexible holding horizon selected from current structure; do not mechanically force short-term or swing." },
      expiresAt: { type: "string", format: "date-time", description: "Hard expiry, no more than seven days from now." },
      entryZone: {
        type: "object",
        required: ["min", "max"],
        properties: { min: { type: "number" }, max: { type: "number" } },
      },
      stopLoss: { type: "number" },
      invalidationPrice: { type: "number" },
      liquidityProtection: {
        type: "object",
        description: "Optional execution protection. Crowding, an adverse sweep and repeated failure zones remain soft warnings unless independent structure/execution evidence creates a hard blocker.",
        properties: {
          blockDangerousStopPool: { type: "boolean" },
          failureCooldownHours: { type: "number", minimum: 12, maximum: 168 },
          maximumFailuresNearZone: { type: "integer", minimum: 1, maximum: 5 },
        },
      },
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
      firstRealisticTarget: {
        type: "object",
        required: ["price", "basis"],
        properties: { price: { type: "number" }, basis: { type: "string" } },
        description: "Must equal TP1 and be based on the nearest realistic structural/liquidity obstacle.",
      },
      minNetRR: { type: "number", description: "Explicit configurable net RR threshold. Legacy defaults are unvalidated CONFIG, not course truths." },
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
      hardBlockers: { type: "array", items: { type: "string" }, description: "Must be empty. A plan with any hard blocker is rejected." },
      softWarnings: { type: "array", items: { type: "string" } },
      sourceAnalysisAt: { type: "string", format: "date-time" },
      risk: {
        type: "object",
        required: ["accountEquityUsdt", "accountRiskPct", "leverage", "riskAssessmentStatus", "dailyRiskLimitReached", "psychologicalVeto", "correlatedRiskPct"],
        properties: {
          accountEquityUsdt: { type: ["number", "null"] },
          accountRiskPct: { type: ["number", "null"] },
          leverage: { type: ["number", "null"] },
          marginMode: { type: "string" },
          configStatus: { type: "string" },
          riskAssessmentStatus: { type: "string", enum: ["VERIFIED_CLEAR"], description: "Only after current account and psychology state are explicitly checked. Unknown cannot arm." },
          dailyRiskLimitReached: { type: "boolean" },
          psychologicalVeto: { type: "boolean" },
          correlatedRiskPct: { type: ["number", "null"] },
          derivedSizing: moduleSchema,
        },
      },
    },
  };
  return {
    openapi: "3.1.0",
    info: {
      title: "Crypto Alpha BTC ETH Realtime",
      description: "Realtime BTC/ETH data and plan scanner governed by the 32-lesson A/B/C model hierarchy. Hard blockers veto entry; confirmation data cannot create a setup.",
      version: API_VERSION,
    },
    servers: [{ url: origin }],
    paths: {
      "/": {
        get: {
          operationId: "getCryptoAlphaData",
          summary: "Get realtime BTC and ETH perpetual market data",
          description: "Returns source-labelled realtime data, structure candidates, volume-profile estimates, effort/result, flow and data gaps for the 32-lesson decision order.",
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
                      dataProviders: {
                        type: "object",
                        properties: { coinalyze: moduleSchema },
                      },
                      analysisContract: moduleSchema,
                      requestBudget: {
                        type: "object",
                        properties: {
                          plannedOkx: { type: "integer" },
                          plannedUpstreamFetches: { type: "integer" },
                          plannedCloudflareSubrequestsCold: { type: "integer" },
                          maximumCloudflareSubrequestsWithAllFallbacksAndRetries: { type: "integer" },
                          cloudflareFreeLimit: { type: "integer" },
                          persistentPerModuleCache: { type: "string" },
                          coinalyzeConfigured: { type: "boolean" },
                          coinalyzeProviderCallUnits: { type: "integer" },
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
                          perpetualStructureReady: { type: "boolean" },
                          openNowDataReady: { type: "boolean" },
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
          description: "Save one exact A/B/C plan only after location, invalidation, meaningful trigger, first realistic target, RR and hard-blocker checks are defined.",
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
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Crypto Alpha Privacy</title><body style="font-family:system-ui;max-width:760px;margin:40px auto;padding:0 18px;line-height:1.7"><h1>Crypto Alpha 隐私政策</h1><p>本服务提供 BTC/ETH 市场数据、保存用户主动提交的交易监控参数并发送提醒；不自动下单，不接收交易所交易密钥，不收集姓名、邮箱、账户或付款信息。</p><p>监控参数包括课程模型、方向、位置、触发、入场区、止损、止盈、失效条件、风险配置、有效期和方案摘要，保存在 Cloudflare Durable Object 中；Bark 设备密钥、扫描令牌和可选 Coinalyze 数据密钥以 Cloudflare Secret 保存，不写入接口响应。</p><p>为保障稳定性，服务提供商可能保留短期技术日志，例如请求时间、错误信息与网络元数据。日志仅用于故障排查。</p><p>执行数据来源：OKX USDT 永续实时价格、指数、标记价、OI和资金费率，以及OKX现货最新成交、订单簿和真实逐笔成交样本；现货样本主动买卖差不冒充跨时间持久CVD。主K线使用 Gate USDT 永续；Gate 公共接口另提供主动买卖估算、大额成交估算、订单簿、已发生强平及多空比等辅助证据。可选 Coinalyze 仅补充所选市场已经发生的清算历史。系统估算的压力区不是未来全市场清算地图，大额参与足迹也不是精确巨鲸账户仓位。所有确认数据均不能单独制造开仓方向。Kraken 现货仅作严格质量校验后的紧急保底，且不能放行执行。服务地址：${origin}</p><p>最后更新：2026-09-06</p></body></html>`;
}

async function handleSnapshot(request, env, ctx) {
  const cache = globalThis.caches?.default;
  const cacheKey = new Request(`https://crypto-alpha-cache.invalid/${CACHE_NAMESPACE}/realtime`);
  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) return new Response(cached.body, cached);
  }
  const snapshot = await buildSnapshot({ coinalyzeApiKey: env?.COINALYZE_API_KEY });
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
    if (input?.op === "acquireLease") {
      const key = String(input.key || SCANNER_LEASE_KEY);
      const now = Date.now();
      const existing = await this.ctx.storage.get(key);
      if (existing?.value?.token && Number.isFinite(existing.value.expiresAt) && existing.value.expiresAt > now) {
        return Response.json({ status: "ok", acquired: false, owner: existing.value.token, expiresAt: existing.value.expiresAt });
      }
      const ttlMs = Math.min(60_000, Math.max(5_000, finite(input.ttlMs, 55_000)));
      const value = { token: String(input.token), expiresAt: now + ttlMs };
      await this.ctx.storage.put(key, { value, expiresAt: value.expiresAt + 60_000 });
      return Response.json({ status: "ok", acquired: true, expiresAt: value.expiresAt });
    }
    if (input?.op === "releaseLease") {
      const key = String(input.key || SCANNER_LEASE_KEY);
      const existing = await this.ctx.storage.get(key);
      if (existing?.value?.token === String(input.token)) await this.ctx.storage.delete(key);
      return Response.json({ status: "ok", released: existing?.value?.token === String(input.token) });
    }
    return Response.json({ error: "INVALID_OPERATION" }, { status: 400 });
  }
}

export function evaluateCourseDecision(input = {}) {
  const hardBlockers = [];
  const softWarnings = [...(Array.isArray(input.softWarnings) ? input.softWarnings : [])];
  const model = ["A", "B", "C"].includes(input.model) ? input.model : null;
  const submodel = scannerText(input.submodel, "", 8).toUpperCase();
  const marketRegime = scannerText(input.marketRegime, "", 24).toUpperCase();
  const regimePermission = submodelRegimePermission(model, submodel, marketRegime);
  const direction = ["LONG", "SHORT"].includes(input.direction) ? input.direction : null;
  if (!model) hardBlockers.push("NO_MODEL");
  if (!SUBMODEL_DEFINITIONS[submodel] || SUBMODEL_DEFINITIONS[submodel].parent !== model) hardBlockers.push("INVALID_SUBMODEL");
  if (!["TREND", "RANGE", "COMPRESSION", "TRANSITION"].includes(marketRegime) || regimePermission === "BLOCKED") hardBlockers.push("REGIME_SUBMODEL_NOT_PERMITTED");
  if (!direction) hardBlockers.push("NO_DIRECTION_CANDIDATE");
  if (input.locationQuality !== "GOOD" || input.rangePosition === "MIDDLE") hardBlockers.push("BAD_OR_MIDDLE_LOCATION");
  if (input.execution?.clearInvalidation !== true) hardBlockers.push("NO_CLEAR_MODEL_OR_STRUCTURE_INVALIDATION");
  if (!Number.isFinite(finite(input.execution?.netRR)) || !Number.isFinite(finite(input.execution?.minNetRR)) || finite(input.execution.netRR) < finite(input.execution.minNetRR)) hardBlockers.push("NET_RR_BELOW_CONFIGURED_THRESHOLD");
  if (input.environment?.btcSystemicConflict === true) hardBlockers.push("SEVERE_BTC_SYSTEMIC_CONFLICT");
  if (input.environment?.majorNewsExecutionRisk === true) hardBlockers.push("MAJOR_EVENT_EXECUTION_RISK");
  if (input.environment?.liquidityAbnormal === true || input.execution?.slippageAbnormal === true) hardBlockers.push("ABNORMAL_LIQUIDITY_OR_EXECUTION");
  if (input.execution?.dangerousStopZone === true && input.execution?.alignedSweepClearedStopPool !== true) hardBlockers.push("DANGEROUS_STOP_ZONE");
  if (input.data?.requiredFieldsReady !== true) hardBlockers.push("REQUIRED_DATA_GAP");
  if (input.risk?.dailyRiskLimitReached === true) hardBlockers.push("DAILY_RISK_LIMIT_REACHED");
  if (input.risk?.psychologicalVeto === true) hardBlockers.push("PSYCHOLOGICAL_VETO");

  if (input.confirmation?.extremeCrowding === true) softWarnings.push("EXTREME_CROWDING_REVIEW");
  if (input.confirmation?.adverseSweep === true) softWarnings.push("ADVERSE_SWEEP_REQUIRES_STRUCTURE_REVIEW");
  if (input.history?.nearbyFailures >= 2) softWarnings.push("REPEATED_FAILURE_ZONE_REQUIRES_REVIEW");
  if (input.history?.failurePatternRepeated === true) softWarnings.push("HISTORICAL_FAILURE_PATTERN_REPEATED");

  const triggerReady = input.trigger?.complete === true && input.trigger?.meaningful === true && input.trigger?.protectiveStructure === true;
  let modelReady = false;
  if (model === "A") modelReady = input.setup?.trendExists === true && input.setup?.pullbackAtMeaningfulLocation === true && input.setup?.counterMoveEfficiencyFaded === true && triggerReady;
  if (model === "B") modelReady = input.setup?.breakout === true && input.setup?.retest === true && input.setup?.acceptance === true && input.setup?.rejection !== true && triggerReady;
  if (model === "C") modelReady = input.setup?.sweep === true && input.setup?.reclaim === true && input.setup?.opposingProgressFailed === true && input.setup?.structureShift === true && triggerReady;

  if (hardBlockers.length) {
    return { finalState: "NO_TRADE", operationalState: input.data?.requiredFieldsReady === true ? "NO_TRADE" : "DATA_BLOCKED", model: model || "NONE", submodel: submodel || "NONE", marketRegime: marketRegime || "UNKNOWN", regimePermission, hardBlockers: [...new Set(hardBlockers)], softWarnings: [...new Set(softWarnings)], openNow: false, scoreIgnoredForPermission: true };
  }
  if (!modelReady || regimePermission === "WAIT_ONLY") {
    return { finalState: "WAIT", operationalState: "ARMED", model, submodel, marketRegime, regimePermission, hardBlockers: [], softWarnings: [...new Set(softWarnings)], openNow: false, scoreIgnoredForPermission: true };
  }
  return { finalState: direction, operationalState: "OPEN_NOW", model, submodel, marketRegime, regimePermission, hardBlockers: [], softWarnings: [...new Set(softWarnings)], openNow: true, scoreIgnoredForPermission: true };
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: JSON_HEADERS });
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const origin = url.origin;

    if (request.method === "GET" && path === "/") return handleSnapshot(request, env, ctx);
    if (path === "/health") {
      return json({ status: "ok", build: BUILD, apiVersion: API_VERSION, upstream: "OKX perpetual execution/index/OI/funding + OKX spot ticker/book/recent trades + Gate perpetual candles/free flow + optional Coinalyze realized liquidations + Kraken Spot emergency structure fallback", normalOkxRequests: 13, gateCapitalFlowRequests: 6, coinalyzeConfigured: Boolean(env?.COINALYZE_API_KEY), coinalyzeMaximumSelectedMarkets: 6, coinalyzeRole: "OPTIONAL_REALIZED_LIQUIDATION_PROXY_NOT_FUTURE_MAP", spotFlowRole: "ACTUAL_OKX_RECENT_TRADES_NOT_PERSISTENT_CVD", futureLiquidationMapAvailable: false, exactWhalePositionsAvailable: false, coinGlassApiRequested: false, okxCandlesRequested: false, binanceRequested: false, bybitRequested: false, bytickRequested: false, bitgetRequested: false, actionCount: 4, scanner: scannerConfiguration(env), authentication: "market snapshot none; scanner endpoints bearer" });
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
