/**
 * 표시 포맷터.
 *
 * 규칙:
 *  · 자릿수는 값의 크기 "구간"으로 정한다. 매 틱 소수 자릿수가 바뀌면
 *    등폭 폰트를 써도 숫자가 흔들려 보인다.
 *  · 시각은 UTC 로 받아 표시 단계에서만 로컬로 바꾼다 (docs/CONTRACT.md 7절).
 */

const numberFormatCache = new Map<string, Intl.NumberFormat>();

function formatter(min: number, max: number): Intl.NumberFormat {
  const key = `${min}:${max}`;
  const cached = numberFormatCache.get(key);
  if (cached) return cached;
  const created = new Intl.NumberFormat('ko-KR', {
    minimumFractionDigits: min,
    maximumFractionDigits: max,
  });
  numberFormatCache.set(key, created);
  return created;
}

/** 가격의 소수 자릿수는 크기 구간으로 고정한다. */
function priceDigits(value: number): number {
  const abs = Math.abs(value);
  if (abs >= 1_000) return 2;
  if (abs >= 1) return 3;
  if (abs >= 0.01) return 5;
  return 8;
}

export function formatPrice(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const digits = priceDigits(value);
  return formatter(digits, digits).format(value);
}

export function formatNumber(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return formatter(digits, digits).format(value);
}

/** 거래대금처럼 자릿수가 큰 값. K/M/B 는 트레이딩 관행 단위라 그대로 쓴다. */
export function formatCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${formatter(2, 2).format(value / 1e9)}B`;
  if (abs >= 1e6) return `${formatter(2, 2).format(value / 1e6)}M`;
  if (abs >= 1e3) return `${formatter(1, 1).format(value / 1e3)}K`;
  return formatter(0, 2).format(value);
}

/** 부호를 항상 붙인다. 색만으로 방향을 인코딩하지 않기 위한 최소 장치. */
export function formatSignedPercent(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${formatter(digits, digits).format(Math.abs(value))}%`;
}

export function formatPercent(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${formatter(digits, digits).format(value)}%`;
}

/** 0~1 비율 → 백분율 표기. */
export function formatRatioPercent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${formatter(digits, digits).format(value * 100)}%`;
}

export function formatMultiple(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${formatter(digits, digits).format(value)}×`;
}

/** 파이프라인 지연. null 이면 "수신 없음". */
export function formatLag(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '—';
  if (seconds < 60) return `${formatter(1, 1).format(seconds)}초`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}분 ${Math.round(seconds % 60)}초`;
  return `${Math.floor(seconds / 3600)}시간 ${Math.floor((seconds % 3600) / 60)}분`;
}

export function formatUptime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '—';
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3_600);
  const m = Math.floor((seconds % 3_600) / 60);
  if (d > 0) return `${d}일 ${h}시간`;
  if (h > 0) return `${h}시간 ${m}분`;
  return `${m}분 ${Math.floor(seconds % 60)}초`;
}

const timeFormat = new Intl.DateTimeFormat('ko-KR', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

const dateTimeFormat = new Intl.DateTimeFormat('ko-KR', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

/** UTC ISO → 로컬 HH:MM:SS */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return timeFormat.format(date);
}

/** UTC ISO → 로컬 MM/DD HH:MM:SS */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return dateTimeFormat.format(date);
}

/** epoch ms 기준 상대 시각. */
export function formatRelative(epochMs: number | null | undefined, now = Date.now()): string {
  if (epochMs === null || epochMs === undefined) return '—';
  const diff = Math.max(0, now - epochMs);
  if (diff < 1_000) return '방금';
  if (diff < 60_000) return `${Math.floor(diff / 1_000)}초 전`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`;
  return `${Math.floor(diff / 3_600_000)}시간 전`;
}

/** ISO 구간 길이를 사람이 읽는 형태로. */
export function formatRangeDuration(fromIso: string, toIso: string): string {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (Number.isNaN(from) || Number.isNaN(to)) return '—';
  return formatUptime((to - from) / 1000);
}

/**
 * `datetime-local` 입력값(로컬 시각, 타임존 없음) → UTC ISO.
 * 전송은 항상 UTC (docs/CONTRACT.md 7절).
 */
export function localInputToUtcIso(value: string): string {
  const parsed = new Date(value);
  return parsed.toISOString();
}

/** Date → `datetime-local` 입력값 (로컬 기준, 분 단위). */
export function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}
