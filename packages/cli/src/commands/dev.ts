import { createServer as createViteServer, searchForWorkspaceRoot } from 'vite'
import type { PluginOption } from 'vite'
import react from '@vitejs/plugin-react'
import { bstageDevPlugin } from '../dev/devVitePlugin.js'
import { createRegisterPlugin } from '../vite/registerPlugin.js'
import { LOGIN_PATH } from '../constants.js'
import { describePhase, resolvePhase } from '../dev/resolvePhase.js'
import { detectProjectKind } from '../project/detectKind.js'
import { ExitCode, fail } from '../portal/output.js'
import { startLiquidDevServer } from '../liquid/server.js'

export interface DevOptions {
  port: string
  /** 미지정 시 `.env`의 `VITE_BSTAGE_PHASE` → 기본값 순으로 해석된다. */
  phase?: string
}

/**
 * liquid 레포용 프리뷰. Vite·인증 프록시·phase가 모두 없다 — 플랫폼이 서버에서 데이터를 넣는
 * 구조라 로컬에 재현할 인증 컨텍스트가 없고, 값은 템플릿 폴더의 data.json에서 온다.
 */
async function runLiquidPreview(root: string, port: number, phase?: string): Promise<void> {
  if (phase !== undefined) {
    console.log('[bstage] liquid 프리뷰는 phase를 쓰지 않습니다 — --phase 를 무시합니다.')
  }

  const server = await startLiquidDevServer({
    root,
    port,
    log: (line) => console.log(`  ${line}`),
  })

  const base = `http://localhost:${server.port}`
  console.log(`\n  liquid 프리뷰:  ${base}`)
  console.log(`  user 목록:      ${base}/user`)
  console.log(`  admin 목록:     ${base}/admin`)
  console.log('  phase와 인증 프록시는 liquid 프리뷰에 없습니다. 값은 data.json에서 옵니다.\n')
}

const MIXED_MESSAGE =
  'liquid 템플릿(public/{user|admin}/{이름}/template.liquid)과 React 템플릿(src/**/template.tsx)이 ' +
  '한 레포에 섞여 있습니다. 포털 빌더가 빌드하지 못하므로 한쪽으로 정리한 뒤 다시 실행하세요.'

/** 기존 SDK(React) 경로 — Vite + 인증 프록시. 동작은 liquid 분기 이전과 같다. */
async function runViteDevServer(root: string, port: number, phaseOption?: string): Promise<void> {
  let resolved
  try {
    resolved = resolvePhase(phaseOption, root)
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

export async function devCommand(options: DevOptions): Promise<void> {
  const port = parseInt(options.port, 10)
  const root = process.cwd()

  // 판정은 포털 빌더와 같은 규칙(detectProjectKind)이다. `unknown`은 기존 Vite 경로로 보낸다 —
  // 판정에 안 잡히는 기존 프로젝트를 깨지 않기 위해서다.
  const kind = detectProjectKind(root).kind
  if (kind === 'liquid') return await runLiquidPreview(root, port, options.phase)
  if (kind === 'mixed') fail(ExitCode.PRECONDITION, MIXED_MESSAGE)

  await runViteDevServer(root, port, options.phase)
}
