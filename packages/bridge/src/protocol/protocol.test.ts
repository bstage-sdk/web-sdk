import { describe, expect, it } from 'vitest'
import { createEnvelope, hasSession, isBridgeEnvelope } from './envelope.js'
import { BridgeError, isBridgeErrorCode, isBridgeErrorLike } from './errors.js'
import { isHostEventType, isRequestType } from './messages.js'
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
  })
})
