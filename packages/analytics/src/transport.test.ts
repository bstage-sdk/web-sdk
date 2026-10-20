import { describe, expect, it } from 'vitest'
import { BODY_MAX, overBodyMax } from './transport.js'

/**
 * `post()`는 브라우저 API(`sendBeacon`·`fetch`)라 육안 검증으로 덮고, 여기서는
 * **크기를 무엇으로 재는가**만 못박는다. 문자 수로 재면 한글 payload의 실제 크기를
 * 3분의 1로 보게 되어 `ship()`의 분할이 늦게 걸린다.
 */
describe('overBodyMax', () => {
  it('상한 이하는 넘지 않은 것으로 본다', () => {
    expect(overBodyMax('a'.repeat(BODY_MAX))).toBe(false)
    expect(overBodyMax('a'.repeat(BODY_MAX + 1))).toBe(true)
  })

  it('문자 수가 아니라 byte로 잰다 — 한글은 UTF-8에서 3바이트다', () => {
    const korean = '가'.repeat(BODY_MAX / 3 + 1)

    expect(korean.length).toBeLessThan(BODY_MAX)
    expect(overBodyMax(korean)).toBe(true)
  })
})
