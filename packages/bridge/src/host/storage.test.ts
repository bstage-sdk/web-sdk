import { afterEach, describe, expect, it } from 'vitest'
import { BridgeError } from '../protocol/errors.js'
import {
  __resetBridgeStorage__,
  handleStorage,
  STORAGE_MAX_KEYS,
  type StorageBackend,
} from './storage.js'

afterEach(() => __resetBridgeStorage__())

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn()
  } catch (err) {
    return err instanceof BridgeError ? err.code : 'X'
  }
  return undefined
}

describe('handleStorage', () => {
  it('set·get·remove', () => {
    expect(handleStorage('p1', { op: 'get', key: 'a' })).toEqual({ value: null })
    expect(handleStorage('p1', { op: 'set', key: 'a', value: '1' })).toEqual({ value: '1' })
    expect(handleStorage('p1', { op: 'get', key: 'a' })).toEqual({ value: '1' })
    expect(handleStorage('p1', { op: 'remove', key: 'a' })).toEqual({ value: null })
    expect(handleStorage('p1', { op: 'get', key: 'a' })).toEqual({ value: null })
  })

  it('placement끼리 섞이지 않는다', () => {
    handleStorage('p1', { op: 'set', key: 'a', value: '1' })
    expect(handleStorage('p2', { op: 'get', key: 'a' })).toEqual({ value: null })
  })

  it('프로토타입 키를 일반 키로 다룬다', () => {
    expect(handleStorage('p1', { op: 'get', key: 'constructor' })).toEqual({ value: null })
    handleStorage('p1', { op: 'set', key: '__proto__', value: 'x' })
    expect(handleStorage('p1', { op: 'get', key: '__proto__' })).toEqual({ value: 'x' })
  })

  it('키 50개 상한 — 기존 키 덮어쓰기는 허용', () => {
    for (let i = 0; i < STORAGE_MAX_KEYS; i += 1) {
      handleStorage('p1', { op: 'set', key: `k${i}`, value: 'v' })
    }
    expect(codeOf(() => handleStorage('p1', { op: 'set', key: 'new', value: 'v' }))).toBe(
      'BAD_REQUEST',
    )
    expect(handleStorage('p1', { op: 'set', key: 'k0', value: 'w' })).toEqual({ value: 'w' })
  })

  it('값 4KB 상한·문자열만', () => {
    expect(
      handleStorage('p1', { op: 'set', key: 'a', value: 'x'.repeat(4096) }).value,
    ).toHaveLength(4096)
    expect(
      codeOf(() => handleStorage('p1', { op: 'set', key: 'a', value: 'x'.repeat(4097) })),
    ).toBe('BAD_REQUEST')
    expect(codeOf(() => handleStorage('p1', { op: 'set', key: 'a', value: 1 }))).toBe('BAD_REQUEST')
  })

  it('잘못된 키·op', () => {
    expect(codeOf(() => handleStorage('p1', { op: 'get', key: '' }))).toBe('BAD_REQUEST')
    expect(codeOf(() => handleStorage('p1', { op: 'get', key: 'x'.repeat(201) }))).toBe(
      'BAD_REQUEST',
    )
    expect(codeOf(() => handleStorage('p1', { op: 'clear', key: 'a' }))).toBe('BAD_REQUEST')
  })

  it('없는 키 remove는 무해', () => {
    expect(handleStorage('p1', { op: 'remove', key: 'nope' })).toEqual({ value: null })
  })
})

/** Map 기반 가짜 저장소 — keys는 접두사로 시작하는 전체 키를 돌려준다. */
function fakeBackend(): StorageBackend & { readonly data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    get: (k) => data.get(k) ?? null,
    set: (k, v) => void data.set(k, v),
    remove: (k) => void data.delete(k),
    keys: (prefix) => [...data.keys()].filter((k) => k.startsWith(prefix)),
  }
}

function throwing(): never {
  throw new Error('backend internal detail')
}

