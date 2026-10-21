import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEnvelope, type BridgeEnvelope } from '../protocol/envelope.js'
import { createBridgeClient } from '../frame/createBridgeClient.js'
import { bridgeRuntime } from '../frame/runtime.js'
import { createBridgeFetch } from '../frame/createBridgeFetch.js'
import type { RuntimeGlobal } from '../frame/types.js'
import { createFakeLink, flush, FRAME, HOST_ORIGIN, SESSION, type FakeLink } from '../testing.js'
import { createBridgeHost } from './createBridgeHost.js'
import { INIT, okResponse, request, setup } from './hostTestKit.js'

/**
 * 세션 수명 — 템플릿이 자기 프레임을 다른 URL로 내비게이션하면 sandbox 플래그가 유지돼 새 문서도 origin "null"·
 * 같은 contentWindow를 가진다. 세션을 URL로 넘겨받은 새 문서가 브리지를 쓰지 못하게, 호스트는 세션을 첫 프레임 토큰에
 * 묶고(두 번째 핸드셰이크 불가) frame-unload를 받으면 즉시 끊는다. 손 검증은 정상 프레임만 태우므로 여기서 고정한다.
 */

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function connected() {
  const link = createFakeLink()
  const fetchImpl = vi.fn(async () => okResponse())
  const navigate = vi.fn()
  const host = createBridgeHost({
    iframe: link.iframe,
    session: SESSION,
    hostOrigin: HOST_ORIGIN,
    init: INIT,
    fetchImpl,
    handlers: { navigate },
  })
  const client = createBridgeClient({
    global: link.frameGlobal,
    session: SESSION,
    hostOrigin: HOST_ORIGIN,
  })
  return { link, host, client, fetchImpl, navigate }
}

/** 같은 contentWindow에 새로 뜬 문서 — 세션은 알지만(예: URL로 받음) 새 런타임이라 프레임 토큰이 다르다. */
function navigatedDocument(link: FakeLink) {
  const g: RuntimeGlobal = {
    parent: link.parent,
    addEventListener: link.frameGlobal.addEventListener,
    crypto: globalThis.crypto as RuntimeGlobal['crypto'],
  }
  return bridgeRuntime(g, createBridgeFetch, { session: SESSION, hostOrigin: HOST_ORIGIN })
}

const toHost = (link: FakeLink) => link.toHost.map((m) => m.message as BridgeEnvelope)

describe('프레임 토큰', () => {
  it('프레임이 보내는 모든 봉투에 같은 128비트 토큰이 최상위로 붙고 payload에는 없다', async () => {
    const { link, client } = connected()
    await client.ready
    await client.request('navigate', { path: '/a' })
    const sent = toHost(link)
    const tokens = new Set(sent.map((m) => m.frame))
    expect(tokens.size).toBe(1)
    expect([...tokens][0]).toMatch(/^[0-9a-f]{32}$/)
    expect(sent.every((m) => !('frame' in (m.payload as object)))).toBe(true)
  })

  it('런타임 인스턴스(문서)마다 토큰이 다르다', () => {
    const a = createFakeLink()
    const b = createFakeLink()
    createBridgeClient({ global: a.frameGlobal, session: SESSION, hostOrigin: HOST_ORIGIN })
    createBridgeClient({ global: b.frameGlobal, session: SESSION, hostOrigin: HOST_ORIGIN })
    expect(toHost(a)[0].frame).not.toBe(toHost(b)[0].frame)
  })

  it('crypto.getRandomValues가 없으면 예측 가능한 토큰을 만들지 않고, frame-unload만 보내 호스트를 끊는다', async () => {
    const link = createFakeLink()
    const g: RuntimeGlobal = {
      parent: link.parent,
      addEventListener: link.frameGlobal.addEventListener,
    }
    const client = bridgeRuntime(g, createBridgeFetch, {
      session: SESSION,
      hostOrigin: HOST_ORIGIN,
    })
    const host = createBridgeHost({
      iframe: link.iframe,
      session: SESSION,
      hostOrigin: HOST_ORIGIN,
      init: INIT,
      fetchImpl: vi.fn(),
    })
    await expect(client.request('back', {})).rejects.toMatchObject({ code: 'UNSUPPORTED' })
    expect(link.toHost).toHaveLength(0)
    link.pageHide()
    expect(toHost(link)).toEqual([expect.objectContaining({ type: 'frame-unload', frame: '' })])
    await flush()
    expect(link.hostListenerCount()).toBe(0)
    host.send('theme', { dark: true })
    expect(link.toFrame).toHaveLength(0)
  })
})

