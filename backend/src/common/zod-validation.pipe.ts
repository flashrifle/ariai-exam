import { BadRequestException, Injectable } from '@nestjs/common';
import type { ArgumentMetadata, PipeTransform } from '@nestjs/common';
import type { ZodError, ZodType } from 'zod';

/** zod 이슈 목록을 한 줄짜리 사람이 읽는 메시지로 만든다. */
export function formatZodIssues(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.map((segment) => String(segment)).join('.');
      return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
    })
    .join('; ');
}

const SOURCE_LABEL: Record<string, string> = {
  query: '쿼리 파라미터',
  body: '요청 본문',
  param: '경로 파라미터',
};

/**
 * zod 스키마 기반 검증 파이프.
 *
 * 검증에 실패하면 400 으로 즉시 거절하고, **어느 필드가 왜 틀렸는지**를 메시지에 담는다.
 * 성공 시에는 파싱·변환된 값(기본값 적용, 문자열 → number/Date)을 그대로 핸들러에 넘긴다.
 *
 *   findCandles(@Query(new ZodValidationPipe(candlesQuerySchema)) query: CandlesQuery)
 */
@Injectable()
export class ZodValidationPipe<TOutput> implements PipeTransform<unknown, TOutput> {
  constructor(private readonly schema: ZodType<TOutput>) {}

  transform(value: unknown, metadata?: ArgumentMetadata): TOutput {
    const parsed = this.schema.safeParse(value);
    if (parsed.success) {
      return parsed.data;
    }
    const label = SOURCE_LABEL[metadata?.type ?? ''] ?? '요청 값';
    throw new BadRequestException(`${label} 검증 실패 — ${formatZodIssues(parsed.error)}`);
  }
}