describe('handleStorage — 주입 저장소', () => {
  const SCOPE = 'space-1\u0000page:/shop'

  it('전체 키는 `${scope}\\u0000${key}` — set·get·remove', () => {
    const b = fakeBackend()
    expect(handleStorage(SCOPE, { op: 'set', key: 'a', value: '1' }, b)).toEqual({ value: '1' })
    expect([...b.data.keys()]).toEqual(['space-1\u0000page:/shop\u0000a'])
    expect(handleStorage(SCOPE, { op: 'get', key: 'a' }, b)).toEqual({ value: '1' })
    expect(handleStorage(SCOPE, { op: 'remove', key: 'a' }, b)).toEqual({ value: null })
    expect(b.data.size).toBe(0)
  })

  it('메모리 저장소는 건드리지 않는다', () => {
    const b = fakeBackend()
    handleStorage(SCOPE, { op: 'set', key: 'a', value: '1' }, b)
    expect(handleStorage(SCOPE, { op: 'get', key: 'a' })).toEqual({ value: null })
  })

  it('키 50개 상한은 스코프 접두사로만 센다 — 다른 placement·이름이 이어지는 placement는 세지 않는다', () => {
    const b = fakeBackend()
    for (let i = 0; i < STORAGE_MAX_KEYS; i += 1) {
      handleStorage('space-1\u0000page:/shopx', { op: 'set', key: `k${i}`, value: 'v' }, b)
    }
    expect(handleStorage(SCOPE, { op: 'set', key: 'first', value: 'v' }, b)).toEqual({
      value: 'v',
    })
    for (let i = 1; i < STORAGE_MAX_KEYS; i += 1) {
      handleStorage(SCOPE, { op: 'set', key: `k${i}`, value: 'v' }, b)
    }
    expect(codeOf(() => handleStorage(SCOPE, { op: 'set', key: 'new', value: 'v' }, b))).toBe(
      'BAD_REQUEST',
    )
    expect(handleStorage(SCOPE, { op: 'set', key: 'first', value: 'w' }, b)).toEqual({
      value: 'w',
    })
  })

  it('값·키 상한과 잘못된 op는 메모리와 같다. 구분자(\\u0000)가 든 키는 거절', () => {
    const b = fakeBackend()
    expect(
      codeOf(() => handleStorage(SCOPE, { op: 'set', key: 'a', value: 'x'.repeat(4097) }, b)),
    ).toBe('BAD_REQUEST')
    expect(codeOf(() => handleStorage(SCOPE, { op: 'get', key: 'x'.repeat(201) }, b))).toBe(
      'BAD_REQUEST',
    )
    expect(codeOf(() => handleStorage(SCOPE, { op: 'clear', key: 'a' }, b))).toBe('BAD_REQUEST')
    expect(codeOf(() => handleStorage(SCOPE, { op: 'get', key: 'a\u0000b' }, b))).toBe(
      'BAD_REQUEST',
    )
    expect(b.data.size).toBe(0)
  })

  it('set·keys 예외는 STORAGE_UNAVAILABLE(메시지 미전달), get 예외는 null, remove 예외는 무시', () => {
    const b = fakeBackend()
    const setFails = { ...b, set: throwing }
    const keysFails = { ...b, keys: throwing }
    const readFails = { ...b, get: throwing, remove: throwing }
    expect(codeOf(() => handleStorage(SCOPE, { op: 'set', key: 'a', value: 'v' }, setFails))).toBe(
      'STORAGE_UNAVAILABLE',
    )
    expect(codeOf(() => handleStorage(SCOPE, { op: 'set', key: 'a', value: 'v' }, keysFails))).toBe(
      'STORAGE_UNAVAILABLE',
    )
    expect(handleStorage(SCOPE, { op: 'get', key: 'a' }, readFails)).toEqual({ value: null })
    expect(handleStorage(SCOPE, { op: 'remove', key: 'a' }, readFails)).toEqual({ value: null })
  })

  it('저장소가 문자열이 아닌 값을 돌려주면 null', () => {
    const b = { ...fakeBackend(), get: () => 1 as unknown as string }
    expect(handleStorage(SCOPE, { op: 'get', key: 'a' }, b)).toEqual({ value: null })
  })
})
