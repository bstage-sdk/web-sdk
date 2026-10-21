import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEnvelope, type BridgeEnvelope } from '../protocol/envelope.js'
import { createFakeLink, flush, HOST_ORIGIN, SESSION } from '../testing.js'
import { createBridgeHost } from './createBridgeHost.js'
import { INIT, request, setup } from './hostTestKit.js'
import { __resetBridgeStorage__ } from './storage.js'

/**
 * 호스트는 프레임(신뢰하지 않는 템플릿 코드)과 호스트 권한 사이의 유일한 관문이다.
 * 손 검증은 정상 프레임의 해피패스만 태우므로 위조 발신자·세션·상한·처리기 부재 분기를 여기서 고정한다.
 */

/** ready를 보내 프레임 토큰을 묶는다(toFrame[0]에 init이 쌓인다). */
async function handshake(link: ReturnType<typeof createFakeLink>) {
  link.parent.postMessage(createEnvelope('evt', 'ready', 'hs', { session: SESSION }), HOST_ORIGIN)
  await flush()
}

afterEach(() => {
  __resetBridgeStorage__()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('발신자 확인', () => {
  it('ready에 init으로 답한다 — hostOrigin·gatewayBase·limits를 채우고 토큰·회원 id는 없다', async () => {
    const { link } = setup()
    link.parent.postMessage(createEnvelope('evt', 'ready', 'r1', { session: SESSION }), HOST_ORIGIN)
    await flush()
    expect(link.toFrame).toHaveLength(1)
    const { message, targetOrigin } = link.toFrame[0]
    expect(targetOrigin).toBe('*')
    expect(message).toEqual({
      v: 1,
      ns: 'bstage-bridge',
      id: 'r1',
      kind: 'res',
      type: 'init',
      payload: {
        ok: true,
        data: {
          placementId: 'pl-1',
          surface: 'page',
          phase: 'dev',
          spaceId: 'space-1',
          hostOrigin: HOST_ORIGIN,
          gatewayBase: `${HOST_ORIGIN}/gw`,
          gatewayPrefixes: ['/gw/'],
          locale: 'ko',
          theme: { dark: false },
          member: { signedIn: true, nickname: 'neo' },
          limits: { maxBodyBytes: 1048576, maxRequestsPerMinute: 300 },
          partnerOrigins: ['https://partner.example.net'],
        },
      },
    })
  })

  it('init에 넘긴 객체의 여분 필드(회원 id·토큰 등)는 싣지 않는다', async () => {
    const { link } = setup({
      init: {
        ...INIT,
        member: { signedIn: true, id: 'm-1', token: 'secret' } as never,
        accessToken: 'secret',
      } as never,
    })
    link.parent.postMessage(createEnvelope('evt', 'ready', 'r1', { session: SESSION }), HOST_ORIGIN)
    await flush()
    const text = JSON.stringify(link.toFrame[0].message)
    expect(text).not.toContain('secret')
    expect(text).not.toContain('m-1')
  })

  it('세션이 다르면 무시한다', async () => {
    const { link, fetchImpl } = setup()
    const res = await request(link, 'fetch', { url: '/gw/a' }, 'f'.repeat(32))
    expect(res).toBeUndefined()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('세션이 없으면 무시한다', async () => {
    const { link } = setup()
    link.parent.postMessage(createEnvelope('evt', 'ready', 'r1', {}), HOST_ORIGIN)
    await flush()
    expect(link.toFrame).toHaveLength(0)
  })

  it('source가 iframe이 아니면 무시한다(다른 창의 위조)', async () => {
    const { link, fetchImpl } = setup()
    link.dispatchToHost({
      source: {},
      origin: 'null',
      data: createEnvelope('req', 'fetch', 'x', { url: '/gw/a', session: SESSION }),
    })
    link.dispatchToHost({
      source: null,
      origin: 'null',
      data: createEnvelope('evt', 'ready', 'y', { session: SESSION }),
    })
    await flush()
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(link.toFrame).toHaveLength(0)
  })

  it('origin이 "null"(sandbox 프레임)이 아니면 무시한다', async () => {
    const { link } = setup()
    link.dispatchToHost({
      source: link.iframe.contentWindow,
      origin: 'https://evil.example',
      data: createEnvelope('evt', 'ready', 'y', { session: SESSION }),
    })
    await flush()
    expect(link.toFrame).toHaveLength(0)
  })

  it('contentWindow가 없으면(분리된 iframe) source가 null이어도 처리하지 않는다', async () => {
    const link = createFakeLink()
    createBridgeHost({
      iframe: { contentWindow: null, ownerDocument: link.iframe.ownerDocument },
      session: SESSION,
      hostOrigin: HOST_ORIGIN,
      init: INIT,
      fetchImpl: vi.fn(),
    })
    link.dispatchToHost({
      source: null,
      origin: 'null',
      data: createEnvelope('evt', 'ready', 'y', { session: SESSION }),
    })
    await flush()
    expect(link.toFrame).toHaveLength(0)
  })

  it.each([
    [null],
    ['string'],
    [{ v: 2, ns: 'bstage-bridge', id: 'a', kind: 'req', type: 'fetch', payload: {} }],
    [{ v: 1, ns: 'other', id: 'a', kind: 'req', type: 'fetch', payload: {} }],
    [{ v: 1, ns: 'bstage-bridge', id: '', kind: 'req', type: 'fetch', payload: {} }],
    [{ v: 1, ns: 'bstage-bridge', id: 'x'.repeat(65), kind: 'req', type: 'fetch', payload: {} }],
    [{ v: 1, ns: 'bstage-bridge', id: 'a', kind: 'bogus', type: 'fetch', payload: {} }],
    [{ v: 1, ns: 'bstage-bridge', id: 'a', kind: 'req', type: 'fetch' }],
  ])('봉투가 아니면 무시한다 (%j)', async (data) => {
    const { link } = setup()
    link.dispatchToHost({ source: link.iframe.contentWindow, origin: 'null', data })
    await flush()
    expect(link.toFrame).toHaveLength(0)
  })

  it('프레임이 보낸 res·evt(ready 외)는 처리하지 않는다', async () => {
    const { link } = setup()
    link.parent.postMessage(createEnvelope('res', 'fetch', 'a', { session: SESSION }), HOST_ORIGIN)
    link.parent.postMessage(createEnvelope('evt', 'locale', 'b', { session: SESSION }), HOST_ORIGIN)
    await flush()
    expect(link.toFrame).toHaveLength(0)
  })

  it('dispose 후에는 리스너를 떼고 아무것도 보내지 않는다', async () => {
    const { link, host } = setup()
    host.dispose()
    host.dispose()
    expect(link.hostListenerCount()).toBe(0)
    host.send('theme', { dark: true })
    expect(link.toFrame).toHaveLength(0)
  })
})

describe('기타 요청', () => {
  it('navigate — 앱 내 경로만 처리기로 넘긴다', async () => {
    const navigate = vi.fn()
    const { link } = setup({}, { navigate })
    expect(await request(link, 'navigate', { path: '/lounge/1' })).toEqual({ ok: true, data: {} })
    expect(await request(link, 'navigate', { path: '//evil.example' })).toMatchObject({
      ok: false,
      error: { code: 'BAD_REQUEST' },
    })
    expect(navigate).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith('/lounge/1')
  })

  it('back', async () => {
    const back = vi.fn()
    const { link } = setup({}, { back })
    expect(await request(link, 'back', {})).toMatchObject({ ok: true })
    expect(back).toHaveBeenCalledTimes(1)
  })

  it('openExternal — 처리기가 없으면 noopener,noreferrer로 window.open', async () => {
    const { link } = setup()
    expect(await request(link, 'openExternal', { url: 'https://example.org/a' })).toMatchObject({
      ok: true,
    })
    expect(link.hostWin.open).toHaveBeenCalledWith(
      'https://example.org/a',
      '_blank',
      'noopener,noreferrer',
    )
    expect(await request(link, 'openExternal', { url: 'http://example.org' })).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN_DESTINATION' },
    })
  })

  it('openExternal — 처리기가 있으면 처리기로', async () => {
    const openExternal = vi.fn()
    const { link } = setup({}, { openExternal })
    await request(link, 'openExternal', { url: 'https://example.org/a' })
    expect(openExternal).toHaveBeenCalledWith('https://example.org/a')
    expect(link.hostWin.open).not.toHaveBeenCalled()
  })

  it('toast·track 처리기', async () => {
    const toast = vi.fn()
    const track = vi.fn()
    const { link } = setup({}, { toast, track })
    await request(link, 'toast', { message: 'hi', kind: 'error' })
    await request(link, 'track', { name: 'click', params: { a: 1 } })
    expect(toast).toHaveBeenCalledWith('hi', 'error')
    expect(track).toHaveBeenCalledWith('click', { a: 1 })
  })

  it.each([
    ['navigate', { path: '/a' }],
    ['back', {}],
    ['toast', { message: 'x' }],
    ['track', { name: 'x' }],
  ])('처리기가 없으면 %s는 UNSUPPORTED', async (type, payload) => {
    const { link } = setup()
    expect(await request(link, type, payload)).toMatchObject({
      ok: false,
      error: { code: 'UNSUPPORTED' },
    })
  })

  it('openExternal — 처리기도 window.open도 없으면 UNSUPPORTED', async () => {
    const link = createFakeLink()
    const win = {
      addEventListener: link.hostWin.addEventListener,
      removeEventListener: link.hostWin.removeEventListener,
    }
    createBridgeHost({
      iframe: { contentWindow: link.iframe.contentWindow, ownerDocument: { defaultView: win } },
      session: SESSION,
      hostOrigin: HOST_ORIGIN,
      init: INIT,
      fetchImpl: vi.fn(),
    })
    link.parent.postMessage(
      createEnvelope('req', 'openExternal', 'o', { url: 'https://a.example', session: SESSION }),
      HOST_ORIGIN,
    )
    await flush()
    expect((link.toFrame[0].message as BridgeEnvelope).payload).toMatchObject({
      ok: false,
      error: { code: 'UNSUPPORTED' },
    })
  })

  it('알 수 없는 요청은 UNSUPPORTED', async () => {
    const { link } = setup()
    expect(await request(link, 'eval', {})).toMatchObject({
      ok: false,
      error: { code: 'UNSUPPORTED' },
    })
  })

  it('처리기 예외는 BAD_REQUEST — 메시지를 싣지 않는다', async () => {
    const { link } = setup(
      {},
      {
        navigate: () => {
          throw new Error('host internal detail')
        },
      },
    )
    expect(await request(link, 'navigate', { path: '/a' })).toEqual({
      ok: false,
      error: { code: 'BAD_REQUEST', message: 'request failed' },
    })
  })

  it('storage — placement 스코프, 같은 placement 재마운트는 값을 이어 쓴다', async () => {
    const first = setup()
    await request(first.link, 'storage', { op: 'set', key: 'k', value: 'v' })
    first.host.dispose()
    const second = setup()
    expect(await request(second.link, 'storage', { op: 'get', key: 'k' })).toEqual({
      ok: true,
      data: { value: 'v' },
    })
    const other = setup({ init: { ...INIT, placementId: 'pl-2' } })
    expect(await request(other.link, 'storage', { op: 'get', key: 'k' })).toEqual({
      ok: true,
      data: { value: null },
    })
  })

  it('log — real이 아니면 처리기(또는 console), real이면 버린다', async () => {
    const log = vi.fn()
    const dev = setup({}, { log })
    await request(dev.link, 'log', { level: 'warn', message: 'hello' })
    expect(log).toHaveBeenCalledWith('warn', 'hello')

    const real = setup({ init: { ...INIT, phase: 'real' } }, { log })
    expect(await request(real.link, 'log', { level: 'warn', message: 'x' })).toMatchObject({
      ok: true,
    })
    expect(log).toHaveBeenCalledTimes(1)

    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})
    const noHandler = setup()
    await request(noHandler.link, 'log', { level: 'info', message: 'c' })
    expect(spy).toHaveBeenCalledWith('[bstage-bridge] c')
  })
})

