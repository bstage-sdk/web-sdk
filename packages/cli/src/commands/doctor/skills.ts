import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  agentsMdStatus,
  parseAgentsIdentity,
  renderManagedBlock,
  skillsFor,
} from '@bstage-sdk/ai-toolkit'
import type { AgentsMdStatus, ProjectKind } from '@bstage-sdk/ai-toolkit'
import { resolveProjectTarget } from '../../constants.js'
import type { DetectedKind } from '../../project/detectKind.js'
import { aiInstallCommand } from '../ai.js'

export interface AgentsMdInfo {
  status: AgentsMdStatus
  /** 갱신이 필요한 경우(legacy/stale) 적용할 최신 관리 영역 블록. 마이그레이션 스킬이 reconcile에 쓴다. */
  managedBlock: string | null
}

/**
 * 에이전트 스킬 설치 상태.
 * - missing: `.claude/skills/{name}/SKILL.md` 없음 — 스킬이 한 번도 설치되지 않음
 * - stale: 파일은 있으나 이 CLI의 최신 템플릿과 내용이 다름(구버전 또는 수동 수정)
 * - ok: 최신
 *
 * 스킬은 SDK 소유 자산(`ai install`이 덮어씀)이므로 내용 불일치는 곧 동기화 대상이다.
 */
export type SkillStatus = 'missing' | 'stale' | 'ok'

export interface SkillRow {
  name: string
  status: SkillStatus
}

/**
 * 스킬 드리프트가 있으면 즉시 `ai install`로 동기화한다.
 *
 * 스킬은 SDK 소유 자산이라 동기화에 판단이 필요 없고(덮어쓰기가 계약), 사용자 파일은
 * 건드리지 않는다. AGENTS.md는 관리 영역 마커가 있을 때만 함께 갱신된다(ai install의
 * 기존 동작 — 레거시 파일은 보존하고 안내만 한다).
 *
 * **쓰기 범위는 SDK 소유 자산뿐이다.** `guard: false`로 불러 package.json·`.husky`는
 * 건드리지 않는다 — 진단 명령이 사용자가 부르지 않은 의존성·훅 변경을 남기면 안 된다.
 *
 * @internal 테스트가 직접 부른다(실제 진입점은 `doctorCommand`).
 */
export async function autoSyncSkills(
  root: string,
  report: { isBstageProject: boolean; skills: SkillRow[] },
): Promise<void> {
  if (!report.isBstageProject) return
  if (!report.skills.some((s) => s.status !== 'ok')) return

  // deprecated 별칭(`skills install`)이 아니라 실물 명령을 직접 부른다 — 별칭을 거치면
  // 사용자가 치지도 않은 명령의 제거 예고 경고가 doctor 출력에 섞인다.
  await aiInstallCommand({ dir: '.claude/skills', cwd: root, guard: false })
}

/**
 * 에이전트 스킬(`.claude/skills/`) 설치 상태를 진단한다.
 *
 * 비교 기준은 **실행 중인 CLI에 동봉된 최신 스킬 템플릿**이다. `npx @bstage-sdk/cli@latest doctor`로
 * 실행하면 항상 최신 스킬 대비로 진단된다(MIGRATION.md를 CLI 쪽에서 읽는 것과 같은 이유).
 */
export async function diagnoseSkills(root: string, kind: ProjectKind): Promise<SkillRow[]> {
  // 디자인 가이드 타깃을 맞춰 비교해야 어드민 프로젝트가 오탐(stale)되지 않는다.
  const target = resolveProjectTarget(root)
  return Promise.all(
    skillsFor(kind).map(async (skill): Promise<SkillRow> => {
      let installed: string
      try {
        installed = await readFile(join(root, '.claude', 'skills', skill.name, 'SKILL.md'), 'utf-8')
      } catch {
        return { name: skill.name, status: 'missing' }
      }
      return {
        name: skill.name,
        status: installed === skill.content({ kind, target }) ? 'ok' : 'stale',
      }
    }),
  )
}

/**
 * 스킬 검사에 쓸 프로젝트 종류를 정한다. 판정 규칙은 포털 빌더와 같은 `detectProjectKind`다.
 * `unknown`(아직 템플릿이 하나도 없는 새 레포 등)은 sdk로 본다 — 스캐폴드가 내는 기본값이다.
 * `mixed`는 어느 세트가 맞는지 정할 수 없어 검사를 건너뛴다(`null`).
 */
export function resolveSkillKind(detected: DetectedKind): ProjectKind | null {
  if (detected === 'mixed') return null
  return detected === 'liquid' ? 'liquid' : 'sdk'
}

/**
 * AGENTS.md 관리 영역 상태를 진단한다.
 * - missing: 파일 없음
 * - legacy: 관리 영역 마커 없음(마커 도입 전 파일) → 마이그레이션 스킬 reconcile 필요
 * - stale: 마커 있으나 관리 영역 버전이 낮음 → `ai update`로 갱신 가능
 * - ok: 최신
 *
 * legacy/stale이면 적용할 최신 관리 영역 블록을 함께 담아, 마이그레이션 스킬이 reconcile에 쓴다.
 */
export async function diagnoseAgentsMd(
  root: string,
  pkgName: string | null,
): Promise<AgentsMdInfo> {
  let content: string
  try {
    content = await readFile(join(root, 'AGENTS.md'), 'utf-8')
  } catch {
    return { status: 'missing', managedBlock: null }
  }

  const status = agentsMdStatus(content)
  if (status === 'ok') return { status, managedBlock: null }

  // 프로젝트 정체성 보존(없으면 레포명 규칙으로 fallback).
  const parsed = parseAgentsIdentity(content)
  const projectName = parsed.projectName ?? pkgName ?? 'custom-templates'
  const space = parsed.space ?? projectName.split('-custom-templates-')[0] ?? projectName
  const target = resolveProjectTarget(root)
  return { status, managedBlock: renderManagedBlock({ space, projectName, target }) }
}
