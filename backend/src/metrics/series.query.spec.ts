/**
 * 지표 시계열 매핑 테스트 — 계산 불가 포인트가 그래프를 왜곡하지 않는지 검증한다.
 */
import { SERIES_METRICS } from './metrics.constants';
import { buildSeriesQuery, mapSeriesRows, type SeriesRow } from './series.query';

describe('mapSeriesRows', () => {
  it('유효한 포인트만 시간·값 쌍으로 변환한다', () => {
    const rows: SeriesRow[] = [
      { ts: new Date('2026-08-15T12:00:00.000Z'), value: '64800.5' },
      { ts: new Date('2026-08-15T12:01:00.000Z'), value: 64810 },
    ];

    expect(mapSeriesRows(rows)).toEqual([
      { ts: '2026-08-15T12:00:00.000Z', value: 64800.5 },
      { ts: '2026-08-15T12:01:00.000Z', value: 64810 },
    ]);
  });

  it('NULL(계산 불가)·NaN·Infinity 포인트는 0 으로 위장하지 않고 제외한다', () => {
    const rows: SeriesRow[] = [
      { ts: new Date('2026-08-15T12:00:00.000Z'), value: null },
      { ts: new Date('2026-08-15T12:01:00.000Z'), value: 'NaN' },
      { ts: new Date('2026-08-15T12:02:00.000Z'), value: 'Infinity' },
      { ts: new Date('2026-08-15T12:03:00.000Z'), value: '1.5' },
    ];

    const points = mapSeriesRows(rows);

    expect(points).toHaveLength(1);
    expect(points[0]).toEqual({ ts: '2026-08-15T12:03:00.000Z', value: 1.5 });
  });

  it('빈 입력이면 빈 배열을 반환한다', () => {
    expect(mapSeriesRows([])).toEqual([]);
  });
});

describe('buildSeriesQuery', () => {
  it('지원하는 모든 지표의 SQL 조립이 예외 없이 완료된다 (스모크)', () => {
    for (const metric of SERIES_METRICS) {
      expect(buildSeriesQuery('BTCUSDT', metric, 60)).toBeDefined();
    }
  });
});
