import { describe, expect, it } from 'vitest'
import { deepClean, labelList, MAX_RESPONSE_DEPTH, ResponseTooDeepError } from './sanitize.js'

describe('labelList (21차 L)', () => {
  it('이름마다 줄바꿈·제어문자를 지우고 max 개 뒤는 "외 N개"', () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ label: `/p${i}\n✓ fake` }))
    const s = labelList(items, 10)
    expect(s).not.toMatch(/[\n\r]/)
    expect(s.endsWith('외 2개')).toBe(true)
    expect(labelList([{ label: 'a' }, { label: 'b' }])).toBe('a, b')
  })
})

describe('deepClean — 프로토타입 오염(22차 M)', () => {
  it('JSON 의 __proto__·constructor·prototype 키는 버리고 사본의 프로토타입을 바꾸지 않는다', () => {
    const parsed = JSON.parse(
      '{"repo":{"id":"r","__proto__":{"source":"builtin"},"constructor":{"prototype":{"x":1}}},"prototype":1}',
    ) as { repo: Record<string, unknown> }
    const out = deepClean(parsed) as { repo: Record<string, unknown> }
    expect(out.repo.source).toBeUndefined()
    expect(Object.getPrototypeOf(out.repo)).toBe(Object.prototype)
    expect(Object.keys(out.repo)).toEqual(['id'])
    expect(Object.keys(out)).toEqual(['repo'])
    expect(({} as Record<string, unknown>).source).toBeUndefined()
  })
})

describe('deepClean — 중첩 상한(24차 L)', () => {
  it('상한을 넘는 깊은 중첩은 스택 넘침 대신 ResponseTooDeepError', () => {
    const deep: unknown = JSON.parse('['.repeat(20000) + ']'.repeat(20000))
    expect(() => deepClean(deep)).toThrow(ResponseTooDeepError)
  })
  it('상한 안의 중첩은 그대로 정리한다', () => {
    const ok: unknown = JSON.parse(
      '{"a":'.repeat(MAX_RESPONSE_DEPTH) + '"x"' + '}'.repeat(MAX_RESPONSE_DEPTH),
    )
    expect(() => deepClean(ok)).not.toThrow()
  })
})
