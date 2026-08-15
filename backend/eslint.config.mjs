// @ts-check
// ─────────────────────────────────────────────────────────────
// backend/eslint.config.mjs
// ESLint 9 flat config - TypeScript + NestJS 관례
// 다른 담당자들의 동시 작업을 막지 않도록 과하게 엄격한 규칙은 피하고,
// 타입 정보(project 기반) 없이도 동작하는 non-type-checked 프리셋을 사용한다.
// ─────────────────────────────────────────────────────────────
import eslint from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // 빌드 산출물 / 의존성 / 마이그레이션 산출물은 린트 대상에서 제외
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'drizzle/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  // prettier와 충돌하는 포맷팅 규칙 비활성화 (포맷팅은 prettier가 전담)
  eslintConfigPrettier,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
    },
    rules: {
      // NestJS는 데코레이터·DI·외부 라이브러리 타입 경계에서 any를 자주 사용하므로 완화
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      // 미사용 변수는 에러가 아닌 경고로, _로 시작하는 이름은 의도적 무시로 허용
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': 'off',
    },
  },
);
