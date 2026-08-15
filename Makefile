# ─────────────────────────────────────────────────────────────
# ariai-exam 루트 Makefile
# Binance 실시간 데이터 수집 프로젝트 - 개발/운영 편의 명령 모음
# ─────────────────────────────────────────────────────────────

.DEFAULT_GOAL := help

COMPOSE_DB   := infra/docker-compose.yml
COMPOSE_FULL := infra/docker-compose.full.yml

.PHONY: help setup db-up db-migrate dev-backend dev-frontend up down clean

help: ## 사용 가능한 명령 목록을 출력합니다 (기본 타깃)
	@echo ""
	@echo "Binance 실시간 데이터 수집 프로젝트 - make 명령어"
	@echo ""
	@echo "  make setup          .env 파일을 준비하고 backend/frontend 의존성을 설치합니다"
	@echo "  make db-up          Postgres 컨테이너를 기동하고 헬스체크 통과까지 대기합니다"
	@echo "  make db-migrate     Drizzle 마이그레이션을 DB에 적용합니다"
	@echo "  make dev-backend    NestJS 백엔드를 watch 모드로 로컬 실행합니다 (도커 아님)"
	@echo "  make dev-frontend   Next.js 프론트엔드를 개발 서버로 로컬 실행합니다 (도커 아님)"
	@echo "  make up             전체 스택(postgres+backend+frontend)을 도커로 기동합니다"
	@echo "  make down           도커로 기동한 전체 스택을 중지합니다"
	@echo "  make clean          컨테이너/볼륨, node_modules, 빌드 산출물을 모두 정리합니다"
	@echo ""

setup: ## .env 복사 + 양쪽 npm install
	@if [ -f backend/.env ]; then \
		echo "backend/.env 가 이미 존재합니다. 건너뜁니다."; \
	else \
		cp .env.example backend/.env; \
		echo ".env.example -> backend/.env 복사 완료"; \
	fi
	@echo "backend 의존성 설치 중..."
	@cd backend && npm install
	@echo "frontend 의존성 설치 중..."
	@cd frontend && npm install
	@echo "설정 완료"

db-up: ## Postgres 기동 후 헬스체크 통과까지 대기
	docker compose -f $(COMPOSE_DB) up -d
	@echo "Postgres 헬스체크 대기 중..."
	@until [ "$$(docker inspect -f '{{.State.Health.Status}}' ariai-postgres 2>/dev/null)" = "healthy" ]; do \
		echo "  아직 준비되지 않았습니다. 1초 후 재확인..."; \
		sleep 1; \
	done
	@echo "Postgres 준비 완료 (healthy)"

db-migrate: ## Drizzle 마이그레이션 적용
	cd backend && npm run db:migrate

dev-backend: ## 백엔드 개발 서버 실행 (watch 모드, 로컬)
	cd backend && npm run start:dev

dev-frontend: ## 프론트엔드 개발 서버 실행 (로컬)
	cd frontend && npm run dev

up: ## 전체 스택을 도커로 빌드 후 기동
	docker compose -f $(COMPOSE_FULL) up -d --build

down: ## 도커로 기동한 스택을 모두 중지
	docker compose -f $(COMPOSE_FULL) down
	docker compose -f $(COMPOSE_DB) down

clean: ## 컨테이너/볼륨/의존성/빌드 산출물을 전부 정리
	docker compose -f $(COMPOSE_FULL) down -v --remove-orphans
	docker compose -f $(COMPOSE_DB) down -v --remove-orphans
	rm -rf backend/node_modules backend/dist backend/coverage
	rm -rf frontend/node_modules frontend/.next
	@echo "정리 완료"
