/**
 * 스캐폴드 `vite.config.ts`.
 *
 * 유저·어드민 템플릿이 같은 설정을 쓴다 — 갈리는 건 템플릿 파일이 선언하는 `target`뿐이다.
 * phase는 `.env`의 `VITE_BSTAGE_PHASE`에서 읽는다.
 */
export function viteConfig(): string {
  return `import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { bstageDevPlugin } from '@bstage-sdk/cli/vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react(), bstageDevPlugin({ phase: env.VITE_BSTAGE_PHASE })],
  }
})
`
}
