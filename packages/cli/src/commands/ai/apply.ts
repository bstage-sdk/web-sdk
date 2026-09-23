import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import pc from 'picocolors'
import type { ActionReason, InstallAction } from '@bstage-sdk/ai-toolkit'
import { ExitCode, fail } from '../../portal/output.js'

/** 사람이 읽는 결말 낱말. 계획의 이유를 그대로 노출하지 않고 한 낱말로 줄인다. */
const LABEL: Record<ActionReason, string> = {
  create: '생성',
  update: '갱신',
  stale: '갱신',
  keep: '최신',
  legacy: '레거시(안내)',
}

/** 실제로 파일을 쓰는 이유들. install은 셋 다, update는 이미 있는 파일만(create 제외). */
export const INSTALL_REASONS: ActionReason[] = ['create', 'update', 'stale']
export const UPDATE_REASONS: ActionReason[] = ['update', 'stale']

/**
 * 파일 한 건을 쓴다. 실패하면 **어느 파일에서 멈췄는지**를 담아 종료한다 — 여러 파일을 순서대로
 * 쓰는 중이라 raw 스택만 나오면 부분 설치 상태에서 어디까지 됐는지 알 수 없다.
 */
function writeFile(file: string, content: string): void {
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, content, 'utf-8')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    fail(ExitCode.FAILURE, `${file} 쓰기 실패: ${message}`)
  }
}

/**
 * 쓰기 대상이 프로젝트 루트 안인지 확인한다. `--dir`가 절대 경로나 `..`를 들고 오면
 * 루트 밖에 파일이 생긴다 — 계획 단계에서도 막지만 쓰기 직전이 마지막 관문이다.
 */
function resolveInRoot(root: string, relative: string): string {
  const base = resolve(root)
  const target = resolve(base, relative)
  if (target === base || !target.startsWith(base + sep)) {
    fail(ExitCode.PRECONDITION, `스킬 디렉터리는 프로젝트 안이어야 합니다: ${relative}`)
  }
  return target
}

/**
 * 계획 중 주어진 이유에 해당하는 액션만 파일로 쓴다.
 * content가 null인 액션은 어떤 경우에도 쓰지 않는다(keep·legacy 보호).
 */
export function applyActions(
  root: string,
  actions: InstallAction[],
  reasons: ActionReason[],
): InstallAction[] {
  const allowed = new Set(reasons)
  const written: InstallAction[] = []
  for (const action of actions) {
    if (!allowed.has(action.reason) || action.content === null) continue
    writeFile(resolveInRoot(root, action.path), action.content)
    written.push(action)
  }
  return written
}

/** 액션 한 건을 한 줄로. 쓰지 않은 항목도 상태를 보여 준다(무엇이 최신인지 알 수 있게). */
export function actionLine(action: InstallAction, applied: boolean): string {
  const label = LABEL[action.reason]
  const note = action.note ? pc.dim(` — ${action.note}`) : ''
  const body = `${action.path} (${label})`
  if (action.reason === 'legacy') return pc.yellow(`  ! ${body}`) + note
  if (applied) return pc.green(`  ✓ ${body}`) + note
  return pc.dim(`  · ${body}`) + note
}
