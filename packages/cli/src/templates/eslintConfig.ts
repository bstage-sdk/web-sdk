export function eslintConfig(): string {
  return `import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // .husky는 SDK가 생성·갱신하는 도구 스크립트라 프로젝트 소스가 아니다.
  // 빼두지 않으면 check-secrets.mjs의 파일 상단 eslint-disable이 "불필요한 directive" 경고로 잡힌다.
  globalIgnores(['dist', '.husky']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
])
`
}
