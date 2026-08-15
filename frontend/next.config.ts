import type { NextConfig } from 'next';

/**
 * 운영 대시보드는 공개 마켓 데이터만 다루므로 인증 계층이 없다.
 * 대신 브라우저 측 방어 헤더는 기본값으로 켜 둔다.
 * (CSP 는 nonce 가 필요하므로 src/proxy.ts 에서 요청 단위로 부여한다)
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  headers: async () => [{ source: '/:path*', headers: securityHeaders }],
};

export default nextConfig;
