import { describe, expect, it } from 'vitest'
import { resolveTemplateName } from './init.js'

/**
 * 이 분기는 릴리즈 전 손 검증이 지나가지 않는다 — 손 검증은 대화형 `bstage init`으로
 * 템플릿 이름을 직접 입력하는 경로만 태운다. `--yes`에서 `--template`을 생략하는 갈래는
 * 아무도 지나가지 않아, commander 기본값 `'hello'`가 Custom Element 검증에 걸려
 * **비대화형 스캐폴드가 계속 실패하는데도 드러나지 않았다.**
 *
 * 그래서 여기서 보는 것은 "파생 기본값이 Custom Element 스펙을 만족하는가"다.
 */

/** init·build가 공유하는 Custom Element 스펙(두 곳에 같은 정규식이 있다). */
const ELEMENT_NAME_RE = /^[a-z][a-z0-9-]*-[a-z0-9-]*$/
/** init이 `--space`에 허용하는 범위 — 대문자를 받는다는 점이 위 스펙과 어긋난다. */
const SPACE_RE = /^[a-zA-Z][a-zA-Z0-9-]*$/

describe('resolveTemplateName', () => {
  it('명시값이 있으면 그대로 쓴다', () => {
    expect(resolveTemplateName('my-space', 'my-space-banner')).toBe('my-space-banner')
  })

  it('생략하면 space에서 파생한다', () => {
    expect(resolveTemplateName('my-space', undefined)).toBe('my-space-hello')
  })

  it('대문자 space를 소문자로 내린다 — Custom Element 스펙이 소문자만 받는다', () => {
    expect(resolveTemplateName('MySpace', undefined)).toBe('myspace-hello')
  })

  it.each(['bmf', 'my-space', 'MySpace', 'A', 'x9', 'Team-42'])(
    '허용되는 space "%s"에서 파생한 기본값이 Custom Element 스펙을 만족한다',
    (space) => {
      expect(SPACE_RE.test(space)).toBe(true) // 전제: init이 받아주는 값
      expect(ELEMENT_NAME_RE.test(resolveTemplateName(space, undefined))).toBe(true)
    },
  )
})
