/**
 * 애플리케이션 부트스트랩 (팀 리더 관리).
 */
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory, Reflector } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { ResponseEnvelopeInterceptor } from './common/response.interceptor';
import type { AppEnv } from './config/configuration';

const API_PREFIX = 'api/v1';
const SWAGGER_PATH = 'api/docs';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, { bufferLogs: false });

  const config = app.get(ConfigService<AppEnv, true>);
  const port = config.get('PORT', { infer: true });
  const corsOrigin = config.get('CORS_ORIGIN', { infer: true });

  app.setGlobalPrefix(API_PREFIX);

  // SSE는 EventSource가 별도 헤더를 못 붙이므로 단순 GET 허용으로 충분하다.
  app.enableCors({
    origin: corsOrigin.split(',').map((o) => o.trim()),
    methods: ['GET', 'POST', 'OPTIONS'],
    credentials: false,
  });

  // 응답 봉투 → 예외 필터 순서로 걸어 성공/실패 응답 형태를 일치시킨다.
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor(app.get(Reflector)));
  app.useGlobalFilters(new AllExceptionsFilter());
  // 검증은 컨트롤러별 ZodValidationPipe가 담당한다.
  // 전역 ValidationPipe(class-validator 기반)는 쓰지 않으므로 등록하지 않는다.

  // DB 풀 정리와 WS 종료, 체결 버퍼 flush가 걸려 있어 반드시 필요하다.
  app.enableShutdownHooks();

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Binance 수집 파이프라인 운영 API')
    .setDescription('BTCUSDT/ETHUSDT 실시간 수집 · 백필 · 지표 · 운영 상태 API')
    .setVersion('1.0.0')
    .build();
  SwaggerModule.setup(SWAGGER_PATH, app, SwaggerModule.createDocument(app, swaggerConfig));

  await app.listen(port);
  logger.log(`서버 기동 완료 — http://localhost:${port}/${API_PREFIX}`);
  logger.log(`API 문서 — http://localhost:${port}/${SWAGGER_PATH}`);
}

void bootstrap();
