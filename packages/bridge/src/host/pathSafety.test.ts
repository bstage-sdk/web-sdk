import { describe, expect, it } from 'vitest'
import { checkPath } from './pathSafety.js'

/** 게이트웨이·navigate 공용 구조 검사 — 디코딩 단계마다 같은 규칙. */
describe('checkPath', () => {
  it('고정점까지 디코딩한 단계를 돌려준다', () => {
    expect(checkPath('/gw/a%252Fb')).toEqual({
      ok: true,
      forms: ['/gw/a%252Fb', '/gw/a%2Fb', '/gw/a/b'],
    })
    expect(checkPath('/plain')).toEqual({ ok: true, forms: ['/plain'] })
  })

  it.each([['/gw/%c0%af'], ['/gw/%e0%80%af'], ['/gw/%ff'], ['/gw/100%25'], ['/gw/%2525252525']])(
    '디코딩 실패·고정점 미도달(%s)은 거절',
    (p) => {
      expect(checkPath(p).ok).toBe(false)
    },
  )

  it.each([
    ['/gw/../x'],
    ['/gw/./x'],
    ['/gw/x/..'],
    ['/gw/x/.'],
    ['/gw/%2e%2e/x'],
    ['/gw/x;y'],
    ['/gw/x\\y'],
    ['/gw/%00'],
  ])('%s 거절', (p) => {
    expect(checkPath(p).ok).toBe(false)
  })

  it('// 는 forbidDoubleSlash일 때만 거절', () => {
    expect(checkPath('/a//b').ok).toBe(true)
    expect(checkPath('/a//b', { forbidDoubleSlash: true }).ok).toBe(false)
    expect(checkPath('/a/%2f/b', { forbidDoubleSlash: true }).ok).toBe(false)
  })
})
