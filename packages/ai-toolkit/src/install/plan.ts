import { agentsMd, renderManagedBlock } from '../agents/agentsMd.js'
import { agentsMdStatus, parseAgentsIdentity, swapManagedBlock } from '../agents/agentsMdRegion.js'
import { claudeMd } from '../agents/claudeMd.js'
import { sanitizeIdentity } from '../agents/identity.js'
import { BSTAGE_SKILLS, skillsFor } from '../skills/registry.js'
import type { DesignTarget, ProjectKind } from '../skills/registry.js'
import { readSkillStamp } from '../skills/stamp.js'
import { VERSION } from '../version.js'

/** 설치 계획을 세우는 데 필요한 프로젝트 상태 스냅샷. 파일 I/O는 호출부(CLI)가 한다. */
export interface InstallInput {
  kind: ProjectKind
  target: DesignTarget
  space: string
  projectName: string
  /** 스킬 디렉터리 기준 경로(기본 '.claude/skills') */
  skillsDir: string
  existing: {
    /**
     * 스킬명 → 설치된 `SKILL.md`의 **파일 전체 내용**(파일이 없으면 키를 넣지 않는다).
     * 스탬프만 받으면 손으로 고친 본문이 최신 스탬프를 달고 keep으로 새어 나간다.
     */
    skills: Record<string, string>
    /** AGENTS.md 파일 내용, 없으면 null */
    agentsMd: string | null
    /** CLAUDE.md 파일 내용, 없으면 null */
    claudeMd: string | null
  }
}

/**
 * 액션의 이유.
 * - `create` 없던 파일을 만든다 · `update` 기존 파일의 일부를 치환한다
 * - `stale` 설치본이 현재 본문과 달라 통째로 다시 쓴다(옛 버전 또는 손수정) · `keep` 손대지 않는다
 * - `legacy` 판단이 필요해 자동으로 건드리지 않는다(안내만)
 */
export type ActionReason = 'create' | 'update' | 'stale' | 'keep' | 'legacy'

export interface InstallAction {
  /** 프로젝트 루트 기준 상대 경로 */
  path: string
  /** 쓸 내용. null이면 쓰지 않는다(keep·legacy). */
  content: string | null
  reason: ActionReason
  /** 사용자에게 알릴 한 줄(있을 때만) */
  note?: string
}

const AGENTS_FILE = 'AGENTS.md'
const CLAUDE_FILE = 'CLAUDE.md'

const LEGACY_NOTE = '관리 영역 마커 없음 — bstage-migrate 스킬로 reconcile'

const HAND_EDIT_NOTE = '버전은 같은데 본문이 다릅니다(손수정) — SDK 본문으로 되돌립니다.'

/**
 * 설치·갱신할 파일 목록을 정한다. 순수 함수 — 파일을 읽지도 쓰지도 않는다.
 *
 * 이 함수가 유일한 판단 지점이다. `bstage ai install`·`update`·`doctor`가 모두 같은 계획을
 * 만들고 소비만 다르게 하므로, "doctor는 ok인데 install은 덮어쓴다" 같은 어긋남이 생기지 않는다.
 */
export function planInstall(input: InstallInput): InstallAction[] {
  const actions = [...planSkills(input), planAgentsMd(input), planClaudeMd(input.existing.claudeMd)]
  // 결정론: 경로 오름차순(입력 배열을 바꾸지 않도록 새 배열에 정렬).
  return [...actions].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

/** `${skillsDir}/${name}/SKILL.md` — 경로 규약은 여기 한 곳. */
export function skillFilePath(skillsDir: string, name: string): string {
  return `${skillsDir}/${name}/SKILL.md`
}

function planSkills(input: InstallInput): InstallAction[] {
  const { kind, target, skillsDir, existing } = input
  const owned = skillsFor(kind)
  const ownedNames = new Set(owned.map((s) => s.name))

  const wanted = owned.map((skill): InstallAction => {
    const path = skillFilePath(skillsDir, skill.name)
    const rendered = skill.content({ kind, target })
    const installed = existing.skills[skill.name]
    if (installed === undefined) return { path, content: rendered, reason: 'create' }
    // 스탬프가 아니라 **내용**으로 판정한다 — 스탬프가 최신이어도 손으로 고친 본문은 드리프트다.
    if (installed === rendered) return { path, content: null, reason: 'keep' }
    // 스탬프까지 최신이면 버전업이 아니라 손수정이다. 덮어쓰는 이유를 한 줄로 알린다.
    if (readSkillStamp(installed) === VERSION) {
      return { path, content: rendered, reason: 'stale', note: HAND_EDIT_NOTE }
    }
    return { path, content: rendered, reason: 'stale' }
  })

  // kind 밖 스킬은 지우지 않는다 — 사용자가 일부러 남겼을 수 있고, 삭제는 되돌릴 수 없다.
  const extras = BSTAGE_SKILLS.filter(
    (s) => !ownedNames.has(s.name) && s.name in existing.skills,
  ).map(
    (s): InstallAction => ({
      path: skillFilePath(skillsDir, s.name),
      content: null,
      reason: 'keep',
      note: `이 프로젝트 종류(${kind})의 스킬이 아닙니다 — 지우지 않습니다. 필요 없으면 직접 삭제하세요.`,
    }),
  )

  return [...wanted, ...extras]
}

function planAgentsMd(input: InstallInput): InstallAction {
  const { kind, target, space, projectName, existing } = input
  const current = existing.agentsMd
  if (current === null) {
    return {
      path: AGENTS_FILE,
      content: agentsMd({ space, projectName, target, kind }),
      reason: 'create',
    }
  }

  const status = agentsMdStatus(current)
  if (status === 'legacy') {
    return { path: AGENTS_FILE, content: null, reason: 'legacy', note: LEGACY_NOTE }
  }
  if (status === 'ok') return { path: AGENTS_FILE, content: null, reason: 'keep' }

  // 프로젝트 정체성은 기존 파일 값을 우선한다 — 입력값은 폴백일 뿐이다(사용자가 고쳐 둔 값 보존).
  // 단 기존 파일 값도 규칙을 통과해야 한다 — 훼손된 AGENTS.md가 위조 마커를 관리 영역에
  // 다시 심는 경로를 여기서 끊는다.
  const identity = parseAgentsIdentity(current)
  const block = renderManagedBlock({
    space: sanitizeIdentity(identity.space) ?? space,
    projectName: sanitizeIdentity(identity.projectName) ?? projectName,
    target,
    kind,
  })
  const swapped = swapManagedBlock(current, block)
  if (swapped === null) {
    // 마커 판정과 어긋나는 예외 상황 — 안전하게 건드리지 않는다.
    return { path: AGENTS_FILE, content: null, reason: 'legacy', note: LEGACY_NOTE }
  }
  return { path: AGENTS_FILE, content: swapped, reason: 'update' }
}

/** CLAUDE.md는 한 줄 포인터일 뿐이고 그 뒤는 사용자 것이다 — 있으면 내용 불문 손대지 않는다. */
function planClaudeMd(current: string | null): InstallAction {
  if (current === null) return { path: CLAUDE_FILE, content: claudeMd(), reason: 'create' }
  return { path: CLAUDE_FILE, content: null, reason: 'keep' }
}
