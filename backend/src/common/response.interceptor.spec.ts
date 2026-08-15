import { Reflector } from '@nestjs/core';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of, toArray } from 'rxjs';
import { ResponseEnvelopeInterceptor } from './response.interceptor';
import { RAW_RESPONSE_KEY } from './decorators/raw-response.decorator';

function handlerOf(value: unknown): CallHandler<unknown> {
  return { handle: () => of(value) };
}

function contextOf(
  metadata: Record<string, unknown> = {},
  type: 'http' | 'ws' = 'http',
): ExecutionContext {
  const handler = (): void => undefined;
  const controller = class Dummy {};
  for (const [key, value] of Object.entries(metadata)) {
    Reflect.defineMetadata(key, value, handler);
  }
  return {
    getType: () => type,
    getHandler: () => handler,
    getClass: () => controller,
  } as unknown as ExecutionContext;
}

describe('ResponseEnvelopeInterceptor', () => {
  const interceptor = new ResponseEnvelopeInterceptor(new Reflector());

  test('일반 HTTP 응답에 success/data/error 봉투를 씌운다', async () => {
    const result = await firstValueFrom(
      interceptor.intercept(contextOf(), handlerOf([{ close: 1 }])),
    );

    expect(result).toEqual({ success: true, data: [{ close: 1 }], error: null });
  });

  test('undefined 반환은 data:null 로 정규화한다', async () => {
    const result = await firstValueFrom(interceptor.intercept(contextOf(), handlerOf(undefined)));

    expect(result).toEqual({ success: true, data: null, error: null });
  });

  test('@RawResponse() 핸들러는 봉투를 씌우지 않는다', async () => {
    const raw = { type: 'tick', data: { price: 1 } };
    const result = await firstValueFrom(
      interceptor.intercept(contextOf({ [RAW_RESPONSE_KEY]: true }), handlerOf(raw)),
    );

    expect(result).toBe(raw);
  });

  test('@Sse() 핸들러(sse 메타데이터)도 봉투를 씌우지 않는다', async () => {
    const frames = await firstValueFrom(
      interceptor.intercept(contextOf({ sse: true }), { handle: () => of('a', 'b') }).pipe(toArray()),
    );

    expect(frames).toEqual(['a', 'b']);
  });

  test('HTTP 가 아닌 컨텍스트는 그대로 통과시킨다', async () => {
    const result = await firstValueFrom(
      interceptor.intercept(contextOf({}, 'ws'), handlerOf('payload')),
    );

    expect(result).toBe('payload');
  });
});
