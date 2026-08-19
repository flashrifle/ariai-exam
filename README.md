# Binance 실시간 거래 데이터 수집 및 운영 대시보드

BTCUSDT · ETHUSDT의 실시간 시세를 Binance에서 수집해 PostgreSQL에 적재하고,
수집 파이프라인의 건강 상태와 시장 지표를 한 화면에서 보여주는 운영 콘솔입니다.

이 프로젝트가 특히 신경 쓴 지점은 **"데이터가 온전한가"를 주장이 아니라 증거로 보여주는 것**입니다.
백필이 돌았다는 로그가 아니라, 어느 구간을 왜 채웠고 몇 행을 썼는지가 DB에 남고 대시보드에 표시됩니다.

<img width="900" alt="운영 대시보드" src="docs/screenshot-dashboard.jpg">

---

## 1. 빠른 시작

### 사전 요구사항

| 항목 | 버전 | 비고 |
|---|---|---|
| Node.js | 22 이상 (권장 24) | 내장 `fetch` 사용 |
| Docker | 최신 | PostgreSQL 17 구동용 |
| npm | 10 이상 | |

Binance **공개 마켓 데이터**만 사용하므로 **API 키가 필요 없습니다.**

### 실행 (5단계)

```bash
# 1) 환경변수 준비 + 의존성 설치
make setup

# 2) PostgreSQL 기동 (healthcheck 통과까지 대기)
make db-up

# 3) 스키마 마이그레이션
make db-migrate

# 4) 백엔드 실행 — 수집기 + API가 함께 뜹니다
make dev-backend

# 5) 새 터미널에서 프론트엔드 실행
make dev-frontend
```

| 주소 | 설명 |
|---|---|
| http://localhost:3000 | 운영 대시보드 |
| http://localhost:4000/api/v1 | REST API |
| http://localhost:4000/api/docs | Swagger 문서 |

`make help`로 전체 명령을 볼 수 있습니다.

### 도커로 전체 스택 한 번에

```bash
make up      # postgres + backend + frontend 빌드 후 기동
make down    # 전체 중지
```

### ⚠️ 포트 충돌 시

기본 포트가 이미 쓰이고 있다면 아래로 바꿔 실행하세요.

```bash
# DB 포트 변경 (기본 5434)
POSTGRES_HOST_PORT=5435 docker compose -f infra/docker-compose.yml up -d
#   → backend/.env 의 DATABASE_URL 포트도 같이 바꿔야 합니다

# 프론트 포트 변경
cd frontend && npx next dev -p 3100
#   → backend/.env 의 CORS_ORIGIN 에 http://localhost:3100 을 추가해야 합니다 (쉼표 구분)
```

> DB 호스트 포트를 **5434**로 잡아 둔 이유는 로컬에 다른 PostgreSQL이 5432를 쓰는 경우가 흔하기 때문입니다.
> 컨테이너 내부 포트는 5432 그대로이므로 도커 내부 통신에는 영향이 없습니다.

---

## 2. 개발 환경

### 기술 스택

| 영역 | 선택 | 이유 |
|---|---|---|
| 백엔드 | **NestJS 11** | 모듈 경계와 DI가 명확해 수집기·백필·지표·API를 독립적으로 나누기 좋음 |
| DB | **PostgreSQL 17** (확장 없음) | 순수 Postgres만으로 구현. 어디서든 재현 가능 |
| ORM | **Drizzle 0.45** | 타입 안전 + 복잡한 시계열 집계는 raw SQL로 탈출 가능 |
| 프론트 | **Next.js 16 / React 19** | App Router, SSE 연동 |
| 서버 상태 | **TanStack Query 5** | 캐시·재검증. SSE 수신값을 쿼리 캐시에 직접 기록 |
| 클라 상태 | **Zustand 5** | 심볼·인터벌 등 **UI 상태 전용** (서버 데이터 복제 금지) |
| 검증 | **Zod 4** | 환경변수·Binance 응답·API 입출력 전 구간 |
| 차트 | **lightweight-charts 5** | 캔들/거래량. 동적 import |
| 스타일 | **Tailwind 4** | CSS-first 토큰 |

**TypeScript는 5.9.3으로 고정**했습니다. 최신은 7.0.2지만 NestJS 11의 `emitDecoratorMetadata` 호환이
검증되지 않아 과제에서 리스크를 지지 않았습니다.

