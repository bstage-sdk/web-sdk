import { describe, expect, it } from 'vitest'
import { UTM_MAX } from './limits.js'
import { readUtm } from './page.js'

describe('readUtm', () => {
  it('utm_* 파라미터만 뽑는다', () => {
    const utm = readUtm('?utm_source=naver&utm_medium=cpc&page=2&sessionId=abc')

    expect(utm).toEqual({ utm_source: 'naver', utm_medium: 'cpc' })
  })

  it('빈 값은 넣지 않는다', () => {
    expect(readUtm('?utm_source=&utm_term=sale')).toEqual({ utm_term: 'sale' })
  })

  it('쿼리가 없으면 빈 객체다', () => {
    expect(readUtm('')).toEqual({})
  })
})

describe('readUtm 상한', () => {
  it('값을 상한에서 자른다 — 쿼리 값은 방문 링크가 통제한다', () => {
    const long = 'a'.repeat(UTM_MAX + 50)

    expect(readUtm(`?utm_source=${long}`).utm_source).toHaveLength(UTM_MAX)
  })
})
