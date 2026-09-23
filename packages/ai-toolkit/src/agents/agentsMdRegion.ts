/**
 * AGENTS.md의 "SDK 관리 영역(managed region)" 마커와 조작 유틸.
 *
 * AGENTS.md는 두 부분으로 나뉜다.
 * - **관리 영역**: 마커(`BSTAGE:MANAGED:START`~`END`)로 감싼 SDK 저작 보일러플레이트.
 *   `bstage ai install|update` / `bstage-migrate` 스킬이 최신 템플릿으로 재생성하므로 직접 편집하면 안 된다.
 * - **자유 영역**: 마커 바깥(주로 END 이후). 프로젝트 고유 규칙을 적는 곳으로, 갱신이 건드리지 않는다.
 *
 * 이 분리 덕에 마이그레이션은 "관리 영역만 결정론적으로 치환"하면 되고, 사용자 내용은 보존된다.
 */

/**
 * 관리 영역 본문이 바뀔 때마다 올린다. doctor가 "마커는 있는데 버전이 낮다 → 갱신 필요"를
 * 결정론적으로 판단하는 근거. (본문은 space/projectName로 파라미터화되므로 내용 직접 비교 대신
 * 버전 토큰으로 staleness를 본다.)
 */
export const AGENTS_MANAGED_VERSION = 12

const START_MARKER = `<!-- BSTAGE:MANAGED:START v=${AGENTS_MANAGED_VERSION} — SDK가 관리하는 영역입니다. \`bstage ai install\` / \`bstage ai update\`가 재생성하므로 직접 편집하지 마세요(갱신 시 덮어쓰입니다). 프로젝트 고유 규칙은 아래 자유 영역에 적으세요. -->`
const END_MARKER = `<!-- BSTAGE:MANAGED:END -->`

// 마커 코멘트의 안내 문구가 바뀌어도 매칭되도록 토큰만 보고 찾는다.
const START_TOKEN = 'BSTAGE:MANAGED:START'
const END_TOKEN = 'BSTAGE:MANAGED:END'
const COMMENT_OPEN = '<!--'
const COMMENT_CLOSE = '-->'

/** 문자 하나짜리 검사라 백트래킹이 없다(아래 findMarker의 선형성 근거). */
const WS_RE = /\s/

/**
 * 마커 코멘트 한 개의 위치. `start`는 `<!--`의 인덱스, `end`는 `-->` 다음 인덱스,
 * `tokenEnd`는 토큰 바로 뒤(버전 파싱 시작점)다.
 */
interface MarkerMatch {
  start: number
  end: number
  tokenEnd: number
}

/**
 * `<!--` 자리마다 "공백을 건너뛴 다음이 `token`이고, 그 뒤에 `-->`가 있는가"를 보고 첫 마커를 찾는다.
 *
 * **정규식을 쓰지 않는 이유**: 예전에는 `/<!--\s*TOKEN(?:\s+v=(\d+))?[\s\S]*?-->/` 하나로 찾았는데,
 * `-->`가 없는 입력에서 `\d+`와 lazy `[\s\S]*?`가 서로 되짚어 **입력 길이의 제곱**으로 느려졌다
 * (`v=` 뒤 숫자 20만 자에 3.7초. 코드 스캔이 polynomial ReDoS로 지적한 지점이다).
 *
 * **선형인 이유**: 닫는 위치는 단조 증가하므로 이전에 찾아 둔 `close`가 현재 `open`보다 뒤면 다시
 * 찾지 않는다. 그래서 `-->` 탐색은 문자열 전체를 통틀어 한 번 훑는 비용이고, 공백 건너뛰기는 각
 * 코멘트가 자기 앞의 공백만 본다. 옛 정규식처럼 **모든 `<!--` 자리를 후보로 본다** — 앞에 닫히지
 * 않은 코멘트가 있어도 뒤의 마커를 찾는다(`from`을 `-->` 뒤로 건너뛰면 그 경우를 놓친다).
 */
function findMarker(content: string, token: string): MarkerMatch | null {
  let from = 0
  let close = -1
  for (;;) {
    const open = content.indexOf(COMMENT_OPEN, from)
    if (open < 0) return null
    const bodyStart = open + COMMENT_OPEN.length
    if (close < bodyStart) {
      close = content.indexOf(COMMENT_CLOSE, bodyStart)
      if (close < 0) return null // 남은 곳 어디에도 닫는 괄호가 없다 — 옛 정규식도 매칭 실패였다
    }
    let i = bodyStart
    while (i < close && WS_RE.test(content[i])) i++
    if (i + token.length <= close && content.startsWith(token, i)) {
      return { start: open, end: close + COMMENT_CLOSE.length, tokenEnd: i + token.length }
    }
    from = bodyStart
  }
}

/**
 * 토큰 바로 뒤의 `v=N`을 읽는다. 옛 정규식의 `(?:\s+v=(\d+))?`와 같은 조건이다 —
 * **공백이 하나 이상** 있고, 바로 `v=`가 오고, 숫자가 하나 이상일 때만 그 값이다. 아니면 0.
 */
function readVersionAfterToken(content: string, tokenEnd: number, limit: number): number {
  let i = tokenEnd
  const wsStart = i
  while (i < limit && WS_RE.test(content[i])) i++
  if (i === wsStart) return 0
  if (!content.startsWith('v=', i)) return 0
  i += 2
  let d = i
  while (d < limit && content[d] >= '0' && content[d] <= '9') d++
  if (d === i) return 0
  return parseInt(content.slice(i, d), 10)
}

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
  const m = findMarker(content, START_TOKEN)
  if (!m) return null
  return readVersionAfterToken(content, m.tokenEnd, m.end - COMMENT_CLOSE.length)
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
  const s = findMarker(existing, START_TOKEN)
  const e = findMarker(existing, END_TOKEN)
  if (!s || !e) return null
  const startIdx = s.start
  const endIdx = e.end
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
