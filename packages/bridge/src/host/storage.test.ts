import { afterEach, describe, expect, it } from 'vitest'
import { BridgeError } from '../protocol/errors.js'
import { __resetBridgeStorage__, handleStorage, STORAGE_MAX_KEYS } from './storage.js'

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
