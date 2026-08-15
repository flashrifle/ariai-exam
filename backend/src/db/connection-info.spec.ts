/**
 * 접속 문자열 요약 테스트.
 * 로그에 비밀번호가 절대 남지 않아야 하므로 그 부분을 명시적으로 고정한다.
 */
import { describeConnection } from './connection-info';

describe('describeConnection', () => {
  test('host/port/database와 사용자만 남기고 비밀번호는 지운다', () => {
    // Arrange
    const url = 'postgresql://ariai:ariai_local_pw@localhost:5432/ariai';

    // Act
    const summary = describeConnection(url);

    // Assert
    expect(summary).toBe('ariai@localhost:5432/ariai');
    expect(summary).not.toContain('ariai_local_pw');
  });

  test('포트가 없으면 기본 포트를 채운다', () => {
    expect(describeConnection('postgresql://user:pw@db.internal/ariai')).toBe(
      'user@db.internal:5432/ariai',
    );
  });

  test('사용자 정보가 없어도 동작한다', () => {
    expect(describeConnection('postgresql://localhost:5432/ariai')).toBe('localhost:5432/ariai');
  });

  test('쿼리 파라미터는 요약에 포함하지 않는다', () => {
    expect(describeConnection('postgresql://u:p@h:6543/db?sslmode=require')).toBe('u@h:6543/db');
  });

  test('해석할 수 없는 값이면 원본을 절대 노출하지 않는다', () => {
    // Arrange
    const broken = 'this-is-not-a-url-with-secret';

    // Act
    const summary = describeConnection(broken);

    // Assert
    expect(summary).toBe('(해석 불가)');
    expect(summary).not.toContain('secret');
  });
});