describe('요청별 추가 상한', () => {
  it('toast는 분당 5회', async () => {
    const toast = vi.fn()
    const { link } = setup({}, { toast })
    for (let i = 0; i < 5; i += 1) {
      expect(await request(link, 'toast', { message: `m${i}` })).toMatchObject({ ok: true })
    }
    expect(await request(link, 'toast', { message: 'x' })).toMatchObject({
      ok: false,
      error: { code: 'RATE_LIMITED' },
    })
    expect(toast).toHaveBeenCalledTimes(5)
  })

  it('ready 응답은 초당 2회까지', async () => {
    const { link } = setup()
    for (let i = 0; i < 5; i += 1) {
      link.parent.postMessage(
        createEnvelope('evt', 'ready', `r${i}`, { session: SESSION }),
        HOST_ORIGIN,
      )
    }
    await flush()
    expect(link.toFrame).toHaveLength(2)
  })

  it('resize는 초당 30회를 넘으면 응답 없이 버린다', async () => {
    const { link } = setup()
    for (let i = 0; i < 35; i += 1) {
      link.parent.postMessage(
        createEnvelope('req', 'resize', `z${i}`, { height: i, session: SESSION }),
        HOST_ORIGIN,
      )
    }
    await flush(10)
    expect(link.toFrame).toHaveLength(30)
  })
})

