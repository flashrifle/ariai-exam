import { SetMetadata } from '@nestjs/common';
import type { CustomDecorator } from '@nestjs/common';

/** 응답 봉투(ApiResponse) 적용을 건너뛰라는 표시. */
export const RAW_RESPONSE_KEY = 'ariai:raw-response';

/**
 * SSE처럼 봉투를 씌우면 안 되는 핸들러에 붙인다.
 * (SSE는 프레임마다 봉투가 씌워지면 프론트 파싱이 깨진다.)
 */
export const RawResponse = (): CustomDecorator<string> => SetMetadata(RAW_RESPONSE_KEY, true);
