# ─────────────────────────────────────────────────────────────
# backend/Dockerfile
# NestJS 백엔드 - Node 22-alpine 멀티스테이지 빌드
#   deps(전체 의존성 설치) → build(nest build) → runtime(운영 의존성만 + non-root 실행)
# ─────────────────────────────────────────────────────────────

# ---------- 1단계: deps ----------
# devDependencies 포함 전체 설치 (nest build 에 @nestjs/cli, typescript 등이 필요)
FROM node:22-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# ---------- 2단계: build ----------
FROM node:22-alpine AS build
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# nest build → dist/main.js 생성
RUN npm run build

# ---------- 3단계: runtime ----------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# non-root 유저 생성 (alpine 기본 이미지에는 전용 앱 유저가 없음)
RUN addgroup -g 1001 nodejs && adduser -S nestjs -u 1001 -G nodejs

# 최종 이미지에는 production 의존성만 설치 (devDependencies 제외)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# 빌드 단계 산출물만 복사 (소스/설정 파일은 가져오지 않음)
COPY --from=build /app/dist ./dist

RUN chown -R nestjs:nodejs /app
USER nestjs

ENV PORT=4000
EXPOSE 4000

# CONTRACT.md 의 /ops/health 엔드포인트를 이용한 컨테이너 헬스체크
# (alpine 기본 이미지에는 curl/wget이 없으므로 Node 내장 fetch 사용)
HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=5 \
  CMD node -e "fetch('http://localhost:4000/api/v1/ops/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