### 디렉토리 구조

```
.
├── backend/                    NestJS — 수집 파이프라인 + 운영 API
│   ├── src/
│   │   ├── binance/            REST 클라이언트 · WS 클라이언트 · weight 레이트리미터
│   │   ├── ingest/             실시간 수집(파싱 → 이벤트 → 배치 적재)
│   │   ├── backfill/           갭 탐지 · 백필 실행 엔진 · 작업 큐
│   │   ├── metrics/            지표 집계 · 스냅샷 캐시
│   │   ├── api/                REST 컨트롤러 (candles / metrics / ops) · 캔들 파생 집계
│   │   ├── realtime/           SSE 스트림
│   │   ├── db/                 스키마 · 마이그레이션 · 리포지토리
│   │   ├── common/             응답 봉투 · 예외 필터 · zod 파이프 · 포트 인터페이스
│   │   └── config/             환경변수 스키마
│   └── drizzle/                생성된 마이그레이션 SQL
├── frontend/                   Next.js — 운영 대시보드
│   └── src/{app,components,hooks,lib,store,types}
├── infra/                      docker-compose (DB 단독 / 전체 스택)
├── docs/
│   ├── METRICS.md              📌 지표 선정 근거 (과제 제출물)
│   └── CONTRACT.md             모듈 간 계약
└── Makefile
```

### 개발 명령

```bash
cd backend
npm run start:dev      # watch 모드
npm test               # 235개 테스트
npm run test:cov       # 커버리지
npm run typecheck
npm run db:generate    # 스키마 변경 후 마이그레이션 생성

cd frontend
npm run dev
npm run typecheck
```

---

## 3. 환경변수

`.env.example`을 `backend/.env`로 복사해 사용합니다 (`make setup`이 자동 수행).

### 백엔드 (`backend/.env`)

| 변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` | `4000` | API 포트 |
| `CORS_ORIGIN` | `http://localhost:3000` | 쉼표로 여러 오리진 지정 가능 |
| `DATABASE_URL` | `postgresql://ariai:ariai_local_pw@localhost:5434/ariai` | |
| `DB_POOL_MAX` | `10` | 커넥션 풀 상한 |
| `BINANCE_REST_BASE_URL` | `https://api.binance.com` | |
| `BINANCE_WS_BASE_URL` | `wss://stream.binance.com:9443` | |
| `SYMBOLS` | `BTCUSDT,ETHUSDT` | 수집 대상 |
| `BOOTSTRAP_BACKFILL_DAYS` | `3` | **최초 실행 시** 채울 과거 일수 |
| `GAP_SCAN_INTERVAL_SEC` | `60` | 갭 스캔 주기 |
| `GAP_SCAN_LOOKBACK_HOURS` | `24` | 갭 스캔이 훑는 과거 구간 |
| `REST_WEIGHT_BUDGET_PER_MIN` | `2400` | Binance IP 한도(6000) 중 사용할 예산 |
| `TRADE_FLUSH_INTERVAL_MS` | `1000` | 체결 배치 flush 주기 |
| `TRADE_FLUSH_MAX_ROWS` | `500` | 배치 최대 크기 |
| `METRICS_REFRESH_MS` | `2000` | 지표 스냅샷 재계산 주기 |
| `METRICS_WINDOW_MINUTES` | `60` | VWAP 등 롤링 윈도우 |
| `TRADE_RETENTION_DAYS` | `7` | 체결 원본 보존 기간 |

부팅 시 zod로 검증하며, 값이 잘못되면 **서버가 뜨지 않고 어떤 변수가 왜 틀렸는지 출력**합니다.
설정 오류로 서버가 반쯤 살아 있는 상태를 만들지 않기 위해서입니다.

### 프론트엔드 (`frontend/.env.local`)

