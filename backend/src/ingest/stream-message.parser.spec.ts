import {
  klineStreamKey,
  parseStreamMessage,
  tradeStreamKey,
} from './stream-message.parser';

/** 분 경계에 정렬된 openTime. */
const ALIGNED_OPEN_TIME = 1699999980000;

function klineFrame(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    stream: 'btcusdt@kline_1m',
    data: {
      e: 'kline',
      E: 1700000000123,
      s: 'BTCUSDT',
      k: {
        t: ALIGNED_OPEN_TIME,
        T: ALIGNED_OPEN_TIME + 59_999,
        s: 'BTCUSDT',
        i: '1m',
        f: 1,
        L: 2,
        o: '35000.10000000',
        c: '35010.50000000',
        h: '35020.00000000',
        l: '34990.00000000',
        v: '12.34500000',
        n: 250,
        x: false,
        q: '432000.12345678',
        V: '6.00000000',
        Q: '210000.00000000',
        B: '0',
        ...overrides,
      },
    },
  });
}

function tradeFrame(): string {
  return JSON.stringify({
    stream: 'ethusdt@trade',
    data: {
      e: 'trade',
      E: 1700000000456,
      s: 'ETHUSDT',
      t: 123456789,
      p: '2000.50',
      q: '0.20000000',
      T: 1700000000455,
      m: true,
      M: true,
    },
  });
}

describe('parseStreamMessage — kline', () => {
  test('미확정 봉을 KlinePayload로 변환한다 (가격/수량 문자열 유지)', () => {
    const msg = parseStreamMessage(klineFrame());
    expect(msg.type).toBe('kline');
    if (msg.type !== 'kline') {
      return;
    }
    expect(msg.eventTime).toEqual(new Date(1700000000123));
    expect(msg.payload.symbol).toBe('BTCUSDT');
    expect(msg.payload.interval).toBe('1m');
    expect(msg.payload.openTime).toEqual(new Date(ALIGNED_OPEN_TIME));
    expect(msg.payload.closeTime).toEqual(new Date(ALIGNED_OPEN_TIME + 59_999));
    expect(msg.payload.open).toBe('35000.10000000');
    expect(msg.payload.close).toBe('35010.50000000');
    expect(msg.payload.volume).toBe('12.34500000');
    expect(msg.payload.quoteVolume).toBe('432000.12345678');
    expect(msg.payload.tradeCount).toBe(250);
    expect(msg.payload.takerBuyBase).toBe('6.00000000');
    expect(msg.payload.takerBuyQuote).toBe('210000.00000000');
    expect(msg.payload.isClosed).toBe(false);
  });

  test('확정 봉(x=true)은 isClosed=true로 변환한다', () => {
    const msg = parseStreamMessage(klineFrame({ x: true }));
    if (msg.type !== 'kline') {
      throw new Error('kline 메시지가 아닙니다');
    }
    expect(msg.payload.isClosed).toBe(true);
  });

  test('openTime이 분 경계에 정렬되지 않으면 예외를 던진다', () => {
    expect(() => parseStreamMessage(klineFrame({ t: ALIGNED_OPEN_TIME + 1 }))).toThrow('분 경계');
  });

  test('지원하지 않는 인터벌은 거부한다', () => {
    expect(() => parseStreamMessage(klineFrame({ i: '5m' }))).toThrow();
  });
});

describe('parseStreamMessage — trade', () => {
  test('체결을 TradePayload로 변환하고 quoteQty를 정확히 계산한다', () => {
    const msg = parseStreamMessage(tradeFrame());
    expect(msg.type).toBe('trade');
    if (msg.type !== 'trade') {
      return;
    }
    expect(msg.eventTime).toEqual(new Date(1700000000456));
    expect(msg.payload.symbol).toBe('ETHUSDT');
    expect(msg.payload.tradeId).toBe(123456789n);
    expect(msg.payload.price).toBe('2000.50');
    expect(msg.payload.qty).toBe('0.20000000');
    // 2000.50 × 0.20000000 — 부동소수 오차 없이 정확해야 한다
    expect(msg.payload.quoteQty).toBe('400.1000000000');
    expect(msg.payload.tradeTime).toEqual(new Date(1700000000455));
    expect(msg.payload.isBuyerMaker).toBe(true);
  });
});

describe('parseStreamMessage — 오류 케이스', () => {
  test('알 수 없는 이벤트 타입은 거부한다', () => {
    const raw = JSON.stringify({
      stream: 'btcusdt@aggTrade',
      data: { e: 'aggTrade', E: 1, s: 'BTCUSDT' },
    });
    expect(() => parseStreamMessage(raw)).toThrow();
  });

  test('지원하지 않는 심볼은 거부한다', () => {
    const raw = tradeFrame().replace(/ETHUSDT/g, 'DOGEUSDT');
    expect(() => parseStreamMessage(raw)).toThrow();
  });

  test('JSON이 아닌 원문은 거부한다', () => {
    expect(() => parseStreamMessage('not-json')).toThrow();
  });
});

describe('streamKey 규칙', () => {
  test('ingest_state.stream_key 형식을 따른다', () => {
    expect(klineStreamKey('BTCUSDT')).toBe('kline:BTCUSDT:1m');
    expect(tradeStreamKey('ETHUSDT')).toBe('trade:ETHUSDT');
  });
});
