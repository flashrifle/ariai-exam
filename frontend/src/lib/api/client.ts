/**
 * HTTP 클라이언트.
 *
 * 원칙:
 *  1. 모든 응답은 `ApiResponse<T>` 봉투다. 봉투를 벗기고 `success === false` 면
 *     **반드시 throw** 한다. 조용히 빈 배열/기본값으로 대체하지 않는다.
 *  2. 벗긴 `data` 는 zod 로 런타임 검증한다. 계약 위반은 개발 단계에서 터져야 한다.
 *  3. 목 모드는 `USE_MOCK` 분기 안에서만 동적 import 된다. 실제 경로에 섞이지 않는다.
 */
import type { z } from 'zod';

import { API_BASE_URL, USE_MOCK } from '@/lib/env';
import { envelopeSchema } from '@/lib/schemas';

/** 요청 기본 타임아웃 (ms). 백엔드가 죽어 있을 때 무한 대기하지 않도록. */
const REQUEST_TIMEOUT_MS = 10_000;

export type ApiErrorKind = 'network' | 'http' | 'envelope' | 'schema';

/** UI 가 원인을 구분해 다른 안내를 띄울 수 있도록 종류를 붙인다. */
export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
  readonly detail: string | null;

  constructor(
    message: string,
    options: { kind: ApiErrorKind; status?: number | null; detail?: string | null },
  ) {
    super(message);
    this.name = 'ApiError';
    this.kind = options.kind;
    this.status = options.status ?? null;
    this.detail = options.detail ?? null;
  }
}

export type QueryParams = Record<string, string | number | undefined>;

function buildUrl(path: string, params?: QueryParams): string {
  const url = new URL(`${API_BASE_URL}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

/** 외부 signal 과 타임아웃을 하나로 합친다 (AbortSignal.any 미지원 환경 대응). */
function withTimeout(signal: AbortSignal | undefined): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException('요청 시간이 초과되었습니다', 'TimeoutError')),
    REQUEST_TIMEOUT_MS,
  );
  const onAbort = () => controller.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}

async function readBody(
  method: 'GET' | 'POST',
  path: string,
  params: QueryParams | undefined,
  body: unknown,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  if (USE_MOCK) {
    // 목 모듈은 이 분기 안에서만 로드된다 → 실제 빌드에서는 별도 청크로 분리되어
    // 한 번도 요청되지 않는다.
    const { mockRequest } = await import('@/lib/mock');
    return mockRequest(method, path, params, body);
  }

  const { signal: merged, cleanup } = withTimeout(signal);
  let response: Response;
  try {
    response = await fetch(buildUrl(path, params), {
      method,
      signal: merged,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('백엔드에 연결할 수 없습니다', {
      kind: 'network',
      detail: error instanceof Error ? error.message : String(error),
    });
  } finally {
    cleanup();
  }

  // 4xx/5xx 여도 봉투가 실려 올 수 있으므로 우선 파싱을 시도한다.
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text.length > 0 ? (JSON.parse(text) as unknown) : null;
  } catch {
    throw new ApiError(`응답을 JSON 으로 해석할 수 없습니다 (HTTP ${response.status})`, {
      kind: 'http',
      status: response.status,
      detail: text.slice(0, 200),
    });
  }

  if (!response.ok && !isEnvelopeShaped(parsed)) {
    throw new ApiError(`요청이 실패했습니다 (HTTP ${response.status})`, {
      kind: 'http',
      status: response.status,
    });
  }

  return parsed;
}

function isEnvelopeShaped(value: unknown): boolean {
  return typeof value === 'object' && value !== null && 'success' in value;
}

async function request<T>(
  method: 'GET' | 'POST',
  path: string,
  schema: z.ZodType<T>,
  options: { params?: QueryParams; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const raw = await readBody(method, path, options.params, options.body, options.signal);

  const envelope = envelopeSchema.safeParse(raw);
  if (!envelope.success) {
    throw new ApiError('응답 봉투 형식이 계약과 다릅니다', {
      kind: 'envelope',
      detail: envelope.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', '),
    });
  }

  if (!envelope.data.success) {
    throw new ApiError(envelope.data.error ?? '백엔드가 실패를 반환했습니다', {
      kind: 'envelope',
    });
  }

  const payload = schema.safeParse(envelope.data.data);
  if (!payload.success) {
    throw new ApiError(`${path} 응답이 계약 타입과 다릅니다`, {
      kind: 'schema',
      detail: payload.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join(' / '),
    });
  }

  return payload.data;
}

export function apiGet<T>(
  path: string,
  schema: z.ZodType<T>,
  options: { params?: QueryParams; signal?: AbortSignal } = {},
): Promise<T> {
  return request('GET', path, schema, options);
}

export function apiPost<T>(
  path: string,
  schema: z.ZodType<T>,
  body: unknown,
  options: { signal?: AbortSignal } = {},
): Promise<T> {
  return request('POST', path, schema, { ...options, body });
}

/** 화면에 그대로 노출해도 되는 짧은 한국어 메시지로 정규화한다. */
export function toErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return '알 수 없는 오류가 발생했습니다';
}

/** 개발자용 상세(계약 위반 내용 등). 없으면 null. */
export function toErrorDetail(error: unknown): string | null {
  return error instanceof ApiError ? error.detail : null;
}
