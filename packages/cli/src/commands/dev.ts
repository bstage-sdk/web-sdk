import { createServer as createViteServer, searchForWorkspaceRoot } from 'vite'
import type { PluginOption } from 'vite'
import react from '@vitejs/plugin-react'
import { bstageDevPlugin } from '../dev/devVitePlugin.js'
import { createRegisterPlugin } from '../vite/registerPlugin.js'
import { LOGIN_PATH } from '../constants.js'
import { describePhase, resolvePhase } from '../dev/resolvePhase.js'

export interface DevOptions {
  port: string
  /** 미지정 시 `.env`의 `VITE_BSTAGE_PHASE` → 기본값 순으로 해석된다. */
  phase?: string
}

export async function devCommand(options: DevOptions): Promise<void> {
  const port = parseInt(options.port, 10)
  const root = process.cwd()

  let resolved
  try {
    resolved = resolvePhase(options.phase, root)
  } catch (err) {
    console.error(`[bstage] ${(err as Error).message}`)
    process.exit(1)
  }
  const phase = resolved.phase
  console.log(describePhase(resolved))

  const plugins: PluginOption[] = [react(), bstageDevPlugin({ phase }), createRegisterPlugin()]

  let vite
  try {
    vite = await createViteServer({
      root,
      configFile: false,
      plugins,
      server: {
        port,
        strictPort: true,
        // 프로젝트 루트 밖 파일은 내보내지 않는다. 워크스페이스 루트를 함께 허용하는 것은
        // 모노레포·pnpm 스토어에서 의존 패키지 실제 경로가 루트 위에 있기 때문이다.
        //
        // 허용 경로를 넓혀야 한다면(로컬 링크 개발 등) 스캐폴드의 `npm run dev`를 쓴다.
        // 그쪽은 소비자의 `vite.config.ts`를 타므로 `server.fs.allow`를 직접 넣을 수 있다.
        fs: { strict: true, allow: [root, searchForWorkspaceRoot(root)] },
      },
    })
  } catch (err) {
    // 사내 전용 phase인데 호스트가 없는 경우가 여기로 온다(bstageDevPlugin의 configResolved).
    // 스택을 그대로 뱉으면 원인이 묻히므로 메시지만 보여준다.
    console.error(`[bstage] ${(err as Error).message}`)
    process.exit(1)
  }

  await vite.listen()
  vite.printUrls()

  const resolvedPort = vite.config.server.port ?? port
  console.log(`  Login:  http://localhost:${resolvedPort}${LOGIN_PATH}\n`)
}
