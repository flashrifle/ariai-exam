/**
 * 목 시장 시뮬레이터 — **개발 중 화면 확인 전용**.
 * `NEXT_PUBLIC_USE_MOCK=true` 일 때만 동적 import 되며, 실제 경로에는 섞이지 않는다.
 *
 * 가격은 시각(분 인덱스)만으로 결정되는 결정론적 함수라서
 * 새로고침해도 과거 캔들이 동일하게 재현된다.
 */
import type {
  BackfillJob,
  Candle,
  CollectorEvent,
  Interval,
  MetricsOverview,
  OpsHealth,
  Symbol as TradingSymbol,
} from '@/types/api';

const MINUTE_MS = 60_000;

const BASE_PRICE: Record<TradingSymbol, number> = {
  BTCUSDT: 96_400,
  ETHUSDT: 3_180,
};

const INTERVAL_MINUTES: Record<Interval, number> = {
  '1m': 1,
  '5m': 5,
  '15m': 15,
  '1h': 60,
};

/** 해시 기반 유사난수 (0~1). 같은 seed 는 항상 같은 값. */
function noise(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43_758.5453;
  return x - Math.floor(x);
}

/** 분 인덱스 → 가격. 여러 주기의 사인파를 겹쳐 자연스러운 파형을 만든다. */
function priceAt(symbol: TradingSymbol, minuteIndex: number): number {
  const base = BASE_PRICE[symbol];
  const wave =
    0.021 * Math.sin(minuteIndex / 57) +
    0.009 * Math.sin(minuteIndex / 13.3) +
    0.003 * Math.sin(minuteIndex / 3.1) +
    0.0016 * (noise(minuteIndex + (symbol === 'BTCUSDT' ? 0 : 991)) - 0.5);
  return base * (1 + wave);
}

function currentMinuteIndex(now = Date.now()): number {
  return Math.floor(now / MINUTE_MS);
}

