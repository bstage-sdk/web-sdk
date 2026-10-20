import { afterEach, describe, expect, it, vi } from 'vitest'
import { BstageClient } from './client/index.js'
import { getFrameBridge, type FrameBridgeInit } from './frameBridge.js'
import {
  __resetBstageI18n__,
  fetchTranslations,
  observeLocale,
  observeTranslations,
  readLocale,
} from './i18n.js'

/**
 * 격리 프레임 어댑터. 브리지가 있을 때만 경로가 바뀌고, 없을 때는 기존 경로 그대로여야 한다.
 * 프레임 안 경로는 플랫폼 격리 설정을 켜기 전까지 손 검증이 태울 수 없으므로 양쪽을 여기서 고정한다.
 */

function jsonResponse() {
  return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
}

/** `null`이면 init 수신 전. */
function fakeBridge(
  init: FrameBridgeInit | null = { gatewayBase: 'https://host.example/gw', locale: 'en' },
) {
  let current: FrameBridgeInit | null = init
  const listeners = new Set<(p: unknown) => void>()
  const bridge = {
    hostOrigin: 'https://host.example',
    getInit: () => current ?? undefined,
    request: vi.fn(async () => ({})),
    on: vi.fn((_type: string, fn: (p: unknown) => void) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    }),
    fetch: vi.fn(async () => jsonResponse()),
    /** 테스트 전용 — 호스트 locale 이벤트 흉내(런타임처럼 스냅샷 갱신 후 통지). */
    emitLocale(next: FrameBridgeInit) {
      current = next
      listeners.forEach((fn) => fn(next))
    },
  }
  vi.stubGlobal('__bstage_bridge__', bridge)
  return bridge
}

afterEach(() => {
  vi.unstubAllGlobals()
  __resetBstageI18n__()
})

describe('getFrameBridge', () => {
  it('없으면 undefined', () => {
    expect(getFrameBridge()).toBeUndefined()
  })

  it.each([
    [null],
    ['x'],
    [{ hostOrigin: 'h', getInit() {}, request() {}, on() {} }],
    [{ fetch() {} }],
  ])('모양이 틀리면 브리지로 보지 않는다 (%j)', (value) => {
    vi.stubGlobal('__bstage_bridge__', value)
    expect(getFrameBridge()).toBeUndefined()
  })

  it('모양이 맞으면 그 객체', () => {
    const bridge = fakeBridge()
    expect(getFrameBridge()).toBe(bridge)
  })
})

describe('BstageClient — 브리지 있음', () => {
  it('브리지 fetch로 보내고 baseUrl은 init.gatewayBase', async () => {
    const bridge = fakeBridge()
    const hook = vi.fn(async () => jsonResponse())
    const native = vi.fn(async () => jsonResponse())
    vi.stubGlobal('__bstage_fetch__', hook)
    vi.stubGlobal('fetch', native)
    await new BstageClient({ appId: 'bsa_a', appKey: 'bsp_b', tenantId: 't' }).get('/content/v1/x')
    expect(bridge.fetch).toHaveBeenCalledTimes(1)
    expect((bridge.fetch.mock.calls[0] as unknown[])[0]).toBe(
      'https://host.example/gw/content/v1/x',
    )
    expect(hook).not.toHaveBeenCalled()
    expect(native).not.toHaveBeenCalled()
  })

  it('init 전이면 baseUrl은 hostOrigin + /gw', async () => {
    const bridge = fakeBridge(null)
    await new BstageClient({ appId: 'bsa_a', appKey: 'bsp_b', tenantId: 't' }).get('/a')
    expect((bridge.fetch.mock.calls[0] as unknown[])[0]).toBe('https://host.example/gw/a')
  })

  it('config.fetch·baseUrl 명시는 브리지보다 우선', async () => {
    const bridge = fakeBridge()
    const explicit = vi.fn(async () => jsonResponse())
    await new BstageClient({
      appId: 'bsa_a',
      appKey: 'bsp_b',
      tenantId: 't',
      baseUrl: 'https://other.example/api',
      fetch: explicit as never,
    }).get('/a')
    expect(explicit).toHaveBeenCalledWith('https://other.example/api/a', expect.anything())
    expect(bridge.fetch).not.toHaveBeenCalled()
  })

  it('생성 뒤에 설치된 브리지도 요청 시점에 반영한다(fetch)', async () => {
    const native = vi.fn(async () => jsonResponse())
    vi.stubGlobal('fetch', native)
    const client = new BstageClient({
      appId: 'bsa_a',
      appKey: 'bsp_b',
      tenantId: 't',
      baseUrl: 'https://host.example/gw',
    })
    const bridge = fakeBridge()
    await client.get('/a')
    expect(bridge.fetch).toHaveBeenCalled()
    expect(native).not.toHaveBeenCalled()
  })
})

