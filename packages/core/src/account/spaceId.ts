/** 스페이스 id 형식 — 영숫자로 시작하는 영숫자·하이픈·밑줄 64자 이하. */
const SPACE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

/** `spaceInfo().id`로 돌려줄 수 있는 값인가. 쿠키·`__NEXT_DATA__`·init 어느 출처든 이 검사를 지나야 한다. */
export function validSpaceId(value: unknown): string | undefined {
  return typeof value === 'string' && SPACE_ID_RE.test(value) ? value : undefined
}
