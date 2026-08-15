import { BadRequestException } from '@nestjs/common';
import type { ArgumentMetadata } from '@nestjs/common';
import { ZodValidationPipe } from './zod-validation.pipe';
import {
  CANDLE_LIMIT_MAX,
  backfillJobsQuerySchema,
  candlesQuerySchema,
  manualBackfillBodySchema,
  metricsSeriesQuerySchema,
} from '../api/dto/query.schemas';

const QUERY_META: ArgumentMetadata = { type: 'query' };
const BODY_META: ArgumentMetadata = { type: 'body' };

describe('ZodValidationPipe — /candles 쿼리', () => {
  const pipe = new ZodValidationPipe(candlesQuerySchema);

  test('interval/limit 을 생략하면 기본값(1m, 500)이 채워진다', () => {
    const result = pipe.transform({ symbol: 'BTCUSDT' }, QUERY_META);

    expect(result).toEqual({ symbol: 'BTCUSDT', interval: '1m', limit: 500 });
  });

  test('limit 문자열을 number 로 변환한다', () => {
    const result = pipe.transform({ symbol: 'ETHUSDT', interval: '1h', limit: '120' }, QUERY_META);

    expect(result.limit).toBe(120);
  });

  test('지원하지 않는 symbol 은 400 으로 거절한다', () => {
    expect(() => pipe.transform({ symbol: 'DOGEUSDT' }, QUERY_META)).toThrow(BadRequestException);
  });

  test('지원하지 않는 interval 은 400 으로 거절한다', () => {
    expect(() => pipe.transform({ symbol: 'BTCUSDT', interval: '3m' }, QUERY_META)).toThrow(
      BadRequestException,
    );
  });

  test('limit 상한을 넘으면 400 으로 거절하고 어떤 필드인지 알려준다', () => {
    expect.assertions(2);
    try {
      pipe.transform({ symbol: 'BTCUSDT', limit: String(CANDLE_LIMIT_MAX + 1) }, QUERY_META);
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).message).toContain('limit');
    }
  });

  test('limit 0 이나 음수는 400 으로 거절한다', () => {
    expect(() => pipe.transform({ symbol: 'BTCUSDT', limit: '0' }, QUERY_META)).toThrow(
      BadRequestException,
    );
    expect(() => pipe.transform({ symbol: 'BTCUSDT', limit: '-5' }, QUERY_META)).toThrow(
      BadRequestException,
    );
  });

  test('symbol 이 없으면 400 으로 거절한다', () => {
    expect(() => pipe.transform({}, QUERY_META)).toThrow(BadRequestException);
  });
});

describe('ZodValidationPipe — /ops 목록 limit 상한', () => {
  const pipe = new ZodValidationPipe(backfillJobsQuerySchema);

  test('limit 생략 시 기본값이 적용된다', () => {
    expect(pipe.transform({}, QUERY_META)).toEqual({ limit: 50 });
  });

  test('무제한 조회를 막기 위해 상한을 초과하면 거절한다', () => {
    expect(() => pipe.transform({ limit: '100000' }, QUERY_META)).toThrow(BadRequestException);
  });
});

describe('ZodValidationPipe — /metrics/series 쿼리', () => {
  const pipe = new ZodValidationPipe(metricsSeriesQuerySchema);

  test('window 를 생략하면 1h 가 기본값이다', () => {
    const result = pipe.transform({ symbol: 'BTCUSDT', metric: 'vwap' }, QUERY_META);

    expect(result).toEqual({ symbol: 'BTCUSDT', metric: 'vwap', window: '1h' });
  });

  test('식별자 문법에 맞지 않는 metric 은 거절한다', () => {
    expect(() => pipe.transform({ symbol: 'BTCUSDT', metric: 'drop table' }, QUERY_META)).toThrow(
      BadRequestException,
    );
  });

  test('형식이 어긋난 window 는 거절한다', () => {
    expect(() =>
      pipe.transform({ symbol: 'BTCUSDT', metric: 'vwap', window: 'forever' }, QUERY_META),
    ).toThrow(BadRequestException);
  });
});

describe('ZodValidationPipe — POST /ops/backfill 본문', () => {
  const pipe = new ZodValidationPipe(manualBackfillBodySchema);

  test('ISO 문자열을 Date 로 변환한다', () => {
    const result = pipe.transform(
      {
        symbol: 'BTCUSDT',
        interval: '1m',
        from: '2026-08-14T00:00:00.000Z',
        to: '2026-08-14T06:00:00.000Z',
      },
      BODY_META,
    );

    expect(result.from).toBeInstanceOf(Date);
    expect(result.to.toISOString()).toBe('2026-08-14T06:00:00.000Z');
  });

  test('from 이 to 보다 뒤면 거절한다', () => {
    expect(() =>
      pipe.transform(
        {
          symbol: 'BTCUSDT',
          interval: '1m',
          from: '2026-08-14T06:00:00.000Z',
          to: '2026-08-14T00:00:00.000Z',
        },
        BODY_META,
      ),
    ).toThrow(BadRequestException);
  });

  test('구간이 31일을 초과하면 거절한다', () => {
    expect(() =>
      pipe.transform(
        {
          symbol: 'BTCUSDT',
          interval: '1m',
          from: '2025-01-01T00:00:00.000Z',
          to: '2025-06-01T00:00:00.000Z',
        },
        BODY_META,
      ),
    ).toThrow(BadRequestException);
  });

  test('파싱할 수 없는 시각은 거절한다', () => {
    expect(() =>
      pipe.transform(
        { symbol: 'BTCUSDT', interval: '1m', from: 'yesterday', to: 'today' },
        BODY_META,
      ),
    ).toThrow(BadRequestException);
  });

  test('미래 구간은 거절한다', () => {
    const future = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    expect(() =>
      pipe.transform(
        { symbol: 'BTCUSDT', interval: '1m', from: new Date().toISOString(), to: future },
        BODY_META,
      ),
    ).toThrow(BadRequestException);
  });
});