/** 1분봉 하나. */
function minuteCandle(symbol: TradingSymbol, minuteIndex: number): Candle {
  const openTime = minuteIndex * MINUTE_MS;
  const open = priceAt(symbol, minuteIndex);
  const close = priceAt(symbol, minuteIndex + 1);
  const spread = Math.abs(close - open) + open * 0.0006 * (0.4 + noise(minuteIndex * 7.7));
  const high = Math.max(open, close) + spread * 0.6;
  const low = Math.min(open, close) - spread * 0.6;
  const volume =
    (symbol === 'BTCUSDT' ? 14 : 220) * (0.45 + noise(minuteIndex * 3.3) * 1.3);
  const quoteVolume = volume * ((open + close) / 2);
  const takerBuyShare = 0.36 + noise(minuteIndex * 5.1) * 0.3;

  return {
    openTime: new Date(openTime).toISOString(),
    closeTime: new Date(openTime + MINUTE_MS - 1).toISOString(),
    open: round(open),
    high: round(high),
    low: round(low),
    close: round(close),
    volume: round(volume, 4),
    quoteVolume: round(quoteVolume),
    tradeCount: Math.round(180 + noise(minuteIndex * 2.9) * 900),
    takerBuyQuote: round(quoteVolume * takerBuyShare),
  };
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** 1분봉 여러 개를 상위 인터벌 한 봉으로 합친다 (백엔드 SQL 집계와 동일한 규칙). */
function aggregate(candles: Candle[]): Candle | null {
  const first = candles[0];
  const last = candles[candles.length - 1];
  if (!first || !last) return null;
  return {
    openTime: first.openTime,
    closeTime: last.closeTime,
    open: first.open,
    high: Math.max(...candles.map((c) => c.high)),
    low: Math.min(...candles.map((c) => c.low)),
    close: last.close,
    volume: round(
      candles.reduce((sum, c) => sum + c.volume, 0),
      4,
    ),
    quoteVolume: round(candles.reduce((sum, c) => sum + c.quoteVolume, 0)),
    tradeCount: candles.reduce((sum, c) => sum + c.tradeCount, 0),
    takerBuyQuote: round(candles.reduce((sum, c) => sum + c.takerBuyQuote, 0)),
  };
}

export function buildCandles(symbol: TradingSymbol, interval: Interval, limit: number): Candle[] {
  const step = INTERVAL_MINUTES[interval];
  const nowIndex = currentMinuteIndex();
  const result: Candle[] = [];

  for (let bucket = limit - 1; bucket >= 0; bucket -= 1) {
    const endIndex = nowIndex - bucket * step;
    const startIndex = Math.floor(endIndex / step) * step;
    const minutes: Candle[] = [];
    for (let m = 0; m < step; m += 1) {
      const index = startIndex + m;
      if (index > nowIndex) break;
      minutes.push(minuteCandle(symbol, index));
    }
    const merged = step === 1 ? minutes[0] : aggregate(minutes);
    if (merged) result.push(merged);
  }

  // openTime 오름차순 · 중복 제거 (lightweight-charts 요구사항)
  const seen = new Set<string>();
  return result.filter((candle) => {
    if (seen.has(candle.openTime)) return false;
    seen.add(candle.openTime);
    return true;
  });
}

/** 지금 이 순간의 체결가. 초 단위로 미세하게 흔들린다. */
export function currentPrice(symbol: TradingSymbol, now = Date.now()): number {
  const index = now / MINUTE_MS;
  return round(priceAt(symbol, index));
}

export function buildMetricsOverview(symbol: TradingSymbol): MetricsOverview {
  const nowIndex = currentMinuteIndex();
  const last = currentPrice(symbol);
  const dayAgo = priceAt(symbol, nowIndex - 1_440);
  const recent = buildCandles(symbol, '1m', 60);
  const quoteSum = recent.reduce((sum, c) => sum + c.quoteVolume, 0);
  const volumeSum = recent.reduce((sum, c) => sum + c.volume, 0);
  const vwap = volumeSum > 0 ? quoteSum / volumeSum : last;
  const takerBuy = recent.reduce((sum, c) => sum + c.takerBuyQuote, 0);

  const returns = recent
    .map((c, i) => (i === 0 ? 0 : Math.log(c.close / (recent[i - 1]?.close ?? c.close))))
    .slice(1);
  const mean = returns.reduce((s, r) => s + r, 0) / Math.max(1, returns.length);
  const variance =
    returns.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(1, returns.length - 1);
  const realizedVolatility = Math.sqrt(variance) * Math.sqrt(525_600) * 100;

  const lastCandle = recent[recent.length - 1];
  const prevCandle = recent[recent.length - 2];

  return {
    symbol,
    asOf: new Date().toISOString(),
    lastPrice: last,
    priceChangePct24h: round(((last - dayAgo) / dayAgo) * 100, 3),
    quoteVolume24h: round(quoteSum * 24),
    vwap: round(vwap),
    vwapDeviationPct: round(((last - vwap) / vwap) * 100, 3),
    realizedVolatility: round(realizedVolatility, 2),
    takerBuyRatio: round(quoteSum > 0 ? takerBuy / quoteSum : 0.5, 4),
    tradeCount1m: lastCandle?.tradeCount ?? 0,
    volumeSurgeRatio: round(
      prevCandle && prevCandle.quoteVolume > 0 && lastCandle
        ? lastCandle.quoteVolume / prevCandle.quoteVolume
        : 1,
      2,
    ),
  };
}

export function buildOpsHealth(): OpsHealth {
  const now = Date.now();
  const nowIndex = currentMinuteIndex(now);
  // 24시간 커버리지에 일부러 구멍을 낸다 — 갭 시각화를 확인하기 위함.
  const gapStart = (nowIndex - 640) * MINUTE_MS;
  const gapStart2 = (nowIndex - 187) * MINUTE_MS;

  const missing = [
    { from: new Date(gapStart).toISOString(), to: new Date(gapStart + 14 * MINUTE_MS).toISOString() },
    { from: new Date(gapStart2).toISOString(), to: new Date(gapStart2 + 3 * MINUTE_MS).toISOString() },
  ];

  const streamLag = (offset: number) => round(0.4 + noise(nowIndex + offset) * 2.6, 2);

  return {
    serverTime: new Date(now).toISOString(),
    uptimeSeconds: 3_600 * 7 + 1_284,
    streams: [
      {
        streamKey: 'btcusdt@kline_1m',
        symbol: 'BTCUSDT',
        kind: 'kline',
        connected: true,
        lastEventAt: new Date(now - 1_200).toISOString(),
        lagSeconds: streamLag(1),
      },
      {
        streamKey: 'btcusdt@trade',
        symbol: 'BTCUSDT',
        kind: 'trade',
        connected: true,
        lastEventAt: new Date(now - 300).toISOString(),
        lagSeconds: streamLag(2),
      },
      {
        streamKey: 'ethusdt@kline_1m',
        symbol: 'ETHUSDT',
        kind: 'kline',
        connected: true,
        lastEventAt: new Date(now - 2_400).toISOString(),
        lagSeconds: streamLag(3),
      },
      {
        // 하나는 일부러 지연 상태로 둔다 — 경고 색 확인용.
        streamKey: 'ethusdt@trade',
        symbol: 'ETHUSDT',
        kind: 'trade',
        connected: true,
        lastEventAt: new Date(now - 9_500).toISOString(),
        lagSeconds: 9.5,
      },
    ],
    coverage: [
      {
        symbol: 'BTCUSDT',
        interval: '1m',
        expected: 1_440,
        actual: 1_423,
        ratio: round(1_423 / 1_440, 4),
        missingRanges: missing,
      },
      {
        symbol: 'ETHUSDT',
        interval: '1m',
        expected: 1_440,
        actual: 1_440,
        ratio: 1,
        missingRanges: [],
      },
    ],
    backfill: {
      running: 1,
      pending: 0,
      failed24h: 1,
      lastSucceededAt: new Date(now - 11 * MINUTE_MS).toISOString(),
    },
  };
}

export function buildBackfillJobs(): BackfillJob[] {
  const now = Date.now();
  const iso = (offsetMs: number) => new Date(now - offsetMs).toISOString();

  return [
    {
      id: 41,
      symbol: 'BTCUSDT',
      interval: '1m',
      rangeStart: iso(640 * MINUTE_MS),
      rangeEnd: iso(626 * MINUTE_MS),
      reason: 'gap_recovery',
      status: 'running',
      rowsWritten: 6,
      attempts: 1,
      error: null,
      createdAt: iso(90_000),
      startedAt: iso(60_000),
      finishedAt: null,
    },
    {
      id: 40,
      symbol: 'ETHUSDT',
      interval: '1m',
      rangeStart: iso(200 * MINUTE_MS),
      rangeEnd: iso(180 * MINUTE_MS),
      reason: 'gap_recovery',
      status: 'succeeded',
      rowsWritten: 20,
      attempts: 1,
      error: null,
      createdAt: iso(11 * MINUTE_MS + 40_000),
      startedAt: iso(11 * MINUTE_MS + 20_000),
      finishedAt: iso(11 * MINUTE_MS),
    },
    {
      id: 39,
      symbol: 'BTCUSDT',
      interval: '1m',
      rangeStart: iso(1_500 * MINUTE_MS),
      rangeEnd: iso(1_440 * MINUTE_MS),
      reason: 'manual',
      status: 'failed',
      rowsWritten: 0,
      attempts: 3,
      error: 'HTTP 429 · Retry-After 12s (weight 예산 초과)',
      createdAt: iso(52 * MINUTE_MS),
      startedAt: iso(52 * MINUTE_MS - 5_000),
      finishedAt: iso(50 * MINUTE_MS),
    },
    {
      id: 1,
      symbol: 'BTCUSDT',
      interval: '1m',
      rangeStart: iso(4_320 * MINUTE_MS),
      rangeEnd: iso(2_880 * MINUTE_MS),
      reason: 'bootstrap',
      status: 'succeeded',
      rowsWritten: 1_440,
      attempts: 1,
      error: null,
      createdAt: iso(430 * MINUTE_MS),
      startedAt: iso(430 * MINUTE_MS),
      finishedAt: iso(427 * MINUTE_MS),
    },
  ];
}

export function buildCollectorEvents(): CollectorEvent[] {
  const now = Date.now();
  const iso = (offsetMs: number) => new Date(now - offsetMs).toISOString();

  return [
    {
      id: 512,
      ts: iso(45_000),
      level: 'warn',
      kind: 'gap_detected',
      stream: 'btcusdt@kline_1m',
      message: '1분봉 14개 누락 구간 탐지 · 백필 잡 41 생성',
      meta: { missingCount: 14, jobId: 41 },
    },
    {
      id: 511,
      ts: iso(9 * MINUTE_MS),
      level: 'info',
      kind: 'backfill_succeeded',
      stream: null,
      message: '백필 잡 40 완료 · 20행 기록',
      meta: { jobId: 40, rowsWritten: 20 },
    },
    {
      id: 510,
      ts: iso(23 * MINUTE_MS),
      level: 'error',
      kind: 'ws_error',
      stream: 'ethusdt@trade',
      message: 'WebSocket 1006 비정상 종료 · 재연결 시도 1회',
      meta: { code: 1006 },
    },
    {
      id: 509,
      ts: iso(23 * MINUTE_MS - 800),
      level: 'info',
      kind: 'ws_open',
      stream: 'ethusdt@trade',
      message: '스트림 재연결 성공',
      meta: null,
    },
    {
      id: 508,
      ts: iso(50 * MINUTE_MS),
      level: 'error',
      kind: 'backfill_failed',
      stream: null,
      message: '백필 잡 39 실패 · HTTP 429 (weight 예산 초과)',
      meta: { jobId: 39, status: 429 },
    },
    {
      id: 507,
      ts: iso(427 * MINUTE_MS),
      level: 'info',
      kind: 'bootstrap_done',
      stream: null,
      message: '부트스트랩 백필 완료 · 3일치 1분봉 적재',
      meta: { days: 3 },
    },
  ];
}
