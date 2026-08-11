/**
 * Crypto Alpha Pro Ultimate V17.1
 * Cloudflare Worker, single-file dashboard edition.
 *
 * Read-only market analysis and alert monitoring. This service never places,
 * changes, or cancels exchange orders.
 */

const BUILD = "crypto-alpha-worker-v17.1.2";
const API_VERSION = "2.1.2";
const OKX_BASE = "https://www.okx.com";
const BINANCE_BASE = "https://fapi.binance.com";

const ASSETS = Object.freeze({
  "BTC-USDT-SWAP": {
    instrumentId: "BTC-USDT-SWAP",
    base: "BTC",
    okxIndexId: "BTC-USDT",
    binanceSymbol: "BTCUSDT",
  },
  "ETH-USDT-SWAP": {
    instrumentId: "ETH-USDT-SWAP",
    base: "ETH",
    okxIndexId: "ETH-USDT",
    binanceSymbol: "ETHUSDT",
  },
});

const TIMEFRAMES = Object.freeze({
  "15m": { okx: "15m", binance: "15m", ms: 15 * 60 * 1000 },
  "1h": { okx: "1H", binance: "1h", ms: 60 * 60 * 1000 },
  "4h": { okx: "4H", binance: "4h", ms: 4 * 60 * 60 * 1000 },
  "1d": { okx: "1D", binance: "1d", ms: 24 * 60 * 60 * 1000 },
});

const HORIZON_CONFIG = Object.freeze({
  SHORT: {
    primaryTf: "15m",
    confirmationTf: "1h",
    preferredLeverage: 50,
    maxDurationMs: 32 * 60 * 60 * 1000,
    rrByGrade: { B: 1.5, A: 1.8, "A+": 2.2 },
  },
  MEDIUM_SHORT: {
    primaryTf: "1h",
    confirmationTf: "4h",
    preferredLeverage: 35,
    maxDurationMs: 15 * 24 * 60 * 60 * 1000,
    rrByGrade: { B: 1.7, A: 2.0, "A+": 2.5 },
  },
  SWING: {
    primaryTf: "4h",
    confirmationTf: "1d",
    preferredLeverage: 20,
    maxDurationMs: 45 * 24 * 60 * 60 * 1000,
    rrByGrade: { B: 2.0, A: 2.3, "A+": 2.8 },
  },
});

const DEFAULT_COSTS = Object.freeze({
  // Percentage points: 0.05 means 0.05%, not 5%.
  entryFeePct: 0.05,
  exitFeePct: 0.05,
  entrySlippagePct: 0.03,
  exitSlippagePct: 0.03,
  expectedFundingPct: 0,
});

const JSON_HEADERS = Object.freeze({
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
  "access-control-allow-headers": "Content-Type,X-Alpha-Key",
});

class AlphaError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "AlphaError";
    this.code = code;
    this.httpStatus = options.httpStatus || 500;
    this.retryable = Boolean(options.retryable);
    this.provider = options.provider || null;
    this.details = options.details || null;
    this.retryAfter = options.retryAfter || null;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function toIso(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = new Date(n);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function finite(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 8) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function mean(values) {
  const v = values.filter(Number.isFinite);
  return v.length ? v.reduce((sum, x) => sum + x, 0) / v.length : null;
}

function stddev(values) {
  const m = mean(values);
  if (!Number.isFinite(m)) return null;
  const v = values.filter(Number.isFinite);
  if (v.length < 2) return 0;
  return Math.sqrt(v.reduce((sum, x) => sum + (x - m) ** 2, 0) / v.length);
}

function percentileRank(values, current) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length || !Number.isFinite(current)) return null;
  let count = 0;
  for (const x of v) if (x <= current) count += 1;
  return round((count / v.length) * 100, 2);
}

function pctChange(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return round(((current - previous) / Math.abs(previous)) * 100, 6);
}

function safeJsonParse(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function requestId() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function jsonResponse(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

function errorResponse(error, reqId) {
  const known = error instanceof AlphaError;
  const status = known ? error.httpStatus : 500;
  const headers = {};
  if (known && error.retryAfter) headers["retry-after"] = String(error.retryAfter);
  return jsonResponse(
    {
      status: "error",
      requestId: reqId,
      generatedAt: nowIso(),
      error: {
        code: known ? error.code : "INTERNAL_ERROR",
        message: known ? error.message : "Unexpected server error",
        retryable: known ? error.retryable : false,
        details: known ? error.details : null,
      },
    },
    status,
    headers,
  );
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function abortSignal(timeoutMs) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, cancel: () => clearTimeout(id) };
}

async function rawFetchJson(url, options = {}) {
  const {
    provider = "UPSTREAM",
    timeoutMs = 3200,
    retries = 1,
    headers = {},
    method = "GET",
    body,
    validator,
    cacheTtlSec = 0,
  } = options;

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const timer = abortSignal(timeoutMs);
    try {
      const response = await fetch(url, {
        method,
        headers,
        body,
        signal: timer.signal,
        cf: cacheTtlSec > 0 ? { cacheEverything: true, cacheTtl: cacheTtlSec } : undefined,
      });
      timer.cancel();

      const text = await response.text();
      if (!response.ok) {
        const retryAfter = finite(response.headers.get("retry-after"));
        throw new AlphaError(
          `HTTP_${response.status}`,
          `${provider} returned HTTP ${response.status}`,
          {
            httpStatus: 502,
            retryable: response.status === 429 || response.status >= 500,
            provider,
            retryAfter,
            details: text.slice(0, 300),
          },
        );
      }

      const data = safeJsonParse(text);
      if (data === null) {
        throw new AlphaError("INVALID_JSON", `${provider} returned invalid JSON`, {
          httpStatus: 502,
          retryable: true,
          provider,
          details: text.slice(0, 300),
        });
      }

      if (validator) validator(data);
      return {
        data,
        fetchedAt: nowIso(),
        attempts: attempt + 1,
        provider,
      };
    } catch (error) {
      timer.cancel();
      lastError =
        error instanceof AlphaError
          ? error
          : new AlphaError(
              error?.name === "AbortError" ? "TIMEOUT" : "NETWORK_ERROR",
              `${provider} request failed: ${error?.message || "unknown error"}`,
              { httpStatus: 502, retryable: true, provider },
            );

      if (!lastError.retryable || attempt >= retries) break;
      const waitMs = Math.min(1200, 180 * 2 ** attempt + Math.floor(Math.random() * 120));
      await delay(waitMs);
    }
  }
  throw lastError;
}

function validateOkx(payload) {
  if (!payload || String(payload.code) !== "0" || !Array.isArray(payload.data)) {
    throw new AlphaError("OKX_API_ERROR", payload?.msg || "Invalid OKX response", {
      httpStatus: 502,
      retryable: String(payload?.code) === "50011" || String(payload?.code).startsWith("5"),
      provider: "OKX",
      details: { upstreamCode: payload?.code || null },
    });
  }
}

function validateBinance(payload) {
  if (payload && typeof payload === "object" && !Array.isArray(payload) && Number(payload.code) < 0) {
    throw new AlphaError("BINANCE_API_ERROR", payload.msg || "Invalid Binance response", {
      httpStatus: 502,
      retryable: Number(payload.code) === -1003 || Number(payload.code) === -1007,
      provider: "BINANCE_FUTURES",
      details: { upstreamCode: payload.code },
    });
  }
}

function cacheAvailable() {
  return typeof caches !== "undefined" && caches.default;
}

function cacheUrl(key) {
  return `https://cache.crypto-alpha.internal/${encodeURIComponent(key)}`;
}

