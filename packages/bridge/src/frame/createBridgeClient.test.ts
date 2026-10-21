import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEnvelope, type BridgeEnvelope } from '../protocol/envelope.js'
import { BRIDGE_ERROR_CODES } from '../protocol/errors.js'
import { REQUEST_TIMEOUT_MS } from '../protocol/messages.js'
import { createBridgeHost } from '../host/createBridgeHost.js'
import { createFakeLink, flush, HOST_ORIGIN, SESSION } from '../testing.js'
import { createBridgeClient } from './createBridgeClient.js'
import { bridgeRuntime } from './runtime.js'
import { createBridgeFetch } from './createBridgeFetch.js'

/**
 * 프레임 런타임은 srcdoc에 문자열로 심겨 타입·린트 도움 없이 돈다. 발신자 확인·타임아웃·재전송은
 * 손 검증의 정상 흐름에서 실행되지 않으므로 여기서 고정한다.
 */

afterEach(() => {
  vi.useRealTimers()
})

const INIT_INPUT = {
  placementId: 'pl-1',
  surface: 'slot' as const,
  phase: 'dev',
  spaceId: 's-1',
  locale: 'ko',
  theme: { dark: false },
  member: { signedIn: false },
  partnerOrigins: [],
}

function connected() {
  const link = createFakeLink()
  const fetchImpl = vi.fn(
    async () => new Response('{"ok":1}', { headers: { 'content-type': 'application/json' } }),
  )
  const host = createBridgeHost({
    iframe: link.iframe,
    session: SESSION,
    hostOrigin: HOST_ORIGIN,
    init: INIT_INPUT,
    fetchImpl,
    handlers: { navigate: vi.fn() },
  })
  const client = createBridgeClient({
    global: link.frameGlobal,
    session: SESSION,
    hostOrigin: HOST_ORIGIN,
  })
  return { link, host, client, fetchImpl }
}

describe('핸드셰이크', () => {
  it('ready → init을 받아 ready가 resolve되고 getInit이 값을 준다', async () => {
    const { client, link } = connected()
    const init = await client.ready
    expect(init).toMatchObject({ placementId: 'pl-1', gatewayBase: `${HOST_ORIGIN}/gw` })
    expect(client.getInit()).toEqual(init)
    expect(link.toHost[0]).toMatchObject({
      targetOrigin: HOST_ORIGIN,
      message: { kind: 'evt', type: 'ready', payload: { session: SESSION } },
    })
  })

  it('전역 __bstage_bridge__에 쓰기 불가로 설치되고, 두 번 만들면 같은 인스턴스', async () => {
    const { client, link } = connected()
    expect(link.frameGlobal.__bstage_bridge__).toBe(client)
    expect(
      createBridgeClient({ global: link.frameGlobal, session: SESSION, hostOrigin: HOST_ORIGIN }),
    ).toBe(client)
    expect(() => {
      ;(link.frameGlobal as { __bstage_bridge__?: unknown }).__bstage_bridge__ = {}
    }).toThrow(TypeError)
    expect(Object.isFrozen(client)).toBe(true)
    await client.ready
  })

  it('호스트 리스너가 늦게 붙어도 ready를 재전송해 핸드셰이크한다', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
    const link = createFakeLink()
    const client = createBridgeClient({
      global: link.frameGlobal,
      session: SESSION,
      hostOrigin: HOST_ORIGIN,
    })
    await flush()
    createBridgeHost({
      iframe: link.iframe,
      session: SESSION,
      hostOrigin: HOST_ORIGIN,
      init: INIT_INPUT,
      fetchImpl: vi.fn(),
    })
    vi.advanceTimersByTime(250)
    await flush()
    await expect(client.ready).resolves.toMatchObject({ placementId: 'pl-1' })
    const readies = link.toHost.filter((m) => (m.message as BridgeEnvelope).type === 'ready')
    expect(readies).toHaveLength(2)
    vi.advanceTimersByTime(5000)
    expect(link.toHost.filter((m) => (m.message as BridgeEnvelope).type === 'ready')).toHaveLength(
      2,
    )
  })

  it('호스트가 늦게 붙어도 포기하지 않는다 — 10초 뒤에는 2초 간격으로 ready를 계속 보낸다', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
    const link = createFakeLink()
    const client = createBridgeClient({
      global: link.frameGlobal,
      session: SESSION,
      hostOrigin: HOST_ORIGIN,
    })
    const readies = () =>
      link.toHost.filter((m) => (m.message as BridgeEnvelope).type === 'ready').length
    vi.advanceTimersByTime(250 * 39)
    expect(readies()).toBe(40)
    vi.advanceTimersByTime(1999)
    expect(readies()).toBe(40)
    vi.advanceTimersByTime(1)
    expect(readies()).toBe(41)
    vi.advanceTimersByTime(60_000)
    expect(readies()).toBe(71)
    createBridgeHost({
      iframe: link.iframe,
      session: SESSION,
      hostOrigin: HOST_ORIGIN,
      init: INIT_INPUT,
      fetchImpl: vi.fn(),
    })
    vi.advanceTimersByTime(2000)
    await flush()
    await expect(client.ready).resolves.toMatchObject({ placementId: 'pl-1' })
  })

  it('두 번째 init은 무시한다', async () => {
    const { client, link } = connected()
    await client.ready
    link.dispatchToFrame({
      source: link.parent,
      origin: HOST_ORIGIN,
      data: createEnvelope('res', 'init', 'x', { ok: true, data: { placementId: 'evil' } }),
    })
    expect(client.getInit()?.placementId).toBe('pl-1')
  })
})

