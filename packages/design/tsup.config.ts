import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'user/index': 'src/user/index.ts',
    'admin/index': 'src/admin/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  // 소스맵은 배포하지 않는다. 번들의 두 배 크기인데 소비자가 라이브러리 내부 스택을
  // 따라 들어가는 일이 드물고, 필요하면 공개 저장소에서 소스를 읽으면 된다.
  // (실측: 널리 쓰이는 공개 패키지 대부분이 소스맵을 배포하지 않는다.)
  sourcemap: false,
  splitting: false,
})
