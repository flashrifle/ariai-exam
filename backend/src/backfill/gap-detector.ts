/**
 * 갭 탐지기 — 기대 open_time 시퀀스와 DB 실존 집합의 차집합으로 누락 구간을 계산한다.
 * 계산 로직은 gap-math.ts 의 순수 함수로 분리되어 있고, 이 클래스는 DB 조회만 붙인다.
 */
import { Injectable } from '@nestjs/common';
import { BASE_INTERVAL, BASE_INTERVAL_MS } from '../config/configuration';
// 다른 담당자 작성 영역 — docs/CONTRACT.md 4.1절 시그니처를 신뢰하고 import 한다.
import { KlineRepository } from '../db/repositories/kline.repository';
import type { TimeRange } from './backfill.types';
import {
  buildExpectedOpenTimes,
  capEndToClosedCandles,
  ceilToStep,
  findMissingOpenTimes,
  mergeIntoRanges,
} from './gap-math';

@Injectable()
export class GapDetector {
  constructor(private readonly klineRepository: KlineRepository) {}

  /**
   * [from, to) 구간에서 누락된 1분봉 구간 목록을 반환한다.
   * - 연속된 누락은 하나의 구간으로 병합된다.
   * - 아직 닫히지 않은 현재 진행 중인 봉(현재 시각이 속한 분)은 갭이 아니므로 제외한다.
   *
   * @param nowMs 테스트 주입용 현재 시각. 생략 시 Date.now().
   */
  async detectGaps(
    symbol: string,
    interval: string,
    from: Date,
    to: Date,
    nowMs: number = Date.now(),
  ): Promise<TimeRange[]> {
    if (interval !== BASE_INTERVAL) {
      throw new Error(`갭 탐지는 저장 기준 인터벌(${BASE_INTERVAL})만 지원합니다: ${interval}`);
    }
    const fromMs = ceilToStep(from.getTime(), BASE_INTERVAL_MS);
    const toMs = capEndToClosedCandles(to.getTime(), nowMs, BASE_INTERVAL_MS);
    if (fromMs >= toMs) {
      return [];
    }

    const existingDates = await this.klineRepository.findExistingOpenTimes(
      symbol,
      interval,
      new Date(fromMs),
      new Date(toMs),
    );
    // 존재 여부 조회를 O(1)로 만들기 위한 Set — 구간이 커도 O(n) 메모리로 처리된다.
    const existing = new Set(existingDates.map((d) => d.getTime()));
    const expected = buildExpectedOpenTimes(fromMs, toMs, BASE_INTERVAL_MS);
    const missing = findMissingOpenTimes(expected, existing);
    return mergeIntoRanges(missing, BASE_INTERVAL_MS);
  }
}