describe('resize', () => {
  it('rAF로 디바운스해 마지막 값만 처리기로 넘긴다(clamp 포함)', async () => {
    const resize = vi.fn()
    const frames: Array<() => void> = []
    const link = createFakeLink()
    const win = {
      ...link.hostWin,
      requestAnimationFrame: (cb: () => void) => frames.push(cb),
      cancelAnimationFrame: vi.fn(),
    }
    createBridgeHost({
      iframe: { contentWindow: link.iframe.contentWindow, ownerDocument: { defaultView: win } },
      session: SESSION,
      hostOrigin: HOST_ORIGIN,
      init: INIT,
      fetchImpl: vi.fn(),
      handlers: { resize },
    })
    await request(link, 'resize', { height: 100 })
    await request(link, 'resize', { height: 50000 })
    expect(frames).toHaveLength(1)
    expect(resize).not.toHaveBeenCalled()
    frames[0]()
    expect(resize).toHaveBeenCalledWith(20000)
    expect(resize).toHaveBeenCalledTimes(1)
  })

  it('rAF가 없으면 setTimeout, dispose하면 대기 중인 보고를 취소한다', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const resize = vi.fn()
    const { link, host } = setup({}, { resize })
    await request(link, 'resize', { height: 10 })
    host.dispose()
    vi.advanceTimersByTime(50)
    expect(resize).not.toHaveBeenCalled()
  })

  it('rAF 없을 때 setTimeout으로 보고한다', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const resize = vi.fn()
    const { link } = setup({}, { resize })
    await request(link, 'resize', { height: 10 })
    vi.advanceTimersByTime(20)
    expect(resize).toHaveBeenCalledWith(10)
  })

  it('처리기가 없으면 성공으로 답하고 아무것도 안 한다', async () => {
    const { link } = setup()
    expect(await request(link, 'resize', { height: 10 })).toMatchObject({ ok: true })
  })
})

