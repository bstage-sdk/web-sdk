import { readFileSync } from 'node:fs'
import { defineConfig } from 'tsup'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'))

/** `version.ts`의 `__SDK_VERSION__` — BstageClient 가 `x-bmf-sdk-version` 헤더로 싣는 값 */
const define = { __SDK_VERSION__: JSON.stringify(pkg.version) }

export default defineConfig({
  // account는 계정 화면 전용 하위 진입점 — 로그인 쿠키 쓰기 코드가 일반 템플릿 번들에 실리지 않게 분리한다.
  entry: { index: 'src/index.ts', account: 'src/account/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  define,
  // 소스맵은 배포하지 않는다. 번들의 두 배 크기인데 소비자가 라이브러리 내부 스택을
  // 따라 들어가는 일이 드물고, 필요하면 공개 저장소에서 소스를 읽으면 된다.
  // (실측: 널리 쓰이는 공개 패키지 대부분이 소스맵을 배포하지 않는다.)
  sourcemap: false,
})
