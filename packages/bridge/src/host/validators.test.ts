import { describe, expect, it } from 'vitest'
import { BridgeError } from '../protocol/errors.js'
import {
  validateExternalUrl,
  validateHeight,
  validateLog,
  validatePath,
  validateToast,
  validateTrack,
} from './validators.js'

const HOST = 'https://space.example.com'

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn()
  } catch (err) {
    return err instanceof BridgeError ? err.code : 'X'
  }
  return undefined
}

describe('validatePath', () => {
  it('앱 내 경로를 통과시킨다', () => {
    expect(validatePath({ path: '/lounge/1?tab=a#x' }, HOST)).toBe('/lounge/1?tab=a#x')
  })

  it.each([
    ['//evil.example'],
    ['/\\evil.example'],
    ['/\t/evil.example'],
    ['/\n/evil.example'],
    ['/a b'],
    ['https://evil.example'],
    ['javascript:alert(1)'],
    ['relative'],
    [''],
    ['/' + 'a'.repeat(2048)],
    ['/..//evil.com'],
    ['/a/../..//evil.com'],
    ['/%2e%2e//evil.com'],
    ['/%2f%2fevil.com'],
    ['/%2F/evil.com'],
    ['/%5cevil.com'],
    ['/%252f%252fevil.com'],
    ['/x/%252e%252e//evil.com'],
    ['/x/%2E%2E//evil.com'],
    ['/a//b'],
    ['/x/%c0%af%c0%afevil.com'],
    ['/x/%e0%80%afevil'],
    ['/x/%3b'],
  ])('%j 거절', (path) => {
    expect(codeOf(() => validatePath({ path }, HOST))).toBe('BAD_REQUEST')
  })

  it('경로 중간의 인코딩 값은 허용한다', () => {
    expect(validatePath({ path: '/search/a%2Fb' }, HOST)).toBe('/search/a%2Fb')
  })

  it('정규화된 경로를 돌려준다', () => {
    expect(validatePath({ path: '/a/../b?x=1' }, HOST)).toBe('/b?x=1')
  })

  it('payload가 없으면 거절', () => {
    expect(codeOf(() => validatePath(null, HOST))).toBe('BAD_REQUEST')
  })
})

describe('validateExternalUrl', () => {
  it('https만, 정규화한 href', () => {
    expect(validateExternalUrl({ url: 'https://example.com/a' })).toBe('https://example.com/a')
  })

  it.each([['http://example.com'], ['javascript:alert(1)'], ['https://u:p@example.com']])(
    '%s 거절',
    (url) => {
      expect(codeOf(() => validateExternalUrl({ url }))).toBe('FORBIDDEN_DESTINATION')
    },
  )

  it('URL이 아니면 BAD_REQUEST', () => {
    expect(codeOf(() => validateExternalUrl({ url: 'nope' }))).toBe('BAD_REQUEST')
    expect(codeOf(() => validateExternalUrl({}))).toBe('BAD_REQUEST')
  })
})

describe('validateToast', () => {
  it('500자에서 자르고 아는 kind만 남긴다', () => {
    expect(validateToast({ message: 'x'.repeat(600), kind: 'success' })).toEqual({
      message: 'x'.repeat(500),
      kind: 'success',
    })
    expect(validateToast({ message: 'hi', kind: 'evil' })).toEqual({ message: 'hi' })
  })

  it('메시지가 문자열이 아니면 거절', () => {
    expect(codeOf(() => validateToast({ message: 1 }))).toBe('BAD_REQUEST')
  })
})

describe('validateHeight', () => {
  it('0~20000 clamp, 반올림', () => {
    expect(validateHeight({ height: -5 })).toBe(0)
    expect(validateHeight({ height: 99999 })).toBe(20000)
    expect(validateHeight({ height: 100.6 })).toBe(101)
  })

  it.each([[NaN], [Infinity], ['100']])('%s 거절', (height) => {
    expect(codeOf(() => validateHeight({ height }))).toBe('BAD_REQUEST')
  })
})

describe('validateTrack', () => {
  it('이름 100자·params 4KB', () => {
    expect(validateTrack({ name: 'click', params: { a: 1 } })).toEqual({
      name: 'click',
      params: { a: 1 },
    })
    expect(validateTrack({ name: 'x'.repeat(100) })).toEqual({ name: 'x'.repeat(100) })
    expect(codeOf(() => validateTrack({ name: 'x'.repeat(101) }))).toBe('BAD_REQUEST')
    expect(codeOf(() => validateTrack({ name: '' }))).toBe('BAD_REQUEST')
    expect(codeOf(() => validateTrack({ name: 'a', params: { v: 'x'.repeat(4096) } }))).toBe(
      'BAD_REQUEST',
    )
  })

  it('프로토타입 오염 키를 깊이와 무관하게 버린다', () => {
    const params = JSON.parse(
      '{"a":1,"__proto__":{"x":1},"n":{"constructor":{"prototype":{"y":1}},"ok":2}}',
    )
    const out = validateTrack({ name: 'e', params })
    expect(out.params).toEqual({ a: 1, n: { ok: 2 } })
    expect(Object.prototype.hasOwnProperty.call(out.params, '__proto__')).toBe(false)
  })

  it('params는 일반 객체만', () => {
    expect(codeOf(() => validateTrack({ name: 'a', params: [1] }))).toBe('BAD_REQUEST')
    expect(codeOf(() => validateTrack({ name: 'a', params: 'x' }))).toBe('BAD_REQUEST')
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(codeOf(() => validateTrack({ name: 'a', params: cyclic }))).toBe('BAD_REQUEST')
  })
})

describe('validateLog', () => {
  it('아는 level만, 2000자에서 자른다', () => {
    expect(validateLog({ level: 'warn', message: 'x'.repeat(3000) }).message).toHaveLength(2000)
    expect(codeOf(() => validateLog({ level: 'trace', message: 'x' }))).toBe('BAD_REQUEST')
    expect(codeOf(() => validateLog({ level: 'info' }))).toBe('BAD_REQUEST')
  })
})
