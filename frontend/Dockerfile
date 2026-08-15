# ─────────────────────────────────────────────────────────────
# frontend/Dockerfile
# Next.js 16 - `output: 'standalone'` 산출물을 전제로 한 멀티스테이지 빌드
#   deps → build → runtime(standalone 서버 + non-root 실행)
#
# ⚠️ 전제조건: frontend/next.config.ts 에 `output: 'standalone'` 설정이 필요합니다.
#    이 설정이 없으면 build 단계에서 .next/standalone 산출물이 생성되지 않아
#    runtime 단계의 COPY 가 실패합니다. (이 Dockerfile 을 작성한 담당자는
#    next.config.ts 를 수정하지 않았습니다 — 소유권 밖 파일이므로 별도 요청 필요)
# ─────────────────────────────────────────────────────────────

# ---------- 1단계: deps ----------
FROM node:22-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# ---------- 2단계: build ----------
FROM node:22-alpine AS build
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules

# public/ 디렉토리가 아직 없을 수 있으므로 미리 생성해 이후 COPY 단계 실패를 방지
RUN mkdir -p public
COPY . .

# NEXT_PUBLIC_* 값은 브라우저 번들에 빌드 타임으로 인라인되므로 빌드 인자로 주입
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:4000/api/v1
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL

RUN npm run build

# ---------- 3단계: runtime ----------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# non-root 유저 생성
RUN addgroup -g 1001 nodejs && adduser -S nextjs -u 1001 -G nodejs

# standalone 산출물: server.js + 자체 포함된 node_modules
COPY --from=build --chown=nextjs:nodejs /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

ENV PORT=3000
# 컨테이너 내부에서 모든 인터페이스로 바인딩해야 호스트 포트 매핑으로 접근 가능
ENV HOSTNAME=0.0.0.0
EXPOSE 3000

CMD ["node", "server.js"]