describe('발신자 확인(프레임)', () => {
  function bare() {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
    const link = createFakeLink()
    const client = createBridgeClient({
      global: link.frameGlobal,
      session: SESSION,
      hostOrigin: HOST_ORIGIN,
    })
    return { link, client }
  }

  it('source가 parent가 아니면 init·이벤트를 무시한다', async () => {
    const { link, client } = bare()
    const fn = vi.fn()
    client.on('theme', fn)
    link.dispatchToFrame({
      source: {},
      origin: HOST_ORIGIN,
      data: createEnvelope('res', 'init', 'x', { ok: true, data: { placementId: 'evil' } }),
    })
    link.dispatchToFrame({
      source: {},
      origin: HOST_ORIGIN,
      data: createEnvelope('evt', 'theme', 'y', { dark: true }),
    })
    expect(client.getInit()).toBeUndefined()
    expect(fn).not.toHaveBeenCalled()
  })

  it('origin이 hostOrigin이 아니면 무시한다', () => {
    const { link, client } = bare()
    link.dispatchToFrame({
      source: link.parent,
      origin: 'https://evil.example',
      data: createEnvelope('res', 'init', 'x', { ok: true, data: { placementId: 'evil' } }),
    })
    expect(client.getInit()).toBeUndefined()
  })

  it.each([
    [null],
    [{ v: 1, ns: 'x', id: 'a', kind: 'evt', type: 'theme', payload: {} }],
    [{ v: 1, ns: 'bstage-bridge', id: '', kind: 'evt', type: 'theme', payload: {} }],
    [{ v: 1, ns: 'bstage-bridge', id: 'a', kind: 'evt', type: '', payload: {} }],
    [{ v: 1, ns: 'bstage-bridge', id: 'a', kind: 'zzz', type: 'theme', payload: {} }],
    [{ v: 1, ns: 'bstage-bridge', id: 'a', kind: 'evt', type: 'theme' }],
  ])('봉투가 아니면 무시한다 (%j)', (data) => {
    const { link, client } = bare()
    const fn = vi.fn()
    client.on('theme', fn)
    link.dispatchToFrame({ source: link.parent, origin: HOST_ORIGIN, data })
    expect(fn).not.toHaveBeenCalled()
  })

  it('실패한 init·모르는 id의 res는 무시한다', () => {
    const { link, client } = bare()
    link.dispatchToFrame({
      source: link.parent,
      origin: HOST_ORIGIN,
      data: createEnvelope('res', 'init', 'x', { ok: false }),
    })
    link.dispatchToFrame({
      source: link.parent,
      origin: HOST_ORIGIN,
      data: createEnvelope('res', 'fetch', 'nope', { ok: true, data: 1 }),
    })
    expect(client.getInit()).toBeUndefined()
  })

  it('parent가 없으면(최상위 창) 아무것도 보내지 않는다', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
    const listeners: unknown[] = []
    const g = {
      parent: null,
      addEventListener: (_t: 'message', fn: unknown) => void listeners.push(fn),
    }
    const client = createBridgeClient({ global: g, session: SESSION, hostOrigin: HOST_ORIGIN })
    expect(client.getInit()).toBeUndefined()
    ;(listeners[0] as (ev: unknown) => void)({
      source: null,
      origin: HOST_ORIGIN,
      data: createEnvelope('res', 'init', 'x', { ok: true, data: {} }),
    })
    expect(client.getInit()).toBeUndefined()
  })
})