describe('send — 호스트 → 프레임 이벤트', () => {
  it('핸드셰이크(토큰 묶임) 전에는 이벤트를 보내지 않고 init에만 반영한다', async () => {
    const { link, host } = setup()
    host.send('theme', { dark: true })
    expect(link.toFrame).toHaveLength(0)
    link.parent.postMessage(createEnvelope('evt', 'ready', 'r', { session: SESSION }), HOST_ORIGIN)
    await flush()
    const init = (link.toFrame[0].message as BridgeEnvelope<{ data: any }>).payload.data
    expect(init.theme).toEqual({ dark: true })
  })

  it('핸드셰이크 전 visibility는 마지막 값만 init 뒤에 한 번 보낸다(init에 접히지 않으므로)', async () => {
    const { link, host } = setup()
    host.send('visibility', { visible: true })
    host.send('visibility', { visible: false })
    expect(link.toFrame).toHaveLength(0)
    await handshake(link)
    const sent = link.toFrame.map((m) => m.message as BridgeEnvelope)
    expect(sent.map((m) => m.type)).toEqual(['init', 'visibility'])
    expect(sent[1].payload).toEqual({ visible: false })
    link.parent.postMessage(createEnvelope('evt', 'ready', 'r2', { session: SESSION }), HOST_ORIGIN)
    await flush()
    expect(link.toFrame.map((m) => (m.message as BridgeEnvelope).type)).toEqual([
      'init',
      'visibility',
      'init',
    ])
  })

  it('evt 봉투를 "*"로 보내고 이후 init에 반영한다', async () => {
    const { link, host } = setup()
    await handshake(link)
    host.send('locale', { locale: 'en', translations: { B1: 'Hello' } })
    host.send('theme', { dark: true })
    host.send('member', { signedIn: false })
    host.send('slot.context', { id: 'user.lounge.post:after', context: { postId: 'p' } })
    host.send('visibility', { visible: false })
    expect(link.toFrame).toHaveLength(6)
    expect(link.toFrame[1]).toMatchObject({
      targetOrigin: '*',
      message: { kind: 'evt', type: 'locale', payload: { locale: 'en' } },
    })
    link.parent.postMessage(createEnvelope('evt', 'ready', 'r', { session: SESSION }), HOST_ORIGIN)
    await flush()
    const init = (link.toFrame[6].message as BridgeEnvelope<{ data: any }>).payload.data
    expect(init).toMatchObject({
      locale: 'en',
      translations: { B1: 'Hello' },
      theme: { dark: true },
      member: { signedIn: false },
      slot: { id: 'user.lounge.post:after', context: { postId: 'p' } },
    })
  })

  it('번역 없는 locale 이벤트는 이전 사전을 지운다', async () => {
    const { link, host } = setup({ init: { ...INIT, translations: { B1: '안녕' } } })
    host.send('locale', { locale: 'en' })
    link.parent.postMessage(createEnvelope('evt', 'ready', 'r', { session: SESSION }), HOST_ORIGIN)
    await flush()
    const init = (link.toFrame[0].message as BridgeEnvelope<{ data: any }>).payload.data
    expect(init.locale).toBe('en')
    expect(init).not.toHaveProperty('translations')
  })

  it('이벤트 payload도 허용 필드만 내보낸다(member는 signedIn·nickname만)', async () => {
    const { link, host } = setup()
    await handshake(link)
    host.send('member', {
      signedIn: true,
      nickname: 'n',
      id: 'm-1',
      email: 'a@b.c',
      token: 't',
    } as never)
    host.send('theme', { dark: true, extra: 1 } as never)
    host.send('visibility', { visible: true, secret: 'x' } as never)
    host.send('locale', { locale: 'en', translations: { B1: 'Hi', B2: 3 }, token: 't' } as never)
    host.send('slot.context', { id: 's', context: { postId: 'p' }, token: 't' } as never)
    const payloads = link.toFrame.slice(1).map((m) => (m.message as BridgeEnvelope).payload)
    expect(payloads).toEqual([
      { signedIn: true, nickname: 'n' },
      { dark: true },
      { visible: true },
      { locale: 'en', translations: { B1: 'Hi' } },
      { id: 's', context: { postId: 'p' } },
    ])
  })

  it('필수 필드가 없는 slot.context·locale 이벤트는 TypeError', () => {
    const { host } = setup()
    expect(() => host.send('slot.context', { context: {} } as never)).toThrow(TypeError)
    expect(() => host.send('locale', {} as never)).toThrow(TypeError)
  })

  it('알 수 없는 이벤트는 TypeError', () => {
    const { host } = setup()
    expect(() => host.send('cookie' as never, {} as never)).toThrow(TypeError)
    expect(() => host.send('theme', null as never)).toThrow(TypeError)
  })

  it('contentWindow가 없으면 보내지 않고 상태만 갱신한다', () => {
    const link = createFakeLink()
    const host = createBridgeHost({
      iframe: { contentWindow: null, ownerDocument: link.iframe.ownerDocument },
      session: SESSION,
      hostOrigin: HOST_ORIGIN,
      init: INIT,
      fetchImpl: vi.fn(),
    })
    expect(() => host.send('theme', { dark: true })).not.toThrow()
    expect(link.toFrame).toHaveLength(0)
  })
})

