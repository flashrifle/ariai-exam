import { Controller, Sse } from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import { ApiOperation, ApiProduces, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Observable } from 'rxjs';
import { RawResponse } from '../common/decorators/raw-response.decorator';
import { SseStreamService } from './sse-stream.service';

/**
 * 실시간 푸시 엔드포인트. 실제 경로는 `GET /api/v1/stream` (전역 prefix 는 main.ts).
 *
 * 이벤트 이름은 docs/CONTRACT.md 계약을 따른다: `tick` / `candle` / `metrics` / `ops`
 * (+ 연결 유지용 `ping`). 프론트는 `EventSource.addEventListener(name, ...)` 로 구독한다.
 */
@ApiTags('realtime')
@Controller()
export class SseController {
  constructor(private readonly sseStream: SseStreamService) {}

  @Sse('stream')
  @RawResponse()
  @ApiProduces('text/event-stream')
  @ApiOperation({
    summary: '실시간 스트림 (SSE)',
    description: [
      '이벤트 이름별 페이로드:',
      '- `tick`: `{ symbol, price, qty, isBuyerMaker, tradeTime }` — 심볼별 250ms 샘플링',
      '- `candle`: `{ symbol, interval, candle, isClosed }` — 확정봉은 유실 없이 전달',
      '- `metrics`: `{ overview }` — 지표 스냅샷',
      '- `ops`: `{ health }` — /ops/health 와 동일한 구조',
      '- `ping`: `{ ts }` — 15초 하트비트(프록시 유휴 타임아웃 방지)',
      '',
      '연결 직후 현재 `ops`/`metrics` 스냅샷을 1회 즉시 전송한다.',
      '이 엔드포인트만 ApiResponse 봉투를 사용하지 않는다.',
    ].join('\n'),
  })
  @ApiResponse({ status: 200, description: 'text/event-stream 무한 스트림' })
  streamEvents(): Observable<MessageEvent> {
    return this.sseStream.connect();
  }
}
