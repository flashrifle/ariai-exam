import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EMPTY, Observable, defer, from, interval, merge, timer } from 'rxjs';
import { catchError, exhaustMap, filter, map, mergeMap, share, throttleTime } from 'rxjs/operators';
import { SUPPORTED_SYMBOLS } from '../config/configuration';
import type { SupportedSymbol } from '../config/configuration';
import { AppEvents } from '../common/events';
import type { KlinePayload, TradePayload } from '../common/events';
import { describeError } from '../common/error.util';
import { METRICS_PORT } from '../common/ports';
import type { MetricsPort } from '../common/ports';
import type { MetricsOverview, OpsHealth } from '../api/dto/api-types';
import { OpsHealthService } from '../api/ops/ops-health.service';
import { fromAppEvent, throttlePerSymbol } from './event-source.util';
import {
  HEARTBEAT_INTERVAL_MS,
  KLINE_UPDATE_THROTTLE_MS,
  METRICS_SNAPSHOT_EVENT,
  OPS_PUSH_THROTTLE_MS,
  OPS_REFRESH_INTERVAL_MS,
  TICK_THROTTLE_MS,
} from './realtime.constants';
import {
  extractOverview,
  toCandleMessage,
  toMetricsMessage,
  toOpsMessage,
  toPingMessage,
  toTickMessage,
} from './sse-payload.mapper';

const DEFAULT_METRICS_REFRESH_MS = 2_000;

/**
 * SSE 스트림 조립기.
 *
 * 설계 요점:
 *  - 이벤트별 상위 스트림은 생성자에서 한 번만 만들고 `share()` 로 다중화한다.
 *    → 클라이언트가 몇 명이든 EventEmitter2 리스너는 이벤트당 1개, 구독자가 0이 되면 해제된다.
 *  - tick 은 심볼별 스로틀링으로 최신값만 샘플링한다(초당 수백 건을 그대로 밀면 브라우저가 죽는다).
 *  - 확정봉(kline.closed)은 유실되면 차트가 어긋나므로 스로틀링 대상에서 제외한다.
 *  - 하위 조회 실패는 `catchError → EMPTY` 로 흡수해 연결 전체가 끊기지 않게 한다.
 */
@Injectable()
export class SseStreamService {
  private readonly logger = new Logger(SseStreamService.name);
  private readonly symbols: readonly SupportedSymbol[];
  private readonly metricsRefreshMs: number;

  private readonly tick$: Observable<MessageEvent>;
  private readonly candle$: Observable<MessageEvent>;
  private readonly metrics$: Observable<MessageEvent>;
  private readonly ops$: Observable<MessageEvent>;

  constructor(
    private readonly emitter: EventEmitter2,
    private readonly opsHealth: OpsHealthService,
    private readonly config: ConfigService,
    @Optional() @Inject(METRICS_PORT) private readonly metricsPort: MetricsPort | null = null,
  ) {
    this.symbols = this.config.get<SupportedSymbol[]>('SYMBOLS') ?? [...SUPPORTED_SYMBOLS];
    this.metricsRefreshMs =
      this.config.get<number>('METRICS_REFRESH_MS') ?? DEFAULT_METRICS_REFRESH_MS;

    this.tick$ = this.buildTickStream();
    this.candle$ = this.buildCandleStream();
    this.metrics$ = this.buildMetricsStream();
    this.ops$ = this.buildOpsStream();
  }

  /**
   * 클라이언트 1개 연결이 구독할 스트림.
   * 구독 해제(=연결 종료)는 NestJS 가 요청 종료 시 자동으로 수행하며,
   * 그 시점에 `share()` 의 refCount 가 0이 되면 상위 리스너까지 정리된다.
   */
  connect(): Observable<MessageEvent> {
    return merge(
      this.initialSnapshot$(),
      this.heartbeat$(),
      this.tick$,
      this.candle$,
      this.metrics$,
      this.ops$,
    );
  }

  /* ── 스트림 조립 ────────────────────────────────────────────── */

  private buildTickStream(): Observable<MessageEvent> {
    return fromAppEvent<TradePayload>(this.emitter, AppEvents.TRADE_RECEIVED).pipe(
      throttlePerSymbol<TradePayload>(TICK_THROTTLE_MS),
      map(toTickMessage),
      share(),
    );
  }

