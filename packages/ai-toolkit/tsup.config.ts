import { readFileSync } from 'node:fs'
import { defineConfig } from 'tsup'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'))

/** `version.ts`의 `__TOOLKIT_VERSION__` — 설치된 스킬 자산이 어느 toolkit 버전에서 나왔는지 알려준다 */
const define = { __TOOLKIT_VERSION__: JSON.stringify(pkg.version) }

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  define,
  // 소스맵은 배포하지 않는다(다른 패키지와 동일 — 소비자가 내부 스택을 따라 들어갈 일이 없다).
  sourcemap: false,
})
