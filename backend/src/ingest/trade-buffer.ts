/**
 * 체결(trade) 배치 삽입용 메모리 버퍼.
 *
 * 초당 수십~수백 건이 들어오므로 건별 INSERT는 금지 — 여기 모았다가
 * flush 주기 또는 최대 크기 도달 시 배치 삽입한다.
 * flush 실패 시 restore()로 되돌려 재시도하되, 하드캡을 넘는 초과분은
 * 오래된 것부터 버리고 유실 개수를 보고한다 (조용히 버리지 않는다).
 */
import type { TradeInsert } from '../db/schema';

export interface TradeBufferOptions {
  /** 이 개수에 도달하면 add()가 true를 반환해 즉시 flush를 유도한다. */
  maxRows: number;
  /** DB 장애 장기화 시 메모리 폭주를 막는 절대 상한. 기본 maxRows × 100. */
  hardCap?: number;
}

export interface RestoreResult {
  /** 복원 후 버퍼에 남은 총 행 수. */
  buffered: number;
  /** 하드캡 초과로 유실된 행 수 (0이 아니면 반드시 에러 로그 대상). */
  dropped: number;
}

const DEFAULT_HARD_CAP_MULTIPLIER = 100;

export class TradeBuffer {
  private rows: TradeInsert[] = [];
  private readonly maxRows: number;
  private readonly hardCap: number;

  constructor(options: TradeBufferOptions) {
    if (!Number.isInteger(options.maxRows) || options.maxRows < 1) {
      throw new Error(`잘못된 maxRows: ${options.maxRows}`);
    }
    this.maxRows = options.maxRows;
    this.hardCap = options.hardCap ?? options.maxRows * DEFAULT_HARD_CAP_MULTIPLIER;
    if (this.hardCap < this.maxRows) {
      throw new Error(`hardCap(${this.hardCap})은 maxRows(${this.maxRows}) 이상이어야 합니다`);
    }
  }

  /** 행을 추가하고, flush 임계(maxRows)에 도달했으면 true를 반환한다. */
  add(row: TradeInsert): boolean {
    this.rows.push(row);
    return this.rows.length >= this.maxRows;
  }

  size(): number {
    return this.rows.length;
  }

  /** 버퍼 내용을 비우고 소유권을 호출자에게 넘긴다. */
  drain(): TradeInsert[] {
    const drained = this.rows;
    this.rows = [];
    return drained;
  }

  /**
   * flush 실패 시 되돌린다. 실패한 행이 시간상 더 오래됐으므로 앞에 붙이고,
   * 하드캡 초과분은 오래된 것부터 버린다.
   */
  restore(failedRows: TradeInsert[]): RestoreResult {
    const combined = [...failedRows, ...this.rows];
    const dropped = Math.max(combined.length - this.hardCap, 0);
    this.rows = dropped > 0 ? combined.slice(dropped) : combined;
    return { buffered: this.rows.length, dropped };
  }
}