  private buildCandleStream(): Observable<MessageEvent> {
    const updated$ = fromAppEvent<KlinePayload>(this.emitter, AppEvents.KLINE_UPDATED).pipe(
      throttlePerSymbol<KlinePayload>(KLINE_UPDATE_THROTTLE_MS),
    );
    // 확정봉은 초당 한두 건이고 유실되면 안 되므로 그대로 통과시킨다.
    const closed$ = fromAppEvent<KlinePayload>(this.emitter, AppEvents.KLINE_CLOSED);

    return merge(updated$, closed$).pipe(map(toCandleMessage), share());
  }

  /**
   * 지표: 이벤트 push 를 우선하고, 없을 때를 대비해 주기 폴링도 함께 돌린다.
   * 심볼별 스로틀로 push/poll 이 겹쳐도 중복 프레임이 나가지 않는다.
   */
  private buildMetricsStream(): Observable<MessageEvent> {
    const pushed$ = fromAppEvent<unknown>(this.emitter, METRICS_SNAPSHOT_EVENT).pipe(
      map(extractOverview),
      filter((overview): overview is MetricsOverview => overview !== null),
    );

    const port = this.metricsPort;
    const polled$: Observable<MetricsOverview> =
      port === null
        ? EMPTY
        : merge(
            ...this.symbols.map((symbol) =>
              interval(this.metricsRefreshMs).pipe(
                exhaustMap(() => this.fetchOverview(port, symbol)),
              ),
            ),
          );

    return merge(pushed$, polled$).pipe(
      throttlePerSymbol<MetricsOverview>(this.metricsRefreshMs),
      map(toMetricsMessage),
      share(),
    );
  }

  /** 운영 상태: 상태 변화 이벤트 + 주기적 재계산(lagSeconds 갱신용). */
  private buildOpsStream(): Observable<MessageEvent> {
    const triggered$ = merge(
      fromAppEvent<unknown>(this.emitter, AppEvents.STREAM_STATUS),
      fromAppEvent<unknown>(this.emitter, AppEvents.BACKFILL_PROGRESS),
    ).pipe(throttleTime(OPS_PUSH_THROTTLE_MS, undefined, { leading: true, trailing: true }));

    const periodic$ = interval(OPS_REFRESH_INTERVAL_MS);

    return merge(triggered$, periodic$).pipe(
      exhaustMap(() => this.fetchHealth()),
      map(toOpsMessage),
      share(),
    );
  }

  /** 접속 직후 화면이 비지 않도록 현재 스냅샷을 1회 즉시 내보낸다. */
  private initialSnapshot$(): Observable<MessageEvent> {
    return defer(() => this.buildInitialEvents()).pipe(mergeMap((events) => from(events)));
  }

  private heartbeat$(): Observable<MessageEvent> {
    // 첫 ping 을 즉시 보내 응답 헤더를 flush 하고, 이후 주기적으로 연결을 살려 둔다.
    return timer(0, HEARTBEAT_INTERVAL_MS).pipe(map(() => toPingMessage(new Date())));
  }

  /* ── 조회 (실패해도 연결을 끊지 않는다) ────────────────────── */

  private fetchHealth(): Observable<OpsHealth> {
    return defer(() => this.opsHealth.getHealth()).pipe(
      catchError((error: unknown) => {
        this.logger.warn(`SSE ops 스냅샷 계산 실패: ${describeError(error)}`);
        return EMPTY;
      }),
    );
  }

  private fetchOverview(port: MetricsPort, symbol: SupportedSymbol): Observable<MetricsOverview> {
    return defer(() => port.getOverview(symbol)).pipe(
      catchError((error: unknown) => {
        this.logger.warn(`SSE metrics(${symbol}) 조회 실패: ${describeError(error)}`);
        return EMPTY;
      }),
    );
  }

  private async buildInitialEvents(): Promise<MessageEvent[]> {
    const tasks: Promise<MessageEvent | null>[] = [
      this.settle(this.opsHealth.getHealth().then(toOpsMessage), 'ops'),
    ];

    const port = this.metricsPort;
    if (port !== null) {
      for (const symbol of this.symbols) {
        tasks.push(this.settle(port.getOverview(symbol).then(toMetricsMessage), `metrics:${symbol}`));
      }
    }

    const settled = await Promise.all(tasks);
    return settled.filter((event): event is MessageEvent => event !== null);
  }

  /** 초기 스냅샷 한 조각이 실패해도 나머지는 그대로 내보낸다. */
  private async settle(task: Promise<MessageEvent>, label: string): Promise<MessageEvent | null> {
    try {
      return await task;
    } catch (error) {
      this.logger.warn(`초기 스냅샷(${label}) 생성 실패: ${describeError(error)}`);
      return null;
    }
  }
}
