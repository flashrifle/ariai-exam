import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { okEnvelope } from './api-response';
import { RAW_RESPONSE_KEY } from './decorators/raw-response.decorator';

/**
 * NestJS `@Sse()` 가 핸들러 디스크립터에 남기는 메타데이터 키.
 * 내부 상수를 직접 import 하면 버전 업 시 깨지므로 값만 복제해 둔다.
 */
const NEST_SSE_METADATA_KEY = 'sse';

/**
 * 모든 HTTP 응답에 `{ success, data, error }` 봉투를 씌운다.
 *
 * 제외 대상:
 *  - HTTP 가 아닌 실행 컨텍스트
 *  - `@RawResponse()` 가 붙은 핸들러/컨트롤러
 *  - `@Sse()` 핸들러 — 봉투를 씌우면 SSE 프레임마다 봉투가 중첩돼 프론트가 깨진다.
 */
@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor<unknown, unknown> {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler<unknown>): Observable<unknown> {
    if (context.getType() !== 'http' || this.shouldSkipEnvelope(context)) {
      return next.handle();
    }
    return next.handle().pipe(map((data) => okEnvelope(data ?? null)));
  }

  private shouldSkipEnvelope(context: ExecutionContext): boolean {
    const handler = context.getHandler();
    const controller = context.getClass();

    const explicitlyRaw = this.reflector.getAllAndOverride<boolean | undefined>(RAW_RESPONSE_KEY, [
      handler,
      controller,
    ]);
    if (explicitlyRaw === true) {
      return true;
    }

    return this.reflector.get<boolean | undefined>(NEST_SSE_METADATA_KEY, handler) === true;
  }
}
