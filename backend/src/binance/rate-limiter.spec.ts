import { BinanceIpBanError, BinanceRateLimiter } from './rate-limiter';

describe('BinanceRateLimiter', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('예산 내 요청은 즉시 통과한다', async () => {
    const limiter = new BinanceRateLimiter({ budgetPerMin: 10 });
    await expect(limiter.acquire(5)).resolves.toBeUndefined();
    await expect(limiter.acquire(5)).resolves.toBeUndefined();
    expect(limiter.getUsedWeight()).toBe(10);
  });

  test('예산 소진 시 대기하고, 윈도우가 지나면 회복된다', async () => {
    const limiter = new BinanceRateLimiter({ budgetPerMin: 10 });
    await limiter.acquire(10);

    let resolved = false;
    const pending = limiter.acquire(1).then(() => {
      resolved = true;
    });

    await jest.advanceTimersByTimeAsync(59_000);
    expect(resolved).toBe(false);

    await jest.advanceTimersByTimeAsync(2_000);
    await pending;
    expect(resolved).toBe(true);
  });

  test('서버가 알려준 사용량이 로컬 추정보다 크면 상향 보정한다', async () => {
    const limiter = new BinanceRateLimiter({ budgetPerMin: 10 });
    await limiter.acquire(2);

    limiter.syncServerUsedWeight(9);
    expect(limiter.getUsedWeight()).toBe(9);

    // 9 + 2 > 10 이므로 대기해야 한다
    let resolved = false;
    const pending = limiter.acquire(2).then(() => {
      resolved = true;
    });
    await jest.advanceTimersByTimeAsync(10_000);
    expect(resolved).toBe(false);

    await jest.advanceTimersByTimeAsync(51_000);
    await pending;
    expect(resolved).toBe(true);
  });

  test('서버 사용량이 로컬보다 작으면 줄이지 않는다 (초과 방향만 보정)', async () => {
    const limiter = new BinanceRateLimiter({ budgetPerMin: 10 });
    await limiter.acquire(5);
    limiter.syncServerUsedWeight(1);
    expect(limiter.getUsedWeight()).toBe(5);
  });

  test('Retry-After 동안 모든 acquire가 전역 정지된다', async () => {
    const limiter = new BinanceRateLimiter({ budgetPerMin: 100 });
    limiter.applyRetryAfter(30);

    let resolved = false;
    const pending = limiter.acquire(1).then(() => {
      resolved = true;
    });
    await jest.advanceTimersByTimeAsync(29_000);
    expect(resolved).toBe(false);

    await jest.advanceTimersByTimeAsync(2_000);
    await pending;
    expect(resolved).toBe(true);
  });

  test('밴 상태에서는 acquire가 즉시 실패한다', async () => {
    const limiter = new BinanceRateLimiter({ budgetPerMin: 100 });
    limiter.markBanned('테스트 밴');
    await expect(limiter.acquire(1)).rejects.toThrow(BinanceIpBanError);
    expect(limiter.getStatus().banned).toBe(true);
  });

  test('예산보다 큰 weight 요청은 즉시 거부한다 (영원한 대기 방지)', async () => {
    const limiter = new BinanceRateLimiter({ budgetPerMin: 10 });
    await expect(limiter.acquire(11)).rejects.toThrow('분당 예산');
  });

  test('0 이하 weight는 거부한다', async () => {
    const limiter = new BinanceRateLimiter({ budgetPerMin: 10 });
    await expect(limiter.acquire(0)).rejects.toThrow('잘못된 요청 weight');
  });
});