async function cacheRead(key) {
  if (!cacheAvailable()) return null;
  try {
    const response = await caches.default.match(new Request(cacheUrl(key)));
    if (!response) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function cacheWrite(key, value, maxAgeSec, ctx) {
  if (!cacheAvailable()) return;
  const operation = caches.default.put(
    new Request(cacheUrl(key)),
    new Response(JSON.stringify(value), {
      headers: {
        "content-type": "application/json",
        "cache-control": `public, max-age=${Math.max(1, Math.floor(maxAgeSec))}`,
      },
    }),
  );
  if (ctx?.waitUntil) ctx.waitUntil(operation.catch(() => {}));
  else await operation.catch(() => {});
}

async function resilientModule(options) {
  const {
    key,
    freshSec,
    staleSec,
    refresh = false,
    cacheOnly = false,
    primary,
    fallback,
    ctx,
  } = options;

  const cached = await cacheRead(key);
  const cachedAge = cached?.cachedAt ? (Date.now() - Date.parse(cached.cachedAt)) / 1000 : Infinity;
  if (!refresh && cached?.value && cachedAge <= freshSec) {
    return {
      ...cached.value,
      cache: { hit: true, stale: false, ageSec: round(cachedAge, 2) },
    };
  }

  if (cacheOnly) {
    if (cached?.value && cachedAge <= staleSec) {
      return {
        ...cached.value,
        cache: {
          hit: true,
          stale: cachedAge > freshSec,
          ageSec: round(cachedAge, 2),
        },
      };
    }
    throw new AlphaError("CACHE_MISS", `No usable cached value for ${key}`, {
      httpStatus: 503,
      retryable: true,
      details: { key, cacheOnly: true },
    });
  }

  let primaryError = null;
  try {
    const value = await primary();
    const wrapped = { ...value, fallbackUsed: false };
    await cacheWrite(key, { cachedAt: nowIso(), value: wrapped }, staleSec, ctx);
    return { ...wrapped, cache: { hit: false, stale: false, ageSec: 0 } };
  } catch (error) {
    primaryError = error;
  }

  if (fallback) {
    try {
      const value = await fallback(primaryError);
      const recoveredErrors = [serialiseError(primaryError), ...(value.sourceErrors || [])].filter(Boolean);
      const wrapped = {
        ...value,
        fallbackUsed: true,
        primaryError: serialiseError(primaryError),
        sourceError: recoveredErrors,
        sourceErrors: recoveredErrors,
      };
      await cacheWrite(key, { cachedAt: nowIso(), value: wrapped }, staleSec, ctx);
      return { ...wrapped, cache: { hit: false, stale: false, ageSec: 0 } };
    } catch (fallbackError) {
      if (cached?.value && cachedAge <= staleSec) {
        const sourceError = [serialiseError(primaryError), serialiseError(fallbackError)].filter(Boolean);
        return {
          ...cached.value,
          fallbackUsed: Boolean(cached.value.fallbackUsed),
          sourceError,
          sourceErrors: sourceError,
          cache: { hit: true, stale: true, ageSec: round(cachedAge, 2) },
        };
      }
      throw new AlphaError("ALL_SOURCES_FAILED", `All sources failed for ${key}`, {
        httpStatus: 502,
        retryable: true,
        details: [serialiseError(primaryError), serialiseError(fallbackError)],
      });
    }
  }

  if (cached?.value && cachedAge <= staleSec) {
    const sourceError = [serialiseError(primaryError)].filter(Boolean);
    return {
      ...cached.value,
      sourceError,
      sourceErrors: sourceError,
      cache: { hit: true, stale: true, ageSec: round(cachedAge, 2) },
    };
  }
  throw primaryError;
}

function serialiseError(error) {
  if (!error) return null;
  return {
    code: error.code || error.name || "ERROR",
    message: error.message || String(error),
    provider: error.provider || null,
    retryable: Boolean(error.retryable),
    details: error.details || null,
  };
}

function moduleMeta(status, source, observedAt, options = {}) {
  const ageSec = observedAt ? Math.max(0, (Date.now() - Date.parse(observedAt)) / 1000) : null;
  return {
    status,
    observedAt: observedAt || null,
    ageSec: Number.isFinite(ageSec) ? round(ageSec, 2) : null,
    source: source || null,
    fallbackUsed: Boolean(options.fallbackUsed),
    cached: Boolean(options.cached),
    errorCode: options.errorCode || null,
    errorMessage: options.errorMessage || null,
  };
}

function unavailableMeta(errorCode, errorMessage, source = null) {
  return moduleMeta("NOT_AVAILABLE", source, null, { errorCode, errorMessage });
}

function ema(values, period) {
  const v = values.filter(Number.isFinite);
  if (v.length < period) return null;
  let result = v.slice(0, period).reduce((sum, x) => sum + x, 0) / period;
  const k = 2 / (period + 1);
  for (let i = period; i < v.length; i += 1) result = v[i] * k + result * (1 - k);
  return result;
}

function rsi(values, period = 14) {
  const v = values.filter(Number.isFinite);
  if (v.length <= period) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i += 1) {
    const diff = v[i] - v[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < v.length; i += 1) {
    const diff = v[i] - v[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function trueRanges(candles) {
  const result = [];
  for (let i = 1; i < candles.length; i += 1) {
    const current = candles[i];
    const previous = candles[i - 1];
    result.push(
      Math.max(
        current.high - current.low,
        Math.abs(current.high - previous.close),
        Math.abs(current.low - previous.close),
      ),
    );
  }
  return result;
}

function wilderLatest(values, period = 14) {
  const v = values.filter(Number.isFinite);
  if (v.length < period) return null;
  let smoothed = v.slice(0, period).reduce((sum, x) => sum + x, 0) / period;
  for (let i = period; i < v.length; i += 1) {
    smoothed = (smoothed * (period - 1) + v[i]) / period;
  }
  return smoothed;
}

function atr(candles, period = 14) {
  return wilderLatest(trueRanges(candles), period);
}

function adx(candles, period = 14) {
  if (candles.length < period * 2 + 2) return null;
  const tr = [];
  const plusDm = [];
  const minusDm = [];
  for (let i = 1; i < candles.length; i += 1) {
    const current = candles[i];
    const previous = candles[i - 1];
    const up = current.high - previous.high;
    const down = previous.low - current.low;
    tr.push(
      Math.max(
        current.high - current.low,
        Math.abs(current.high - previous.close),
        Math.abs(current.low - previous.close),
      ),
    );
    plusDm.push(up > down && up > 0 ? up : 0);
    minusDm.push(down > up && down > 0 ? down : 0);
  }

  let smoothTr = tr.slice(0, period).reduce((s, x) => s + x, 0);
  let smoothPlus = plusDm.slice(0, period).reduce((s, x) => s + x, 0);
  let smoothMinus = minusDm.slice(0, period).reduce((s, x) => s + x, 0);
  const dx = [];
  for (let i = period; i < tr.length; i += 1) {
    if (i > period) {
      smoothTr = smoothTr - smoothTr / period + tr[i];
      smoothPlus = smoothPlus - smoothPlus / period + plusDm[i];
      smoothMinus = smoothMinus - smoothMinus / period + minusDm[i];
    }
    if (smoothTr === 0) continue;
    const plusDi = (100 * smoothPlus) / smoothTr;
    const minusDi = (100 * smoothMinus) / smoothTr;
    const denom = plusDi + minusDi;
    if (denom > 0) dx.push((100 * Math.abs(plusDi - minusDi)) / denom);
  }
  return wilderLatest(dx, period);
}

function rollingVwap(candles, period = 20) {
  const slice = candles.slice(-period);
  let numerator = 0;
  let denominator = 0;
  for (const c of slice) {
    const typical = (c.high + c.low + c.close) / 3;
    numerator += typical * c.volume;
    denominator += c.volume;
  }
  return denominator > 0 ? numerator / denominator : null;
}

function findPivots(candles, left = 3, right = 3, lookback = 120) {
  const start = Math.max(left, candles.length - lookback);
  const highs = [];
  const lows = [];
  for (let i = start; i < candles.length - right; i += 1) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - left; j <= i + right; j += 1) {
      if (j === i) continue;
      if (candles[j].high >= candles[i].high) isHigh = false;
      if (candles[j].low <= candles[i].low) isLow = false;
    }
    if (isHigh) highs.push({ price: candles[i].high, ts: candles[i].ts, index: i });
    if (isLow) lows.push({ price: candles[i].low, ts: candles[i].ts, index: i });
  }
  return { highs, lows };
}

function classifyStructure(candles, pivots, currentAdx) {
  const lastClose = candles.at(-1)?.close;
  const highs = pivots.highs.slice(-2);
  const lows = pivots.lows.slice(-2);
  const previousHigh = highs.at(-1)?.price;
  const previousLow = lows.at(-1)?.price;

  if (Number.isFinite(previousHigh) && lastClose > previousHigh) return "BREAKOUT_UP";
  if (Number.isFinite(previousLow) && lastClose < previousLow) return "BREAKOUT_DOWN";
  if (highs.length >= 2 && lows.length >= 2) {
    const higherHigh = highs[1].price > highs[0].price;
    const higherLow = lows[1].price > lows[0].price;
    const lowerHigh = highs[1].price < highs[0].price;
    const lowerLow = lows[1].price < lows[0].price;
    if (higherHigh && higherLow) return "HH_HL";
    if (lowerHigh && lowerLow) return "LH_LL";
    if (Number.isFinite(currentAdx) && currentAdx < 18) return "RANGE";
  }
  return "TRANSITION";
}

function classifyTrend(structure, ema20Value, ema50Value, ema200Value, currentAdx) {
  const bullEma = ema20Value > ema50Value && ema50Value > ema200Value;
  const bearEma = ema20Value < ema50Value && ema50Value < ema200Value;
  if (["HH_HL", "BREAKOUT_UP"].includes(structure) && (bullEma || currentAdx >= 18)) return "BULLISH";
  if (["LH_LL", "BREAKOUT_DOWN"].includes(structure) && (bearEma || currentAdx >= 18)) return "BEARISH";
  if (structure === "RANGE" || (Number.isFinite(currentAdx) && currentAdx < 16)) return "RANGE";
  return "TRANSITION";
}

function analyseCandles(candles, timeframe) {
  if (!Array.isArray(candles) || candles.length < 205) {
    throw new AlphaError("INSUFFICIENT_CANDLES", `${timeframe} needs at least 205 closed candles`, {
      httpStatus: 502,
      retryable: true,
      details: { received: Array.isArray(candles) ? candles.length : 0 },
    });
  }
  const clean = candles
    .filter(
      (c) =>
        Number.isFinite(c.ts) &&
        Number.isFinite(c.open) &&
        Number.isFinite(c.high) &&
        Number.isFinite(c.low) &&
        Number.isFinite(c.close) &&
        Number.isFinite(c.volume),
    )
    .sort((a, b) => a.ts - b.ts);
  const closes = clean.map((c) => c.close);
  const volumes = clean.map((c) => c.volume);
  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  const e200 = ema(closes, 200);
  const r14 = rsi(closes, 14);
  const a14 = atr(clean, 14);
  const d14 = adx(clean, 14);
  const volumeWindow = volumes.slice(-20);
  const volumeMean = mean(volumeWindow);
  const volumeSd = stddev(volumeWindow);
  const volumeZ = volumeSd > 0 ? (volumes.at(-1) - volumeMean) / volumeSd : 0;
  const pivots = findPivots(clean);
  const structure = classifyStructure(clean, pivots, d14);
  const trend = classifyTrend(structure, e20, e50, e200, d14);
  const last = clean.at(-1);

  return {
    candleCount: clean.length,
    lastClosedAt: toIso(last.ts + TIMEFRAMES[timeframe].ms),
    price: round(last.close, 8),
    ema20: round(e20, 8),
    ema50: round(e50, 8),
    ema200: round(e200, 8),
    rsi14: round(r14, 4),
    atr14: round(a14, 8),
    atrPct: round((a14 / last.close) * 100, 6),
    adx14: round(d14, 4),
    volume20Mean: round(volumeMean, 8),
    volumeZScore: round(volumeZ, 4),
    trend,
    structure,
    swingHigh: round(pivots.highs.at(-1)?.price, 8),
    previousSwingHigh: round(pivots.highs.at(-2)?.price, 8),
    swingLow: round(pivots.lows.at(-1)?.price, 8),
    previousSwingLow: round(pivots.lows.at(-2)?.price, 8),
    vwap20: round(rollingVwap(clean, 20), 8),
    pivots: {
      highs: pivots.highs.slice(-8).map((x) => ({ price: round(x.price, 8), observedAt: toIso(x.ts) })),
      lows: pivots.lows.slice(-8).map((x) => ({ price: round(x.price, 8), observedAt: toIso(x.ts) })),
    },
  };
}

async function okxGet(path, options = {}) {
  return rawFetchJson(`${OKX_BASE}${path}`, {
    provider: "OKX",
    timeoutMs: options.timeoutMs || 3200,
    // A full BTC + ETH snapshot already uses many independent endpoints.
    // Do not spend a second external subrequest on the same failed endpoint;
    // module-level cache/fallback handling is safer on the Workers Free limit.
    retries: options.retries ?? 0,
    cacheTtlSec: options.cacheTtlSec || 0,
    validator: validateOkx,
  });
}

async function binanceGet(path, options = {}) {
  return rawFetchJson(`${BINANCE_BASE}${path}`, {
    provider: "BINANCE_FUTURES_FALLBACK",
    timeoutMs: options.timeoutMs || 3200,
    retries: options.retries ?? 0,
    cacheTtlSec: options.cacheTtlSec || 0,
    validator: validateBinance,
  });
}

function settledValue(result) {
  return result?.status === "fulfilled" ? result.value : null;
}

function settledError(result) {
  return result?.status === "rejected" ? serialiseError(result.reason) : null;
}

function resultMeta(result, staleThresholdSec = null) {
  const observedAt = result?.observedAt || result?.fetchedAt || null;
  const ageSec = observedAt ? Math.max(0, (Date.now() - Date.parse(observedAt)) / 1000) : null;
  let status = result?.partial ? "PARTIAL" : "OK";
  if (result?.cache?.stale || (Number.isFinite(staleThresholdSec) && ageSec > staleThresholdSec)) {
    status = "STALE";
  }
  return moduleMeta(status, result?.source, observedAt, {
    fallbackUsed: result?.fallbackUsed,
    cached: result?.cache?.hit,
    errorCode: result?.sourceError ? "SOURCE_RECOVERED" : null,
    errorMessage: result?.sourceError ? "A source failed; cached or fallback data was used." : null,
  });
}

function parseOkxTicker(row) {
  return {
    last: finite(row?.last),
    bid: finite(row?.bidPx),
    ask: finite(row?.askPx),
    high24h: finite(row?.high24h),
    low24h: finite(row?.low24h),
    open24h: finite(row?.open24h),
    baseVolume24h: finite(row?.vol24h),
    quoteVolume24h: finite(row?.volCcy24h),
    observedAt: toIso(row?.ts),
  };
}

async function fetchTicker(asset, refresh, ctx) {
  const key = `ticker:${asset.instrumentId}`;
  const result = await resilientModule({
    key,
    freshSec: 5,
    staleSec: 120,
    refresh,
    ctx,
    primary: async () => {
      const [tickerResult, markResult, indexResult] = await Promise.allSettled([
        okxGet(`/api/v5/market/ticker?instId=${asset.instrumentId}`, { cacheTtlSec: 2 }),
        okxGet(`/api/v5/public/mark-price?instType=SWAP&instId=${asset.instrumentId}`, {
          cacheTtlSec: 2,
        }),
        okxGet(`/api/v5/market/index-tickers?instId=${asset.okxIndexId}`, { cacheTtlSec: 2 }),
      ]);
      const tickerResponse = settledValue(tickerResult);
      if (!tickerResponse?.data?.data?.[0]) throw tickerResult.reason || new Error("OKX ticker empty");
      const ticker = parseOkxTicker(tickerResponse.data.data[0]);
      const markRow = settledValue(markResult)?.data?.data?.[0] || null;
      const indexRow = settledValue(indexResult)?.data?.data?.[0] || null;
      const mark = finite(markRow?.markPx);
      const index = finite(indexRow?.idxPx);
      return {
        source: "OKX",
        observedAt: ticker.observedAt || tickerResponse.fetchedAt,
        fetchedAt: tickerResponse.fetchedAt,
        partial: !Number.isFinite(mark) || !Number.isFinite(index),
        sourceErrors: unique([settledError(markResult), settledError(indexResult)]).filter(Boolean),
        data: {
          ...ticker,
          mark,
          index,
          spreadBps:
            Number.isFinite(ticker.bid) && Number.isFinite(ticker.ask) && ticker.ask + ticker.bid > 0
              ? round(((ticker.ask - ticker.bid) / ((ticker.ask + ticker.bid) / 2)) * 10000, 4)
              : null,
          basisPct:
            Number.isFinite(mark) && Number.isFinite(index) && index !== 0
              ? round(((mark - index) / index) * 100, 6)
              : null,
        },
      };
    },
    fallback: async () => {
      const [ticker, book, premium] = await Promise.all([
        binanceGet(`/fapi/v1/ticker/24hr?symbol=${asset.binanceSymbol}`, { cacheTtlSec: 2 }),
        binanceGet(`/fapi/v1/ticker/bookTicker?symbol=${asset.binanceSymbol}`, { cacheTtlSec: 2 }),
        binanceGet(`/fapi/v1/premiumIndex?symbol=${asset.binanceSymbol}`, { cacheTtlSec: 2 }),
      ]);
      const t = ticker.data;
      const b = book.data;
      const p = premium.data;
      const bid = finite(b.bidPrice);
      const ask = finite(b.askPrice);
      const mark = finite(p.markPrice);
      const index = finite(p.indexPrice);
      return {
        source: "BINANCE_FUTURES_FALLBACK",
        observedAt: toIso(p.time || t.closeTime) || premium.fetchedAt,
        fetchedAt: premium.fetchedAt,
        partial: false,
        data: {
          last: finite(t.lastPrice),
          bid,
          ask,
          high24h: finite(t.highPrice),
          low24h: finite(t.lowPrice),
          open24h: finite(t.openPrice),
          baseVolume24h: finite(t.volume),
          quoteVolume24h: finite(t.quoteVolume),
          mark,
          index,
          spreadBps:
            Number.isFinite(bid) && Number.isFinite(ask) && bid + ask > 0
              ? round(((ask - bid) / ((ask + bid) / 2)) * 10000, 4)
              : null,
          basisPct:
            Number.isFinite(mark) && Number.isFinite(index) && index !== 0
              ? round(((mark - index) / index) * 100, 6)
              : null,
          observedAt: toIso(p.time || t.closeTime),
        },
      };
    },
  });

  return {
    meta: resultMeta(result, 30),
    ...result.data,
    sourceErrors: (result.sourceErrors || result.sourceError || []).filter(Boolean),
  };
}

function parseOkxCandles(rows, timeframe) {
  const duration = TIMEFRAMES[timeframe].ms;
  return rows
    .map((row) => ({
      ts: finite(row?.[0]),
      open: finite(row?.[1]),
      high: finite(row?.[2]),
      low: finite(row?.[3]),
      close: finite(row?.[4]),
      volume: finite(row?.[5]),
      quoteVolume: finite(row?.[7]),
      confirmed: String(row?.[8]) === "1",
    }))
    .filter((c) => c.confirmed || c.ts + duration <= Date.now())
    .sort((a, b) => a.ts - b.ts);
}

function parseBinanceCandles(rows) {
  return rows
    .map((row) => ({
      ts: finite(row?.[0]),
      open: finite(row?.[1]),
      high: finite(row?.[2]),
      low: finite(row?.[3]),
      close: finite(row?.[4]),
      volume: finite(row?.[5]),
      closeTime: finite(row?.[6]),
      quoteVolume: finite(row?.[7]),
      takerBuyBaseVolume: finite(row?.[9]),
      takerBuyQuoteVolume: finite(row?.[10]),
    }))
    .filter((c) => c.closeTime <= Date.now())
    .sort((a, b) => a.ts - b.ts);
}

async function fetchTimeframe(asset, timeframe, refresh, ctx) {
  const tf = TIMEFRAMES[timeframe];
  const freshSec = Math.min(120, Math.max(12, tf.ms / 1000 / 20));
  const staleSec = Math.max(300, (tf.ms / 1000) * 2.2);
  const result = await resilientModule({
    key: `candles:${asset.instrumentId}:${timeframe}`,
    freshSec,
    staleSec,
    refresh,
    ctx,
    primary: async () => {
      const response = await okxGet(
        `/api/v5/market/candles?instId=${asset.instrumentId}&bar=${tf.okx}&limit=300`,
        { cacheTtlSec: Math.floor(freshSec) },
      );
      const candles = parseOkxCandles(response.data.data, timeframe);
      const analysis = analyseCandles(candles, timeframe);
      return {
        source: "OKX",
        observedAt: analysis.lastClosedAt,
        fetchedAt: response.fetchedAt,
        data: analysis,
      };
    },
    fallback: async () => {
      const response = await binanceGet(
        `/fapi/v1/klines?symbol=${asset.binanceSymbol}&interval=${tf.binance}&limit=300`,
        { cacheTtlSec: Math.floor(freshSec) },
      );
      const candles = parseBinanceCandles(response.data);
      const analysis = analyseCandles(candles, timeframe);
      return {
        source: "BINANCE_FUTURES_FALLBACK",
        observedAt: analysis.lastClosedAt,
        fetchedAt: response.fetchedAt,
        data: analysis,
      };
    },
  });
  return {
    meta: resultMeta(result, (tf.ms / 1000) * 2),
    ...result.data,
    sourceErrors: (result.sourceError || []).filter(Boolean),
  };
}

function parseOkxOiRows(rows, priceHint) {
  return rows
    .map((row) => {
      if (Array.isArray(row)) {
        const coin = finite(row[2]);
        return {
          ts: finite(row[0]),
          coin,
          usd: finite(row[3], Number.isFinite(coin) && Number.isFinite(priceHint) ? coin * priceHint : null),
        };
      }
      const coin = finite(row?.oiCcy ?? row?.oi);
      return {
        ts: finite(row?.ts),
        coin,
        usd: finite(row?.oiUsd, Number.isFinite(coin) && Number.isFinite(priceHint) ? coin * priceHint : null),
      };
    })
    .filter((x) => Number.isFinite(x.ts) && Number.isFinite(x.usd))
    .sort((a, b) => a.ts - b.ts);
}

function historyValueAgo(series, agoMs) {
  if (!series.length) return null;
  const target = Date.now() - agoMs;
  let best = null;
  let bestDistance = Infinity;
  for (const row of series) {
    const distance = Math.abs(row.ts - target);
    if (distance < bestDistance) {
      best = row;
      bestDistance = distance;
    }
  }
  return best;
}

function oiChangeSet(series, currentUsd) {
  const horizons = {
    change5mPct: 5 * 60 * 1000,
    change15mPct: 15 * 60 * 1000,
    change1hPct: 60 * 60 * 1000,
    change4hPct: 4 * 60 * 60 * 1000,
    change24hPct: 24 * 60 * 60 * 1000,
  };
  const output = {};
  for (const [key, ago] of Object.entries(horizons)) {
    output[key] = pctChange(currentUsd, historyValueAgo(series, ago)?.usd);
  }
  return output;
}

async function fetchOpenInterest(asset, priceHint, refresh, ctx) {
  const result = await resilientModule({
    key: `oi:${asset.instrumentId}`,
    freshSec: 45,
    staleSec: 600,
    refresh,
    ctx,
    primary: async () => {
      const [currentResult, history5mResult, history1hResult] = await Promise.allSettled([
        okxGet(`/api/v5/public/open-interest?instType=SWAP&instId=${asset.instrumentId}`, {
          cacheTtlSec: 20,
        }),
        okxGet(
          `/api/v5/rubik/stat/contracts/open-interest-history?instId=${asset.instrumentId}&period=5m&limit=100`,
          { cacheTtlSec: 45 },
        ),
        okxGet(
          `/api/v5/rubik/stat/contracts/open-interest-history?instId=${asset.instrumentId}&period=1H&limit=30`,
          { cacheTtlSec: 120 },
        ),
      ]);
      const currentResponse = settledValue(currentResult);
      const currentRow = currentResponse?.data?.data?.[0];
      if (!currentRow) throw currentResult.reason || new Error("OKX open interest empty");
      const currentCoin = finite(currentRow.oiCcy ?? currentRow.oi);
      const history = [
        ...parseOkxOiRows(settledValue(history5mResult)?.data?.data || [], priceHint),
        ...parseOkxOiRows(settledValue(history1hResult)?.data?.data || [], priceHint),
      ].sort((a, b) => a.ts - b.ts);
      const currentUsd = finite(
        currentRow.oiUsd,
        Number.isFinite(currentCoin) && Number.isFinite(priceHint)
          ? currentCoin * priceHint
          : history.at(-1)?.usd,
      );
      if (!Number.isFinite(currentUsd)) throw new Error("OKX open interest has no usable value");
      return {
        source: "OKX",
        observedAt: toIso(currentRow.ts) || currentResponse.fetchedAt,
        fetchedAt: currentResponse.fetchedAt,
        partial: history.length < 10,
        sourceErrors: [settledError(history5mResult), settledError(history1hResult)].filter(Boolean),
        data: {
          currentCoin: round(currentCoin, 8),
          currentUsd: round(currentUsd, 2),
          ...oiChangeSet(history, currentUsd),
          historyPoints: history.length,
        },
      };
    },
    fallback: async () => {
      const [current, history] = await Promise.all([
        binanceGet(`/fapi/v1/openInterest?symbol=${asset.binanceSymbol}`, { cacheTtlSec: 20 }),
        binanceGet(
          `/futures/data/openInterestHist?symbol=${asset.binanceSymbol}&period=5m&limit=500`,
          { cacheTtlSec: 45 },
        ),
      ]);
      const series = (Array.isArray(history.data) ? history.data : [])
        .map((row) => ({
          ts: finite(row.timestamp),
          coin: finite(row.sumOpenInterest),
          usd: finite(row.sumOpenInterestValue),
        }))
        .filter((x) => Number.isFinite(x.ts) && Number.isFinite(x.usd))
        .sort((a, b) => a.ts - b.ts);
      const currentCoin = finite(current.data.openInterest);
      const latest = series.at(-1);
      const currentUsd = finite(
        latest?.usd,
        Number.isFinite(currentCoin) && Number.isFinite(priceHint) ? currentCoin * priceHint : null,
      );
      if (!Number.isFinite(currentUsd)) throw new Error("Binance open interest has no usable value");
      return {
        source: "BINANCE_FUTURES_FALLBACK",
        observedAt: toIso(current.data.time || latest?.ts) || current.fetchedAt,
        fetchedAt: current.fetchedAt,
        partial: series.length < 50,
        data: {
          currentCoin: round(currentCoin, 8),
          currentUsd: round(currentUsd, 2),
          ...oiChangeSet(series, currentUsd),
          historyPoints: series.length,
        },
      };
    },
  });
  return {
    meta: resultMeta(result, 300),
    ...result.data,
    sourceErrors: (result.sourceErrors || result.sourceError || []).filter(Boolean),
  };
}

function fundingStats(rates, currentRate) {
  const clean = rates.filter(Number.isFinite);
  const m = mean(clean);
  const sd = stddev(clean);
  return {
    percentile30d: percentileRank(clean, currentRate),
    zScore30d: Number.isFinite(sd) && sd > 0 ? round((currentRate - m) / sd, 4) : null,
    historyPoints: clean.length,
  };
}

async function fetchFunding(asset, refresh, ctx) {
  const result = await resilientModule({
    key: `funding:${asset.instrumentId}`,
    freshSec: 60,
    staleSec: 900,
    refresh,
    ctx,
    primary: async () => {
      const [currentResult, historyResult] = await Promise.allSettled([
        okxGet(`/api/v5/public/funding-rate?instId=${asset.instrumentId}`, { cacheTtlSec: 30 }),
        okxGet(`/api/v5/public/funding-rate-history?instId=${asset.instrumentId}&limit=100`, {
          cacheTtlSec: 300,
        }),
      ]);
      const currentResponse = settledValue(currentResult);
      const row = currentResponse?.data?.data?.[0];
      if (!row) throw currentResult.reason || new Error("OKX funding empty");
      const currentRate = finite(row.fundingRate);
      if (!Number.isFinite(currentRate)) throw new Error("OKX funding rate is missing");
      const historyRows = settledValue(historyResult)?.data?.data || [];
      const rates = historyRows.map((x) => finite(x?.fundingRate)).filter(Number.isFinite);
      return {
        source: "OKX",
        observedAt: toIso(row.ts) || currentResponse.fetchedAt,
        fetchedAt: currentResponse.fetchedAt,
        partial: rates.length < 20,
        sourceErrors: [settledError(historyResult)].filter(Boolean),
        data: {
          currentRate,
          currentRatePct: round(currentRate * 100, 6),
          nextRate: finite(row.nextFundingRate),
          nextFundingAt: toIso(row.nextFundingTime || row.fundingTime),
          method: row.method || null,
          ...fundingStats(rates, currentRate),
        },
      };
    },
    fallback: async () => {
      const [premium, history] = await Promise.all([
        binanceGet(`/fapi/v1/premiumIndex?symbol=${asset.binanceSymbol}`, { cacheTtlSec: 30 }),
        binanceGet(`/fapi/v1/fundingRate?symbol=${asset.binanceSymbol}&limit=100`, {
          cacheTtlSec: 300,
        }),
      ]);
      const currentRate = finite(premium.data.lastFundingRate);
      if (!Number.isFinite(currentRate)) throw new Error("Binance funding rate is missing");
      const rates = (Array.isArray(history.data) ? history.data : [])
        .map((x) => finite(x.fundingRate))
        .filter(Number.isFinite);
      return {
        source: "BINANCE_FUTURES_FALLBACK",
        observedAt: toIso(premium.data.time) || premium.fetchedAt,
        fetchedAt: premium.fetchedAt,
        partial: rates.length < 20,
        data: {
          currentRate,
          currentRatePct: round(currentRate * 100, 6),
          nextRate: null,
          nextFundingAt: toIso(premium.data.nextFundingTime),
          method: null,
          ...fundingStats(rates, currentRate),
        },
      };
    },
  });
  return {
    meta: resultMeta(result, 300),
    ...result.data,
    sourceErrors: (result.sourceErrors || result.sourceError || []).filter(Boolean),
  };
}

function parseOkxRatioRows(rows) {
  return rows
    .map((row) => {
      if (Array.isArray(row)) return { ts: finite(row[0]), ratio: finite(row.at(-1)) };
      return { ts: finite(row?.ts), ratio: finite(row?.ratio ?? row?.longShortRatio) };
    })
    .filter((x) => Number.isFinite(x.ts) && Number.isFinite(x.ratio))
    .sort((a, b) => a.ts - b.ts);
}

function parseOkxTakerRows(rows) {
  return rows
    .map((row) => {
      if (Array.isArray(row)) {
        return { ts: finite(row[0]), sell: finite(row[1]), buy: finite(row[2]) };
      }
      return {
        ts: finite(row?.ts),
        sell: finite(row?.sellVol ?? row?.sellVolume),
        buy: finite(row?.buyVol ?? row?.buyVolume),
      };
    })
    .filter((x) => Number.isFinite(x.ts) && Number.isFinite(x.buy) && Number.isFinite(x.sell))
    .sort((a, b) => a.ts - b.ts);
}

function sumSince(rows, field, sinceMs) {
  const cutoff = Date.now() - sinceMs;
  return rows.filter((x) => x.ts >= cutoff).reduce((sum, x) => sum + (finite(x[field], 0) || 0), 0);
}

async function fetchPositioning(asset, refresh, ctx, cacheOnly = false) {
  const result = await resilientModule({
    key: `positioning:${asset.instrumentId}`,
    freshSec: 50,
    staleSec: 600,
    refresh,
    cacheOnly,
    ctx,
    primary: async () => {
      const [ratioResult, takerResult] = await Promise.allSettled([
        okxGet(
          `/api/v5/rubik/stat/contracts/long-short-account-ratio?ccy=${asset.base}&period=5m&limit=100`,
          { cacheTtlSec: 45 },
        ),
        okxGet(`/api/v5/rubik/stat/taker-volume?ccy=${asset.base}&instType=SWAP&period=5m`, {
          cacheTtlSec: 45,
        }),
      ]);
      const ratios = parseOkxRatioRows(settledValue(ratioResult)?.data?.data || []);
      const takers = parseOkxTakerRows(settledValue(takerResult)?.data?.data || []);
      if (!ratios.length && !takers.length) {
        throw ratioResult.reason || takerResult.reason || new Error("OKX positioning empty");
      }
      const buy1h = sumSince(takers, "buy", 60 * 60 * 1000);
      const sell1h = sumSince(takers, "sell", 60 * 60 * 1000);
      return {
        source: "OKX",
        observedAt: toIso(Math.max(ratios.at(-1)?.ts || 0, takers.at(-1)?.ts || 0)),
        fetchedAt: settledValue(ratioResult)?.fetchedAt || settledValue(takerResult)?.fetchedAt,
        partial: !ratios.length || !takers.length,
        sourceErrors: [settledError(ratioResult), settledError(takerResult)].filter(Boolean),
        data: {
          globalLongShortRatio: round(ratios.at(-1)?.ratio, 6),
          topTraderLongShortRatio: null,
          takerBuySellRatio1h: sell1h > 0 ? round(buy1h / sell1h, 6) : null,
          takerBuyVolume1h: round(buy1h, 4),
          takerSellVolume1h: round(sell1h, 4),
        },
      };
    },
    fallback: async () => {
      const [globalResult, topResult, takerResult] = await Promise.allSettled([
        binanceGet(
          `/futures/data/globalLongShortAccountRatio?symbol=${asset.binanceSymbol}&period=5m&limit=100`,
          { cacheTtlSec: 45 },
        ),
        binanceGet(
          `/futures/data/topLongShortAccountRatio?symbol=${asset.binanceSymbol}&period=5m&limit=100`,
          { cacheTtlSec: 45 },
        ),
        binanceGet(
          `/futures/data/takerlongshortRatio?symbol=${asset.binanceSymbol}&period=5m&limit=100`,
          { cacheTtlSec: 45 },
        ),
      ]);
      const globalRatio = settledValue(globalResult);
      const topRatio = settledValue(topResult);
      const taker = settledValue(takerResult);
      const globals = Array.isArray(globalRatio?.data) ? globalRatio.data : [];
      const tops = Array.isArray(topRatio?.data) ? topRatio.data : [];
      const takers = Array.isArray(taker?.data) ? taker.data : [];
      if (!globals.length && !takers.length) {
        throw globalResult.reason || takerResult.reason || new Error("Binance positioning empty");
      }
      const latestTaker = takers.at(-1) || {};
      return {
        source: "BINANCE_FUTURES_FALLBACK",
        observedAt:
          toIso(latestTaker.timestamp || globals.at(-1)?.timestamp || tops.at(-1)?.timestamp) ||
          taker?.fetchedAt || globalRatio?.fetchedAt,
        fetchedAt: taker?.fetchedAt || globalRatio?.fetchedAt,
        partial: !globals.length || !takers.length || !tops.length,
        sourceErrors: [settledError(globalResult), settledError(topResult), settledError(takerResult)].filter(Boolean),
        data: {
          globalLongShortRatio: finite(globals.at(-1)?.longShortRatio),
          topTraderLongShortRatio: finite(tops.at(-1)?.longShortRatio),
          takerBuySellRatio1h: finite(latestTaker.buySellRatio),
          takerBuyVolume1h: finite(latestTaker.buyVol),
          takerSellVolume1h: finite(latestTaker.sellVol),
        },
      };
    },
  });
  return {
    meta: resultMeta(result, 300),
    ...result.data,
    sourceErrors: (result.sourceErrors || result.sourceError || []).filter(Boolean),
  };
}

function orderBookStats(bids, asks) {
  const bidNotional = bids.reduce((sum, row) => sum + finite(row[0], 0) * finite(row[1], 0), 0);
  const askNotional = asks.reduce((sum, row) => sum + finite(row[0], 0) * finite(row[1], 0), 0);
  const total = bidNotional + askNotional;
  return {
    bidNotional: round(bidNotional, 2),
    askNotional: round(askNotional, 2),
    bookImbalancePct: total > 0 ? round(((bidNotional - askNotional) / total) * 100, 4) : null,
    depthLevels: Math.min(bids.length, asks.length),
  };
}

async function fetchOrderBook(asset, refresh, ctx, cacheOnly = false) {
  const result = await resilientModule({
    key: `book:${asset.instrumentId}`,
    freshSec: 5,
    staleSec: 90,
    refresh,
    cacheOnly,
    ctx,
    primary: async () => {
      const response = await okxGet(`/api/v5/market/books?instId=${asset.instrumentId}&sz=20`, {
        cacheTtlSec: 2,
      });
      const row = response.data.data[0];
      if (!row) throw new Error("OKX order book empty");
      return {
        source: "OKX",
        observedAt: toIso(row.ts) || response.fetchedAt,
        fetchedAt: response.fetchedAt,
        data: orderBookStats(row.bids || [], row.asks || []),
      };
    },
    fallback: async () => {
      const response = await binanceGet(`/fapi/v1/depth?symbol=${asset.binanceSymbol}&limit=20`, {
        cacheTtlSec: 2,
      });
      return {
        source: "BINANCE_FUTURES_FALLBACK",
        observedAt: toIso(response.data.E || response.data.T) || response.fetchedAt,
        fetchedAt: response.fetchedAt,
        data: orderBookStats(response.data.bids || [], response.data.asks || []),
      };
    },
  });
  return {
    meta: resultMeta(result, 30),
    ...result.data,
    sourceErrors: (result.sourceError || []).filter(Boolean),
  };
}

function flowLabel(ratio, imbalance) {
  const ratioValue = finite(ratio, 1);
  const imbalanceValue = finite(imbalance, 0);
  if (ratioValue >= 1.08 && imbalanceValue >= -10) return "BUY";
  if (ratioValue <= 0.92 && imbalanceValue <= 10) return "SELL";
  return "BALANCED";
}

async function fetchLiquidations(asset, priceHint, refresh, ctx, cacheOnly = false) {
  try {
    const result = await resilientModule({
      key: `liquidations:${asset.instrumentId}`,
      freshSec: 50,
      staleSec: 600,
      refresh,
      cacheOnly,
      ctx,
      primary: async () => {
        const response = await okxGet(
          `/api/v5/public/liquidation-orders?instType=SWAP&uly=${asset.base}-USDT&state=filled&limit=100`,
          { cacheTtlSec: 45 },
        );
        const records = [];
        for (const group of response.data.data || []) {
          const details = Array.isArray(group.details) ? group.details : [group];
          for (const detail of details) {
            const ts = finite(detail.ts ?? group.ts);
            const px = finite(detail.bkPx ?? detail.px, priceHint);
            const size = finite(detail.sz, 0);
            const usd = finite(detail.bkLoss, Number.isFinite(px) ? Math.abs(size * px) : null);
            if (Number.isFinite(ts) && Number.isFinite(usd)) records.push({ ts, usd: Math.abs(usd) });
          }
        }
        const sumWindow = (ms) =>
          round(records.filter((x) => x.ts >= Date.now() - ms).reduce((s, x) => s + x.usd, 0), 2);
        return {
          source: "OKX",
          observedAt: toIso(Math.max(...records.map((x) => x.ts), Date.now())) || response.fetchedAt,
          fetchedAt: response.fetchedAt,
          data: {
            liquidation15mUsd: sumWindow(15 * 60 * 1000),
            liquidation1hUsd: sumWindow(60 * 60 * 1000),
            liquidation4hUsd: sumWindow(4 * 60 * 60 * 1000),
            recordCount: records.length,
          },
        };
      },
    });
    return {
      meta: resultMeta(result, 300),
      ...result.data,
      sourceErrors: (result.sourceError || []).filter(Boolean),
    };
  } catch (error) {
    return {
      meta: unavailableMeta(error.code || "LIQUIDATION_SOURCE_FAILED", error.message, "OKX"),
      liquidation15mUsd: null,
      liquidation1hUsd: null,
      liquidation4hUsd: null,
      recordCount: 0,
      sourceErrors: [serialiseError(error)],
    };
  }
}

function rejectedModule(error, fields = {}, source = null) {
  const serialised = serialiseError(error);
  return {
    meta: unavailableMeta(serialised.code, serialised.message, source || serialised.provider),
    ...fields,
    sourceErrors: [serialised],
  };
}

function moduleUsable(module) {
  return ["OK", "PARTIAL", "STALE"].includes(module?.meta?.status);
}

function collectLevelCandidates(ticker, timeframes) {
  const tfWeight = { "15m": 1, "1h": 2, "4h": 3, "1d": 4 };
  const candidates = [];
  for (const [timeframe, module] of Object.entries(timeframes)) {
    if (!moduleUsable(module)) continue;
    const weight = tfWeight[timeframe] || 1;
    for (const pivot of module.pivots?.highs || []) {
      if (Number.isFinite(pivot.price)) {
        candidates.push({ price: pivot.price, kind: "SWING_HIGH", timeframe, weight });
      }
    }
    for (const pivot of module.pivots?.lows || []) {
      if (Number.isFinite(pivot.price)) {
        candidates.push({ price: pivot.price, kind: "SWING_LOW", timeframe, weight });
      }
    }
    for (const [price, kind, multiplier] of [
      [module.vwap20, "VWAP20", 0.8],
      [module.ema20, "EMA20", 0.65],
      [module.ema50, "EMA50", 0.8],
      [module.ema200, "EMA200", 1.1],
    ]) {
      if (Number.isFinite(price)) candidates.push({ price, kind, timeframe, weight: weight * multiplier });
    }
  }
  if (Number.isFinite(ticker?.high24h)) {
    candidates.push({ price: ticker.high24h, kind: "HIGH_24H", timeframe: "24h", weight: 2.2 });
  }
  if (Number.isFinite(ticker?.low24h)) {
    candidates.push({ price: ticker.low24h, kind: "LOW_24H", timeframe: "24h", weight: 2.2 });
  }
  return candidates;
}

function clusterLevels(ticker, timeframes) {
  const last = finite(ticker?.last);
  if (!Number.isFinite(last)) {
    return {
      meta: unavailableMeta("PRICE_MISSING", "Cannot build levels without a current price"),
      supports: [],
      resistances: [],
    };
  }
  const atr1h = finite(timeframes?.["1h"]?.atr14, last * 0.005);
  const tolerance = Math.max(last * 0.0015, atr1h * 0.18);
  const candidates = collectLevelCandidates(ticker, timeframes).sort((a, b) => a.price - b.price);
  const clusters = [];
  for (const item of candidates) {
    const previous = clusters.at(-1);
    if (previous && Math.abs(item.price - previous.price) <= tolerance) {
      previous.items.push(item);
      previous.totalWeight += item.weight;
      previous.price =
        previous.items.reduce((sum, x) => sum + x.price * x.weight, 0) / previous.totalWeight;
    } else {
      clusters.push({ price: item.price, totalWeight: item.weight, items: [item] });
    }
  }

  const formatted = clusters
    .map((cluster) => {
      const kinds = unique(cluster.items.map((x) => x.kind));
      const timeframesUsed = unique(cluster.items.map((x) => x.timeframe));
      const strength = cluster.totalWeight >= 7 ? "HIGH" : cluster.totalWeight >= 3.5 ? "MEDIUM" : "LOW";
      return {
        price: round(cluster.price, 8),
        kind: kinds.join("+").slice(0, 90),
        strength,
        sourceTimeframes: timeframesUsed,
        evidenceCount: cluster.items.length,
        distancePct: round(((cluster.price - last) / last) * 100, 5),
      };
    })
    .filter((x) => Math.abs(x.distancePct) <= 25);

  return {
    meta: moduleMeta("OK", "DERIVED_FROM_CANDLES", ticker.meta?.observedAt || nowIso()),
    supports: formatted
      .filter((x) => x.price < last)
      .sort((a, b) => b.price - a.price)
      .slice(0, 8),
    resistances: formatted
      .filter((x) => x.price > last)
      .sort((a, b) => a.price - b.price)
      .slice(0, 8),
    clusteringTolerance: round(tolerance, 8),
  };
}

function combineMeta(modules, source = "COMPOSITE") {
  const statuses = modules.map((x) => x?.meta?.status || "NOT_AVAILABLE");
  let status = "OK";
  if (statuses.every((x) => x === "NOT_AVAILABLE" || x === "ERROR")) status = "NOT_AVAILABLE";
  else if (statuses.some((x) => x === "STALE")) status = "STALE";
  else if (statuses.some((x) => x === "PARTIAL" || x === "NOT_AVAILABLE" || x === "ERROR")) status = "PARTIAL";
  const observed = modules
    .map((x) => Date.parse(x?.meta?.observedAt || ""))
    .filter(Number.isFinite);
  return moduleMeta(status, source, observed.length ? new Date(Math.min(...observed)).toISOString() : null);
}

function buildDerivatives(ticker, oi, funding, positioning, liquidations) {
  return {
    meta: combineMeta([oi, funding, positioning, liquidations]),
    openInterest: oi,
    funding,
    basisPct: ticker?.basisPct ?? null,
    globalLongShortRatio: positioning?.globalLongShortRatio ?? null,
    topTraderLongShortRatio: positioning?.topTraderLongShortRatio ?? null,
    takerBuySellRatio1h: positioning?.takerBuySellRatio1h ?? null,
    liquidations,
  };
}

function buildOrderFlow(book, positioning) {
  const usable = moduleUsable(book) || moduleUsable(positioning);
  return {
    meta: usable
      ? combineMeta([book, positioning], "BOOK_AND_TAKER_FLOW")
      : unavailableMeta("ORDER_FLOW_UNAVAILABLE", "Book and taker-flow modules are unavailable"),
    bookImbalancePct: book?.bookImbalancePct ?? null,
    bidNotional: book?.bidNotional ?? null,
    askNotional: book?.askNotional ?? null,
    takerBuySellRatio1h: positioning?.takerBuySellRatio1h ?? null,
    aggressiveFlow: usable
      ? flowLabel(positioning?.takerBuySellRatio1h, book?.bookImbalancePct)
      : "UNKNOWN",
  };
}

async function fetchAssetCore(asset, requestedTimeframes, refresh, ctx) {
  // Phase 1 is the decision-critical core. It must finish before optional
  // derivatives/order-flow modules can consume the remaining subrequest budget.
  // This prevents an optional endpoint from crowding out a BTC/ETH K-line call.
  const coreResults = await Promise.allSettled([
    fetchTicker(asset, refresh, ctx),
    ...requestedTimeframes.map((timeframe) => fetchTimeframe(asset, timeframe, refresh, ctx)),
  ]);
  const ticker =
    settledValue(coreResults[0]) ||
    rejectedModule(coreResults[0].reason, {
      last: null,
      bid: null,
      ask: null,
      mark: null,
      index: null,
      spreadBps: null,
      high24h: null,
      low24h: null,
      quoteVolume24h: null,
    });
  const timeframes = {};
  requestedTimeframes.forEach((timeframe, index) => {
    const result = coreResults[index + 1];
    timeframes[timeframe] =
      settledValue(result) ||
      rejectedModule(result.reason, {
        candleCount: 0,
        lastClosedAt: null,
        price: null,
        ema20: null,
        ema50: null,
        ema200: null,
        rsi14: null,
        atr14: null,
        atrPct: null,
        adx14: null,
        volumeZScore: null,
        trend: "UNKNOWN",
        structure: "UNKNOWN",
        swingHigh: null,
        swingLow: null,
        vwap20: null,
        pivots: { highs: [], lows: [] },
      });
  });

  return { ticker, timeframes };
}

async function fetchAssetSnapshot(
  asset,
  requestedTimeframes,
  refresh,
  ctx,
  preloadedCore = null,
  allowFullOptionalNetwork = true,
) {
  const { ticker, timeframes } =
    preloadedCore || (await fetchAssetCore(asset, requestedTimeframes, refresh, ctx));

  // Phase 2 is cache-first even when the caller asks for a forced refresh.
  // Its freshness windows are short (5-60 seconds), so this preserves useful
  // derivatives data without repeatedly exhausting external subrequests.
  const secondaryResults = await Promise.allSettled([
    fetchOpenInterest(asset, ticker.last, false, ctx),
    fetchFunding(asset, false, ctx),
    fetchPositioning(asset, false, ctx, !allowFullOptionalNetwork),
    fetchOrderBook(asset, false, ctx, !allowFullOptionalNetwork),
    fetchLiquidations(asset, ticker.last, false, ctx, !allowFullOptionalNetwork),
  ]);
  const oi =
    settledValue(secondaryResults[0]) ||
    rejectedModule(secondaryResults[0].reason, {
      currentCoin: null,
      currentUsd: null,
      change5mPct: null,
      change15mPct: null,
      change1hPct: null,
      change4hPct: null,
      change24hPct: null,
      historyPoints: 0,
    });
  const funding =
    settledValue(secondaryResults[1]) ||
    rejectedModule(secondaryResults[1].reason, {
      currentRate: null,
      currentRatePct: null,
      nextRate: null,
      nextFundingAt: null,
      percentile30d: null,
      zScore30d: null,
      historyPoints: 0,
    });
  const positioning =
    settledValue(secondaryResults[2]) ||
    rejectedModule(secondaryResults[2].reason, {
      globalLongShortRatio: null,
      topTraderLongShortRatio: null,
      takerBuySellRatio1h: null,
    });
  const book =
    settledValue(secondaryResults[3]) ||
    rejectedModule(secondaryResults[3].reason, {
      bidNotional: null,
      askNotional: null,
      bookImbalancePct: null,
      depthLevels: 0,
    });
  const liquidations =
    settledValue(secondaryResults[4]) ||
    rejectedModule(secondaryResults[4].reason, {
      liquidation15mUsd: null,
      liquidation1hUsd: null,
      liquidation4hUsd: null,
      recordCount: 0,
    });
  const levels = clusterLevels(ticker, timeframes);
  const orderFlow = buildOrderFlow(book, positioning);

  return {
    instrumentId: asset.instrumentId,
    baseAsset: asset.base,
    ticker,
    timeframes,
    derivatives: buildDerivatives(ticker, oi, funding, positioning, liquidations),
    levels,
    orderFlow,
    diagnostics: {
      book,
      positioning,
    },
  };
}

function statusFactor(status) {
  if (status === "OK") return 1;
  if (status === "PARTIAL") return 0.75;
  if (status === "STALE") return 0.45;
  return 0;
}

function assetQuality(asset, requestedTimeframes) {
  const modules = [
    ["ticker", asset.ticker, 16, true],
    ...requestedTimeframes.map((tf) => [`timeframes.${tf}`, asset.timeframes?.[tf], 12, true]),
    ["derivatives.openInterest", asset.derivatives?.openInterest, 10, true],
    ["derivatives.funding", asset.derivatives?.funding, 8, true],
    ["diagnostics.positioning", asset.diagnostics?.positioning, 6, false],
    ["orderFlow", asset.orderFlow, 5, false],
    ["levels", asset.levels, 5, false],
    ["derivatives.liquidations", asset.derivatives?.liquidations, 2, false],
  ];
  const totalWeight = modules.reduce((sum, row) => sum + row[2], 0);
  let earned = 0;
  const criticalMissing = [];
  const optionalMissing = [];
  const staleFields = [];
  const sourceErrors = [];
  for (const [path, module, weight, critical] of modules) {
    const status = module?.meta?.status || "NOT_AVAILABLE";
    earned += weight * statusFactor(status);
    if (["NOT_AVAILABLE", "ERROR"].includes(status)) {
      (critical ? criticalMissing : optionalMissing).push(`${asset.instrumentId}.${path}`);
    }
    if (status === "STALE") staleFields.push(`${asset.instrumentId}.${path}`);
    for (const error of module?.sourceErrors || []) {
      sourceErrors.push({ module: `${asset.instrumentId}.${path}`, ...error });
    }
  }
  const coveragePct = round((earned / totalWeight) * 100, 2);
  const blocked = !moduleUsable(asset.ticker) || requestedTimeframes.every((tf) => !moduleUsable(asset.timeframes?.[tf]));
  return {
    coveragePct,
    confidence: blocked ? "BLOCKED" : coveragePct >= 90 ? "HIGH" : coveragePct >= 75 ? "MEDIUM" : "LOW",
    criticalMissing,
    optionalMissing,
    staleFields,
    sourceErrors,
  };
}

function overallQuality(assets, requestedTimeframes) {
  const perAsset = {};
  for (const asset of Object.values(assets)) {
    perAsset[asset.instrumentId] = assetQuality(asset, requestedTimeframes);
  }
  const values = Object.values(perAsset);
  const coveragePct = round(mean(values.map((x) => x.coveragePct)), 2);
  const criticalMissing = values.flatMap((x) => x.criticalMissing);
  const optionalMissing = values.flatMap((x) => x.optionalMissing);
  const staleFields = values.flatMap((x) => x.staleFields);
  const sourceErrors = values.flatMap((x) => x.sourceErrors);
  const confidence = values.some((x) => x.confidence === "BLOCKED")
    ? "BLOCKED"
    : coveragePct >= 90 && !criticalMissing.length
      ? "HIGH"
      : coveragePct >= 75
        ? "MEDIUM"
        : "LOW";
  return {
    coveragePct,
    confidence,
    criticalMissing,
    optionalMissing,
    staleFields,
    perAsset,
    note: "Coverage measures data completeness and freshness; it is not an opportunity score.",
    sourceErrors,
  };
}

function macroModule() {
  return {
    meta: unavailableMeta(
      "WEB_SEARCH_REQUIRED",
      "No authenticated, auditable macro/ETF/news feed is configured. Re-check current news in GPT before execution.",
    ),
    eventRisk: "UNKNOWN",
    events: [],
    btcEtfNetFlowUsd: null,
    ethEtfNetFlowUsd: null,
    etfSessionDate: null,
    webSearchRequired: true,
  };
}

function normaliseDirection(value) {
  const direction = String(value || "").toUpperCase();
  if (!["LONG", "SHORT"].includes(direction)) {
    throw new AlphaError("INVALID_DIRECTION", "direction must be LONG or SHORT", { httpStatus: 400 });
  }
  return direction;
}

function normaliseHorizon(value) {
  const horizon = String(value || "").toUpperCase();
  if (!HORIZON_CONFIG[horizon]) {
    throw new AlphaError("INVALID_HORIZON", "horizon must be SHORT, MEDIUM_SHORT or SWING", {
      httpStatus: 400,
    });
  }
  return horizon;
}

function normaliseGrade(value) {
  const grade = String(value || "").toUpperCase();
  if (!["A+", "A", "B", "C", "D"].includes(grade)) {
    throw new AlphaError("INVALID_GRADE", "opportunityGrade must be A+, A, B, C or D", {
      httpStatus: 400,
    });
  }
  return grade;
}

function gradeFromScore(score) {
  if (score >= 88) return "A+";
  if (score >= 80) return "A";
  if (score >= 70) return "B";
  if (score >= 60) return "C";
  return "D";
}

function defaultRiskPct(grade) {
  if (grade === "A+") return 5.5;
  if (grade === "A") return 4.5;
  if (grade === "B") return 3;
  return 0;
}

function allowedRiskRange(grade, aggressiveRiskConfirmed) {
  if (grade === "A+") return { min: 5, max: aggressiveRiskConfirmed ? 8 : 6 };
  if (grade === "A") return { min: 4, max: 5 };
  if (grade === "B") return { min: 2.5, max: 3.5 };
  return { min: 0, max: 0 };
}

function planCosts(inputCosts = {}) {
  const costs = { ...DEFAULT_COSTS, ...(inputCosts || {}) };
  for (const [key, value] of Object.entries(costs)) {
    const n = finite(value);
    const limit = key.includes("Slippage") ? 3 : key.includes("Funding") ? 5 : 1;
    if (!Number.isFinite(n) || n < -limit || n > limit) {
      throw new AlphaError(
        "INVALID_COST_ASSUMPTION",
        `${key} must be a percentage-point value between ${-limit} and ${limit}; 0.05 means 0.05%`,
        { httpStatus: 400 },
      );
    }
    costs[key] = n;
  }
  const totalCostPct =
    Math.max(0, costs.entryFeePct) +
    Math.max(0, costs.exitFeePct) +
    Math.max(0, costs.entrySlippagePct) +
    Math.max(0, costs.exitSlippagePct) +
    Math.abs(costs.expectedFundingPct);
  return { ...costs, totalCostPct: round(totalCostPct, 6), totalCostFraction: totalCostPct / 100 };
}

function estimatedLiquidationPrice(direction, entry, leverage, maintenanceMarginPct) {
  const mmr = maintenanceMarginPct / 100;
  if (direction === "LONG") return entry * Math.max(0.001, 1 - 1 / leverage + mmr);
  return entry * (1 + 1 / leverage - mmr);
}

function selectSafeLeverage({ direction, entry, stop, preferredLeverage, maintenanceMarginPct, atrPct }) {
  const bufferPct = Math.max(0.2, finite(atrPct, 1) * 0.2);
  for (let leverage = Math.floor(preferredLeverage); leverage >= 1; leverage -= 1) {
    const liquidationPrice = estimatedLiquidationPrice(
      direction,
      entry,
      leverage,
      maintenanceMarginPct,
    );
    const safe =
      direction === "LONG"
        ? liquidationPrice <= stop * (1 - bufferPct / 100)
        : liquidationPrice >= stop * (1 + bufferPct / 100);
    if (safe) {
      return {
        leverage,
        preferredLeverage,
        reducedForSafety: leverage < preferredLeverage,
        estimatedLiquidationPrice: round(liquidationPrice, 8),
        liquidationBufferPct: round(bufferPct, 4),
        liquidationEstimateOnly: true,
      };
    }
  }
  return {
    leverage: null,
    preferredLeverage,
    reducedForSafety: true,
    estimatedLiquidationPrice: null,
    liquidationBufferPct: round(bufferPct, 4),
    liquidationEstimateOnly: true,
  };
}

function normaliseTargets(targets, direction, entry) {
  if (!Array.isArray(targets) || targets.length === 0) {
    throw new AlphaError("TARGET_REQUIRED", "At least one real structural target is required", {
      httpStatus: 400,
    });
  }
  if (targets.length > 3) {
    throw new AlphaError("TOO_MANY_TARGETS", "At most three targets are supported", { httpStatus: 400 });
  }
  const parsed = targets.map((target, index) => {
    const price = finite(target?.price);
    if (!Number.isFinite(price) || price <= 0) {
      throw new AlphaError("INVALID_TARGET", `targets[${index}].price must be positive`, {
        httpStatus: 400,
      });
    }
    if ((direction === "LONG" && price <= entry) || (direction === "SHORT" && price >= entry)) {
      throw new AlphaError(
        "TARGET_WRONG_SIDE",
        `targets[${index}] must be beyond entry in the profitable direction`,
        { httpStatus: 400 },
      );
    }
    return {
      price,
      weight: finite(target.weight, 1),
      basis: String(target.basis || "USER_SUPPLIED_STRUCTURE").slice(0, 200),
      reachability: String(target.reachability || "UNKNOWN").toUpperCase(),
    };
  });
  const weightSum = parsed.reduce((sum, target) => sum + Math.max(0, target.weight), 0);
  if (weightSum <= 0) {
    throw new AlphaError("INVALID_TARGET_WEIGHTS", "Target weights must total more than zero", {
      httpStatus: 400,
    });
  }
  return parsed.map((target) => ({ ...target, weight: target.weight / weightSum }));
}

function targetStructuralCheck(target, direction, assetSnapshot, atrValue) {
  if (!assetSnapshot) return { matched: null, matchedLevel: null };
  const levels = direction === "LONG" ? assetSnapshot.levels?.resistances : assetSnapshot.levels?.supports;
  const tolerance = Math.max(finite(atrValue, target.price * 0.005) * 0.45, target.price * 0.0015);
  let nearest = null;
  let distance = Infinity;
  for (const level of levels || []) {
    const d = Math.abs(level.price - target.price);
    if (d < distance) {
      nearest = level;
      distance = d;
    }
  }
  return {
    matched: Boolean(nearest && distance <= tolerance),
    matchedLevel: nearest
      ? { price: nearest.price, kind: nearest.kind, distance: round(distance, 8), tolerance: round(tolerance, 8) }
      : null,
  };
}

function validatePlan(input, assetSnapshot = null) {
  const instrumentId = String(input?.instrumentId || "");
  if (!ASSETS[instrumentId]) {
    throw new AlphaError("INVALID_INSTRUMENT", "instrumentId must be BTC-USDT-SWAP or ETH-USDT-SWAP", {
      httpStatus: 400,
    });
  }
  const direction = normaliseDirection(input.direction);
  const horizon = normaliseHorizon(input.horizon);
  const grade = normaliseGrade(input.opportunityGrade);
  const equity = finite(input.accountEquity, 17000);
  const entry = finite(input.entry);
  const stop = finite(input.stop);
  if (!Number.isFinite(equity) || equity <= 0 || !Number.isFinite(entry) || entry <= 0 || !Number.isFinite(stop) || stop <= 0) {
    throw new AlphaError("INVALID_PLAN_PRICE", "accountEquity, entry and stop must be positive numbers", {
      httpStatus: 400,
    });
  }
  if ((direction === "LONG" && stop >= entry) || (direction === "SHORT" && stop <= entry)) {
    throw new AlphaError("STOP_WRONG_SIDE", "Stop must be below a long entry or above a short entry", {
      httpStatus: 400,
    });
  }

  const aggressiveRiskConfirmed = input.aggressiveRiskConfirmed === true;
  const range = allowedRiskRange(grade, aggressiveRiskConfirmed);
  const requestedRiskPct = finite(input.riskPct, defaultRiskPct(grade));
  const dailyLossPct = Math.max(0, finite(input.dailyLossPct, 0));
  const consecutiveFullStops = Math.max(0, Math.floor(finite(input.consecutiveFullStops, 0)));
  const correlatedOpenRiskPct = Math.max(0, finite(input.correlatedOpenRiskPct, 0));
  const blockers = [];
  const warnings = [];
  if (["C", "D"].includes(grade)) blockers.push("C/D opportunities have zero immediate-entry risk budget.");
  if (dailyLossPct >= 8) blockers.push("Daily realised loss has reached the 8% circuit breaker.");
  if (consecutiveFullStops >= 2) blockers.push("Two consecutive full-stop losses require stopping new entries for the day.");
  if (requestedRiskPct < range.min || requestedRiskPct > range.max) {
    blockers.push(`Risk ${requestedRiskPct}% is outside the ${grade} range ${range.min}%–${range.max}%.`);
  }
  if (requestedRiskPct > 6 && !aggressiveRiskConfirmed) {
    blockers.push("Risk above 6% requires explicit aggressiveRiskConfirmed=true.");
  }
  if (requestedRiskPct > 8) blockers.push("Absolute single-plan risk cap is 8%.");
  if (correlatedOpenRiskPct >= 8) blockers.push("Existing correlated BTC/ETH risk already reaches the 8% cap.");

  const targets = normaliseTargets(input.targets, direction, entry);
  const costs = planCosts(input.costs);
  const stopDistancePct = (Math.abs(entry - stop) / entry) * 100;
  const effectiveRiskPct = stopDistancePct + costs.totalCostPct;
  const availableCorrelatedRiskPct = Math.max(0, 8 - correlatedOpenRiskPct);
  const approvedRiskPct = Math.min(requestedRiskPct, availableCorrelatedRiskPct);
  if (approvedRiskPct < requestedRiskPct) {
    warnings.push(`Risk was capped to ${round(approvedRiskPct, 4)}% by the 8% correlated-risk limit.`);
  }
  const riskBudgetUsdt = equity * (approvedRiskPct / 100);

  const primaryTf = HORIZON_CONFIG[horizon].primaryTf;
  const atrPct = finite(input.atrPct, assetSnapshot?.timeframes?.[primaryTf]?.atrPct);
  const atrValue = finite(
    input.atrValue,
    assetSnapshot?.timeframes?.[primaryTf]?.atr14,
  );
  const maintenanceMarginPct = clamp(finite(input.maintenanceMarginPct, 0.5), 0, 5);
  const preferredLeverage = Math.min(
    HORIZON_CONFIG[horizon].preferredLeverage,
    clamp(Math.floor(finite(input.exchangeMaxLeverage, 125)), 1, 125),
  );
  const leverageCheck = selectSafeLeverage({
    direction,
    entry,
    stop,
    preferredLeverage,
    maintenanceMarginPct,
    atrPct,
  });
  if (!leverageCheck.leverage) blockers.push("No leverage passed the approximate stop-before-liquidation safety check.");
  if (leverageCheck.reducedForSafety && leverageCheck.leverage) {
    warnings.push(
      `Preferred ${preferredLeverage}x was reduced to ${leverageCheck.leverage}x so estimated liquidation remains beyond the stop buffer.`,
    );
  }

  const riskLimitedNotional = effectiveRiskPct > 0 ? riskBudgetUsdt / (effectiveRiskPct / 100) : 0;
  const maxMarginPct = clamp(finite(input.maxMarginPct, 50), 1, 100);
  const marginLimitUsdt = equity * (maxMarginPct / 100);
  const marginLimitedNotional = leverageCheck.leverage ? marginLimitUsdt * leverageCheck.leverage : 0;
  const notionalUsdt = Math.max(0, Math.min(riskLimitedNotional, marginLimitedNotional));
  if (notionalUsdt < riskLimitedNotional - 0.01) {
    warnings.push(`Notional was capped by the ${maxMarginPct}% maximum-margin allocation.`);
  }
  const quantity = notionalUsdt / entry;
  const marginUsdt = leverageCheck.leverage ? notionalUsdt / leverageCheck.leverage : null;
  const estimatedMaxLossUsdt = notionalUsdt * (effectiveRiskPct / 100);
  const actualRiskPct = (estimatedMaxLossUsdt / equity) * 100;

  const targetResults = targets.map((target, index) => {
    const grossRewardPct =
      direction === "LONG"
        ? ((target.price - entry) / entry) * 100
        : ((entry - target.price) / entry) * 100;
    const netRewardPct = grossRewardPct - costs.totalCostPct;
    const netRr = effectiveRiskPct > 0 ? netRewardPct / effectiveRiskPct : null;
    const distanceAtr = Number.isFinite(atrValue) && atrValue > 0 ? Math.abs(target.price - entry) / atrValue : null;
    return {
      targetNumber: index + 1,
      price: round(target.price, 8),
      weightPct: round(target.weight * 100, 4),
      basis: target.basis,
      suppliedReachability: target.reachability,
      grossRewardPct: round(grossRewardPct, 6),
      netRewardPct: round(netRewardPct, 6),
      netRr: round(netRr, 4),
      distanceAtr: round(distanceAtr, 4),
      structuralCheck: targetStructuralCheck(target, direction, assetSnapshot, atrValue),
    };
  });
  const weightedNetRr = targetResults.reduce(
    (sum, target, index) => sum + finite(target.netRr, 0) * targets[index].weight,
    0,
  );
  const minimumNetRr = HORIZON_CONFIG[horizon].rrByGrade[grade] ?? null;
  const rrPassed = Number.isFinite(minimumNetRr) && weightedNetRr >= minimumNetRr;
  if (!Number.isFinite(minimumNetRr)) blockers.push("C/D grade has no formal minimum RR because immediate entry is prohibited.");
  else if (!rrPassed) {
    blockers.push(
      `Weighted net RR ${round(weightedNetRr, 4)} is below the ${grade} ${horizon} minimum ${minimumNetRr}. Do not move targets farther just to pass.`,
    );
  }
  if (targetResults[0]?.netRewardPct <= 0) blockers.push("TP1 is not profitable after estimated costs.");
  if (!Number.isFinite(atrValue)) warnings.push("ATR was unavailable; target distance in ATR could not be verified.");
  if (assetSnapshot && targetResults.some((target) => target.structuralCheck.matched === false)) {
    warnings.push("One or more targets do not match a nearby derived level; verify their structural basis manually.");
  }

  return {
    status: blockers.length ? "rejected" : "valid",
    generatedAt: nowIso(),
    instrumentId,
    direction,
    horizon,
    opportunityGrade: grade,
    account: {
      equityUsdt: round(equity, 2),
      requestedRiskPct: round(requestedRiskPct, 4),
      approvedRiskPct: round(approvedRiskPct, 4),
      riskBudgetUsdt: round(riskBudgetUsdt, 2),
      correlatedOpenRiskPct: round(correlatedOpenRiskPct, 4),
      dailyLossPct: round(dailyLossPct, 4),
      consecutiveFullStops,
    },
    prices: {
      entry: round(entry, 8),
      stop: round(stop, 8),
      stopDistancePct: round(stopDistancePct, 6),
      effectiveRiskPct: round(effectiveRiskPct, 6),
    },
    leverage: { ...leverageCheck, maintenanceMarginPct },
    position: {
      notionalUsdt: round(notionalUsdt, 2),
      quantity: round(quantity, 8),
      marginUsdt: round(marginUsdt, 2),
      estimatedMaxLossUsdt: round(estimatedMaxLossUsdt, 2),
      actualRiskPct: round(actualRiskPct, 4),
      marginLimitUsdt: round(marginLimitUsdt, 2),
      exchangeStepSizeChecked: false,
    },
    costs,
    targets: targetResults,
    rr: {
      minimumNetRr,
      tp1NetRr: targetResults[0]?.netRr ?? null,
      weightedNetRr: round(weightedNetRr, 4),
      passed: rrPassed,
      method: "Real targets first; round-trip costs deducted from reward and added to stop risk.",
    },
    blockers,
    warnings,
    disclaimer:
      "Decision-support calculation only. Liquidation is an estimate; verify exchange maintenance tiers, quantity step and actual fees before placing an order.",
  };
}

function stableId(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function directionTrend(direction) {
  return direction === "LONG" ? "BULLISH" : "BEARISH";
}

function directionStructures(direction) {
  return direction === "LONG" ? ["HH_HL", "BREAKOUT_UP"] : ["LH_LL", "BREAKOUT_DOWN"];
}

function candidateTargets(direction, asset, entry, atrValue, horizon) {
  const levels = direction === "LONG" ? asset.levels?.resistances : asset.levels?.supports;
  const valid = (levels || [])
    .filter((level) => (direction === "LONG" ? level.price > entry : level.price < entry))
    .filter((level) => {
      if (!Number.isFinite(atrValue) || atrValue <= 0) return true;
      const distanceAtr = Math.abs(level.price - entry) / atrValue;
      const limit = horizon === "SHORT" ? 4 : horizon === "MEDIUM_SHORT" ? 6 : 8;
      return distanceAtr <= limit;
    })
    .slice(0, 3);
  const weights = valid.length === 1 ? [1] : valid.length === 2 ? [0.6, 0.4] : [0.45, 0.35, 0.2];
  return valid.map((level, index) => ({
    price: level.price,
    weight: weights[index],
    basis: level.kind,
    reachability: index === 0 ? "HIGH" : index === 1 ? "MEDIUM" : "LOW",
  }));
}

function scoreCandidate({ direction, primary, confirmation, asset, plan, nearEntry, btcAsset }) {
  const expected = directionTrend(direction);
  const favourableStructures = directionStructures(direction);
  const trendScore =
    (primary?.trend === expected ? 13 : primary?.trend === "TRANSITION" ? 5 : 0) +
    (confirmation?.trend === expected ? 12 : confirmation?.trend === "TRANSITION" ? 4 : 0);
  const structureScore =
    (favourableStructures.includes(primary?.structure) ? 15 : primary?.structure === "TRANSITION" ? 6 : 0) +
    (nearEntry ? 10 : 5);
  let derivativesScore = 8;
  const fundingPercentile = finite(asset.derivatives?.funding?.percentile30d);
  const oiChange = finite(asset.derivatives?.openInterest?.change1hPct, 0);
  const flow = asset.orderFlow?.aggressiveFlow;
  if ((direction === "LONG" && flow === "BUY") || (direction === "SHORT" && flow === "SELL")) derivativesScore += 5;
  else if ((direction === "LONG" && flow === "SELL") || (direction === "SHORT" && flow === "BUY")) derivativesScore -= 4;
  if (Number.isFinite(oiChange) && Math.abs(oiChange) <= 5) derivativesScore += 3;
  if (
    Number.isFinite(fundingPercentile) &&
    ((direction === "LONG" && fundingPercentile >= 95) || (direction === "SHORT" && fundingPercentile <= 5))
  ) derivativesScore -= 6;
  derivativesScore = clamp(derivativesScore, 0, 20);
  const minimum = finite(plan?.rr?.minimumNetRr, 99);
  const rr = finite(plan?.rr?.weightedNetRr, 0);
  const reachabilityScore = rr >= minimum ? 20 : rr >= minimum * 0.8 ? 12 : rr > 0 ? 5 : 0;
  let contextScore = 3;
  if (asset.instrumentId === "BTC-USDT-SWAP") contextScore = 5;
  else if (btcAsset) {
    const btcTrend = btcAsset.timeframes?.["4h"]?.trend;
    contextScore = btcTrend === expected ? 8 : btcTrend === "TRANSITION" || btcTrend === "RANGE" ? 4 : 0;
  }
  return {
    total: round(clamp(trendScore + structureScore + derivativesScore + reachabilityScore + contextScore, 0, 100), 2),
    components: {
      trendAndEnvironment: trendScore,
      structureAndEntry: structureScore,
      derivativesAndFunds: derivativesScore,
      targetReachabilityAndNetRr: reachabilityScore,
      btcAndMacroContext: contextScore,
    },
    macroNewsStillRequired: true,
  };
}

function buildCandidate(asset, direction, horizon, quality, btcAsset) {
  const config = HORIZON_CONFIG[horizon];
  const primary = asset.timeframes?.[config.primaryTf];
  const confirmation = asset.timeframes?.[config.confirmationTf];
  if (!moduleUsable(asset.ticker) || !moduleUsable(primary) || !moduleUsable(confirmation)) return null;
  const expected = directionTrend(direction);
  if (primary.trend !== expected && confirmation.trend !== expected) return null;
  const last = finite(asset.ticker.last);
  const atrValue = finite(primary.atr14, last * 0.006);
  const levels = direction === "LONG" ? asset.levels?.supports : asset.levels?.resistances;
  const anchor = levels?.[0];
  if (!Number.isFinite(last) || !anchor) return null;
  const halfWidth = Math.max(atrValue * 0.14, last * 0.001);
  const entryZone = {
    low: round(anchor.price - halfWidth, 8),
    high: round(anchor.price + halfWidth, 8),
  };
  const entry = clamp(last, entryZone.low, entryZone.high);
  const primarySwing = direction === "LONG" ? finite(primary.swingLow) : finite(primary.swingHigh);
  const anchorStop = direction === "LONG" ? anchor.price - atrValue * 0.35 : anchor.price + atrValue * 0.35;
  const swingStop = Number.isFinite(primarySwing)
    ? direction === "LONG"
      ? primarySwing - atrValue * 0.18
      : primarySwing + atrValue * 0.18
    : anchorStop;
  const stop = direction === "LONG" ? Math.min(anchorStop, swingStop) : Math.max(anchorStop, swingStop);
  const targets = candidateTargets(direction, asset, entry, atrValue, horizon);
  if (!targets.length) return null;
  let plan = validatePlan(
    {
      instrumentId: asset.instrumentId,
      direction,
      horizon,
      opportunityGrade: "B",
      accountEquity: 17000,
      riskPct: 3,
      entry,
      stop,
      targets,
      atrValue,
      atrPct: primary.atrPct,
    },
    asset,
  );
  const nearEntry = last >= entryZone.low && last <= entryZone.high;
  const score = scoreCandidate({ direction, primary, confirmation, asset, plan, nearEntry, btcAsset });
  const grade = gradeFromScore(score.total);
  const riskPct = defaultRiskPct(grade);
  plan = validatePlan(
    {
      instrumentId: asset.instrumentId,
      direction,
      horizon,
      opportunityGrade: grade,
      accountEquity: 17000,
      riskPct,
      entry,
      stop,
      targets,
      atrValue,
      atrPct: primary.atrPct,
    },
    asset,
  );
  const favourableStructure = directionStructures(direction).includes(primary.structure);
  const opposingFlow =
    (direction === "LONG" && asset.orderFlow?.aggressiveFlow === "SELL") ||
    (direction === "SHORT" && asset.orderFlow?.aggressiveFlow === "BUY");
  const triggerMet = nearEntry && favourableStructure && !opposingFlow && quality.coveragePct >= 75;
  const state =
    triggerMet && ["A+", "A", "B"].includes(grade) && plan.status === "valid"
      ? "READY_NOW"
      : ["A+", "A", "B", "C"].includes(grade)
        ? "PENDING_TRIGGER"
        : "NO_EDGE";
  const counterEvidence = [];
  if (confirmation.trend !== expected) counterEvidence.push(`${config.confirmationTf} trend is ${confirmation.trend}.`);
  if (opposingFlow) counterEvidence.push(`Aggressive order flow is ${asset.orderFlow.aggressiveFlow}.`);
  if (asset.instrumentId === "ETH-USDT-SWAP" && btcAsset?.timeframes?.["4h"]?.trend !== expected) {
    counterEvidence.push(`BTC 4h filter is ${btcAsset?.timeframes?.["4h"]?.trend || "UNKNOWN"}.`);
  }
  if (plan.status !== "valid") counterEvidence.push(...plan.blockers.slice(0, 3));
  const setupKey = `${asset.instrumentId}:${direction}:${horizon}:${round(anchor.price, 2)}:${round(stop, 2)}`;
  return {
    setupId: `setup_${stableId(setupKey)}`,
    instrumentId: asset.instrumentId,
    direction,
    horizon,
    state,
    score: score.total,
    grade,
    scoreComponents: score.components,
    setupFingerprint: stableId(`${setupKey}:${primary.trend}:${confirmation.trend}`),
    thesis: [
      `${config.primaryTf} trend is ${primary.trend} with ${primary.structure} structure.`,
      `${config.confirmationTf} confirmation trend is ${confirmation.trend}.`,
      `Entry is anchored to ${anchor.kind} at ${anchor.price}.`,
    ],
    counterEvidence,
    entryZone,
    bestEntry: round(entry, 8),
    trigger: `Price in zone plus ${config.primaryTf} favourable structure; no strongly opposing aggressive flow.`,
    triggerMet,
    invalidation: round(stop, 8),
    targets: plan.targets.map((target) => ({
      price: target.price,
      basis: target.basis,
      distancePct: target.grossRewardPct,
      distanceAtr: target.distanceAtr,
      reachability: target.suppliedReachability,
      weightPct: target.weightPct,
    })),
    netRr: plan.rr,
    preferredLeverage: HORIZON_CONFIG[horizon].preferredLeverage,
    safeLeverageEstimate: plan.leverage.leverage,
    dataCoveragePct: quality.coveragePct,
    newsCheckRequired: true,
    expiresAt: new Date(Date.now() + HORIZON_CONFIG[horizon].maxDurationMs).toISOString(),
  };
}

function buildSetupCandidates(assets, dataQuality) {
  const candidates = [];
  const btc = assets["BTC-USDT-SWAP"] || null;
  for (const asset of Object.values(assets)) {
    const quality = dataQuality.perAsset[asset.instrumentId];
    if (!quality || quality.confidence === "BLOCKED") continue;
    for (const horizon of Object.keys(HORIZON_CONFIG)) {
      for (const direction of ["LONG", "SHORT"]) {
        try {
          const candidate = buildCandidate(asset, direction, horizon, quality, btc);
          if (candidate && candidate.state !== "NO_EDGE") candidates.push(candidate);
        } catch {
          // Candidate generation is advisory and must never break the raw snapshot.
        }
      }
    }
  }
  return candidates
    .sort((a, b) => {
      const stateRank = { READY_NOW: 0, PENDING_TRIGGER: 1 };
      return (stateRank[a.state] ?? 2) - (stateRank[b.state] ?? 2) || b.score - a.score;
    })
    .slice(0, 12);
}

function parseRequestedList(value, defaults) {
  if (!value) return [...defaults];
  return unique(
    String(value)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function emptyAssetSnapshot(asset, requestedTimeframes, error) {
  const ticker = rejectedModule(error, {
    last: null,
    bid: null,
    ask: null,
    mark: null,
    index: null,
    spreadBps: null,
    high24h: null,
    low24h: null,
    quoteVolume24h: null,
  });
  const timeframes = Object.fromEntries(
    requestedTimeframes.map((tf) => [
      tf,
      rejectedModule(error, {
        candleCount: 0,
        lastClosedAt: null,
        trend: "UNKNOWN",
        structure: "UNKNOWN",
        atr14: null,
        atrPct: null,
        pivots: { highs: [], lows: [] },
      }),
    ]),
  );
  const unavailable = rejectedModule(error);
  return {
    instrumentId: asset.instrumentId,
    baseAsset: asset.base,
    ticker,
    timeframes,
    derivatives: {
      meta: unavailable.meta,
      openInterest: unavailable,
      funding: unavailable,
      basisPct: null,
      globalLongShortRatio: null,
      topTraderLongShortRatio: null,
      takerBuySellRatio1h: null,
      liquidations: unavailable,
    },
    levels: { meta: unavailable.meta, supports: [], resistances: [], sourceErrors: unavailable.sourceErrors },
    orderFlow: {
      meta: unavailable.meta,
      aggressiveFlow: "UNKNOWN",
      bookImbalancePct: null,
      sourceErrors: unavailable.sourceErrors,
    },
    diagnostics: { book: unavailable, positioning: unavailable },
  };
}

async function buildSnapshot(options = {}, ctx = null) {
  const reqId = options.requestId || requestId();
  const requestedSymbols = parseRequestedList(options.symbols, Object.keys(ASSETS));
  const requestedTimeframes = parseRequestedList(options.timeframes, Object.keys(TIMEFRAMES));
  const invalidSymbols = requestedSymbols.filter((symbol) => !ASSETS[symbol]);
  const invalidTimeframes = requestedTimeframes.filter((timeframe) => !TIMEFRAMES[timeframe]);
  if (invalidSymbols.length) {
    throw new AlphaError("INVALID_SYMBOL", `Unsupported symbols: ${invalidSymbols.join(", ")}`, {
      httpStatus: 400,
    });
  }
  if (invalidTimeframes.length) {
    throw new AlphaError("INVALID_TIMEFRAME", `Unsupported timeframes: ${invalidTimeframes.join(", ")}`, {
      httpStatus: 400,
    });
  }
  const refresh = options.refresh === true;
  // With both BTC and ETH requested, the worst-case primary + fallback cost of
  // every optional module can exceed the Workers external-subrequest ceiling.
  // Keep OI/funding live for both assets and read the remaining optional modules
  // from cache. A focused one-asset snapshot may refresh the full optional set.
  const allowFullOptionalNetwork = requestedSymbols.length === 1;
  // Complete the decision-critical ticker/K-line phase for every requested
  // asset before any optional module is allowed to start.
  const coreResults = await Promise.allSettled(
    requestedSymbols.map((symbol) => fetchAssetCore(ASSETS[symbol], requestedTimeframes, refresh, ctx)),
  );
  const results = await Promise.allSettled(
    requestedSymbols.map((symbol, index) => {
      const core = settledValue(coreResults[index]);
      if (!core) return Promise.reject(coreResults[index].reason);
      return fetchAssetSnapshot(
        ASSETS[symbol],
        requestedTimeframes,
        refresh,
        ctx,
        core,
        allowFullOptionalNetwork,
      );
    }),
  );
  const assets = {};
  requestedSymbols.forEach((symbol, index) => {
    assets[symbol] =
      settledValue(results[index]) || emptyAssetSnapshot(ASSETS[symbol], requestedTimeframes, results[index].reason);
  });
  const dataQuality = overallQuality(assets, requestedTimeframes);
  const macro = macroModule();
  const setupCandidates = options.includeSetups === false ? [] : buildSetupCandidates(assets, dataQuality);
  const status =
    dataQuality.confidence === "HIGH"
      ? "success"
      : dataQuality.confidence === "MEDIUM"
        ? "degraded"
        : dataQuality.coveragePct > 0
          ? "partial"
          : "error";
  return {
    status,
    requestId: reqId,
    engine: "Crypto Alpha Pro Ultimate V17.1",
    build: BUILD,
    apiVersion: API_VERSION,
    generatedAt: nowIso(),
    timezone: "UTC",
    displayTimezone: "Asia/Shanghai (UTC+8 conversion is performed by the GPT)",
    dataQuality: {
      coveragePct: dataQuality.coveragePct,
      confidence: dataQuality.confidence,
      criticalMissing: dataQuality.criticalMissing,
      optionalMissing: dataQuality.optionalMissing,
      staleFields: dataQuality.staleFields,
      perAsset: dataQuality.perAsset,
      note: dataQuality.note,
    },
    assets,
    macro,
    setupCandidates,
    sourceErrors: dataQuality.sourceErrors,
    providerPolicy: {
      primary: "OKX",
      fallback: "BINANCE_FUTURES",
      fallbackIsAlwaysLabelled: true,
      requestBudgetPolicy:
        "Core ticker/K-lines first; BTC+ETH keeps OI/funding live and reads lower-priority modules from cache; no same-endpoint retry.",
      crossVenueCaveat:
        "Fallback values are continuity data from a different venue and must not be represented as OKX values.",
    },
    executionPolicy: {
      readOnly: true,
      placesOrders: false,
      opportunityScoresAreAdvisory: true,
      newsWebSearchRequired: true,
    },
  };
}

function legacyResponse(snapshot) {
  const market = {};
  const analysis = {};
  const derivatives = {};
  for (const [instrumentId, asset] of Object.entries(snapshot.assets)) {
    const key = instrumentId.startsWith("BTC") ? "BTC" : "ETH";
    market[key] = { instrumentId, ...asset.ticker };
    analysis[key] = asset.timeframes;
    derivatives[key] = asset.derivatives;
  }
  return {
    status: snapshot.status,
    engine: snapshot.engine,
    build: snapshot.build,
    requestId: snapshot.requestId,
    time: snapshot.generatedAt,
    timezone: snapshot.timezone,
    market,
    analysis,
    derivatives,
    risk: {
      score: null,
      permission: "UNKNOWN",
      rule:
        "Legacy WAIT scoring was retired. Re-evaluate raw fields, dataQuality, trigger state, structural targets and net RR independently.",
    },
    futureModules: {
      dataQuality: snapshot.dataQuality,
      macro: snapshot.macro,
      setupCandidates: snapshot.setupCandidates,
      alertsAvailable: true,
      planValidatorAvailable: true,
    },
    sourceErrors: snapshot.sourceErrors,
  };
}

function secureEqual(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  if (!a.length || a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index += 1) result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return result === 0;
}

function requireApiKey(request, env, mandatory = false) {
  const configured = String(env?.ALPHA_API_KEY || "");
  if (!configured) {
    if (mandatory) {
      throw new AlphaError(
        "API_KEY_NOT_CONFIGURED",
        "Set the ALPHA_API_KEY Worker secret before using alerts.",
        { httpStatus: 503 },
      );
    }
    return;
  }
  if (!secureEqual(request.headers.get("X-Alpha-Key"), configured)) {
    throw new AlphaError("UNAUTHORIZED", "Missing or invalid X-Alpha-Key", { httpStatus: 401 });
  }
}

async function readJsonBody(request, maxBytes = 40000) {
  const length = finite(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBytes) {
    throw new AlphaError("BODY_TOO_LARGE", `Request body exceeds ${maxBytes} bytes`, {
      httpStatus: 413,
    });
  }
  const text = await request.text();
  if (text.length > maxBytes) {
    throw new AlphaError("BODY_TOO_LARGE", `Request body exceeds ${maxBytes} bytes`, {
      httpStatus: 413,
    });
  }
  const body = safeJsonParse(text);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AlphaError("INVALID_JSON_BODY", "A JSON object body is required", { httpStatus: 400 });
  }
  return body;
}

function requireAlertKv(env) {
  if (!env?.ALERTS_KV) {
    throw new AlphaError(
      "ALERTS_KV_NOT_CONFIGURED",
      "Bind a Workers KV namespace as ALERTS_KV before using alerts.",
      { httpStatus: 503 },
    );
  }
  return env.ALERTS_KV;
}

function alertKey(alertId) {
  return `alert:${alertId}`;
}

async function saveAlert(env, alert) {
  const kv = requireAlertKv(env);
  const expiryMs = Math.max(Date.now() + 60 * 1000, Date.parse(alert.expiresAt) + 7 * 24 * 60 * 60 * 1000);
  await kv.put(alertKey(alert.alertId), JSON.stringify(alert), {
    expirationTtl: Math.max(60, Math.floor((expiryMs - Date.now()) / 1000)),
  });
}

async function getAlert(env, alertId) {
  const kv = requireAlertKv(env);
  const alert = await kv.get(alertKey(alertId), "json");
  if (!alert) throw new AlphaError("ALERT_NOT_FOUND", "Alert not found", { httpStatus: 404 });
  return alert;
}

async function listAlerts(env, status = null) {
  const kv = requireAlertKv(env);
  const listed = await kv.list({ prefix: "alert:", limit: 1000 });
  const records = await Promise.all(listed.keys.map((key) => kv.get(key.name, "json")));
  return records
    .filter(Boolean)
    .filter((alert) => !status || alert.status === status)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

function normaliseAlertInput(body) {
  const instrumentId = String(body.instrumentId || "");
  if (!ASSETS[instrumentId]) {
    throw new AlphaError("INVALID_INSTRUMENT", "Unsupported alert instrument", { httpStatus: 400 });
  }
  const direction = normaliseDirection(body.direction);
  const horizon = normaliseHorizon(body.horizon);
  const low = finite(body.entryZone?.low);
  const high = finite(body.entryZone?.high);
  const invalidation = finite(body.invalidation);
  if (!Number.isFinite(low) || !Number.isFinite(high) || low <= 0 || high <= 0 || low >= high) {
    throw new AlphaError("INVALID_ENTRY_ZONE", "entryZone.low must be below entryZone.high", {
      httpStatus: 400,
    });
  }
  if (
    !Number.isFinite(invalidation) ||
    (direction === "LONG" && invalidation >= low) ||
    (direction === "SHORT" && invalidation <= high)
  ) {
    throw new AlphaError(
      "INVALID_INVALIDATION",
      "Invalidation must be below a long entry zone or above a short entry zone",
      { httpStatus: 400 },
    );
  }
  const expiresAtMs = Date.parse(body.expiresAt);
  const maximum = HORIZON_CONFIG[horizon].maxDurationMs;
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now() || expiresAtMs > Date.now() + maximum) {
    throw new AlphaError(
      "INVALID_EXPIRY",
      `expiresAt must be in the future and within the ${horizon} maximum duration`,
      { httpStatus: 400 },
    );
  }
  const fingerprint = String(body.setupFingerprint || "").trim();
  if (!fingerprint) {
    throw new AlphaError("FINGERPRINT_REQUIRED", "setupFingerprint is required", { httpStatus: 400 });
  }
  const grade = body.opportunityGrade ? normaliseGrade(body.opportunityGrade) : "B";
  const minDefault = HORIZON_CONFIG[horizon].rrByGrade[grade] || HORIZON_CONFIG[horizon].rrByGrade.B;
  const revalidation = {
    minCoveragePct: clamp(finite(body.revalidation?.minCoveragePct, 80), 60, 100),
    requireTrendUnchanged: body.revalidation?.requireTrendUnchanged !== false,
    requireStructureValid: body.revalidation?.requireStructureValid !== false,
    requireNetRr: Math.max(0, finite(body.revalidation?.requireNetRr, minDefault)),
    maxEventRisk: ["LOW", "MEDIUM"].includes(body.revalidation?.maxEventRisk)
      ? body.revalidation.maxEventRisk
      : "MEDIUM",
    maxEntrySlippagePct: clamp(finite(body.revalidation?.maxEntrySlippagePct, 0.25), 0, 3),
  };
  return {
    instrumentId,
    direction,
    horizon,
    opportunityGrade: grade,
    entryZone: { low, high },
    trigger: String(body.trigger || "Price touches entry zone and technical conditions remain valid").slice(0, 500),
    invalidation,
    targets: Array.isArray(body.targets) ? body.targets.slice(0, 3) : [],
    expiresAt: new Date(expiresAtMs).toISOString(),
    setupFingerprint: fingerprint.slice(0, 200),
    expectedPrimaryTrend: body.expectedPrimaryTrend || directionTrend(direction),
    revalidation,
    notificationChannel: ["TELEGRAM", "WEBHOOK", "NONE"].includes(body.notificationChannel)
      ? body.notificationChannel
      : "TELEGRAM",
  };
}

async function createAlert(env, body) {
  const parsed = normaliseAlertInput(body);
  const createdAt = nowIso();
  const alert = {
    alertId: `alt_${requestId().replaceAll("-", "").slice(0, 24)}`,
    status: "ARMED",
    ...parsed,
    createdAt,
    updatedAt: createdAt,
    lastPrice: null,
    lastCheckedAt: null,
    revalidationResult: null,
    lastNotifiedStatus: null,
  };
  await saveAlert(env, alert);
  return alert;
}

function zoneTouched(alert, price) {
  if (price >= alert.entryZone.low && price <= alert.entryZone.high) return true;
  const previous = finite(alert.lastPrice);
  if (!Number.isFinite(previous)) return false;
  const min = Math.min(previous, price);
  const max = Math.max(previous, price);
  return min <= alert.entryZone.high && max >= alert.entryZone.low;
}

function alertInvalidated(alert, price) {
  return alert.direction === "LONG" ? price <= alert.invalidation : price >= alert.invalidation;
}

function entrySlippagePct(alert, price) {
  if (price >= alert.entryZone.low && price <= alert.entryZone.high) return 0;
  const boundary = price < alert.entryZone.low ? alert.entryZone.low : alert.entryZone.high;
  return Math.abs((price - boundary) / boundary) * 100;
}

function eventRiskAllowed(current, maximum) {
  if (current === "UNKNOWN") return false;
  const rank = { LOW: 0, MEDIUM: 1, HIGH: 2 };
  return rank[current] <= rank[maximum];
}

function targetsForAlert(alert, asset, price, primary) {
  if (Array.isArray(alert.targets) && alert.targets.length) return alert.targets;
  return candidateTargets(alert.direction, asset, price, primary?.atr14, alert.horizon);
}

function revalidateAlert(alert, snapshot) {
  const asset = snapshot.assets[alert.instrumentId];
  const checkedAt = nowIso();
  const price = finite(asset?.ticker?.last);
  const reasons = [];
  const warnings = [];
  if (!asset || !Number.isFinite(price)) {
    return {
      alert: {
        ...alert,
        status: "TOUCHED_NOT_CONFIRMED",
        lastCheckedAt: checkedAt,
        updatedAt: checkedAt,
        revalidationResult: {
          passed: false,
          technicalPassed: false,
          newsCheckStatus: "REQUIRED",
          reasons: ["Current price is unavailable."],
        },
      },
      notify: false,
    };
  }
  if (Date.parse(alert.expiresAt) <= Date.now()) {
    const next = {
      ...alert,
      status: "EXPIRED",
      lastPrice: price,
      lastCheckedAt: checkedAt,
      updatedAt: checkedAt,
      revalidationResult: { passed: false, technicalPassed: false, newsCheckStatus: "REQUIRED", reasons: ["Alert expired."] },
    };
    return { alert: next, notify: alert.lastNotifiedStatus !== next.status };
  }
  if (alertInvalidated(alert, price)) {
    const next = {
      ...alert,
      status: "INVALIDATED",
      lastPrice: price,
      lastCheckedAt: checkedAt,
      updatedAt: checkedAt,
      revalidationResult: {
        passed: false,
        technicalPassed: false,
        newsCheckStatus: "REQUIRED",
        reasons: ["The structural invalidation price was breached."],
      },
    };
    return { alert: next, notify: alert.lastNotifiedStatus !== next.status };
  }
  const touched = zoneTouched(alert, price) || alert.status === "TOUCHED_NOT_CONFIRMED";
  if (!touched) {
    return {
      alert: { ...alert, lastPrice: price, lastCheckedAt: checkedAt, updatedAt: checkedAt },
      notify: false,
    };
  }

  const config = HORIZON_CONFIG[alert.horizon];
  const primary = asset.timeframes?.[config.primaryTf];
  const confirmation = asset.timeframes?.[config.confirmationTf];
  const quality = snapshot.dataQuality.perAsset?.[alert.instrumentId];
  const expected = directionTrend(alert.direction);
  if (!quality || quality.coveragePct < alert.revalidation.minCoveragePct) {
    reasons.push(
      `Coverage ${quality?.coveragePct ?? 0}% is below ${alert.revalidation.minCoveragePct}%.`,
    );
  }
  if (alert.revalidation.requireTrendUnchanged) {
    if (primary?.trend !== expected) reasons.push(`${config.primaryTf} trend is ${primary?.trend || "UNKNOWN"}, not ${expected}.`);
    if (["BEARISH", "BULLISH"].includes(confirmation?.trend) && confirmation.trend !== expected) {
      reasons.push(`${config.confirmationTf} trend reversed to ${confirmation.trend}.`);
    }
  }
  if (alert.revalidation.requireStructureValid && !directionStructures(alert.direction).includes(primary?.structure)) {
    reasons.push(`${config.primaryTf} structure ${primary?.structure || "UNKNOWN"} is not a confirmed directional structure.`);
  }
  const slippage = entrySlippagePct(alert, price);
  if (slippage > alert.revalidation.maxEntrySlippagePct) {
    reasons.push(`Price is ${round(slippage, 4)}% beyond the entry zone, exceeding allowed slippage.`);
  }

  const targets = targetsForAlert(alert, asset, price, primary);
  let plan = null;
  if (!targets.length) reasons.push("No current structural target is available.");
  else {
    try {
      plan = validatePlan(
        {
          instrumentId: alert.instrumentId,
          direction: alert.direction,
          horizon: alert.horizon,
          opportunityGrade: alert.opportunityGrade,
          accountEquity: 17000,
          riskPct: defaultRiskPct(alert.opportunityGrade),
          entry: price,
          stop: alert.invalidation,
          targets,
          atrValue: primary?.atr14,
          atrPct: primary?.atrPct,
        },
        asset,
      );
      if (finite(plan.rr.weightedNetRr, 0) < alert.revalidation.requireNetRr) {
        reasons.push(
          `Current weighted net RR ${plan.rr.weightedNetRr} is below required ${alert.revalidation.requireNetRr}.`,
        );
      }
      for (const blocker of plan.blockers.filter((item) => !item.startsWith("Weighted net RR"))) reasons.push(blocker);
      warnings.push(...plan.warnings);
    } catch (error) {
      reasons.push(`Plan validation failed: ${error.message}`);
    }
  }

  const technicalPassed = reasons.length === 0;
  const eventRisk = snapshot.macro?.eventRisk || "UNKNOWN";
  const newsPassed = eventRiskAllowed(eventRisk, alert.revalidation.maxEventRisk);
  if (!newsPassed) {
    warnings.push(
      eventRisk === "UNKNOWN"
        ? "Live macro/news risk is not available in the Worker; open the GPT to run the required web-news check."
        : `Event risk ${eventRisk} exceeds allowed ${alert.revalidation.maxEventRisk}.`,
    );
  }
  const passed = technicalPassed && newsPassed;
  const nextStatus = passed ? "REVALIDATED_READY" : "TOUCHED_NOT_CONFIRMED";
  const next = {
    ...alert,
    status: nextStatus,
    lastPrice: price,
    lastCheckedAt: checkedAt,
    updatedAt: checkedAt,
    revalidationResult: {
      passed,
      technicalPassed,
      newsCheckStatus: newsPassed ? "PASSED" : "REQUIRED",
      reasons,
      warnings,
      currentPlan: plan,
      dataCoveragePct: quality?.coveragePct ?? 0,
      eventRisk,
    },
  };
  const shouldNotify =
    next.lastNotifiedStatus !== nextStatus &&
    (nextStatus === "REVALIDATED_READY" || technicalPassed || alert.status === "ARMED");
  return { alert: next, notify: shouldNotify };
}

function alertNotificationText(alert) {
  const result = alert.revalidationResult || {};
  const title =
    alert.status === "REVALIDATED_READY"
      ? "条件复核通过，请重新评估执行"
      : alert.status === "TOUCHED_NOT_CONFIRMED" && result.technicalPassed
        ? "价格已触发，技术条件通过，新闻检查待完成"
        : alert.status === "INVALIDATED"
          ? "交易计划已失效"
          : alert.status === "EXPIRED"
            ? "交易提醒已过期"
            : "价格已触发，但条件未通过";
  return [
    `Crypto Alpha V17.1｜${title}`,
    `${alert.instrumentId} ${alert.direction} ${alert.horizon}`,
    `当前价格：${alert.lastPrice ?? "UNKNOWN"}`,
    `状态：${alert.status}`,
    `技术复核：${result.technicalPassed ? "通过" : "未通过"}`,
    `新闻检查：${result.newsCheckStatus || "REQUIRED"}`,
    ...(result.reasons || []).slice(0, 4).map((reason) => `- ${reason}`),
    "这不是自动开仓指令；请打开 GPT 获取最新新闻并完成最终复核。",
  ].join("\n");
}

async function sendAlertNotification(env, alert) {
  if (alert.notificationChannel === "NONE") return { sent: false, channel: "NONE" };
  const text = alertNotificationText(alert);
  if (alert.notificationChannel === "TELEGRAM") {
    if (!env?.TELEGRAM_BOT_TOKEN || !env?.TELEGRAM_CHAT_ID) {
      throw new AlphaError(
        "TELEGRAM_NOT_CONFIGURED",
        "Configure TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID secrets",
        { httpStatus: 503 },
      );
    }
    const response = await rawFetchJson(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        provider: "TELEGRAM",
        timeoutMs: 5000,
        retries: 1,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
        validator: (payload) => {
          if (!payload?.ok) throw new AlphaError("TELEGRAM_ERROR", payload?.description || "Telegram failed", { provider: "TELEGRAM" });
        },
      },
    );
    return { sent: true, channel: "TELEGRAM", messageId: response.data?.result?.message_id || null };
  }
  if (alert.notificationChannel === "WEBHOOK") {
    if (!env?.ALERT_WEBHOOK_URL) {
      throw new AlphaError("WEBHOOK_NOT_CONFIGURED", "Configure ALERT_WEBHOOK_URL", { httpStatus: 503 });
    }
    const headers = { "content-type": "application/json" };
    if (env.ALERT_WEBHOOK_BEARER) headers.authorization = `Bearer ${env.ALERT_WEBHOOK_BEARER}`;
    await rawFetchJson(env.ALERT_WEBHOOK_URL, {
      provider: "ALERT_WEBHOOK",
      timeoutMs: 5000,
      retries: 1,
      method: "POST",
      headers,
      body: JSON.stringify({ event: "crypto_alpha_alert", alert, text }),
    });
    return { sent: true, channel: "WEBHOOK" };
  }
  return { sent: false, channel: alert.notificationChannel };
}

async function processAlert(env, alert, snapshot) {
  if (["CANCELLED", "INVALIDATED", "EXPIRED", "REVALIDATED_READY"].includes(alert.status)) return alert;
  const result = revalidateAlert(alert, snapshot);
  let next = result.alert;
  if (result.notify) {
    try {
      const notification = await sendAlertNotification(env, next);
      next = {
        ...next,
        lastNotifiedStatus: next.status,
        notification: { ...notification, attemptedAt: nowIso() },
      };
    } catch (error) {
      next = {
        ...next,
        notification: { sent: false, attemptedAt: nowIso(), error: serialiseError(error) },
      };
    }
  }
  await saveAlert(env, next);
  return next;
}

function openApiDocument(origin) {
  const meta = {
    type: "object",
    additionalProperties: true,
    properties: {
      status: { type: "string", enum: ["OK", "PARTIAL", "STALE", "NOT_AVAILABLE", "ERROR"] },
      observedAt: { type: ["string", "null"], format: "date-time" },
      ageSec: { type: ["number", "null"] },
      source: { type: ["string", "null"] },
      fallbackUsed: { type: "boolean" },
      errorCode: { type: ["string", "null"] },
      errorMessage: { type: ["string", "null"] },
    },
  };
  // GPT Actions requires every object schema to declare `properties`, even
  // when the payload intentionally permits provider-specific extra fields.
  const flexibleObject = {
    type: "object",
    additionalProperties: true,
    properties: {},
  };
  const target = {
    type: "object",
    required: ["price"],
    additionalProperties: false,
    properties: {
      price: { type: "number" },
      weight: { type: "number", minimum: 0 },
      basis: { type: "string" },
      reachability: { type: "string", enum: ["HIGH", "MEDIUM", "LOW", "UNKNOWN"] },
    },
  };
  const alertProperties = {
    instrumentId: { type: "string", enum: Object.keys(ASSETS) },
    direction: { type: "string", enum: ["LONG", "SHORT"] },
    horizon: { type: "string", enum: Object.keys(HORIZON_CONFIG) },
    opportunityGrade: { type: "string", enum: ["A+", "A", "B", "C", "D"] },
    entryZone: {
      type: "object",
      required: ["low", "high"],
      additionalProperties: false,
      properties: { low: { type: "number" }, high: { type: "number" } },
    },
    trigger: { type: "string" },
    invalidation: { type: "number" },
    targets: { type: "array", maxItems: 3, items: target },
    expiresAt: { type: "string", format: "date-time" },
    setupFingerprint: { type: "string" },
    expectedPrimaryTrend: { type: "string", enum: ["BULLISH", "BEARISH"] },
    notificationChannel: { type: "string", enum: ["TELEGRAM", "WEBHOOK", "NONE"] },
    revalidation: {
      type: "object",
      required: ["minCoveragePct", "requireTrendUnchanged", "requireStructureValid", "requireNetRr", "maxEventRisk"],
      additionalProperties: false,
      properties: {
        minCoveragePct: { type: "number", minimum: 60, maximum: 100 },
        requireTrendUnchanged: { type: "boolean" },
        requireStructureValid: { type: "boolean" },
        requireNetRr: { type: "number", minimum: 0 },
        maxEventRisk: { type: "string", enum: ["LOW", "MEDIUM"] },
        maxEntrySlippagePct: { type: "number", minimum: 0, maximum: 3 },
      },
    },
  };
  return {
    openapi: "3.1.0",
    info: {
      title: "Crypto Alpha Pro Ultimate V17.1 API",
      version: API_VERSION,
      description:
        "Read-only BTC/ETH perpetual snapshot, deterministic position/RR validation and revalidated alerts. Never places orders. Fallback venue data is explicitly labelled.",
    },
    servers: [{ url: origin }],
    security: [{ AlphaApiKey: [] }],
    paths: {
      "/": {
        get: {
          operationId: "getCryptoAlphaData",
          summary: "Get complete real-time BTC and ETH perpetual data",
          description:
            "Call first for any current BTC/ETH trading analysis. Inspect dataQuality and raw modules; do not obey legacy risk.permission as a final decision.",
          "x-openai-isConsequential": false,
          parameters: [
            { name: "refresh", in: "query", required: false, schema: { type: "boolean", default: false } },
          ],
          responses: {
            200: {
              description: "Complete, degraded or partial snapshot",
              content: { "application/json": { schema: flexibleObject } },
            },
          },
        },
      },
      "/v2/snapshot": {
        get: {
          operationId: "getAlphaSnapshot",
          summary: "Get a configurable structured snapshot",
          description: "Use for focused diagnostics or alert revalidation. Single-field absence does not make the whole call fail.",
          "x-openai-isConsequential": false,
          parameters: [
            { name: "symbols", in: "query", required: false, schema: { type: "string", default: "BTC-USDT-SWAP,ETH-USDT-SWAP" } },
            { name: "timeframes", in: "query", required: false, schema: { type: "string", default: "15m,1h,4h,1d" } },
            { name: "setups", in: "query", required: false, schema: { type: "boolean", default: true } },
            { name: "refresh", in: "query", required: false, schema: { type: "boolean", default: false } },
          ],
          responses: {
            200: {
              description: "Snapshot with per-module freshness and coverage",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["status", "requestId", "generatedAt", "dataQuality", "assets"],
                    additionalProperties: true,
                    properties: {
                      status: { type: "string", enum: ["success", "degraded", "partial", "error"] },
                      requestId: { type: "string" },
                      generatedAt: { type: "string", format: "date-time" },
                      dataQuality: flexibleObject,
                      assets: {
                        type: "object",
                        additionalProperties: flexibleObject,
                        properties: {},
                      },
                      macro: flexibleObject,
                      setupCandidates: { type: "array", items: flexibleObject },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/v2/plan/validate": {
        post: {
          operationId: "validateAlphaPlan",
          summary: "Validate position size, leverage safety and net RR",
          description:
            "Call after choosing structure-based entry, stop and real targets, before outputting a formal OPEN_NOW plan. Cost fields are percentage points: 0.05 means 0.05%.",
          "x-openai-isConsequential": false,
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["instrumentId", "direction", "horizon", "opportunityGrade", "entry", "stop", "targets"],
                  additionalProperties: false,
                  properties: {
                    instrumentId: { type: "string", enum: Object.keys(ASSETS) },
                    direction: { type: "string", enum: ["LONG", "SHORT"] },
                    horizon: { type: "string", enum: Object.keys(HORIZON_CONFIG) },
                    opportunityGrade: { type: "string", enum: ["A+", "A", "B", "C", "D"] },
                    accountEquity: { type: "number", default: 17000 },
                    riskPct: { type: "number", minimum: 0, maximum: 8 },
                    aggressiveRiskConfirmed: { type: "boolean", default: false },
                    entry: { type: "number" },
                    stop: { type: "number" },
                    targets: { type: "array", minItems: 1, maxItems: 3, items: target },
                    dailyLossPct: { type: "number", minimum: 0 },
                    consecutiveFullStops: { type: "integer", minimum: 0 },
                    correlatedOpenRiskPct: { type: "number", minimum: 0 },
                    exchangeMaxLeverage: { type: "integer", minimum: 1, maximum: 125 },
                    maintenanceMarginPct: { type: "number", minimum: 0, maximum: 5 },
                    maxMarginPct: { type: "number", minimum: 1, maximum: 100, default: 50 },
                    atrValue: { type: "number" },
                    atrPct: { type: "number" },
                    marketCheck: { type: "boolean", default: true },
                    refresh: { type: "boolean", default: false },
                    costs: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        entryFeePct: { type: "number", default: 0.05 },
                        exitFeePct: { type: "number", default: 0.05 },
                        entrySlippagePct: { type: "number", default: 0.03 },
                        exitSlippagePct: { type: "number", default: 0.03 },
                        expectedFundingPct: { type: "number", default: 0 },
                      },
                    },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: "Validation result; inspect validation.status, blockers and warnings", content: { "application/json": { schema: flexibleObject } } },
            400: { description: "Invalid or unsafe plan definition" },
          },
        },
      },
      "/v2/alerts": {
        post: {
          operationId: "createAlphaAlert",
          summary: "Create an ARMED setup monitor",
          description: "Requires explicit user confirmation. Stores conditions but never places an order.",
          "x-openai-isConsequential": true,
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["instrumentId", "direction", "horizon", "entryZone", "invalidation", "expiresAt", "setupFingerprint", "revalidation"],
                  additionalProperties: false,
                  properties: alertProperties,
                },
              },
            },
          },
          responses: { 201: { description: "Alert created", content: { "application/json": { schema: flexibleObject } } } },
        },
        get: {
          operationId: "listAlphaAlerts",
          summary: "List alerts",
          "x-openai-isConsequential": false,
          parameters: [{ name: "status", in: "query", required: false, schema: { type: "string" } }],
          responses: { 200: { description: "Alert list", content: { "application/json": { schema: flexibleObject } } } },
        },
      },
      "/v2/alerts/{alertId}": {
        get: {
          operationId: "getAlphaAlert",
          summary: "Get one alert and its last revalidation",
          "x-openai-isConsequential": false,
          parameters: [{ name: "alertId", in: "path", required: true, schema: { type: "string" } }],
          responses: { 200: { description: "Alert", content: { "application/json": { schema: flexibleObject } } } },
        },
        delete: {
          operationId: "cancelAlphaAlert",
          summary: "Cancel an alert",
          "x-openai-isConsequential": true,
          parameters: [{ name: "alertId", in: "path", required: true, schema: { type: "string" } }],
          responses: { 200: { description: "Cancelled alert", content: { "application/json": { schema: flexibleObject } } } },
        },
      },
    },
    components: {
      securitySchemes: {
        AlphaApiKey: {
          type: "apiKey",
          in: "header",
          name: "X-Alpha-Key",
          description: "Set the same private value as the Worker ALPHA_API_KEY secret.",
        },
      },
      schemas: { ModuleMeta: meta },
    },
  };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function privacyHtml(env) {
  const contact = escapeHtml(env?.PRIVACY_CONTACT || "Contact the operator who provided this GPT");
  const updated = "2026-08-11";
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Crypto Alpha Pro API 隐私政策</title>
  <style>body{font-family:system-ui,-apple-system,sans-serif;max-width:820px;margin:40px auto;padding:0 20px;line-height:1.7;color:#18212f}h1,h2{line-height:1.25}code{background:#eef1f5;padding:.15em .35em;border-radius:4px}.note{background:#fff7db;padding:14px;border-radius:8px}</style>
</head>
<body>
  <h1>Crypto Alpha Pro API 隐私政策</h1>
  <p>更新日期：${updated}</p>
  <p class="note">本服务是只读的 BTC/ETH 市场数据、风险计算和提醒辅助工具，不连接用户交易所账户，不下单，也不承诺收益。</p>
  <h2>处理的数据</h2>
  <p>市场快照请求会处理用户选择的币种、周期和计算参数。若用户明确创建提醒，服务会保存提醒条件、状态、到期时间和复核结果。服务不要求交易所 API 密钥、身份证件、银行卡或交易账户密码。</p>
  <h2>数据来源与用途</h2>
  <p>服务从公开市场数据接口获取行情与衍生品数据，仅用于生成结构化快照、风险计算、故障诊断和提醒复核。备用数据源会被明确标注，不会伪装成主数据源。</p>
  <h2>保存与删除</h2>
  <p>普通快照不由应用主动写入持久数据库。提醒保存在 Cloudflare Workers KV，直至取消、到期后最多七天或由服务运营者删除。Cloudflare 可能按照其平台政策处理必要的网络和运行日志。</p>
  <h2>通知</h2>
  <p>只有用户明确创建提醒后，服务才会通过已由运营者配置的 Telegram 或 Webhook 发送通知。不要在 GPT 对话中发送机器人令牌、Webhook 密钥或其他秘密。</p>
  <h2>第三方服务</h2>
  <p>本服务可能使用 Cloudflare、OKX、Binance Futures、Telegram 或由运营者配置的 Webhook。各第三方按其自身政策处理数据。</p>
  <h2>用户选择</h2>
  <p>用户可查询或取消提醒。若需删除与本服务有关的数据，请联系：${contact}。</p>
  <h2>安全与限制</h2>
  <p>服务使用 API 密钥保护受限接口，但任何互联网服务都不能保证绝对安全。输出仅用于决策辅助，不构成投资建议或自动执行授权。</p>
</body>
</html>`;
}

async function healthCheck() {
  const started = Date.now();
  const [okx, binance] = await Promise.allSettled([
    okxGet("/api/v5/public/time", { timeoutMs: 3500, retries: 0 }),
    binanceGet("/fapi/v1/time", { timeoutMs: 3500, retries: 0 }),
  ]);
  const providers = {
    OKX: okx.status === "fulfilled"
      ? { status: "OK", serverTime: toIso(okx.value.data.data?.[0]?.ts), latencyMs: Date.now() - started }
      : { status: "ERROR", error: serialiseError(okx.reason) },
    BINANCE_FUTURES: binance.status === "fulfilled"
      ? { status: "OK", serverTime: toIso(binance.value.data.serverTime), latencyMs: Date.now() - started }
      : { status: "ERROR", error: serialiseError(binance.reason) },
  };
  const available = Object.values(providers).some((provider) => provider.status === "OK");
  return {
    status: available ? "healthy" : "unavailable",
    build: BUILD,
    apiVersion: API_VERSION,
    generatedAt: nowIso(),
    providers,
  };
}

function snapshotOptionsFromUrl(url, reqId) {
  return {
    requestId: reqId,
    symbols: url.searchParams.get("symbols"),
    timeframes: url.searchParams.get("timeframes"),
    includeSetups: !["false", "0", "no"].includes(String(url.searchParams.get("setups") || "true").toLowerCase()),
    refresh: ["true", "1", "yes"].includes(String(url.searchParams.get("refresh") || "false").toLowerCase()),
  };
}

async function routeRequest(request, env, ctx) {
  const reqId = requestId();
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: JSON_HEADERS });

  try {
    if (request.method === "GET" && path === "/openapi.json") {
      return jsonResponse(openApiDocument(url.origin), 200, { "cache-control": "public, max-age=3600" });
    }
    if (request.method === "GET" && path === "/privacy") {
      return new Response(privacyHtml(env), {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "public, max-age=3600",
          "x-content-type-options": "nosniff",
        },
      });
    }
    if (request.method === "GET" && path === "/health") {
      const health = await healthCheck();
      return jsonResponse(health, health.status === "healthy" ? 200 : 503);
    }
    if (request.method === "GET" && (path === "/" || path === "/v2/snapshot")) {
      requireApiKey(request, env, false);
      const snapshot = await buildSnapshot(snapshotOptionsFromUrl(url, reqId), ctx);
      return jsonResponse(path === "/" ? legacyResponse(snapshot) : snapshot, snapshot.status === "error" ? 503 : 200);
    }
    if (request.method === "POST" && path === "/v2/plan/validate") {
      requireApiKey(request, env, false);
      const body = await readJsonBody(request);
      let snapshot = null;
      if (body.marketCheck !== false) {
        const horizon = normaliseHorizon(body.horizon);
        const config = HORIZON_CONFIG[horizon];
        snapshot = await buildSnapshot(
          {
            requestId: reqId,
            symbols: body.instrumentId,
            timeframes: unique(["15m", config.primaryTf, config.confirmationTf, "4h"]),
            includeSetups: false,
            refresh: body.refresh === true,
          },
          ctx,
        );
      }
      const asset = snapshot?.assets?.[body.instrumentId] || null;
      const validation = validatePlan(body, asset);
      return jsonResponse({
        status: "success",
        requestId: reqId,
        generatedAt: nowIso(),
        marketDataQuality: snapshot?.dataQuality || null,
        validation,
      });
    }
    if (path === "/v2/alerts" && request.method === "POST") {
      requireApiKey(request, env, true);
      const alert = await createAlert(env, await readJsonBody(request));
      return jsonResponse({ status: "success", alert }, 201);
    }
    if (path === "/v2/alerts" && request.method === "GET") {
      requireApiKey(request, env, true);
      const status = url.searchParams.get("status");
      const alerts = await listAlerts(env, status);
      return jsonResponse({ status: "success", alerts });
    }
    const alertMatch = path.match(/^\/v2\/alerts\/([A-Za-z0-9_-]+)$/);
    if (alertMatch && request.method === "GET") {
      requireApiKey(request, env, true);
      return jsonResponse({ status: "success", alert: await getAlert(env, alertMatch[1]) });
    }
    if (alertMatch && request.method === "DELETE") {
      requireApiKey(request, env, true);
      const current = await getAlert(env, alertMatch[1]);
      const alert = { ...current, status: "CANCELLED", updatedAt: nowIso() };
      await saveAlert(env, alert);
      return jsonResponse({ status: "success", alert });
    }
    throw new AlphaError("NOT_FOUND", "Route not found", { httpStatus: 404 });
  } catch (error) {
    return errorResponse(error, reqId);
  }
}

async function runAlertScan(env, ctx) {
  const alerts = (await listAlerts(env)).filter((alert) =>
    ["ARMED", "TOUCHED_NOT_CONFIRMED"].includes(alert.status),
  );
  if (!alerts.length) return { scanned: 0, updated: 0 };
  const symbols = unique(alerts.map((alert) => alert.instrumentId));
  const timeframes = unique(
    alerts.flatMap((alert) => {
      const config = HORIZON_CONFIG[alert.horizon];
      return [config.primaryTf, config.confirmationTf, "4h"];
    }),
  );
  const snapshot = await buildSnapshot(
    {
      requestId: requestId(),
      symbols,
      timeframes,
      includeSetups: false,
      refresh: true,
    },
    ctx,
  );
  const settled = await Promise.allSettled(alerts.map((alert) => processAlert(env, alert, snapshot)));
  return {
    scanned: alerts.length,
    updated: settled.filter((result) => result.status === "fulfilled").length,
    failed: settled
      .filter((result) => result.status === "rejected")
      .map((result) => serialiseError(result.reason)),
  };
}

export default {
  async fetch(request, env, ctx) {
    return routeRequest(request, env, ctx);
  },

  async scheduled(_event, env, ctx) {
    const operation = runAlertScan(env, ctx).catch(() => null);
    if (ctx?.waitUntil) ctx.waitUntil(operation);
    else await operation;
  },
};
