import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveTextStyle } from './text-style.js'
import type { TypographyValue } from './types.js'

/**
 * 토큰 문자열을 손으로 쪼개 해석하는 코드라 오타가 조용히 흘러간다. 특히 weight는 타입으로만
 * 막혀 있는데 `bstage build`가 `tsc`를 타지 않아 런타임까지 도달한다.
 *
 * 토큰 데이터에 의존하지 않도록 generated 토큰 대신 최소 맵을 직접 넘긴다.
 */

const typo = (fontSize: string): TypographyValue => ({
  fontSize,
  lineHeight: '1.5',
  letterSpacing: '0',
})

/** user 스타일: 키가 `{size}/{role}` 2-part, weight는 토큰의 마지막 조각 */
const USER_TOKENS = { '16/title': typo('16px') }
/** admin 스타일: 키가 `{size}/{role}/{weight}` 3-part */
const ADMIN_TOKENS = { '16/title/med': typo('16px') }
const WEIGHTS = { reg: 400, med: 500, semibold: 600 }

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('resolveTextStyle — 토큰 형태', () => {
  it('user 2-part 키 + 별도 weight를 해석한다', () => {
    expect(resolveTextStyle(USER_TOKENS, WEIGHTS, '16/title/semibold')).toEqual({
      fontSize: '16px',
      lineHeight: '1.5',
      fontWeight: 600,
      letterSpacing: '0',
    })
  })

  it('admin 3-part 키는 토큰 전체로 먼저 찾는다', () => {
    expect(resolveTextStyle(ADMIN_TOKENS, WEIGHTS, '16/title/med').fontWeight).toBe(500)
  })

  it('알 수 없는 타이포그래피 토큰은 throw한다', () => {
    expect(() => resolveTextStyle(USER_TOKENS, WEIGHTS, '99/nope/reg')).toThrow(
      /알 수 없는 타이포그래피 토큰/,
    )
  })

  it('weight 이름에 하이픈이 붙으면 앞부분으로 찾는다 (med-link → med)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(resolveTextStyle(USER_TOKENS, WEIGHTS, '16/title/med-link').fontWeight).toBe(500)
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('resolveTextStyle — 모르는 weight', () => {
  it('400으로 폴백하되 dev에서 경고한다', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(resolveTextStyle(USER_TOKENS, WEIGHTS, '16/title/bolder').fontWeight).toBe(400)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('알 수 없는 font weight: "bolder"'))
    // 사용 가능한 값을 알려줘야 고칠 수 있다
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('reg, med, semibold'))
  })

  it('같은 weight는 한 번만 경고한다 (매 렌더 스팸 방지)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    resolveTextStyle(USER_TOKENS, WEIGHTS, '16/title/thin')
    resolveTextStyle(USER_TOKENS, WEIGHTS, '16/title/thin')
    resolveTextStyle(USER_TOKENS, WEIGHTS, '16/title/thin')

    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('프로덕션에서는 경고하지 않고 400 폴백만 한다', () => {
    // 굵기 오타 하나로 위젯 렌더를 멈추지 않는다 — 알리는 건 고칠 수 있는 시점(dev)에만.
    vi.stubEnv('NODE_ENV', 'production')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(resolveTextStyle(USER_TOKENS, WEIGHTS, '16/title/heavy').fontWeight).toBe(400)
    expect(warn).not.toHaveBeenCalled()
  })
})
