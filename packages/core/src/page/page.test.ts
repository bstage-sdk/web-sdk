import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FrameBridgeInit, FrameBridgeLike } from '../frameBridge.js'
import { __resetTemplateHosts__, trackTemplateHost } from '../core/templateHosts.js'
import { getPageLocation, onPageLocationChange, PAGE_LOCATION_EVENT } from './location.js'
import { navigateExternal } from './navigateExternal.js'

/**
 * 페이지 위치·같은 탭 외부 이동의 두 경로(격리 프레임·inline). 프레임 경로는 플랫폼 격리를 켜기 전까지 손 검증이
 * 태울 수 없고, inline 경로의 형식 위반·엘리먼트 부재 분기도 정상 흐름에서 지나가지 않으므로 여기서 고정한다.
 */

afterEach(() => {
  vi.unstubAllGlobals()
  __resetTemplateHosts__()
})

/** 런타임처럼 등록 순서대로 구독자를 부르는 가짜 브리지. */
function fakeBridge(init: FrameBridgeInit | undefined = {}) {
  const listeners: Array<{ type: string; fn: (p: unknown) => void }> = []
  const bridge = {
    hostOrigin: 'https://host.example',
    getInit: () => init,
    request: vi.fn(async (): Promise<unknown> => ({})),
    on: vi.fn((type: string, fn: (p: unknown) => void) => {
      const entry = { type, fn }
      listeners.push(entry)
      return () => void listeners.splice(listeners.indexOf(entry), 1)
    }),
    fetch: vi.fn(),
    emit(type: string, payload: unknown) {
      listeners.filter((l) => l.type === type).forEach((l) => l.fn(payload))
    },
  }
  return bridge satisfies FrameBridgeLike
}

function inFrame(bridge: FrameBridgeLike) {
  vi.stubGlobal('__bstage_bridge__', bridge)
}

function plain(loc: { path: string; query: URLSearchParams }) {
  return { path: loc.path, search: loc.query.toString() }
}

describe('getPageLocation — 격리 프레임', () => {
  it('init.page를 읽는다', () => {
    inFrame(fakeBridge({ page: { path: '/shop', search: '?id=1&id=2' } }))
    const loc = getPageLocation()
    expect(loc.path).toBe('/shop')
    expect(loc.query.getAll('id')).toEqual(['1', '2'])
  })

  it('init.page가 없거나(옛 호스트·계정 배치) init 전이면 빈 위치', () => {
    inFrame(fakeBridge({}))
    expect(plain(getPageLocation())).toEqual({ path: '', search: '' })
    inFrame(fakeBridge(undefined))
    expect(plain(getPageLocation())).toEqual({ path: '', search: '' })
  })

  it('형식이 틀린 init.page는 빈 위치', () => {
    inFrame(fakeBridge({ page: { path: 'shop', search: '' } }))
    expect(plain(getPageLocation())).toEqual({ path: '', search: '' })
  })

  it('스냅샷이 낡아도 직접 구독한 page 이벤트의 최신 값을 준다(형식 위반 이벤트는 무시)', () => {
    const bridge = fakeBridge({ page: { path: '/a', search: '' } })
    inFrame(bridge)
    expect(getPageLocation().path).toBe('/a')
    bridge.emit('page', { path: '/b', search: '?x=1' })
    bridge.emit('page', { path: 'bad', search: '' })
    expect(plain(getPageLocation())).toEqual({ path: '/b', search: 'x=1' })
    expect(bridge.on).toHaveBeenCalledTimes(1)
  })

  it('query는 호출마다 새 사본이다', () => {
    inFrame(fakeBridge({ page: { path: '/a', search: '?k=v' } }))
    getPageLocation().query.set('k', 'changed')
    expect(getPageLocation().query.get('k')).toBe('v')
  })
})

describe('onPageLocationChange — 격리 프레임', () => {
  it('page 이벤트마다 부르고, 콜백 안에서 getPageLocation도 새 값이다. 해제 후에는 부르지 않는다', () => {
    const bridge = fakeBridge({ page: { path: '/a', search: '' } })
    inFrame(bridge)
    const seen: Array<{ cb: unknown; read: unknown }> = []
    const off = onPageLocationChange((loc) => {
      seen.push({ cb: plain(loc), read: plain(getPageLocation()) })
    })
    bridge.emit('page', { path: '/b', search: '?q=1' })
    bridge.emit('page', { path: '/c', search: 'nope' })
    off()
    bridge.emit('page', { path: '/d', search: '' })
    expect(seen).toEqual([
      { cb: { path: '/b', search: 'q=1' }, read: { path: '/b', search: 'q=1' } },
    ])
  })
})

/** window.location·이벤트를 흉내 낸다. */
function inlineWindow(pathname: unknown, search: unknown) {
  const target = new EventTarget()
  vi.stubGlobal('location', { pathname, search })
  vi.stubGlobal('addEventListener', target.addEventListener.bind(target))
  vi.stubGlobal('removeEventListener', target.removeEventListener.bind(target))
  vi.stubGlobal('dispatchEvent', target.dispatchEvent.bind(target))
  return target
}

