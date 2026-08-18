import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const pkg = (p: string) => fileURLToPath(new URL(`./packages/${p}`, import.meta.url))

export default defineConfig({
  test: {
    // 테스트는 소스 옆(`*.test.ts`)에 둔다 — tsup entry가 명시적이라 번들에 실리지 않고,
    // 각 패키지 `files:["dist"]`라 배포물에도 나가지 않는다. 대신 tsconfig `include:["src"]`
    // 안에 있어 typecheck·lint·prettier가 테스트까지 함께 덮는다.
    include: ['packages/*/src/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    // design 토큰을 **소스**로 해석한다. 이 alias가 없으면 bare specifier가 exports 맵을 타고
    // dist로 가서 `pnpm test`가 선행 빌드에 의존한다. 여기서 막으려는 건 소스 상수 드리프트
    // (cli의 예시 키 ↔ design의 실제 토큰 키)이고 패키징은 build·typecheck가 이미 검증하므로,
    // fresh clone에서 빌드 없이 테스트가 돌게 한다.
    alias: {
      '@bstage-sdk/design/user': pkg('design/src/user/index.ts'),
      '@bstage-sdk/design/admin': pkg('design/src/admin/index.ts'),
    },
  },
})
