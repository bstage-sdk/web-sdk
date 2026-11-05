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
  // 격리 프레임 문서에 깔 디자인 토큰 CSS(`renderFrameCss`)를 번들에 인라인한다. bridge는 런타임 의존이
  // 없는 패키지라 design은 devDependency다(cli와 같은 방식). 토큰을 바꾸면 bridge도 함께 bump해야 한다
  // (scripts/check-changeset.mjs INLINED_PAIRS).
  noExternal: ['@bstage-sdk/design'],
  dts: true,
  clean: true,
  // 프레임 런타임은 `Function.prototype.toString()`으로 srcdoc에 심긴다(src/frame/runtime.ts).
  // 압축하면 식별자는 바뀌어도 자기완결성은 유지되지만, 디버깅을 위해 압축하지 않는다.
  minify: false,
  // 소스맵은 배포하지 않는다(host 패키지와 같은 근거).
  sourcemap: false,
})
