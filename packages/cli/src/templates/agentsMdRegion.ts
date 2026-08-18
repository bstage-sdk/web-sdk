/**
 * AGENTS.md의 "SDK 관리 영역(managed region)" 마커와 조작 유틸.
 *
 * AGENTS.md는 두 부분으로 나뉜다.
 * - **관리 영역**: 마커(`BSTAGE:MANAGED:START`~`END`)로 감싼 SDK 저작 보일러플레이트.
 *   `bstage skills install` / `bstage migrate`가 최신 템플릿으로 재생성하므로 직접 편집하면 안 된다.
 * - **자유 영역**: 마커 바깥(주로 END 이후). 프로젝트 고유 규칙을 적는 곳으로, 갱신이 건드리지 않는다.
 *
 * 이 분리 덕에 마이그레이션은 "관리 영역만 결정론적으로 치환"하면 되고, 사용자 내용은 보존된다.
 */

/**
 * 관리 영역 본문이 바뀔 때마다 올린다. doctor가 "마커는 있는데 버전이 낮다 → 갱신 필요"를
 * 결정론적으로 판단하는 근거. (본문은 space/projectName로 파라미터화되므로 내용 직접 비교 대신
 * 버전 토큰으로 staleness를 본다.)
 */
export const AGENTS_MANAGED_VERSION = 10

const START_MARKER = `<!-- BSTAGE:MANAGED:START v=${AGENTS_MANAGED_VERSION} — SDK가 관리하는 영역입니다. \`bstage skills install\` / \`bstage migrate\`가 재생성하므로 직접 편집하지 마세요(갱신 시 덮어쓰입니다). 프로젝트 고유 규칙은 아래 자유 영역에 적으세요. -->`
const END_MARKER = `<!-- BSTAGE:MANAGED:END -->`

// 마커 코멘트의 안내 문구가 바뀌어도 매칭되도록 토큰만 보고 찾는다.
const START_RE = /<!--\s*BSTAGE:MANAGED:START(?:\s+v=(\d+))?[\s\S]*?-->/
const END_RE = /<!--\s*BSTAGE:MANAGED:END[\s\S]*?-->/

const FREE_REGION_NOTE = `<!-- 아래는 프로젝트 자유 영역입니다. SDK 마이그레이션이 보존합니다. 이 프로젝트만의 규칙·컨텍스트를 여기에 적으세요. -->`

/** 본문을 관리 영역 마커로 감싼다. */
export function wrapManaged(body: string): string {
  return `${START_MARKER}\n${body}\n${END_MARKER}`
}

/** init이 새 프로젝트에 까는 기본 자유 영역 스캐폴드(빈 섹션). */
export function freeRegionScaffold(): string {
  return `${FREE_REGION_NOTE}\n\n## 프로젝트 규칙\n\n<!-- 이 프로젝트만의 규칙·컨텍스트를 여기에 작성하세요. -->\n`
}

export type AgentsMdStatus = 'missing' | 'legacy' | 'stale' | 'ok'

/**
 * 관리 영역의 버전을 읽는다.
 * - 마커 없음 → null (레거시: 마커 도입 전 파일)
 * - 마커 있는데 v= 없음 → 0
 * - v=N → N
 */
export function readManagedVersion(content: string): number | null {
  const m = START_RE.exec(content)
  if (!m) return null
  return m[1] ? parseInt(m[1], 10) : 0
}

/** AGENTS.md 내용으로 갱신 상태를 판정한다. */
export function agentsMdStatus(content: string): Exclude<AgentsMdStatus, 'missing'> {
  const v = readManagedVersion(content)
  if (v === null) return 'legacy'
  return v < AGENTS_MANAGED_VERSION ? 'stale' : 'ok'
}

/**
 * 기존 파일의 관리 영역(START~END)을 새 블록으로 치환한다. START/END 바깥(자유 영역 등)은
 * 그대로 보존한다. 마커가 없으면(레거시) null을 반환 — 호출부가 reconcile 경로로 분기한다.
 */
export function swapManagedBlock(existing: string, newWrappedBlock: string): string | null {
  const s = START_RE.exec(existing)
  const e = END_RE.exec(existing)
  if (!s || !e) return null
  const startIdx = s.index
  const endIdx = e.index + e[0].length
  if (endIdx <= startIdx) return null
  return existing.slice(0, startIdx) + newWrappedBlock + existing.slice(endIdx)
}

/**
 * 기존 AGENTS.md에서 프로젝트 정체성(space/projectName)을 파싱한다.
 * 관리 영역을 새로 렌더링할 때 프로젝트 고유 값을 보존하기 위해 사용한다.
 */
export function parseAgentsIdentity(content: string): {
  space?: string
  projectName?: string
} {
  const space = /\*\*Space\*\*:\s*([A-Za-z0-9-]+)/.exec(content)?.[1]
  const projectName = /\*\*레포\*\*:\s*`([^`]+)`/.exec(content)?.[1]
  return { space, projectName }
}
