'use client';

import { PriceChartPanel } from '@/components/chart/PriceChartPanel';
import { DashboardHeader } from '@/components/dashboard/DashboardHeader';
import { MetricTiles } from '@/components/metrics/MetricTiles';
import { PriceHeroPanel } from '@/components/metrics/PriceHeroPanel';
import { BackfillFormPanel } from '@/components/ops/BackfillFormPanel';
import { BackfillJobsPanel } from '@/components/ops/BackfillJobsPanel';
import { CollectorEventLogPanel } from '@/components/ops/CollectorEventLogPanel';
import { CoveragePanel } from '@/components/ops/CoveragePanel';
import { PipelineHealthPanel } from '@/components/ops/PipelineHealthPanel';
import { StreamHealthPanel } from '@/components/ops/StreamHealthPanel';
import { TakerPressurePanel } from '@/components/pressure/TakerPressurePanel';
import { useStreamCacheSync } from '@/hooks/useStreamCacheSync';
import { USE_MOCK } from '@/lib/env';

/**
 * 단일 대시보드 레이아웃.
 *
 * 위계: 균일한 카드 격자를 쓰지 않는다.
 *  · 1행 — "지금 얼마인가"(현재가)와 "지금 데이터가 온전한가"(파이프라인)가 가장 크다.
 *  · 2행 — 가격 차트가 화면의 2/3, 체결강도가 1/3.
 *  · 3~4행 — 운영 영역. 수집 상태 · 커버리지 · 백필 · 로그.
 */
export function DashboardShell() {
  // SSE 로 들어온 지표/운영 스냅샷을 쿼리 캐시에 반영한다 (이 컴포넌트는 리렌더되지 않는다).
  useStreamCacheSync();

  return (
    <div className="relative z-10 flex min-h-dvh flex-col">
      <DashboardHeader />

      {USE_MOCK ? <MockBanner /> : null}

      <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-5 lg:px-6 lg:py-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-6 xl:grid-cols-12">
          <div className="md:col-span-3 xl:col-span-4">
            <PriceHeroPanel />
          </div>
          <div className="md:col-span-3 xl:col-span-3">
            <PipelineHealthPanel />
          </div>
          <div className="md:col-span-6 xl:col-span-5">
            <MetricTiles />
          </div>

          <div className="flex min-h-[460px] flex-col md:col-span-6 xl:col-span-8">
            <PriceChartPanel />
          </div>
          <div className="md:col-span-6 xl:col-span-4">
            <TakerPressurePanel />
          </div>

          <SectionBand
            id="ops-heading"
            title="수집 파이프라인 운영"
            description="스트림 지연 · 봉 커버리지 · 백필 · 수집기 로그"
          />

          <div className="md:col-span-3 xl:col-span-4">
            <StreamHealthPanel />
          </div>
          <div className="md:col-span-3 xl:col-span-5">
            <CoveragePanel />
          </div>
          <div className="md:col-span-6 xl:col-span-3">
            <BackfillFormPanel />
          </div>

          <div className="md:col-span-6 xl:col-span-7">
            <BackfillJobsPanel />
          </div>
          <div className="md:col-span-6 xl:col-span-5">
            <CollectorEventLogPanel />
          </div>
        </div>
      </main>
    </div>
  );
}

/** Swiss 식 구역 분할선. 화면을 "시장"과 "운영" 두 축으로 끊어 읽게 만든다. */
function SectionBand({
  id,
  title,
  description,
}: {
  id: string;
  title: string;
  description: string;
}) {
  return (
    <div className="border-hairline-strong mt-4 flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t pt-3 md:col-span-6 xl:col-span-12">
      <h2 id={id} className="text-fg text-sm font-semibold tracking-[0.2em] uppercase">
        {title}
      </h2>
      <span className="label-micro">{description}</span>
    </div>
  );
}

function MockBanner() {
  return (
    <div
      role="status"
      className="border-amber/50 bg-amber/10 mx-auto w-full max-w-[1600px] border-b px-4 py-2 lg:px-6"
    >
      <p className="label-micro text-amber whitespace-normal">
        목 데이터 모드 (NEXT_PUBLIC_USE_MOCK=true) — 화면에 보이는 값은 실제 수집 결과가 아닙니다.
      </p>
    </div>
  );
}
