const BUILD = "crypto-alpha-worker-v17.5.0-okx-stable-route";
const API_VERSION = "2.5.0";
const KRAKEN_FUTURES_BASE = "https://futures.kraken.com";
const KRAKEN_SPOT_BASE = "https://api.kraken.com";
const OKX_BASE = "https://www.okx.com";
const CACHE_SECONDS = 15;
const CANDLE_LIMIT = 240;
const RECENT_CANDLE_COUNT = 24;

const ASSETS = {
  BTCUSDT: { instrumentId: "BTC-USDT-SWAP", futuresSymbol: "PI_XBTUSD", spotPair: "XBTUSD" },
  ETHUSDT: { instrumentId: "ETH-USDT-SWAP", futuresSymbol: "PI_ETHUSD", spotPair: "ETHUSD" },
};

const TIMEFRAMES = {
  "15m": { okxBar: "15m", futuresResolution: "15m", spotInterval: "15" },
  "1h": { okxBar: "1H", futuresResolution: "1h", spotInterval: "60" },
  "4h": { okxBar: "4H", futuresResolution: "4h", spotInterval: "240" },
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

async function okx(path, retry429 = false) {
  const maximumAttempts = retry429 ? 2 : 1;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort("OKX timeout"), 9000);
    try {
      const response = await fetch(`${OKX_BASE}${path}`, {
        headers: { accept: "application/json", "user-agent": "CryptoAlpha/17.3.0" },
        signal: controller.signal,
        cf: { cacheEverything: true, cacheTtl: CACHE_SECONDS },
      });
      if (response.status === 429 && attempt < maximumAttempts) {
        await delay(900);
        continue;
      }
      if (!response.ok) throw new Error(`OKX HTTP ${response.status}`);
      const body = await response.json();
      if (body?.code !== "0" || !Array.isArray(body?.data)) {
        throw new Error(`OKX ${body?.code || "invalid response"}: ${body?.msg || "no data"}`);
      }
      return body.data;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("OKX request failed");
}

async function upstream(base, path, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(`${label} timeout`), 9000);
  try {
    const response = await fetch(`${base}${path}`, {
      headers: { accept: "application/json", "user-agent": "CryptoAlpha/17.3.0" },
      signal: controller.signal,
      cf: { cacheEverything: true, cacheTtl: CACHE_SECONDS },
    });
    if (!response.ok) throw new Error(`${label} HTTP ${response.status}`);
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

function krakenFutures(path) {
  return upstream(KRAKEN_FUTURES_BASE, path, "Kraken Futures");
}

async function krakenSpot(path) {
  const body = await upstream(KRAKEN_SPOT_BASE, path, "Kraken Spot");
  if (!body || !Array.isArray(body.error) || body.error.length) {
    throw new Error(`Kraken Spot ${body?.error?.join(", ") || "invalid response"}`);
  }
  return body.result;
}

function parseFuturesCandles(body) {
  if (!Array.isArray(body?.candles)) throw new Error("Kraken Futures candles are empty");
  const candles = body.candles
    .map((row) => ({
      ts: new Date(Number(row.time)).toISOString(),
      open: finite(row.open),
      high: finite(row.high),
      low: finite(row.low),
      close: finite(row.close),
      volumeContracts: finite(row.volume),
      volumeBase: null,
      confirmed: true,
    }))
    .filter((c) => [c.open, c.high, c.low, c.close].every(Number.isFinite))
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  if (candles.length) candles[candles.length - 1].confirmed = false;
  return candles;
}

function parseSpotCandles(result) {
  const key = Object.keys(result || {}).find((name) => name !== "last");
  const rows = key ? result[key] : null;
  if (!Array.isArray(rows)) throw new Error("Kraken Spot candles are empty");
  const candles = rows
    .map((row) => ({
      ts: new Date(Number(row[0]) * 1000).toISOString(),
      open: finite(row[1]),
      high: finite(row[2]),
      low: finite(row[3]),
      close: finite(row[4]),
      volumeContracts: null,
      volumeBase: finite(row[6]),
      confirmed: true,
    }))
    .filter((c) => [c.open, c.high, c.low, c.close].every(Number.isFinite))
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  if (candles.length) candles[candles.length - 1].confirmed = false;
  return candles;
}

function parseOkxCandles(rows) {
  if (!Array.isArray(rows)) throw new Error("OKX perpetual candles are empty");
  return rows
    .map((row) => ({
      ts: new Date(Number(row[0])).toISOString(),
      open: finite(row[1]),
      high: finite(row[2]),
      low: finite(row[3]),
      close: finite(row[4]),
      volumeContracts: finite(row[5]),
      volumeBase: finite(row[6]),
      volumeQuote: finite(row[7]),
      confirmed: String(row[8] ?? "0") === "1",
    }))
    .filter((c) => [c.open, c.high, c.low, c.close].every(Number.isFinite))
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
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

function parseOkxExecutionPrice(markRows, tickerRows, instrumentId) {
  const markRow = markRows?.find((item) => item?.instId === instrumentId);
  const tickerRow = tickerRows?.find((item) => item?.instId === instrumentId);
  const markPrice = finite(markRow?.markPx);
  const tickerLast = finite(tickerRow?.last);
  if (!Number.isFinite(tickerLast) && !Number.isFinite(markPrice)) {
    throw new Error(`OKX realtime ticker and mark price unavailable for ${instrumentId}`);
  }
  const last = finite(tickerLast, markPrice);
  const open24h = finite(tickerRow?.open24h);
  return {
    status: "ok",
    source: "OKX_USDT_PERPETUAL",
    priceType: tickerRow && markRow ? "LAST_BID_ASK_AND_MARK" : tickerRow ? "LAST_BID_ASK" : "MARK_PRICE_ONLY",
    primaryEndpoint: `/api/v5/market/ticker?instId=${instrumentId}`,
    fallbackEndpoint: `/api/v5/public/mark-price?instType=SWAP&instId=${instrumentId}`,
    last: round(last, 8),
    markPrice: round(markPrice, 8),
    bid: round(finite(tickerRow?.bidPx), 8),
    ask: round(finite(tickerRow?.askPx), 8),
    high24h: round(finite(tickerRow?.high24h), 8),
    low24h: round(finite(tickerRow?.low24h), 8),
    volume24hContracts: round(finite(tickerRow?.vol24h), 4),
    change24hPct: open24h ? round(((last - open24h) / open24h) * 100, 4) : null,
    exchangeTimestamp: tickerRow?.ts
      ? new Date(Number(tickerRow.ts)).toISOString()
      : markRow?.ts ? new Date(Number(markRow.ts)).toISOString() : null,
  };
}

function parseFuturesTicker(row) {
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

function parseOkxOpenInterest(rows) {
  const row = rows[0];
  if (!row) throw new Error("OKX open interest is empty");
  return {
    status: "ok",
    source: "OKX",
    contracts: round(finite(row.oi), 4),
    baseCurrency: round(finite(row.oiCcy), 8),
    usdValue: round(finite(row.oiUsd), 2),
    exchangeTimestamp: row.ts ? new Date(Number(row.ts)).toISOString() : null,
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
      derivatives: {
        openInterest: errorModule("Not loaded"),
        funding: errorModule("Not loaded"),
      },
    };
  }

  const tickerPromise = krakenFutures("/derivatives/api/v3/tickers")
    .then((value) => ({ status: "fulfilled", value }))
    .catch((reason) => ({ status: "rejected", reason }));
  const okxPriceDefinitions = Object.entries(ASSETS).flatMap(([symbol, config]) => [
    { symbol, type: "ticker", path: `/api/v5/market/ticker?instId=${config.instrumentId}` },
    { symbol, type: "markPrice", path: `/api/v5/public/mark-price?instType=SWAP&instId=${config.instrumentId}` },
  ]);
  const okxPricePromise = Promise.allSettled(okxPriceDefinitions.map((definition) => okx(definition.path, true)));
  const okxDefinitions = Object.entries(ASSETS).flatMap(([symbol, config]) => [
    { symbol, type: "openInterest", path: `/api/v5/public/open-interest?instType=SWAP&instId=${config.instrumentId}` },
    { symbol, type: "funding", path: `/api/v5/public/funding-rate?instId=${config.instrumentId}` },
  ]);
  const okxPromise = Promise.allSettled(okxDefinitions.map((definition) => okx(definition.path)));

  for (const [symbol, config] of Object.entries(ASSETS)) {
    for (const [timeframe, tfConfig] of Object.entries(TIMEFRAMES)) {
      try {
        let candles;
        let source = "OKX_USDT_PERPETUAL";
        let fallbackUsed = false;
        try {
          const rows = await okx(`/api/v5/market/candles?instId=${config.instrumentId}&bar=${tfConfig.okxBar}&limit=${CANDLE_LIMIT}`);
          candles = parseOkxCandles(rows);
          if (candles.length < 200) throw new Error(`OKX returned only ${candles.length} candles`);
        } catch (okxError) {
          fallbackUsed = true;
          try {
            const body = await krakenFutures(`/api/charts/v1/trade/${config.futuresSymbol}/${tfConfig.futuresResolution}?count=${CANDLE_LIMIT}`);
            candles = parseFuturesCandles(body);
            if (candles.length < 200) throw new Error(`Kraken Futures returned only ${candles.length} candles`);
            source = "KRAKEN_FUTURES";
            fallbacks.push({ symbol, timeframe, primary: "OKX_USDT_PERPETUAL", fallback: "KRAKEN_FUTURES", reason: okxError?.message || String(okxError) });
          } catch (futuresError) {
            const result = await krakenSpot(`/0/public/OHLC?pair=${config.spotPair}&interval=${tfConfig.spotInterval}`);
            candles = parseSpotCandles(result).slice(-CANDLE_LIMIT);
            source = "KRAKEN_SPOT";
            fallbacks.push({ symbol, timeframe, primary: "OKX_USDT_PERPETUAL", fallback: "KRAKEN_SPOT", reason: `${okxError?.message || String(okxError)}; ${futuresError?.message || String(futuresError)}` });
          }
        }
        assets[symbol].timeframes[timeframe] = { ...summarizeTimeframe(candles), source, fallbackUsed };
      } catch (error) {
        const message = error?.message || String(error);
        assets[symbol].timeframes[timeframe] = errorModule(message);
        errors.push({ symbol, module: "candles", timeframe, error: message });
      }
      await delay(150);
    }
  }

  let futuresTickers = [];
  const tickerResult = await tickerPromise;
  try {
    if (tickerResult.status === "rejected") throw tickerResult.reason;
    const tickerBody = tickerResult.value;
    futuresTickers = Array.isArray(tickerBody?.tickers) ? tickerBody.tickers : [];
    if (!futuresTickers.length) throw new Error("Kraken Futures tickers are empty");
  } catch (error) {
    supplementalErrors.push({ source: "KRAKEN_FUTURES", module: "tickerBatch", error: error?.message || String(error) });
  }

  for (const [symbol, config] of Object.entries(ASSETS)) {
    const row = futuresTickers.find((item) => item?.symbol === config.futuresSymbol);
    try {
      assets[symbol].ticker = row ? parseFuturesTicker(row) : tickerFromCandles(assets[symbol]);
    } catch (error) {
      const message = error?.message || String(error);
      assets[symbol].ticker = errorModule(message);
      errors.push({ symbol, module: "ticker", timeframe: null, error: message });
    }
    try {
      assets[symbol].derivatives.openInterest = parseFuturesOpenInterest(row);
    } catch (error) {
      supplementalErrors.push({ source: "KRAKEN_FUTURES", symbol, module: "openInterest", error: error?.message || String(error) });
    }
    try {
      assets[symbol].derivatives.funding = parseFuturesFunding(row);
    } catch (error) {
      supplementalErrors.push({ source: "KRAKEN_FUTURES", symbol, module: "funding", error: error?.message || String(error) });
    }
  }

  const okxPriceResults = await okxPricePromise;
  for (const [symbol, config] of Object.entries(ASSETS)) {
    const tickerIndex = okxPriceDefinitions.findIndex((item) => item.symbol === symbol && item.type === "ticker");
    const markIndex = okxPriceDefinitions.findIndex((item) => item.symbol === symbol && item.type === "markPrice");
    const tickerResult = okxPriceResults[tickerIndex];
    const markResult = okxPriceResults[markIndex];
    if (tickerResult.status === "rejected") {
      supplementalErrors.push({ source: "OKX", symbol, module: "ticker", error: tickerResult.reason?.message || String(tickerResult.reason) });
    }
    if (markResult.status === "rejected") {
      supplementalErrors.push({ source: "OKX", symbol, module: "markPrice", error: markResult.reason?.message || String(markResult.reason) });
    }
    try {
      assets[symbol].ticker = parseOkxExecutionPrice(
        markResult.status === "fulfilled" ? markResult.value : null,
        tickerResult.status === "fulfilled" ? tickerResult.value : null,
        config.instrumentId,
      );
    } catch (error) {
      const message = `Exact OKX USDT perpetual realtime price unavailable: ${error?.message || String(error)}`;
      errors.push({ symbol, module: "executionPrice", timeframe: null, error: message });
    }
  }

  const okxResults = await okxPromise;
  okxDefinitions.forEach((definition, index) => {
    const result = okxResults[index];
    if (result.status === "fulfilled") {
      try {
        assets[definition.symbol].derivatives[definition.type] = definition.type === "openInterest"
          ? parseOkxOpenInterest(result.value)
          : parseOkxFunding(result.value);
      } catch (error) {
        supplementalErrors.push({ source: "OKX", symbol: definition.symbol, module: definition.type, error: error?.message || String(error) });
      }
    } else {
      supplementalErrors.push({ source: "OKX", symbol: definition.symbol, module: definition.type, error: result.reason?.message || String(result.reason) });
    }
  });

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
  for (const asset of Object.values(assets)) {
    modules.push(asset.ticker, ...Object.values(asset.timeframes), asset.derivatives.openInterest, asset.derivatives.funding);
  }
  const available = modules.filter((module) => module.status === "ok").length;
  const coveragePct = round((available / modules.length) * 100, 2);
  const executionPriceReady = Object.values(assets).every((asset) => asset.ticker.source === "OKX_USDT_PERPETUAL");
  const criticalReady = Object.values(assets).every(
    (asset) =>
      asset.ticker.status === "ok" &&
      Object.values(asset.timeframes).every((tf) => tf.status === "ok") &&
      asset.derivatives.openInterest.status === "ok" &&
      asset.derivatives.funding.status === "ok",
  ) && executionPriceReady;

  return {
    status: criticalReady ? "ok" : "partial",
    decisionState: criticalReady ? "DATA_READY" : "DATA_BLOCKED",
    build: BUILD,
    apiVersion: API_VERSION,
    generatedAt: new Date().toISOString(),
    timezone: "UTC",
    source: "OKX USDT perpetual last/bid/ask/mark price for execution; OKX perpetual candles primary; Kraken candle fallback; OKX/Kraken derivatives",
    requestBudget: { planned: 15, maximumWithKlineFallbacks: 27 },
    coverage: { availableModules: available, totalModules: modules.length, coveragePct, executionPriceReady, criticalReady },
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
    },
  };
  return {
    openapi: "3.1.0",
    info: {
      title: "Crypto Alpha BTC ETH Realtime",
      description: "Realtime BTC/ETH perpetual data for OKX execution. Each asset uses its own OKX ticker endpoint as primary and its own OKX mark-price endpoint as fallback. Kraken is used only for labelled candle or derivatives fallback.",
      version: API_VERSION,
    },
    servers: [{ url: origin }],
    paths: {
      "/": {
        get: {
          operationId: "getCryptoAlphaData",
          summary: "Get realtime BTC and ETH perpetual market data",
          description: "Returns exact OKX BTC/ETH USDT perpetual last, bid, ask and mark prices plus 15m/1h/4h indicators, candles, OI and funding rate. DATA_READY requires an exact OKX ticker or mark price for each asset. No authentication.",
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
                        properties: { planned: { type: "integer" }, maximumWithKlineFallbacks: { type: "integer" } },
                      },
                      coverage: {
                        type: "object",
                        properties: {
                          availableModules: { type: "integer" },
                          totalModules: { type: "integer" },
                          coveragePct: { type: "number" },
                          executionPriceReady: { type: "boolean" },
                          criticalReady: { type: "boolean" },
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
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Crypto Alpha Privacy</title><body style="font-family:system-ui;max-width:760px;margin:40px auto;padding:0 18px;line-height:1.7"><h1>Crypto Alpha 隐私政策</h1><p>本服务仅提供只读的 BTC/ETH 市场数据，不执行交易，不接收交易所密钥，不收集姓名、邮箱、账户或付款信息。</p><p>为保障稳定性，服务提供商可能保留短期技术日志，例如请求时间、错误信息与网络元数据。日志仅用于故障排查。</p><p>执行价格与主K线来源：OKX USDT 永续。K线备用来源：Kraken Futures 与 Kraken Spot。服务地址：${origin}</p><p>最后更新：2026-08-18</p></body></html>`;
}

async function handleSnapshot(request, ctx) {
  const cache = globalThis.caches?.default;
  const cacheKey = new Request("https://crypto-alpha-cache.invalid/v17.5.0/realtime");
  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) return new Response(cached.body, cached);
  }
  const snapshot = await buildSnapshot();
  const response = json(snapshot);
  if (cache && ctx?.waitUntil) ctx.waitUntil(cache.put(cacheKey, response.clone()));
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
      return json({ status: "ok", build: BUILD, apiVersion: API_VERSION, upstream: "OKX per-instrument ticker primary + OKX per-instrument mark fallback + Kraken reserve", actionCount: 1, authentication: "none" });
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
