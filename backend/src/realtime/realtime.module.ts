import { Module } from '@nestjs/common';
import { ApiModule } from '../api/api.module';
import { SseController } from './sse.controller';
import { SseStreamService } from './sse-stream.service';

/**
 * SSE 모듈.
 *
 * 전제 (app.module.ts):
 *  - `EventEmitterModule.forRoot()` 등록 (EventEmitter2 주입)
 *  - `ConfigService` 사용 가능
 *  - `ApiModule` 이 export 하는 `OpsHealthService` 를 통해 `ops` 이벤트 payload 를 만든다
 */
@Module({
  imports: [ApiModule],
  controllers: [SseController],
  providers: [SseStreamService],
})
export class RealtimeModule {}