| 변수 | 기본값 | 설명 |
|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:4000/api/v1` | |
| `NEXT_PUBLIC_USE_MOCK` | `false` | `true`면 백엔드 없이 목 데이터로 화면만 확인 |

---

## 4. 주요 기능 및 구현 내용

### Part 1. 데이터 수집 파이프라인

#### 4.1 실시간 수집

Binance combined stream **연결 1개**로 4개 스트림을 구독합니다
(`btcusdt@kline_1m`, `btcusdt@trade`, `ethusdt@kline_1m`, `ethusdt@trade`).

방어한 실패 모드:

| 실패 모드 | 대응 |
|---|---|
| Binance가 **24시간마다 연결 강제 종료** | 정상 상황으로 간주하고 즉시 재연결 |
| 좀비 연결 (TCP는 살아있는데 데이터 없음) | ping/pong 하트비트 + 무응답 타임아웃으로 강제 절단 |
| 재연결 폭주 | 지수 백오프 + 지터, 대기 상한 |
| 체결 초당 수십~수백 건 | 건별 INSERT 금지 → 버퍼에 모아 배치 적재 (주기/최대행수 중 먼저 도달) |
| **정상 종료 시 버퍼 유실** | `OnModuleDestroy`에서 반드시 flush (2회 시도 후에도 남으면 유실량을 에러 로그) |
| 중복 수신 | idempotent upsert로 흡수 |

미확정 봉(`k.x === false`)도 upsert해 차트가 실시간으로 움직이되, 확정 시에만 `KLINE_CLOSED`를 발행합니다.

#### 4.2 백필 — 최초 실행과 다운타임 복구를 하나의 엔진으로

과제가 "두 방법을 별개 기능으로 구현할 필요는 없다"고 명시한 만큼,
**같은 실행 경로에 `reason`만 다르게** 흐르도록 설계했습니다.

| reason | 트리거 | 동작 |
|---|---|---|
| `bootstrap` | 기동 시 **과거가 비어 있음** | `BOOTSTRAP_BACKFILL_DAYS`만큼 과거 적재 |
| `gap_recovery` | 기동 직후 + 60초 주기 + **WS 재연결** | 마지막 저장 지점 이후 = 다운타임 갭. 상시 누락도 함께 탐지 |
| `manual` | `POST /ops/backfill` | 운영자가 지정한 구간 |

재시작 시 별도 분기가 필요 없는 이유는, **"마지막 저장 지점 ~ 현재"가 곧 다운타임 갭**이기 때문입니다.
갭 스캔이 상시 도는 덕분에 서버가 살아 있는 중에 생긴 누락(일시적 WS 끊김 등)도 같은 경로로 복구됩니다.

**기동 판단은 "가장 오래된 봉"을 기준으로 합니다** — 마지막 봉이 아닙니다.
수집기는 기동 즉시 WS를 붙여 미확정 봉도 저장하므로, 마지막 봉만 보면
"방금 WS가 넣은 현재 봉"과 "과거 N일치 적재 완료"를 구분할 수 없습니다.
그러면 빈 DB인데도 '이미 최신'으로 오판해 최초 백필을 건너뜁니다.
`earliest_open_time`이 목표 시작점보다 늦으면 그 앞이 비어 있다고 보고 `bootstrap`을 실행합니다.
(이미 존재하는 봉은 갭 탐지가 걸러내므로 구간을 넓게 잡아도 중복 요청은 발생하지 않습니다.)

**WS 재연결 시에는 끊김 구간을 갭 탐지 없이 강제로 다시 받습니다.**
미확정 봉이 저장된 직후 연결이 끊기면 그 봉은 "부분 스냅샷 상태로 존재"하게 되고,
Binance kline 스트림은 재연결 후 진행 중인 봉만 보내므로 최종본이 오지 않습니다.
갭 탐지는 `open_time` 존재 여부만 보기 때문에 이 봉을 찾지 못합니다 —
그래서 끊김/복구 시각을 이벤트로 받아 그 구간을 REST 원본으로 덮어씁니다.
upsert의 단조 증가 가드 덕분에 이미 완전한 행을 다시 써도 안전합니다.

**갭 탐지 알고리즘** — 1분봉 `open_time`은 정확히 60초 간격의 이산 시퀀스라는 성질을 이용합니다.

1. 대상 구간의 기대 `open_time` 시퀀스 생성
2. DB에 실제 존재하는 `open_time`과 차집합
3. **연속된 누락을 하나의 구간으로 병합** (1440개 낱개 job이 아니라 구간 job)
4. 아직 완결되지 않은 **현재 진행 중인 봉은 갭에서 제외**

**REST 페이지네이션** — `/api/v3/klines`는 한 번에 최대 1000개입니다.
커서는 반드시 **응답의 마지막 openTime + interval**로 전진시킵니다
(요청 endTime을 다음 startTime으로 쓰면 중복·무한루프). 응답이 비었거나 커서가 정체하면 즉시 종료하고,
최대 반복 횟수 상한도 둡니다.

**레이트리밋** — Binance IP 한도는 분당 weight 6000이고, 초과가 반복되면 **IP 밴(418)** 입니다.
로컬 추정만 믿지 않고 응답 헤더 `X-MBX-USED-WEIGHT-1M`으로 내부 카운터를 보정하며,
429 수신 시 `Retry-After`를 존중해 전체 요청을 정지시킵니다.

#### 4.3 데이터 무결성

- **가격·수량은 문자열 그대로** DB `numeric`에 저장합니다. `parseFloat`을 거치지 않아 정밀도가 보존됩니다.
- 집계는 **SQL의 numeric 연산**으로 수행하고, JS `number` 변환은 API 경계에서만 일어납니다.
- 확정 봉 보호를 DB 제약으로 걸었습니다:
  ```sql
  ON CONFLICT (symbol, interval, open_time) DO UPDATE SET ...
  WHERE excluded.trade_count >= klines.trade_count AND excluded.volume >= klines.volume
  ```
  봉이 채워지는 동안 `trade_count`/`volume`은 단조 증가하므로, REST가 진행 중인 미완성 봉을 돌려줘도
  이미 저장된 완성 봉을 덮어쓸 수 없습니다. 애플리케이션 로직이 아니라 **제약으로 막았습니다.**
- 한 INSERT에 같은 충돌 키가 두 번 들어가면 Postgres가 문장 전체를 실패시키므로(백필 페이지 경계에서 실제 발생),
  쿼리 생성 전에 배치 내부 중복을 제거합니다.
- 바인드 파라미터 65535 한계를 **컬럼 수 기준으로 계산**해 청크를 나눕니다.

### Part 2. 운영 대시보드

실시간 갱신은 **SSE**(`GET /api/v1/stream`)로 합니다. 대시보드는 단방향 수신만 하므로 WebSocket이 불필요합니다.

| 이벤트 | 내용 | 비고 |
|---|---|---|
| `tick` | 체결 기반 가격 갱신 | 심볼별 250ms 샘플링 (초당 수백 건을 그대로 밀면 브라우저가 죽음) |
| `candle` | 1분봉 갱신/확정 | |
| `metrics` | 지표 스냅샷 | |
| `ops` | 수집 상태·백필 진행 | |
| `ping` | 15초 하트비트 | 프록시 유휴 타임아웃 방지 |

연결 즉시 현재 스냅샷을 1회 보내 초기 화면이 비지 않게 하고, 클라이언트 종료 시 리스너를 해제합니다.
프론트는 SSE가 살아 있으면 폴링을 끄고, 끊기면 5초 폴링으로 전환하며, 재연결 순간 1회 refetch로 끊긴 구간을 메웁니다.

**표시 지표**는 두 축입니다. 선정 근거는 **[docs/METRICS.md](docs/METRICS.md)** 에 지표별로 정리했습니다.

- **시장 지표** — 현재가, 24h 변화율, 24h 거래대금, VWAP, VWAP 이격도, 실현변동성(연율화),
  체결강도(taker buy ratio), 1분 체결 건수, 거래량 급증 배율
- **운영 지표** — 스트림별 수집 지연(lag), 24시간 1분봉 커버리지와 **누락 구간 위치**,
  백필 job 성공/실패 이력, WS 연결 이벤트 로그

데이터 파이프라인 과제에서 "데이터가 온전한가"는 시세만큼 중요한 정보라고 보고,
운영 지표를 부가 정보가 아니라 **1급 시민으로 배치**했습니다.

---

## 5. API

Base: `http://localhost:4000/api/v1` · 문서: `/api/docs`

