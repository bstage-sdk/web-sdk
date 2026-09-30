import { createServer as createViteServer, searchForWorkspaceRoot } from 'vite'
import type { PluginOption } from 'vite'
import react from '@vitejs/plugin-react'
import { bstageDevPlugin } from '../dev/devVitePlugin.js'
import { createRegisterPlugin } from '../vite/registerPlugin.js'
import { LOGIN_PATH } from '../constants.js'
import { describePhase, resolvePhase } from '../dev/resolvePhase.js'
import { detectProjectKind, type DetectedKind } from '../project/detectKind.js'
import { ExitCode, fail } from '../portal/output.js'
import pc from 'picocolors'
import { ignoredLiquidNotice } from '../liquid/ignoredNotice.js'
import { startLiquidDevServer } from '../liquid/server.js'

export interface DevOptions {
  port: string
  /** 미지정 시 `.env`의 `VITE_BSTAGE_PHASE` → 기본값 순으로 해석된다. */
  phase?: string
  /** 혼합 레포(sdk + liquid)에서 어느 프리뷰를 띄울지 — `sdk`(기본) 또는 `liquid`. */
  kind?: string
}

export type DevMode = 'sdk' | 'liquid'

export interface DevModeDecision {
  mode: DevMode
  /** 띄우지 않은 쪽을 보는 방법 — 혼합 레포에서 기본값으로 갔을 때만 있다. */
  hint?: string
}

/**
 * 레포 종류와 `--kind`로 어느 프리뷰를 띄울지 정한다. 서버는 하나만 뜬다.
 *
 * - `sdk`·`unknown` → Vite. `unknown`은 판정에 안 잡히는 기존 프로젝트를 깨지 않기 위해 Vite다.
 * - `liquid` → liquidjs 프리뷰.
 * - `mixed` → 기본 Vite, `--kind liquid`로 liquid 프리뷰. 두 서버를 함께 띄우지 않는다(포트·로그가
 *   섞인다) — 어느 쪽을 보는지는 사용자가 정한다.
 * - `--kind`가 판정과 어긋나면(liquid 레포에 `--kind sdk` 등) 덮어쓰지 않고 멈춘다 — `ai install
 *   --kind`와 같은 규칙이다. 없는 쪽을 띄우면 "엔트리를 못 찾았다"는 엉뚱한 오류로 끝난다.
 *
 * @internal 테스트용으로 노출한다. public API 아님.
 */
export function resolveDevMode(kind: DetectedKind, requested: string | undefined): DevModeDecision {
  if (requested !== undefined && requested !== 'sdk' && requested !== 'liquid') {
    fail(ExitCode.PRECONDITION, `--kind 값이 올바르지 않습니다: ${requested} (sdk 또는 liquid)`)
  }
  const detected: DevMode = kind === 'liquid' ? 'liquid' : 'sdk'

  if (kind === 'mixed') {
    if (requested === 'liquid') return { mode: 'liquid' }
    if (requested === 'sdk') return { mode: 'sdk' }
    return {
      mode: 'sdk',
      hint:
        'sdk와 liquid 템플릿이 함께 있는 레포입니다 — 지금은 sdk(Vite) 프리뷰를 띄웁니다. ' +
        'liquid 프리뷰는 `bstage dev --kind liquid` 로 따로 띄우세요.',
    }
  }

  if (requested !== undefined && requested !== detected) {
    fail(
      ExitCode.PRECONDITION,
      `--kind ${requested}로 지정했지만 이 레포는 ${kind}로 판정됩니다 — 옵션을 빼고 다시 실행하세요.`,
    )
  }
  return { mode: detected }
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

  // 판정은 포털 빌더와 같은 규칙(detectProjectKind)이다. 어느 프리뷰를 띄울지는 resolveDevMode가
  // 정한다(혼합 레포는 기본 sdk, `--kind liquid`로 선택).
  const report = detectProjectKind(root)
  const decision = resolveDevMode(report.kind, options.kind)
  // 규약 밖 .liquid 는 어느 종류로 판정되든 조용히 무시된다 — 프리뷰를 띄우기 전에 짚는다.
  const ignored = ignoredLiquidNotice(report.ignoredLiquid)
  if (ignored !== null) console.log(`[bstage] ${pc.yellow('경고')}: ${ignored}\n`)
  if (decision.hint !== undefined) console.log(`[bstage] ${decision.hint}\n`)
  if (decision.mode === 'liquid') return await runLiquidPreview(root, port, options.phase)

  await runViteDevServer(root, port, options.phase)
}