describe('요청', () => {
  it('요청 payload에 세션을 붙이고 res의 data로 resolve', async () => {
    const { client, link } = connected()
    await expect(client.request('navigate', { path: '/a' })).resolves.toEqual({})
    const req = link.toHost.map((m) => m.message as BridgeEnvelope).find((m) => m.kind === 'req')
    expect(req?.payload).toEqual({ path: '/a', session: SESSION })
  })

  it('호스트 오류는 code가 붙은 Error로 reject', async () => {
    const { client } = connected()
    await expect(client.request('navigate', { path: '//evil' })).rejects.toMatchObject({
      name: 'BridgeError',
      code: 'BAD_REQUEST',
    })
  })

  it('error 모양이 깨진 실패 응답도 BAD_REQUEST로 reject', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
    const link = createFakeLink()
    const client = createBridgeClient({
      global: link.frameGlobal,
      session: SESSION,
      hostOrigin: HOST_ORIGIN,
    })
    const pending = client.request('back', {})
    const req = link.toHost.map((m) => m.message as BridgeEnvelope).find((m) => m.kind === 'req')!
    link.dispatchToFrame({
      source: link.parent,
      origin: HOST_ORIGIN,
      data: createEnvelope('res', 'back', req.id, null),
    })
    await expect(pending).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'bridge request failed',
    })
  })

  it('15초 안에 응답이 없으면 TIMEOUT, 늦은 응답은 무시', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
    const link = createFakeLink()
    const client = createBridgeClient({
      global: link.frameGlobal,
      session: SESSION,
      hostOrigin: HOST_ORIGIN,
    })
    const pending = client.request('back', {})
    const req = link.toHost.map((m) => m.message as BridgeEnvelope).find((m) => m.kind === 'req')!
    vi.advanceTimersByTime(REQUEST_TIMEOUT_MS - 1)
    let settled = false
    pending.catch(() => (settled = true))
    await flush()
    expect(settled).toBe(false)
    vi.advanceTimersByTime(1)
    await expect(pending).rejects.toMatchObject({ code: 'TIMEOUT' })
    link.dispatchToFrame({
      source: link.parent,
      origin: HOST_ORIGIN,
      data: createEnvelope('res', 'back', req.id, { ok: true, data: {} }),
    })
  })

  it('payload 생략 시 빈 객체 + 세션', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
    const link = createFakeLink()
    const client = createBridgeClient({
      global: link.frameGlobal,
      session: SESSION,
      hostOrigin: HOST_ORIGIN,
    })
    void client.request('back', undefined as never).catch(() => {})
    const req = link.toHost.map((m) => m.message as BridgeEnvelope).find((m) => m.kind === 'req')!
    expect(req.payload).toEqual({ session: SESSION })
  })
})

