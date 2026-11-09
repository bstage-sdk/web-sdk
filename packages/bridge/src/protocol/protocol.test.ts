import { describe, expect, it } from 'vitest'
import { createEnvelope, hasSession, isBridgeEnvelope } from './envelope.js'
import { BridgeError, isBridgeErrorCode, isBridgeErrorLike } from './errors.js'
import {
  isHostEventType,
  isRequestType,
  PAGE_LOCATION_MAX_LENGTH,
  toPageLocation,
} from './messages.js'
import { createNonce, createSession, isValidNonce, isValidSession } from './session.js'

describe('envelope', () => {
  it('createEnvelope → isBridgeEnvelope', () => {
    expect(isBridgeEnvelope(createEnvelope('req', 'fetch', 'a', {}))).toBe(true)
  })

  it('type 길이 상한', () => {
    expect(isBridgeEnvelope(createEnvelope('req', 'x'.repeat(33), 'a', {}))).toBe(false)
  })

  it('hasSession', () => {
    expect(hasSession({ session: 's' }, 's')).toBe(true)
    expect(hasSession({ session: 't' }, 's')).toBe(false)
    expect(hasSession(null, 's')).toBe(false)
    expect(hasSession('s', 's')).toBe(false)
  })
})

describe('session·nonce', () => {
  it('세션은 128비트 hex, 매번 다르다', () => {
    const a = createSession()
    expect(isValidSession(a)).toBe(true)
    expect(a).not.toBe(createSession())
    expect(isValidSession('A'.repeat(32))).toBe(false)
    expect(isValidSession(1)).toBe(false)
  })

  it('nonce는 base64url 22자', () => {
    const n = createNonce()
    expect(n).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(isValidNonce(n)).toBe(true)
    expect(isValidNonce('a"b'.repeat(10))).toBe(false)
  })
})

describe('errors·guards', () => {
  it('BridgeError', () => {
    const e = new BridgeError('TIMEOUT', 'x')
    expect(e).toBeInstanceOf(Error)
    expect(e.code).toBe('TIMEOUT')
    expect(isBridgeErrorLike(e)).toBe(true)
    expect(isBridgeErrorLike(Object.assign(new Error(), { code: 'NOPE' }))).toBe(false)
    expect(isBridgeErrorCode('RATE_LIMITED')).toBe(true)
  })

  it('type 가드', () => {
    expect(isRequestType('fetch')).toBe(true)
    expect(isRequestType('eval')).toBe(false)
    expect(isHostEventType('locale')).toBe(true)
    expect(isHostEventType('ready')).toBe(false)
    expect(isRequestType('navigateExternal')).toBe(true)
    expect(isHostEventType('page')).toBe(true)
    expect(isBridgeErrorCode('STORAGE_UNAVAILABLE')).toBe(true)
  })

  it('navigateExternal은 봉투 type 길이 상한 안이다', () => {
    expect(isBridgeEnvelope(createEnvelope('req', 'navigateExternal', 'a', {}))).toBe(true)
  })
})

describe('toPageLocation', () => {
  it('path·search만 담은 새 객체', () => {
    const src = { path: '/a', search: '?b=1', hash: '#c' }
    expect(toPageLocation(src)).toEqual({ path: '/a', search: '?b=1' })
    expect(toPageLocation({ path: '/', search: '' })).toEqual({ path: '/', search: '' })
  })

  it.each([
    null,
    'x',
    { path: 'a', search: '' },
    { path: '/a', search: 'b' },
    { path: '/a' },
    { path: '/' + 'a'.repeat(PAGE_LOCATION_MAX_LENGTH), search: '' },
    { path: '/', search: '?' + 'a'.repeat(PAGE_LOCATION_MAX_LENGTH) },
  ])('형식 위반은 undefined (%j)', (value) => {
    expect(toPageLocation(value)).toBeUndefined()
  })
})
