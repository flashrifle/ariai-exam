import { Observable } from 'rxjs';
import type { MonoTypeOperatorFunction } from 'rxjs';
import { groupBy, mergeMap, throttleTime } from 'rxjs/operators';
import type { EventEmitter2 } from '@nestjs/event-emitter';

/**
 * EventEmitter2 이벤트를 Observable 로 감싼다.
 *
 * **teardown 에서 반드시 리스너를 제거한다.** SSE 연결마다 리스너가 쌓이면
 * MaxListenersExceededWarning → 메모리 누수로 직결된다.
 * (호출부에서 `share()` 로 다중화하므로 이벤트당 리스너는 최대 1개만 유지된다.)
 */
export function fromAppEvent<T>(emitter: EventEmitter2, eventName: string): Observable<T> {
  return new Observable<T>((subscriber) => {
    const handler = (payload: T): void => subscriber.next(payload);
    emitter.on(eventName, handler);
    return () => {
      emitter.off(eventName, handler);
    };
  });
}

/**
 * 심볼별로 독립적인 스로틀을 건다.
 *
 * 전체 스트림에 하나의 스로틀을 걸면 거래가 활발한 심볼이 조용한 심볼의 갱신을 굶긴다.
 * leading 으로 첫 값은 즉시, trailing 으로 창의 마지막(=최신) 값만 내보낸다.
 */
export function throttlePerSymbol<T extends { symbol: string }>(
  durationMs: number,
): MonoTypeOperatorFunction<T> {
  return (source: Observable<T>) =>
    source.pipe(
      groupBy((item) => item.symbol),
      mergeMap((group) =>
        group.pipe(throttleTime(durationMs, undefined, { leading: true, trailing: true })),
      ),
    );
}