describe('inline', () => {
  it('getPageLocation은 window.location의 pathname·search', () => {
    inlineWindow('/shop', '?id=7')
    expect(plain(getPageLocation())).toEqual({ path: '/shop', search: 'id=7' })
  })

  it('location이 없으면 빈 위치', () => {
    expect(plain(getPageLocation())).toEqual({ path: '', search: '' })
  })

  it('onPageLocationChange는 window의 bstage:page 이벤트를 받는다(형식 위반 무시, 해제 가능)', () => {
    const win = inlineWindow('/a', '')
    const cb = vi.fn()
    const off = onPageLocationChange(cb)
    const send = (detail: unknown) =>
      win.dispatchEvent(new CustomEvent(PAGE_LOCATION_EVENT, { detail }))
    send({ path: '/b', search: '?x=1' })
    send({ path: '/c', search: 'x=1' })
    send(null)
    off()
    send({ path: '/d', search: '' })
    expect(cb).toHaveBeenCalledTimes(1)
    expect(plain(cb.mock.calls[0][0])).toEqual({ path: '/b', search: 'x=1' })
  })

  it('addEventListener가 없는 환경이면 아무것도 하지 않는 해제 함수', () => {
    expect(() => onPageLocationChange(vi.fn())()).not.toThrow()
  })
})

describe('navigateExternal — 격리 프레임', () => {
  it('navigateExternal 요청을 보낸다', async () => {
    const bridge = fakeBridge()
    inFrame(bridge)
    await navigateExternal('https://shop.example.com/p')
    expect(bridge.request).toHaveBeenCalledWith('navigateExternal', {
      url: 'https://shop.example.com/p',
    })
  })

  it('호스트 거절(처리기 없음 등)은 그대로 reject', async () => {
    const bridge = fakeBridge()
    const err = Object.assign(new Error('not supported by host'), { code: 'UNSUPPORTED' })
    bridge.request.mockRejectedValueOnce(err)
    inFrame(bridge)
    await expect(navigateExternal('https://a.example')).rejects.toBe(err)
  })
})

/** 문서에 붙은 템플릿 엘리먼트 흉내. */
function templateElement(connected = true) {
  const el = new EventTarget() as EventTarget & { isConnected: boolean }
  el.isConnected = connected
  return el
}

describe('navigateExternal — inline', () => {
  it('붙어 있는 엘리먼트가 하나면 그 엘리먼트에서 bubbles·composed 이벤트로 낸다', async () => {
    const el = templateElement()
    const detached = templateElement(false)
    const seen = vi.fn()
    el.addEventListener('bstage:navigate-external', seen)
    trackTemplateHost(el as unknown as HTMLElement)
    trackTemplateHost(detached as unknown as HTMLElement)
    await navigateExternal('https://shop.example.com/a b')
    expect(seen).toHaveBeenCalledTimes(1)
    const ev = seen.mock.calls[0][0] as CustomEvent
    expect(ev.detail).toEqual({ url: 'https://shop.example.com/a%20b' })
    expect(ev.bubbles && ev.composed).toBe(true)
  })

  it('붙어 있는 엘리먼트가 여럿이면 어느 배치인지 가릴 수 없어 보내지 않고 reject', async () => {
    const a = templateElement()
    const b = templateElement()
    const seen = vi.fn()
    a.addEventListener('bstage:navigate-external', seen)
    b.addEventListener('bstage:navigate-external', seen)
    trackTemplateHost(a as unknown as HTMLElement)
    trackTemplateHost(b as unknown as HTMLElement)
    await expect(navigateExternal('https://a.example')).rejects.toThrow(/템플릿 엘리먼트/)
    expect(seen).not.toHaveBeenCalled()
  })

  it('엘리먼트가 없으면 window로 흘리지 않고 reject', async () => {
    const el = templateElement()
    trackTemplateHost(el as unknown as HTMLElement)()
    const win = inlineWindow('/', '')
    const onWin = vi.fn()
    win.addEventListener('bstage:navigate-external', onWin)
    await expect(navigateExternal('https://a.example')).rejects.toThrow(/템플릿 엘리먼트/)
    expect(onWin).not.toHaveBeenCalled()
  })

  it('bstage:page 이벤트의 프로토콜 상대 경로(//host, /\\host)는 버린다', () => {
    const win = inlineWindow('/shop', '')
    const seen = vi.fn()
    const off = onPageLocationChange(seen)
    win.dispatchEvent(
      new CustomEvent(PAGE_LOCATION_EVENT, { detail: { path: '//evil.test/x', search: '' } }),
    )
    win.dispatchEvent(
      new CustomEvent(PAGE_LOCATION_EVENT, { detail: { path: '/\\evil.test', search: '' } }),
    )
    for (const path of ['/\t/evil.test', '/..//evil.test', '/a#h']) {
      win.dispatchEvent(new CustomEvent(PAGE_LOCATION_EVENT, { detail: { path, search: '' } }))
    }
    expect(seen).not.toHaveBeenCalled()
    off()
  })

  it.each(['http://a.example', 'https://u:p@a.example', 'javascript:alert(1)', 'not a url'])(
    '%s는 TypeError로 reject하고 이벤트를 내지 않는다',
    async (url) => {
      const el = templateElement()
      const onEl = vi.fn()
      el.addEventListener('bstage:navigate-external', onEl)
      trackTemplateHost(el as unknown as HTMLElement)
      await expect(navigateExternal(url)).rejects.toBeInstanceOf(TypeError)
      expect(onEl).not.toHaveBeenCalled()
    },
  )
})