describe('옵션 검증', () => {
  const base = () => {
    const link = createFakeLink()
    return {
      iframe: link.iframe,
      session: SESSION,
      hostOrigin: HOST_ORIGIN,
      init: INIT,
      fetchImpl: vi.fn(),
    }
  }

  it.each([
    [{ session: 'short' }],
    [{ hostOrigin: 'https://space.example.com/path' }],
    [{ hostOrigin: 'ftp://space.example.com' }],
    [{ fetchImpl: undefined }],
    [{ iframe: undefined }],
    [{ init: undefined }],
    [{ policy: { maxBodyBytes: -1 } }],
    [{ partnerFetchImpl: 'nope' }],
  ])('%j → TypeError', (patch) => {
    expect(() => createBridgeHost({ ...base(), ...patch } as never)).toThrow(TypeError)
  })

  it('옵션이 없으면 TypeError', () => {
    expect(() => createBridgeHost(undefined as never)).toThrow(TypeError)
  })

  it('ownerDocument가 없으면 globalThis에 리스너를 단다', () => {
    const add = vi.fn()
    vi.stubGlobal('addEventListener', add)
    vi.stubGlobal('removeEventListener', vi.fn())
    try {
      createBridgeHost({ ...base(), iframe: { contentWindow: null } })
      expect(add).toHaveBeenCalledWith('message', expect.any(Function))
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
