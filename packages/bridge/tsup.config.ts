import { defineConfig } from 'tsup'

export default defineConfig({
  // 진입점 셋: `.`(프로토콜·srcdoc), `./host`(플랫폼 측), `./frame`(iframe 안).
  // 이름을 고정해 package.json exports의 dist 경로(index·host·frame)와 맞춘다.
  entry: {
    index: 'src/index.ts',
    host: 'src/host/index.ts',
    frame: 'src/frame/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  // 프레임 런타임은 `Function.prototype.toString()`으로 srcdoc에 심긴다(src/frame/runtime.ts).
  // 압축하면 식별자는 바뀌어도 자기완결성은 유지되지만, 디버깅을 위해 압축하지 않는다.
  minify: false,
  // 소스맵은 배포하지 않는다(host 패키지와 같은 근거).
  sourcemap: false,
})
