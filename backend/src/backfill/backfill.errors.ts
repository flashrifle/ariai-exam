/**
 * 백필 모듈 오류 타입.
 */
import { BadRequestException } from '@nestjs/common';

/**
 * 수동 백필 요청 검증 실패.
 *
 * `BadRequestException`을 상속해 **그 자체로 HTTP 400** 이 되게 한다.
 * 평범한 Error 를 던지면 전역 예외 필터가 500 으로 처리해,
 * 클라이언트 입력 오류가 서버 장애로 보고되고 진짜 장애 알림을 오염시킨다.
 *
 * 서비스 계층 검증을 유지하는 이유: 컨트롤러의 zod 스키마는 컴파일 시점 상수를 쓰지만
 * 서비스는 런타임 설정(SYMBOLS 환경변수 등)을 검사하므로 둘의 허용 범위가 완전히 같을 수 없다.
 * 이중 방어는 그대로 두되, 그 틈으로 들어온 요청도 400 으로 답한다.
 */
export class BackfillValidationError extends BadRequestException {
  constructor(message: string) {
    super(message);
    this.name = 'BackfillValidationError';
  }
}
