/**
 * overview 행 매핑 테스트 — DB 없이 경계 변환 로직을 검증한다.
 * 핵심: NULL(계산 불가)·NaN·Infinity 가 절대 프론트로 새지 않아야 한다.
 */
import { buildOverviewQuery, mapOverviewRow, type OverviewRow } from './overview.query';

const AS_OF = new Date('2026-08-15T12:00:00.000Z');

function fullRow(): OverviewRow {
  return {
    as_of: AS_OF,
    last_price: '65000.12345678',
    price_change_pct_24h: '2.5',
    quote_volume_24h: '123456789.12',
    vwap: '64800.5',
    vwap_deviation_pct: '0.308',
    realized_volatility: '45.6',
    taker_buy_ratio: '0.52',
    trade_count_1m: '321',
    volume_surge_ratio: '1.8',
  };
}

describe('mapOverviewRow', () => {
  it('numeric string 행을 MetricsOverview number 필드로 변환한다', () => {
    const overview = mapOverviewRow('BTCUSDT', fullRow());

    expect(overview).toEqual({
      symbol: 'BTCUSDT',
      asOf: '2026-08-15T12:00:00.000Z',
      lastPrice: 65000.12345678,
      priceChangePct24h: 2.5,
      quoteVolume24h: 123456789.12,
      vwap: 64800.5,
      vwapDeviationPct: 0.308,
      realizedVolatility: 45.6,
      takerBuyRatio: 0.52,
      tradeCount1m: 321,
      volumeSurgeRatio: 1.8,
    });
  });

  it('계산 불가(NULL) 필드는 0 으로 치환한다 — 데이터 없는 초기 상태 방어', () => {
    const row: OverviewRow = {
      as_of: AS_OF,
      last_price: null,
      price_change_pct_24h: null,
      quote_volume_24h: '0',
      vwap: null,
      vwap_deviation_pct: null,
      realized_volatility: null,
      taker_buy_ratio: null,
      trade_count_1m: '0',
      volume_surge_ratio: null,
    };

    const overview = mapOverviewRow('ETHUSDT', row);

    expect(overview.lastPrice).toBe(0);
    expect(overview.priceChangePct24h).toBe(0);
    expect(overview.vwap).toBe(0);
    expect(overview.realizedVolatility).toBe(0);
    expect(overview.volumeSurgeRatio).toBe(0);
    // 모든 필드가 유한한 number 인지 전수 확인
    for (const [key, value] of Object.entries(overview)) {
      if (typeof value === 'number') {
        expect(Number.isFinite(value)).toBe(true);
      } else {
        expect(['symbol', 'asOf']).toContain(key);
      }
    }
  });

  it('NaN·Infinity 문자열이 들어와도 유한한 값으로 강제한다', () => {
    const row: OverviewRow = { ...fullRow(), vwap: 'NaN', volume_surge_ratio: 'Infinity' };

    const overview = mapOverviewRow('BTCUSDT', row);

    expect(overview.vwap).toBe(0);
    expect(overview.volumeSurgeRatio).toBe(0);
  });

  it('takerBuyRatio 는 0~1 로 클램프한다', () => {
    const over: OverviewRow = { ...fullRow(), taker_buy_ratio: '1.2' };
    const under: OverviewRow = { ...fullRow(), taker_buy_ratio: '-0.1' };

    expect(mapOverviewRow('BTCUSDT', over).takerBuyRatio).toBe(1);
    expect(mapOverviewRow('BTCUSDT', under).takerBuyRatio).toBe(0);
  });
});

describe('buildOverviewQuery', () => {
  it('SQL 조각 조립이 예외 없이 완료된다 (스모크)', () => {
    expect(buildOverviewQuery('BTCUSDT', 60)).toBeDefined();
    expect(buildOverviewQuery('ETHUSDT', 15)).toBeDefined();
  });
});
