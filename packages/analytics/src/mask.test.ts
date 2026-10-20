import { describe, expect, it } from 'vitest'
import { MASK_MAX, mask } from './mask.js'

describe('mask', () => {
  it('URL 쿼리·프래그먼트의 토큰류를 지운다', () => {
    expect(mask('https://x.test/cb?code=abc&page=2')).toBe(
      'https://x.test/cb?code=abc&page=2'.replace('abc', '***'),
    )
    expect(mask('https://x.test/#access_token=zzz')).toBe('https://x.test/#access_token=***')
  })

  it('userinfo 자격증명을 지운다', () => {
    expect(mask('https://user:pw@host/x')).toBe('https://***:***@host/x')
  })

  it('Bearer·JWT를 지운다', () => {
    expect(mask('Bearer abc.def')).toBe('Bearer ***')
    expect(mask('t eyJhbGciOi.p.s 뒤')).toBe('t *** 뒤')
  })

  it('입력을 먼저 잘라 정규식 실행 길이를 묶는다', () => {
    expect(mask('a'.repeat(MASK_MAX * 3)).length).toBe(MASK_MAX)
  })

  it('토큰이 아닌 값은 건드리지 않는다', () => {
    expect(mask('https://x.test/a?page=2&sort=desc')).toBe('https://x.test/a?page=2&sort=desc')
  })
})