describe('두 번째 핸드셰이크', () => {
  it('같은 토큰의 ready 재전송에는 계속 init으로 답한다', async () => {
    const { link } = setup()
    link.parent.postMessage(createEnvelope('evt', 'ready', 'r1', { session: SESSION }), HOST_ORIGIN)
    await flush()
    link.parent.postMessage(createEnvelope('evt', 'ready', 'r2', { session: SESSION }), HOST_ORIGIN)
    await flush()
    expect(link.toFrame.map((m) => (m.message as BridgeEnvelope).id)).toEqual(['r1', 'r2'])
  })

  it('다른 토큰의 ready(같은 창의 새 문서)는 init을 받지 못하고 세션이 끊긴다', async () => {
    const { link, client, fetchImpl } = connected()
    await client.ready
    const intruder = navigatedDocument(link)
    await flush(10)
    expect(intruder.getInit()).toBeUndefined()
    expect(link.hostListenerCount()).toBe(0)

    // 원래 프레임의 요청도 더는 처리되지 않는다(세션 단위로 끊는다).
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    const pending = client.request('fetch', { url: '/gw/a' })
    const settled = expect(pending).rejects.toMatchObject({ code: 'TIMEOUT' })
    await vi.advanceTimersByTimeAsync(15_000)
    await settled
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('새 문서가 ready 없이 바로 요청을 보내도 처리하지 않고 세션을 끊는다', async () => {
    const { link, client, fetchImpl, navigate } = connected()
    await client.ready
    link.dispatchToHost({
      source: link.iframe.contentWindow,
      origin: 'null',
      data: {
        ...createEnvelope('req', 'fetch', 'x', { url: '/gw/a', session: SESSION }),
        frame: 'a'.repeat(32),
      },
    })
    await flush(10)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(link.hostListenerCount()).toBe(0)
    link.parent.postMessage(
      createEnvelope('req', 'navigate', 'n', { path: '/a', session: SESSION }),
      HOST_ORIGIN,
    )
    await flush(10)
    expect(navigate).not.toHaveBeenCalled()
  })

  it.each([
    ['없음', undefined],
    ['형식 아님', 'not-a-token'],
    ['대문자', FRAME.toUpperCase()],
  ])('세션은 맞는데 토큰이 %s이면 처리하지 않고 세션을 끊는다', async (_label, frame) => {
    const { link, fetchImpl } = setup()
    const env = createEnvelope('req', 'fetch', 'x', { url: '/gw/a', session: SESSION })
    link.dispatchToHost({
      source: link.iframe.contentWindow,
      origin: 'null',
      data: frame === undefined ? env : { ...env, frame },
    })
    await flush(10)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(link.hostListenerCount()).toBe(0)
  })

  it('세션이 틀린 메시지는 토큰이 달라도 세션을 끊지 않는다(세션을 모르는 쪽의 방해 불가)', async () => {
    const { link } = setup()
    link.dispatchToHost({
      source: link.iframe.contentWindow,
      origin: 'null',
      data: {
        ...createEnvelope('evt', 'ready', 'x', { session: 'f'.repeat(32) }),
        frame: 'a'.repeat(32),
      },
    })
    await flush()
    expect(link.hostListenerCount()).toBe(1)
    const res = await request(link, 'log', { level: 'info', message: 'hi' })
    expect(res).toEqual({ ok: true, data: {} })
  })
})

describe('onDispose', () => {
  function withSpy() {
    const onDispose = vi.fn()
    const ctx = setup({ onDispose })
    return { ...ctx, onDispose }
  }

  it('frame-unload면 "frame-unload"로 한 번 부른다', async () => {
    const { link, onDispose, host } = withSpy()
    link.parent.postMessage(
      createEnvelope('evt', 'frame-unload', 'u', { session: SESSION }),
      HOST_ORIGIN,
    )
    await flush()
    host.dispose()
    expect(onDispose.mock.calls).toEqual([['frame-unload']])
  })

  it('다른 토큰이면 "frame-mismatch"', async () => {
    const { link, onDispose } = withSpy()
    await request(link, 'log', { level: 'info', message: 'bind' })
    link.dispatchToHost({
      source: link.iframe.contentWindow,
      origin: 'null',
      data: { ...createEnvelope('evt', 'ready', 'r', { session: SESSION }), frame: 'b'.repeat(32) },
    })
    expect(onDispose.mock.calls).toEqual([['frame-mismatch']])
  })

  it('dispose() 호출이면 "manual", 콜백 예외는 삼킨다', () => {
    const onDispose = vi.fn(() => {
      throw new Error('embedder bug')
    })
    const { host, link } = setup({ onDispose })
    expect(() => host.dispose()).not.toThrow()
    expect(onDispose).toHaveBeenCalledWith('manual')
    expect(link.hostListenerCount()).toBe(0)
  })

  it('함수가 아니면 생성 시 TypeError', () => {
    expect(() => setup({ onDispose: 'x' as never })).toThrow(TypeError)
  })
})

describe('frame-unload', () => {
  it('pagehide에서 frame-unload를 동기로 보내고, 호스트는 받는 즉시 dispose한다', async () => {
    const { link, client } = connected()
    await client.ready
    const before = link.toHost.length
    link.pageHide()
    // 동기 전송 — 이벤트 처리기 안에서 바로 나간다.
    expect(link.toHost).toHaveLength(before + 1)
    const unload = toHost(link)[before]
    expect(unload).toMatchObject({
      kind: 'evt',
      type: 'frame-unload',
      payload: { session: SESSION },
      frame: toHost(link)[0].frame,
    })
    await flush()
    expect(link.hostListenerCount()).toBe(0)
  })

  it('dispose 뒤의 메시지(ready·요청)는 무시된다', async () => {
    const { link, client, fetchImpl, navigate } = connected()
    await client.ready
    link.pageHide()
    await flush()
    const sentToFrame = link.toFrame.length
    link.parent.postMessage(createEnvelope('evt', 'ready', 'r9', { session: SESSION }), HOST_ORIGIN)
    link.parent.postMessage(
      createEnvelope('req', 'navigate', 'n9', { path: '/a', session: SESSION }),
      HOST_ORIGIN,
    )
    link.parent.postMessage(
      createEnvelope('req', 'fetch', 'f9', { url: '/gw/a', session: SESSION }),
      HOST_ORIGIN,
    )
    await flush(10)
    expect(link.toFrame).toHaveLength(sentToFrame)
    expect(navigate).not.toHaveBeenCalled()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('진행 중이던 요청의 응답은 frame-unload 뒤 프레임에 보내지 않는다', async () => {
    const { link, fetchImpl } = setup()
    let release!: (r: Response) => void
    fetchImpl.mockImplementationOnce(() => new Promise<Response>((r) => (release = r)))
    link.parent.postMessage(
      createEnvelope('req', 'fetch', 'slow', { url: '/gw/a', session: SESSION }),
      HOST_ORIGIN,
    )
    await flush()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    link.parent.postMessage(
      createEnvelope('evt', 'frame-unload', 'u', { session: SESSION }),
      HOST_ORIGIN,
    )
    await flush()
    release(okResponse())
    await flush(20)
    expect(link.toFrame).toHaveLength(0)
  })

  it('프레임 쪽: frame-unload 뒤 대기 중인 요청은 바로 거절되고 새 요청·ready 재전송은 보내지 않는다', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    const link = createFakeLink()
    const client = createBridgeClient({
      global: link.frameGlobal,
      session: SESSION,
      hostOrigin: HOST_ORIGIN,
    })
    const pending = client.request('back', {})
    const rejected = expect(pending).rejects.toMatchObject({ code: 'UNSUPPORTED' })
    link.pageHide()
    await rejected
    const sent = link.toHost.length
    await expect(client.request('back', {})).rejects.toMatchObject({ code: 'UNSUPPORTED' })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(link.toHost).toHaveLength(sent)
  })

  it('bfcache 진입(persisted: true)에서는 보내지 않는다 — 복원 뒤 같은 문서가 계속 쓴다', async () => {
    const { link, client, navigate } = connected()
    await client.ready
    const before = link.toHost.length
    link.pageHide(true)
    expect(link.toHost).toHaveLength(before)
    await client.request('navigate', { path: '/a' })
    expect(navigate).toHaveBeenCalledWith('/a')
  })

  it('frame-unload는 한 번만 보낸다', async () => {
    const { link, client } = connected()
    await client.ready
    link.pageHide()
    link.pageHide()
    expect(toHost(link).filter((m) => m.type === 'frame-unload')).toHaveLength(1)
  })
})
