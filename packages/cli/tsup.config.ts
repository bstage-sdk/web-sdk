import { defineConfig } from 'tsup'
import { writeFile, readFile, chmod } from 'node:fs/promises'
import { join } from 'node:path'

export default defineConfig({
  entry: ['src/index.ts', 'src/vite/preset.ts'],
  format: ['esm'],
  // `bstage dev`는 진짜 플랫폼이 없는 로컬에서 "가짜 플랫폼" 역할로 :root 토큰 fallback을
  // 깐다. 소비자가 design을 설치하지 않았어도 동작해야
  // 하므로 devVitePlugin이 import한 design을 번들에 인라인한다.
  // devDependency라 tsup 기본값으로도 인라인되지만, 그 암묵 규칙에 기대지 않도록 명시한다.
  noExternal: ['@bstage-sdk/design'],
  dts: true,
  clean: true,
  // 소스맵은 배포하지 않는다. 번들의 두 배 크기인데 소비자가 라이브러리 내부 스택을
  // 따라 들어가는 일이 드물고, 필요하면 공개 저장소에서 소스를 읽으면 된다.
  // (실측: 널리 쓰이는 공개 패키지 대부분이 소스맵을 배포하지 않는다.)
  sourcemap: false,
  async onSuccess() {
    // CLI 엔트리에 shebang 추가
    const indexPath = join('dist', 'index.js')
    const content = await readFile(indexPath, 'utf-8')
    await writeFile(indexPath, `#!/usr/bin/env node\n${content}`)
    await chmod(indexPath, 0o755)
  },
})
