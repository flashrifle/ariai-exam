import { USE_MOCK } from '@/lib/env';
import type { StreamSourceLike } from '@/lib/stream/event-stream-client';

/**
 * 목 스트림은 동적 import 로만 로드된다. 로드가 끝나기 전에 붙은 리스너는
 * 큐에 담아 두었다가 그대로 옮겨 붙인다.
 */
class LazyMockSource implements StreamSourceLike {
  private inner: StreamSourceLike | null = null;
  private closed = false;
  private pending: Array<[string, (event: Event) => void]> = [];

  constructor(url: string) {
    void import('@/lib/mock/stream').then(({ createMockEventSource }) => {
      if (this.closed) return;
      const inner = createMockEventSource(url);
      for (const [type, listener] of this.pending) inner.addEventListener(type, listener);
      this.pending = [];
      this.inner = inner;
    });
  }

  addEventListener(type: string, listener: (event: Event) => void): void {
    if (this.inner) this.inner.addEventListener(type, listener);
    else this.pending.push([type, listener]);
  }

  close(): void {
    this.closed = true;
    this.inner?.close();
    this.inner = null;
    this.pending = [];
  }
}

/** 기본은 실제 EventSource. `NEXT_PUBLIC_USE_MOCK=true` 일 때만 목으로 갈아탄다. */
export function createStreamSource(url: string): StreamSourceLike {
  if (!USE_MOCK) return new EventSource(url);
  return new LazyMockSource(url);
}
