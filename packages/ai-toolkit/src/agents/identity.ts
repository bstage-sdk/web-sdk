/**
 * AGENTS.md 관리 영역에 그대로 박히는 값(프로젝트명·space)의 허용 규칙.
 *
 * 한 줄 · 1~100자 · `[A-Za-z0-9._@/-]`만(스코프 패키지명 허용). 남의 레포 package.json이나
 * 이미 훼손된 AGENTS.md가 개행·위조 마커를 실어 에이전트가 읽는 지시문에 끼어드는 경로를
 * 막는다. 값을 **고쳐서 쓰지 않는다** — 고친 값은 출처를 잃으므로 규칙 밖이면 null 로 돌려
 * 호출부가 폴백을 고르게 한다.
 */
const IDENTITY_RE = /^[A-Za-z0-9._@/-]{1,100}$/
const IDENTITY_FORBIDDEN = ['<!--', '-->', 'BSTAGE:MANAGED']

/** 규칙에 맞으면 그대로, 아니면 null. */
export function sanitizeIdentity(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  if (!IDENTITY_RE.test(value)) return null
  if (IDENTITY_FORBIDDEN.some((token) => value.includes(token))) return null
  return value
}