describe('이벤트', () => {
  it('on으로 구독, 해제 후에는 받지 않는다. 이벤트는 init 스냅샷에도 반영된다', async () => {
    const { client, host } = connected()
    await client.ready
    const fn = vi.fn()
    const off = client.on('locale', fn)
    host.send('locale', { locale: 'en', translations: { B1: 'Hi' } })
    await flush()
    expect(fn).toHaveBeenCalledWith({ locale: 'en', translations: { B1: 'Hi' } })
    expect(client.getInit()).toMatchObject({ locale: 'en', translations: { B1: 'Hi' } })
    off()
    host.send('locale', { locale: 'ja' })
    await flush()
    expect(fn).toHaveBeenCalledTimes(1)
    expect(client.getInit()?.locale).toBe('ja')
    expect(client.getInit()?.translations).toBeUndefined()
  })

  it('member·theme·slot.context를 스냅샷에 반영하고, 모양이 틀린 이벤트는 반영하지 않는다', async () => {
    const { client, host, link } = connected()
    await client.ready
    host.send('member', { signedIn: true, nickname: 'n' })
    host.send('theme', { dark: true })
    host.send('slot.context', { id: 'a.b', context: { x: 1 } })
    host.send('visibility', { visible: false })
    await flush()
    expect(client.getInit()).toMatchObject({
      member: { signedIn: true, nickname: 'n' },
      theme: { dark: true },
      slot: { id: 'a.b', context: { x: 1 } },
    })
    link.dispatchToFrame({
      source: link.parent,
      origin: HOST_ORIGIN,
      data: createEnvelope('evt', 'theme', 'y', { dark: 'yes' }),
    })
    link.dispatchToFrame({
      source: link.parent,
      origin: HOST_ORIGIN,
      data: createEnvelope('evt', 'locale', 'z', null),
    })
    await flush()
    expect(client.getInit()?.theme).toEqual({ dark: true })
  })

  it('구독자 예외가 다른 구독자를 막지 않는다', async () => {
    const { client, host } = connected()
    await client.ready
    const second = vi.fn()
    client.on('theme', () => {
      throw new Error('boom')
    })
    client.on('theme', second)
    host.send('theme', { dark: true })
    await flush()
    expect(second).toHaveBeenCalled()
  })
})

describe('createBridgeClient 설정', () => {
  it('세션·hostOrigin을 생략하면 __bstage_bridge_config__를 읽는다', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
    const link = createFakeLink()
    Object.assign(link.frameGlobal, {
      __bstage_bridge_config__: { session: SESSION, hostOrigin: HOST_ORIGIN },
    })
    const client = createBridgeClient({ global: link.frameGlobal })
    expect(client.hostOrigin).toBe(HOST_ORIGIN)
  })

  it('설정이 없으면 TypeError', () => {
    expect(() => createBridgeClient({ global: createFakeLink().frameGlobal })).toThrow(TypeError)
  })

  it('crypto가 없으면 브리지를 열지 않는다(예측 가능한 프레임 토큰 금지)', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
    const link = createFakeLink()
    const g = { ...link.frameGlobal, crypto: undefined }
    bridgeRuntime(g, createBridgeFetch, { session: SESSION, hostOrigin: HOST_ORIGIN })
    vi.advanceTimersByTime(1000)
    expect(link.toHost).toHaveLength(0)
  })
})

describe('protocol과 런타임 상수 일치', () => {
  it('런타임 소스의 상수가 protocol 값과 같다(자기완결이라 중복돼 있다)', () => {
    const src = bridgeRuntime.toString()
    expect(src).toMatch(/NS = ["']bstage-bridge["']/)
    expect(src).toMatch(/TIMEOUT_MS = 15e3|TIMEOUT_MS = 15000/)
    expect(src).toContain('MAX_ID = 64')
    expect(src).toContain('MAX_TYPE = 32')
    expect(BRIDGE_ERROR_CODES).toContain('TIMEOUT')
  })
})