모든 응답은 동일한 봉투를 씁니다.

```json
{ "success": true, "data": { }, "error": null }
```

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/candles?symbol&interval&limit` | 캔들. `1m` 원본 + `5m`/`15m`/`1h` SQL 파생 집계 |
| GET | `/metrics/overview?symbol` | 지표 스냅샷 |
| GET | `/metrics/series?symbol&metric&window` | 지표 시계열 |
| GET | `/ops/health` | **수집 건강도** — 스트림별 lag, 커버리지, 누락 구간, 백필 요약 |
| GET | `/ops/backfill-jobs?limit` | 백필 이력 |
| GET | `/ops/events?limit` | 수집기 이벤트 로그 |
| POST | `/ops/backfill` | 수동 백필 `{symbol, interval, from, to}` |
| GET | `/stream` | SSE |

5xx 응답에는 스택트레이스나 DB 에러 원문이 실리지 않습니다(서버 로그에만 상세 기록).

---

## 6. 데이터 모델

| 테이블 | 역할 |
|---|---|
| `klines` | 1분봉. PK `(symbol, interval, open_time)`. `source`로 `ws`/`rest` 구분 |
| `trades` | 개별 체결. PK `(symbol, trade_id)` — 거래소 전역 시퀀스라 중복이 자연 제거됨 |
| `ingest_state` | 스트림별 수집 진행 지점. 재시작 시 갭 판단 기준 |
| `backfill_jobs` | 백필 이력. **복구가 실제로 돌았다는 증거** |
| `collector_events` | 연결/끊김/갭탐지/레이트리밋 로그 |

`5m`/`15m`/`1h`는 저장하지 않고 1분봉에서 SQL로 파생합니다.
버킷 내 `open`/`close`는 min/max가 아니라 **시간 순서 기준 첫/마지막**으로 계산합니다.

---

## 7. 테스트

```bash
cd backend && npm test
```

235개 통과. DB·네트워크 없이 도는 순수 로직 테스트에 집중했습니다.

특히 검증한 것:
- 갭 탐지: 갭 없음 / 중간 / 여러 곳 / 맨 앞·뒤 / 전 구간 누락, 구간 병합, 진행 중 봉 제외
- 페이지네이션 커서: 마지막 페이지, 빈 응답, **커서 정체(무한루프 방지)**
- 레이트리미터: 예산 소진·회복, 429/418 처리
- 지표 계산: VWAP, 로그수익률→표준편차→연율화, 분모 0 방어
- 배치 청크: 파라미터 65535 경계값

### 실제 동작 검증 기록

구현 후 실환경에서 확인한 내용입니다.

| 항목 | 방법 | 결과 |
|---|---|---|
| 최초 백필 | 빈 DB로 기동 | 심볼당 4,320행 (3일 × 1440분) |
| 다운타임 복구 | 서버 종료 후 재시작 | "이미 최신" 판단 → 갭만 복구 |
| 갭 탐지 정확도 | 과거 30분치 강제 DELETE 후 재시작 | 해당 구간 **하나의 job으로 병합**해 30행 정확히 복구 |
| 인터벌 집계 | 1h 캔들 조회 | 09시 종가와 10시 시가가 연속 → first/last 계산 정확 |
| 실시간 수집 | 대시보드 | 스트림 4/4 연결, lag 0.3~1.9초, 커버리지 100% |

---

## 8. 알려진 제약

정직하게 남깁니다.

- **CSP 미적용** — Next.js App Router가 인라인 부트스트랩 스크립트를 사용해 정적 헤더로는
  `'unsafe-inline'`이 필요해집니다. nonce 발급 프록시가 정답이나 검증 시간이 부족해 넣지 않았습니다.
  나머지 보안 헤더(`nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`)는 적용했습니다.
- **체결(trade) 데이터는 다운타임 복구 대상이 아닙니다.** 1분봉은 재연결 시 REST로 복구되지만,
  WS가 끊긴 동안의 개별 체결은 그 구간이 비어 있게 됩니다.
  의도적인 범위 결정입니다 — 지표와 차트는 전부 `klines`에서 계산되고 `trades`는 7일 보존의 보조 원본이며,
  `/api/v3/aggTrades`는 조회 구간이 1시간으로 제한되어 klines와는 다른 페이지네이터가 필요합니다.
  체결 이력의 완전성이 요구된다면 그 페이지네이터를 별도로 구현해야 합니다.
- **프론트엔드 테스트 없음** — 우선순위를 둔다면 SSE 클라이언트(백오프·배치·정지 가드)와 포맷 유틸입니다.
- **`/candles`에 구간 파라미터 없음** — `limit`만 지원해 과거 특정 구간 조회가 불가합니다.
- **`TickEvent`에 tradeId 없음** — 재연결 후 틱 중복/누락을 클라이언트가 판별할 수 없습니다.
- **인증 없음** — 내부 운영 도구를 전제했습니다. 외부 노출 시 인증과 rate limit이 필요합니다.
