import { VERSION } from '../version.js'

/**
 * 설치된 SKILL.md가 어느 toolkit 버전에서 나왔는지 남기는 스탬프.
 *
 * frontmatter 바로 다음 줄에 한 줄로 넣는다 — 본문을 읽는 에이전트에게는 주석이라 보이지 않는다.
 * stale 판정 자체는 **본문 전체 비교**가 하고(손수정 드리프트까지 잡으려면 그래야 한다),
 * 이 스탬프는 `bstage ai doctor`가 "어느 버전에서 나온 설치본인가"를 보여 주는 데 쓴다.
 */
const STAMP_LINE_RE = /^<!--\s*bstage-ai-toolkit\s+(\S+)\s*-->$/

/** frontmatter 블록(`---` ~ `---`)과 그 뒤 개행까지. */
const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n/

/** 스탬프 한 줄. */
export function skillStamp(version: string = VERSION): string {
  return `<!-- bstage-ai-toolkit ${version} -->`
}

/**
 * 스킬 본문의 frontmatter 바로 다음 줄에 버전 스탬프를 끼워 넣는다.
 * frontmatter가 없으면 넣을 자리가 정해지지 않으므로 던진다(조용히 앞에 붙이면 frontmatter가 깨진다).
 */
export function withStamp(body: string): string {
  const m = FRONTMATTER_RE.exec(body)
  if (!m) {
    throw new Error(
      '스킬 본문에 frontmatter(---)가 없어 버전 스탬프를 넣을 자리를 찾지 못했습니다.',
    )
  }
  return `${m[0]}${skillStamp()}\n${body.slice(m[0].length)}`
}

/**
 * 설치된 SKILL.md에서 스탬프 버전을 읽는다. 스탬프가 없으면 null(스탬프 도입 전 설치본).
 *
 * **자리를 고정해서 본다** — frontmatter를 닫는 `---` 다음의 첫 비어 있지 않은 줄만 후보로 삼고,
 * 그 줄 전체가 스탬프일 때만 인정한다. 본문 어디서든 찾으면 스킬이 스탬프 형식을 예시로 인용하거나
 * 사용자가 아래쪽에 옛 스탬프를 남겨 둔 것을 설치 버전으로 오독해, stale한 설치본이 최신으로 보인다.
 */
export function readSkillStamp(content: string): string | null {
  const m = FRONTMATTER_RE.exec(content)
  if (!m) return null
  const firstLine = content
    .slice(m[0].length)
    .split('\n')
    .find((line) => line.trim() !== '')
  if (firstLine === undefined) return null
  return STAMP_LINE_RE.exec(firstLine.trim())?.[1] ?? null
}
