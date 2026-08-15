import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { failEnvelope } from './api-response';
import { describeError } from './error.util';

/** 클라이언트에게 보여줄 5xx 기본 문구. 내부 원인은 절대 싣지 않는다. */
const GENERIC_SERVER_ERROR = '서버 내부 오류가 발생했습니다';

/**
 * 전역 예외 필터.
 *
 * 원칙:
 *  - 응답은 항상 `{ success:false, data:null, error }` 봉투를 유지한다.
 *  - 4xx 는 우리가 만든 메시지이므로 그대로 노출한다.
 *  - 5xx 는 스택트레이스·DB 에러 원문이 새어 나가지 않도록 일반 문구로 치환한다.
 *  - 상세 원인은 서버 로그에만 남긴다.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const status = this.resolveStatus(exception);
    const clientMessage = this.resolveClientMessage(exception, status);

    if (host.getType() !== 'http') {
      this.logger.error(`비-HTTP 컨텍스트 예외 (${status})`, describeError(exception));
      return;
    }

    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    this.logger.error(
      `[${request.method} ${request.originalUrl ?? request.url}] ${status} — ${clientMessage}`,
      describeError(exception),
    );

    // SSE 등 이미 스트리밍이 시작된 응답은 헤더/본문을 덮어쓸 수 없다.
    if (response.headersSent) {
      response.end();
      return;
    }

    response.status(status).json(failEnvelope(clientMessage));
  }

  private resolveStatus(exception: unknown): number {
    return exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private resolveClientMessage(exception: unknown, status: number): string {
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      return GENERIC_SERVER_ERROR;
    }
    if (exception instanceof HttpException) {
      return this.extractHttpMessage(exception);
    }
    return GENERIC_SERVER_ERROR;
  }

  /** HttpException 응답 본문에서 사람이 읽을 메시지만 뽑아낸다. */
  private extractHttpMessage(exception: HttpException): string {
    const payload: unknown = exception.getResponse();
    if (typeof payload === 'string') {
      return payload;
    }
    if (payload !== null && typeof payload === 'object' && 'message' in payload) {
      const message: unknown = (payload as { message: unknown }).message;
      if (typeof message === 'string') {
        return message;
      }
      if (Array.isArray(message)) {
        return message.map((item) => String(item)).join('; ');
      }
    }
    return exception.message;
  }
}
