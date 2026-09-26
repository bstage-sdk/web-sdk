import pc from 'picocolors'
import { ExitCode, fail, printJson } from '../portal/output.js'
import { INSTALL_REASONS, UPDATE_REASONS, actionLine, applyActions } from './ai/apply.js'
import { diagnose, isHealthy, remedy, renderDoctor } from './ai/doctor.js'
import { resolveAiContext } from './ai/context.js'
import { installGuardHook } from './ai/guard.js'
import type { AiContext, AiDeps, AiOptions } from './ai/context.js'

export type { AiOptions, AiDeps } from './ai/context.js'

function header(ctx: AiContext, verb: string): string {
  return (
    pc.cyan(`[bstage] ai ${verb}: ${ctx.skillsDir}/`) +
    pc.dim(` (kind: ${ctx.kind}, 디자인 타깃: ${ctx.target})`)
  )
}

/**
 * `bstage ai install` — 에이전트용 스킬·AGENTS.md·CLAUDE.md를 설치·최신화하고
 * pre-commit 시크릿 가드를 건다.
 *
 * 무엇을 쓸지는 ai-toolkit의 `planInstall`이 정한다(여기서는 계획을 실행만 한다).
 * 사용자 파일(자유 영역·CLAUDE.md·kind 밖 스킬)은 계획 단계에서 이미 보호된다.
 *
 * `guard: false`면 가드 설치를 건너뛴다 — 진단 경로(doctor 자동 동기화)가 사용자
 * package.json·`.husky`를 고치지 않게 하기 위한 것이다.
 */
export async function aiInstallCommand(o: AiOptions, deps: AiDeps = {}): Promise<void> {
  const out = deps.out ?? console.log
  const ctx = resolveAiContext(o, out)
  out(header(ctx, 'install'))

  const written = new Set(applyActions(ctx.root, ctx.actions, INSTALL_REASONS))
  for (const action of ctx.actions) out(actionLine(action, written.has(action)))

  if (o.guard === false) {
    // doctor 같은 진단 경로 — 사용자 package.json·.husky는 건드리지 않는다.
    out(pc.dim('  · pre-commit 시크릿 가드는 `bstage ai install`로 설치하세요.'))
  } else {
    const guard = installGuardHook(ctx.root, out)
    if (!guard.installed) {
      out(
        pc.yellow(
          `  ! pre-commit 시크릿 가드를 설치하지 못했습니다: ${guard.reason} — 수동 설치: \`bstage ai install\`을 package.json이 있는 프로젝트 루트에서 실행하세요.`,
        ),
      )
    }
  }
  out(pc.dim(`  Claude Code가 ${ctx.skillsDir}/ 의 스킬을 자동 인식합니다.`))
}

/**
 * `bstage ai update` — 이미 설치된 자산만 최신화한다.
 *
 * 없는 파일은 만들지 않는다 — "최신화"를 부른 사용자가 새 파일이 생기는 걸 기대하지 않기
 * 때문이다(가드 훅도 건드리지 않는다). 없는 것은 install로 안내한다.
 */
export async function aiUpdateCommand(o: AiOptions, deps: AiDeps = {}): Promise<void> {
  const out = deps.out ?? console.log
  const ctx = resolveAiContext(o, out)
  out(header(ctx, 'update'))

  const written = new Set(applyActions(ctx.root, ctx.actions, UPDATE_REASONS))
  for (const action of ctx.actions) {
    if (action.reason === 'create') {
      out(pc.dim(`  · ${action.path} (없음) — \`bstage ai install\`로 설치하세요.`))
      continue
    }
    out(actionLine(action, written.has(action)))
  }
}

/**
 * `bstage ai doctor` — 설치 상태만 진단한다(파일 수정 없음).
 * 전부 최신이면 0, 하나라도 어긋나면 사전조건(2)으로 끝난다 — CI가 분기할 수 있게.
 */
export async function aiDoctorCommand(o: AiOptions, deps: AiDeps = {}): Promise<void> {
  const out = deps.out ?? console.log
  // `--json`은 순수 리포트 계약이라 경고 한 줄도 stdout에 섞지 않는다.
  const ctx = resolveAiContext(o, o.json ? () => {} : out)
  const d = diagnose(ctx)

  if (o.json) printJson(d)
  else out(renderDoctor(d))

  if (!isHealthy(d)) {
    fail(ExitCode.PRECONDITION, remedy(d))
  }
}
