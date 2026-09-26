import { constants, copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import pc from 'picocolors'
import type { ActionReason, InstallAction } from '@bstage-sdk/ai-toolkit'
import { ExitCode, fail } from '../../portal/output.js'
import { assertWritableInRoot, lstatOrNull, resolveInRoot, writeFileNoFollow } from './safeWrite.js'

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
    writeFileNoFollow(file, content)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    fail(ExitCode.FAILURE, `${file} 쓰기 실패: ${message}`)
  }
}

/**
 * 덮기 전 본문을 `<path>.bak`에 남긴다. 백업 경로도 루트 안이어야 하고, 그 자리에 심볼릭 링크가
 * 있으면 따라 쓰지 않는다 — 레포 안의 링크 하나로 루트 밖 파일을 덮는 경로가 되기 때문이다.
 * 일반 파일이면 지우고 배타 생성으로 다시 만든다(그 사이 생긴 것도 따라 쓰지 않게).
 */
function writeBackup(root: string, relative: string, source: string): void {
  const backup = resolveInRoot(root, `${relative}.bak`)
  assertWritableInRoot(root, backup)
  const existing = lstatOrNull(backup)
  try {
    if (existing) rmSync(backup)
    copyFileSync(source, backup, constants.COPYFILE_EXCL)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    fail(ExitCode.FAILURE, `${backup} 쓰기 실패: ${message}`)
  }
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
    const target = resolveInRoot(root, action.path)
    // 문자열로 루트 안이어도 대상이나 중간 디렉터리가 링크면 쓰기가 루트 밖으로 새어 나간다.
    assertWritableInRoot(root, target)
    // 손수정 본문은 덮기 전에 남긴다. 복사 실패는 쓰기 실패와 같은 규칙으로 멈춘다 — 백업 없이
    // 덮어쓰는 것이 이 표시의 목적과 반대이기 때문이다.
    if (action.backup && existsSync(target)) writeBackup(root, action.path, target)
    writeFile(target, action.content)
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
