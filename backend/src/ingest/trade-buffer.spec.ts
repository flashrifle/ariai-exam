import type { TradeInsert } from '../db/schema';
import { TradeBuffer } from './trade-buffer';

function row(id: number): TradeInsert {
  return {
    symbol: 'BTCUSDT',
    tradeId: BigInt(id),
    price: '100.00000000',
    qty: '1.00000000',
    quoteQty: '100.00000000',
    tradeTime: new Date(id * 1_000),
    isBuyerMaker: false,
  };
}

function ids(rows: TradeInsert[]): bigint[] {
  return rows.map((r) => r.tradeId);
}

describe('TradeBuffer', () => {
  test('maxRows에 도달하기 전에는 add가 false를 반환한다', () => {
    const buffer = new TradeBuffer({ maxRows: 3 });
    expect(buffer.add(row(1))).toBe(false);
    expect(buffer.add(row(2))).toBe(false);
  });

  test('maxRows에 도달하면 add가 true를 반환해 flush를 유도한다', () => {
    const buffer = new TradeBuffer({ maxRows: 3 });
    buffer.add(row(1));
    buffer.add(row(2));
    expect(buffer.add(row(3))).toBe(true);
    // flush가 지연돼 계속 쌓여도 true를 유지한다
    expect(buffer.add(row(4))).toBe(true);
  });

  test('drain은 쌓인 행을 순서대로 넘기고 버퍼를 비운다', () => {
    const buffer = new TradeBuffer({ maxRows: 10 });
    buffer.add(row(1));
    buffer.add(row(2));
    const drained = buffer.drain();
    expect(ids(drained)).toEqual([1n, 2n]);
    expect(buffer.size()).toBe(0);
    expect(buffer.drain()).toEqual([]);
  });

  test('restore는 실패분(더 오래된 행)을 앞에 붙여 순서를 보존한다', () => {
    const buffer = new TradeBuffer({ maxRows: 10 });
    const failed = [row(1), row(2)];
    buffer.add(row(3)); // flush 진행 중 새로 도착한 행
    const result = buffer.restore(failed);
    expect(result.dropped).toBe(0);
    expect(result.buffered).toBe(3);
    expect(ids(buffer.drain())).toEqual([1n, 2n, 3n]);
  });

  test('restore 시 하드캡 초과분은 오래된 것부터 버리고 유실 수를 보고한다', () => {
    const buffer = new TradeBuffer({ maxRows: 2, hardCap: 5 });
    buffer.add(row(4));
    buffer.add(row(5));
    buffer.add(row(6));
    const result = buffer.restore([row(1), row(2), row(3)]);
    expect(result.dropped).toBe(1);
    expect(result.buffered).toBe(5);
    // 가장 오래된 1이 유실되고 2~6이 남는다
    expect(ids(buffer.drain())).toEqual([2n, 3n, 4n, 5n, 6n]);
  });

  test('잘못된 옵션은 생성 시점에 거부한다', () => {
    expect(() => new TradeBuffer({ maxRows: 0 })).toThrow('잘못된 maxRows');
    expect(() => new TradeBuffer({ maxRows: 10, hardCap: 5 })).toThrow('hardCap');
  });
});
