/**
 * /api/v3/klines 페이지네이션 커서 로직 (네트워크 비의존 — fetchPage 를 주입받는다).
 * 행 타입에 제네릭이라 Binance 응답 형태 변화에 결합되지 않는다.
 *
 * 규칙:
 * - 커서는 "응답 마지막 openTime + stepMs" 로 전진한다.
 *   (요청한 endTime 을 다음 startTime 으로 쓰면 중복/무한루프가 난다.)
 * - 빈 응답이거나 커서가 전진하지 않으면 즉시 종료한다.
 * - maxPages 상한으로 무한루프를 이중 방어한다.
 * - Binance 의 endTime 은 openTime 기준 "포함" 필터이므로 endMs - 1 을 전달해
 *   반개구간 [startMs, endMs) 의 의미를 유지한다.
 */
import { MAX_PAGES_HARD_CAP, MAX_PAGES_SAFETY_MARGIN } from './backfill.constants';

export type PaginateStopReason =
  | 'completed'
  | 'empty_page'
  | 'cursor_stalled'
  | 'max_pages_exceeded';

export interface PaginateKlinesOptions<T> {
  /** 포함 하한 (epoch ms). */
  readonly startMs: number;
  /** 미포함 상한 (epoch ms). */
  readonly endMs: number;
  readonly stepMs: number;
  readonly pageLimit: number;
  readonly maxPages: number;
  /** 실제 REST 호출 (BinanceRestClient 위임). */
  readonly fetchPage: (
    startTimeMs: number,
    endTimeMs: number,
    limit: number,
  ) => Promise<readonly T[]>;
  /** 페이지 단위 소비 (upsert 등). 전체 구간을 메모리에 들지 않기 위한 콜백. */
  readonly onPage: (rows: readonly T[]) => Promise<void>;
  /** 행에서 openTime(epoch ms)을 읽는다. 읽을 수 없으면 null → 커서 정체로 종료. */
  readonly getOpenTimeMs: (row: T) => number | null;
}

export interface PaginateKlinesResult {
  readonly pages: number;
  readonly rows: number;
  readonly stopReason: PaginateStopReason;
  readonly nextCursorMs: number;
}

/** 구간 크기로부터 페이지 수 상한을 계산한다 (여유분 포함, 하드캡 적용). */
export function computeMaxPages(
  startMs: number,
  endMs: number,
  stepMs: number,
  pageLimit: number,
): number {
  const candles = Math.max(0, Math.ceil((endMs - startMs) / stepMs));
  const pages = Math.ceil(candles / pageLimit) + MAX_PAGES_SAFETY_MARGIN;
  return Math.min(pages, MAX_PAGES_HARD_CAP);
}

/** 커서를 전진시키며 [startMs, endMs) 구간을 페이지 단위로 소비한다. */
export async function paginateKlines<T>(
  opts: PaginateKlinesOptions<T>,
): Promise<PaginateKlinesResult> {
  let cursorMs = opts.startMs;
  let pages = 0;
  let rows = 0;

  while (cursorMs < opts.endMs) {
    if (pages >= opts.maxPages) {
      return { pages, rows, stopReason: 'max_pages_exceeded', nextCursorMs: cursorMs };
    }
    const batch = await opts.fetchPage(cursorMs, opts.endMs - 1, opts.pageLimit);
    pages += 1;

    if (batch.length === 0) {
      // 서버에 데이터가 없는 구간 — 즉시 종료 (무한루프 방지 1차 가드).
      return { pages, rows, stopReason: 'empty_page', nextCursorMs: cursorMs };
    }

    // 구간 밖 행은 방어적으로 걸러낸다.
    const inRange = batch.filter((row) => {
      const openTime = opts.getOpenTimeMs(row);
      return openTime !== null && openTime >= cursorMs && openTime < opts.endMs;
    });
    if (inRange.length > 0) {
      await opts.onPage(inRange);
      rows += inRange.length;
    }

    const lastOpenTime = opts.getOpenTimeMs(batch[batch.length - 1]);
    const nextCursorMs = lastOpenTime === null ? null : lastOpenTime + opts.stepMs;
    if (nextCursorMs === null || nextCursorMs <= cursorMs) {
      // 커서 정체 — 즉시 종료 (무한루프 방지 2차 가드).
      return { pages, rows, stopReason: 'cursor_stalled', nextCursorMs: cursorMs };
    }
    cursorMs = nextCursorMs;
  }

  return { pages, rows, stopReason: 'completed', nextCursorMs: cursorMs };
}
