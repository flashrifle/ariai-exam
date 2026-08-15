# 모듈 간 계약 (Contract)

이 문서는 **여러 담당자가 동시에 작업**하기 위한 단일 진실 공급원이다.
자신의 담당 디렉토리 밖의 파일을 수정해야 한다면, 임의로 고치지 말고 계약 위반으로 보고할 것.

## 1. 소유권 경계 (동시 작업 시 충돌 방지)

| 영역 | 소유 디렉토리 | 다른 담당자는 |
|---|---|---|
| DB 기반 | `backend/src/db/**` | schema.ts를 **읽기만** |
| 거래소 연동 · 실시간 수집 | `backend/src/binance/**`, `backend/src/ingest/**` | import만 |
| 백필 · 갭 복구 | `backend/src/backfill/**` | import만 |
| 지표 | `backend/src/metrics/**` | import만 |
| API · 실시간 전송 | `backend/src/api/**`, `backend/src/realtime/**` | import만 |
| 프론트엔드 | `frontend/**` | 손대지 않음 |
| 인프라 | `infra/**`, 루트 설정 | 손대지 않음 |

`backend/src/app.module.ts`는 팀 리더가 관리한다. 모듈을 만들었으면 등록을 요청할 것.

## 2. 수집 대상 (고정)

- 심볼: `BTCUSDT`, `ETHUSDT`
- 캔들 인터벌: `1m` (저장 기준 단위. 그 이상은 SQL 집계로 파생)
- 스트림: `<symbol>@kline_1m`, `<symbol>@trade` (combined stream 1개 연결로 구독)

## 3. Binance 엔드포인트 (2026 기준)

| 용도 | 엔드포인트 |
|---|---|
| REST base | `https://api.binance.com` |
| 캔들 백필 | `GET /api/v3/klines?symbol=&interval=&startTime=&endTime=&limit=1000` |
| 서버 시각 | `GET /api/v3/time` |
| WS base | `wss://stream.binance.com:9443/stream?streams=a/b/c` |

레이트리밋: IP 기준 분당 weight 6000. `/api/v3/klines`는 limit≤100:1, ≤500:2, ≤1000:5.
응답 헤더 `X-MBX-USED-WEIGHT-1M`를 반드시 읽어 백프레셔를 걸 것. HTTP 429 수신 시
`Retry-After` 준수, 418(밴) 발생은 실패로 간주한다.

## 4. 내부 인터페이스

### 4.1 수집 → DB (ingest / backfill 공통)

두 경로 모두 아래 리포지토리를 통해서만 기록한다. 중복 수신은 정상 동작이며,
**idempotent upsert** 로 흡수한다 (`ON CONFLICT ... DO UPDATE`).

```ts
// backend/src/db/repositories/*.repository.ts
interface KlineRepository {
  upsertMany(rows: KlineInsert[]): Promise<number>;
  /** 지정 구간에서 실제 존재하는 open_time 목록 (갭 계산용) */
  findExistingOpenTimes(symbol: string, interval: string, from: Date, to: Date): Promise<Date[]>;
  latestOpenTime(symbol: string, interval: string): Promise<Date | null>;
}

interface TradeRepository {
  insertManyIgnoreConflict(rows: TradeInsert[]): Promise<number>;
  latestTradeTime(symbol: string): Promise<Date | null>;
}
```

### 4.2 이벤트 버스 (모듈 간 결합 최소화)

Nest `EventEmitter2`를 사용한다. 페이로드 타입은 `backend/src/common/events.ts`에 정의.

| 이벤트 | 발행자 | 구독자 |
|---|---|---|
| `kline.closed` | ingest | realtime(SSE), metrics 캐시 |
| `trade.received` | ingest | realtime(SSE) |
| `stream.status` | ingest | realtime(SSE), ops |
| `backfill.progress` | backfill | realtime(SSE), ops |

## 5. HTTP API 계약 (프론트가 의존하는 부분)

Base: `/api/v1`. 모든 응답은 아래 봉투를 사용한다.

```ts
type ApiResponse<T> = { success: boolean; data: T | null; error: string | null };
```

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/candles?symbol&interval&limit` | 캔들 시계열 (interval: 1m/5m/15m/1h, 1m에서 SQL 집계 파생) |
| GET | `/metrics/overview?symbol` | 지표 카드용 스냅샷 |
| GET | `/metrics/series?symbol&metric&window` | 지표 시계열 |
| GET | `/ops/health` | 스트림별 수집 상태 · 지연 · 커버리지 |
| GET | `/ops/backfill-jobs?limit` | 백필 이력 |
| GET | `/ops/events?limit` | 수집기 운영 로그 |
| POST | `/ops/backfill` | 수동 백필 트리거 `{symbol, interval, from, to}` |
| GET | `/stream` | **SSE**. 실시간 푸시 |

응답 타입 정의의 원본은 `frontend/src/types/api.ts` 이다.
백엔드 DTO는 이 타입과 필드명·형태가 정확히 일치해야 한다.

### SSE 이벤트 이름

- `tick` — 체결 기반 실시간 가격 갱신
- `candle` — 1분봉 확정/갱신
- `metrics` — 지표 스냅샷 갱신
- `ops` — 수집 상태/백필 진행 변화

## 6. 숫자 표현 규칙

- DB는 `numeric`, drizzle는 **string**으로 반환한다.
- API 경계에서 `number`로 변환해 프론트로 내보낸다 (표시 목적).
- 합계·비율 등 **집계는 반드시 SQL의 numeric 연산**으로 수행한다. JS 부동소수로 누적하지 말 것.

## 7. 시간 규칙

- 저장·전송 모두 **UTC**. 프론트 표시 단계에서만 로컬 변환.
- Binance는 epoch milliseconds를 준다. DB는 `timestamptz`.
- 1분봉 `openTime`은 항상 분 경계(`ss.mmm = 00.000`)에 정렬된다. 이 불변조건을 검증할 것.
