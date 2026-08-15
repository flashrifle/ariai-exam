import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { AppProviders } from '@/components/providers/AppProviders';

import './globals.css';

export const metadata: Metadata = {
  title: 'ARIAI · 수집 운영 콘솔',
  description: 'Binance 실시간 수집 파이프라인의 시장 지표와 운영 건강도를 한 화면에서 본다.',
};

export const viewport: Viewport = {
  themeColor: '#0a0d12',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-dvh">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