describe('BstageClient — 브리지 없음(기존 경로)', () => {
  it('__bstage_fetch__ → fetch, baseUrl은 location.origin + /gw', async () => {
    const hook = vi.fn(async () => jsonResponse())
    vi.stubGlobal('__bstage_fetch__', hook)
    vi.stubGlobal('location', { origin: 'https://space.example' })
    await new BstageClient({ appId: 'bsa_a', appKey: 'bsp_b', tenantId: 't' }).get('/a')
    expect((hook.mock.calls[0] as unknown[])[0]).toBe('https://space.example/gw/a')
  })

  it('훅이 없으면 globalThis.fetch', async () => {
    const native = vi.fn(async () => jsonResponse())
    vi.stubGlobal('fetch', native)
    vi.stubGlobal('location', { origin: 'https://space.example' })
    await new BstageClient({ appId: 'bsa_a', appKey: 'bsp_b', tenantId: 't' }).get('/a')
    expect(native).toHaveBeenCalled()
  })

  it('모양이 틀린 __bstage_bridge__는 무시하고 기존 경로', async () => {
    vi.stubGlobal('__bstage_bridge__', { fetch: 'nope' })
    const hook = vi.fn(async () => jsonResponse())
    vi.stubGlobal('__bstage_fetch__', hook)
    vi.stubGlobal('location', { origin: 'https://space.example' })
    await new BstageClient({ appId: 'bsa_a', appKey: 'bsp_b', tenantId: 't' }).get('/a')
    expect(hook).toHaveBeenCalled()
  })
})

describe('i18n — 브리지 있음', () => {
  it('readLocale은 init locale을 쓰고 쿠키·<html lang>을 보지 않는다(user·admin 모두)', () => {
    fakeBridge({ locale: 'ja' })
    vi.stubGlobal('document', {
      documentElement: { lang: 'ko' },
      cookie: 'bmf_bstage_lang=en; bmf_mybstage_locale=vi',
    })
    expect(readLocale()).toBe('ja')
    expect(readLocale('admin')).toBe('ja')
  })

  it('init이 없거나 지원하지 않는 locale이면 기본값', () => {
    fakeBridge(null)
    expect(readLocale()).toBe('ko')
    fakeBridge({ locale: 'xx' })
    expect(readLocale()).toBe('ko')
  })

  it('observeLocale은 브리지 locale 이벤트를 구독하고, 같은 값이면 알리지 않는다', () => {
    const bridge = fakeBridge({ locale: 'en' })
    const onChange = vi.fn()
    const off = observeLocale(onChange)
    expect(bridge.on).toHaveBeenCalledWith('locale', expect.any(Function))
    bridge.emitLocale({ locale: 'en' })
    expect(onChange).not.toHaveBeenCalled()
    bridge.emitLocale({ locale: 'zh-cn' })
    expect(onChange).toHaveBeenCalledWith('zh-CN')
    off()
    bridge.emitLocale({ locale: 'ko' })
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('fetchTranslations는 CDN을 부르지 않고 init 사전을 돌려준다', async () => {
    const native = vi.fn()
    vi.stubGlobal('fetch', native)
    const bridge = fakeBridge({ locale: 'en', translations: { B1: 'Hello', B2: 3 as never } })
    await expect(fetchTranslations('en')).resolves.toEqual({ B1: 'Hello' })
    await expect(fetchTranslations('ko')).resolves.toEqual({})
    expect(native).not.toHaveBeenCalled()
    expect(bridge.fetch).not.toHaveBeenCalled()
  })

  it('locale 이벤트로 바뀐 사전을 다음 호출에 반영한다(캐시하지 않는다)', async () => {
    const bridge = fakeBridge({ locale: 'en', translations: { B1: 'Hello' } })
    await fetchTranslations('en')
    bridge.emitLocale({ locale: 'ja', translations: { B1: 'こんにちは' } })
    await expect(fetchTranslations('ja')).resolves.toEqual({ B1: 'こんにちは' })
    await expect(fetchTranslations('en')).resolves.toEqual({})
  })

  it('observeTranslations — 같은 locale에 사전만 새로 와도 알린다', () => {
    const bridge = fakeBridge({ locale: 'en' })
    const onChange = vi.fn()
    const off = observeTranslations(onChange)
    bridge.emitLocale({ locale: 'en' })
    expect(onChange).not.toHaveBeenCalled()
    bridge.emitLocale({ locale: 'en', translations: { B1: 'Hello' } })
    expect(onChange).toHaveBeenCalledTimes(1)
    off()
    bridge.emitLocale({ locale: 'en', translations: { B1: 'Hi' } })
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('observeTranslations — 브리지가 없으면 아무것도 하지 않는다', () => {
    const onChange = vi.fn()
    expect(() => observeTranslations(onChange)()).not.toThrow()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('사전이 없으면 빈 사전', async () => {
    fakeBridge({ locale: 'en' })
    await expect(fetchTranslations('en')).resolves.toEqual({})
    fakeBridge(null)
    await expect(fetchTranslations('en')).resolves.toEqual({})
  })
})

describe('i18n — 브리지 없음(기존 경로)', () => {
  it('readLocale은 <html lang> → 쿠키', () => {
    vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: 'bmf_bstage_lang=vi' })
    expect(readLocale()).toBe('vi')
  })

  it('fetchTranslations는 CDN fetch를 부른다', async () => {
    const native = vi.fn(async () => new Response('{}', { status: 500 }))
    vi.stubGlobal('fetch', native)
    await expect(fetchTranslations('en')).rejects.toThrow()
    expect(native).toHaveBeenCalled()
  })
})
