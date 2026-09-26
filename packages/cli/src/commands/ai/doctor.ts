import pc from 'picocolors'
import {
  BSTAGE_SKILLS,
  VERSION,
  readManagedVersion,
  readSkillStamp,
  skillFilePath,
  skillsFor,
} from '@bstage-sdk/ai-toolkit'
import type { InstallAction } from '@bstage-sdk/ai-toolkit'
import { table } from '../../portal/output.js'
import type { AiContext } from './context.js'

/** 스킬 한 건의 진단 상태. `extra`는 이 kind의 스킬이 아닌데 설치돼 있는 경우(지우지 않는다). */
export type SkillStatus = 'ok' | 'stale' | 'missing' | 'extra'
export type FileStatus = 'ok' | 'stale' | 'legacy' | 'missing'

export interface SkillDiagnosis {
  name: string
  status: SkillStatus
  /** 설치본의 스탬프 버전. 미설치·스탬프 없음은 null(상태 판정 근거는 아니다 — 본문 비교가 정한다). */
  installed: string | null
}

export interface Diagnosis {
  kind: string
  toolkitVersion: string
  skills: SkillDiagnosis[]
  agentsMd: { status: FileStatus; version: number | null }
  claudeMd: { status: 'ok' | 'missing' }
}

const SKILL_STATUS_BY_REASON: Record<string, SkillStatus> = {
  create: 'missing',
  stale: 'stale',
  keep: 'ok',
}

const FILE_STATUS_BY_REASON: Record<string, FileStatus> = {
  create: 'missing',
  update: 'stale',
  legacy: 'legacy',
  keep: 'ok',
}

/**
 * 진단은 install이 세운 계획을 그대로 읽는다 — 별도 판정 로직을 두면 "doctor는 ok인데
 * install은 덮어쓴다"가 생긴다.
 */
export function diagnose(ctx: AiContext): Diagnosis {
  const byPath = new Map(ctx.actions.map((a) => [a.path, a] as const))
  const at = (path: string): InstallAction | undefined => byPath.get(path)
  const owned = new Set(skillsFor(ctx.kind).map((s) => s.name))
  const installed = ctx.input.existing.skills

  const skills = BSTAGE_SKILLS.filter((s) => owned.has(s.name) || s.name in installed).map(
    (s): SkillDiagnosis => {
      const action = at(skillFilePath(ctx.skillsDir, s.name))
      const status = owned.has(s.name)
        ? (SKILL_STATUS_BY_REASON[action?.reason ?? 'create'] ?? 'missing')
        : 'extra'
      // 표시는 계속 스탬프 값이다 — 상태(stale)는 본문 비교가 정하고, 스탬프는 "어느 버전에서
      // 나온 설치본인가"만 알려 준다.
      const content = installed[s.name]
      return {
        name: s.name,
        status,
        installed: content === undefined ? null : readSkillStamp(content),
      }
    },
  )

  const agentsReason = at('AGENTS.md')?.reason ?? 'create'
  const content = ctx.input.existing.agentsMd
  return {
    kind: ctx.kind,
    toolkitVersion: VERSION,
    skills,
    agentsMd: {
      status: FILE_STATUS_BY_REASON[agentsReason] ?? 'missing',
      version: content === null ? null : readManagedVersion(content),
    },
    claudeMd: { status: at('CLAUDE.md')?.reason === 'keep' ? 'ok' : 'missing' },
  }
}

/** 전부 ok인가 — 종료코드(0 vs 2)의 근거. */
/**
 * `extra`(현재 종류에 속하지 않는 SDK 스킬이 남아 있음)는 경고일 뿐 실패가 아니다 — 파일을
 * 지우지 않는 것이 설계라, 실패로 치면 사람이 손으로 지울 때까지 CI가 계속 빨간불이 된다.
 */
export function isHealthy(d: Diagnosis): boolean {
  return !d.skills.some(skillNeedsWork) && d.agentsMd.status === 'ok' && d.claudeMd.status === 'ok'
}

/** 설치·갱신으로 풀리는 스킬 상태인가. `extra`는 경고일 뿐이라 여기서 빠진다(위 주석 참고). */
function skillNeedsWork(s: Diagnosis['skills'][number]): boolean {
  return s.status !== 'ok' && s.status !== 'extra'
}

/**
 * 갱신 안내 문구. **`legacy`는 `install`·`update`로 풀리지 않는다** — 마커 없는 AGENTS.md는 두
 * 명령 모두 건드리지 않으므로, 그 두 개만 안내하면 몇 번을 돌려도 상태가 그대로인 안내가 된다
 * (종료 코드도 계속 2다). 그 경우에는 reconcile 경로를 가리킨다.
 */
export function remedy(d: Diagnosis): string {
  const legacy = d.agentsMd.status === 'legacy'
  // `isHealthy`와 같은 술어를 쓴다 — `extra`를 여기서 문제로 세면, kind 밖 스킬이 남은 레거시
  // 레포가 다시 "install·update 하세요"만 듣게 된다(둘 다 그 상태를 바꾸지 못한다).
  const others =
    d.skills.some(skillNeedsWork) ||
    d.claudeMd.status !== 'ok' ||
    (d.agentsMd.status !== 'ok' && !legacy)
  if (legacy && !others) {
    return 'AGENTS.md의 관리 영역 마커를 찾지 못했거나 알아볼 수 없습니다 — `bstage ai install`·`update`는 이 파일을 건드리지 않습니다. bstage-migrate 스킬로 기존 내용과 합치세요.'
  }
  if (legacy) {
    return '갱신이 필요한 항목이 있습니다 — `bstage ai install`(없는 파일 포함) 또는 `bstage ai update`. AGENTS.md는 관리 영역 마커를 알아볼 수 없어 두 명령이 건드리지 않으니 bstage-migrate 스킬로 합치세요.'
  }
  return '갱신이 필요한 항목이 있습니다 — `bstage ai install`(없는 파일 포함) 또는 `bstage ai update`.'
}

/**
 * 표는 색을 입히지 않는다 — `table()`이 문자열 길이로 열 폭을 맞추는데 ANSI escape가 섞이면
 * 폭 계산이 어긋나 열이 밀린다. 강조는 표 아래 요약 줄이 맡는다.
 */
export function renderDoctor(d: Diagnosis): string {
  const rows = [
    ['항목', '상태', '비고'],
    ['kind', d.kind, `toolkit ${d.toolkitVersion}`],
    ...d.skills.map((s) => [s.name, s.status, s.installed ?? '-']),
    ['AGENTS.md', d.agentsMd.status, d.agentsMd.version === null ? '-' : `v${d.agentsMd.version}`],
    ['CLAUDE.md', d.claudeMd.status, '-'],
  ]
  const summary = isHealthy(d) ? pc.green('모두 최신입니다.') : pc.yellow(remedy(d))
  return `${table(rows)}\n${summary}`
}
