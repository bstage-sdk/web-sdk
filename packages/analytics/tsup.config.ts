import { readFileSync } from 'node:fs'
import { defineConfig } from 'tsup'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'))

/** 호스트가 물고 있는 SDK 버전을 런타임에 `version()`으로 확인할 수 있게 심는다 */
const define = { __SDK_VERSION__: JSON.stringify(pkg.version) }

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  define,
  // 소스맵은 배포하지 않는다. 번들의 두 배 크기인데 소비자가 라이브러리 내부 스택을
  // 따라 들어가는 일이 드물고, 필요하면 공개 저장소에서 소스를 읽으면 된다.
  sourcemap: false,
})
