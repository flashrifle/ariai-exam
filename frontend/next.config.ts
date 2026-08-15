import type { NextConfig } from 'next';

/**
 * 운영 대시보드는 공개 마켓 데이터만 다루므로 인증 계층이 없다.
 * 대신 브라우저 측 방어 헤더는 기본값으로 켜 둔다.
 *
 * CSP 는 여기 넣지 않았다. Next App Router 는 인라인 부트스트랩 스크립트를 쓰기 때문에
 * 정적 헤더로 걸면 `'unsafe-inline'` 이 필요해져 의미가 없다. 제대로 하려면
 * 요청마다 nonce 를 발급하는 프록시(Next 16 의 `src/proxy.ts`)가 필요하고,
 * 실제로 앱을 띄워 검증한 뒤 넣어야 한다 — 미해결 항목으로 보고했다.
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  // 도커 런타임 스테이지가 `.next/standalone` 산출물을 전제로 한다 (frontend/Dockerfile).
  // 이 옵션이 없으면 이미지 빌드가 runtime 단계에서 실패한다.
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  headers: async () => [{ source: '/:path*', headers: securityHeaders }],
};

export default nextConfig;
