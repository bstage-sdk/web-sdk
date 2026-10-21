import { describe, expect, it, vi } from 'vitest'
import type { BridgeInit } from '../protocol/messages.js'
import { flush, HOST_ORIGIN } from '../testing.js'
import { installDirectFetch, type DirectFetchGlobal } from './directFetch.js'

/**
 * 프레임 네트워크 라우터의 갈래표. 손 검증은 /gw 한 번과 외부 한 번이라, 파트너·거절·init 전 호출·
 * 전역 교체 내성은 여기서만 확인된다.
 */

const PARTNER = 'https://partner.example.net'

const INIT = {
  placementId: 'p',
  surface: 'page',
  phase: 'dev',
  spaceId: 's',
  hostOrigin: HOST_ORIGIN,
  gatewayBase: `${HOST_ORIGIN}/gw`,
  gatewayPrefixes: ['/gw/', '/svc/'],
  locale: 'ko',
  theme: { dark: false },
  member: { signedIn: false },
  limits: { maxBodyBytes: 1, maxRequestsPerMinute: 1 },
  partnerOrigins: [PARTNER],
} as unknown as BridgeInit

function setup(init: BridgeInit | Promise<BridgeInit> = INIT) {
  const nativeFetch = vi.fn(async () => new Response('native'))
  const bridgeFetch = vi.fn(async () => new Response('bridge'))
  const g: DirectFetchGlobal = { fetch: nativeFetch as unknown as typeof fetch, URL, Request }
  const ready = Promise.resolve(init)
  const routed = installDirectFetch(
    g,
    { fetch: bridgeFetch as unknown as typeof fetch, ready },
    { hostOrigin: HOST_ORIGIN },
  )
  return { g, routed, nativeFetch, bridgeFetch }
}

async function ready(s: ReturnType<typeof setup>) {
  await flush(3)
  return s
}

describe('갈래표', () => {
  it.each([
    [`${HOST_ORIGIN}/gw/content/v1/boards`, `${HOST_ORIGIN}/gw/content/v1/boards`],
    [`${HOST_ORIGIN}/gw`, `${HOST_ORIGIN}/gw`],
    [`${HOST_ORIGIN}/svc/account/api/v1/me`, `${HOST_ORIGIN}/svc/account/api/v1/me`],
    ['/gw/content/v1', `${HOST_ORIGIN}/gw/content/v1`],
    ['/svc/x?y=1', `${HOST_ORIGIN}/svc/x?y=1`],
    [`${PARTNER}/api/v1/items`, `${PARTNER}/api/v1/items`],
  ])('%s → 브리지(판정한 절대 URL로)', async (url, href) => {
    const s = await ready(setup())
    const res = await s.routed(url, { method: 'POST', body: '{}' })
    await expect(res.text()).resolves.toBe('bridge')
    expect(s.bridgeFetch).toHaveBeenCalledWith(href, { method: 'POST', body: '{}' })
    expect(s.nativeFetch).not.toHaveBeenCalled()
  })

  it('외부 https → 원래 fetch, credentials omit·no-referrer로 덮고 인증 헤더를 붙이지 않는다', async () => {
    const s = await ready(setup())
    const res = await s.routed('https://api.weather.example.org/v1?q=seoul', {
      credentials: 'include',
      headers: { accept: 'application/json' },
    })
    await expect(res.text()).resolves.toBe('native')
    expect(s.bridgeFetch).not.toHaveBeenCalled()
    expect(s.nativeFetch).toHaveBeenCalledTimes(1)
    const [target, init] = s.nativeFetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(target).toBe('https://api.weather.example.org/v1?q=seoul')
    expect(init).toEqual({
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      headers: { accept: 'application/json' },
    })
    expect(JSON.stringify(init).toLowerCase()).not.toContain('authorization')
  })

  it('파트너와 포트만 다른 origin은 파트너가 아니다(정확 일치) → 직접', async () => {
    const s = await ready(setup())
    await s.routed('https://partner.example.net:8443/x')
    expect(s.nativeFetch).toHaveBeenCalledTimes(1)
    expect(s.bridgeFetch).not.toHaveBeenCalled()
  })

  it.each([
    [`${HOST_ORIGIN}/`],
    [`${HOST_ORIGIN}/account/login`],
    [`${HOST_ORIGIN}/gwx/a`],
    [`${HOST_ORIGIN}/%67w/a`],
    ['/static/app.js'],
    ['http://api.example.org/x'],
    ['ws://api.example.org/x'],
    ['data:text/plain,hi'],
    ['javascript:alert(1)'],
  ])('%s → 거절(TypeError), 어느 fetch도 부르지 않는다', async (url) => {
    const s = await ready(setup())
    await expect(s.routed(url)).rejects.toThrow(TypeError)
    expect(s.nativeFetch).not.toHaveBeenCalled()
    expect(s.bridgeFetch).not.toHaveBeenCalled()
  })

  it('잘못된 URL은 TypeError', async () => {
    const s = await ready(setup())
    await expect(s.routed('http://[::1')).rejects.toThrow(TypeError)
  })

  it('Request 입력은 그대로 넘긴다(메서드·본문 보존) — 갈래는 request.url로 정한다', async () => {
    const s = await ready(setup())
    const gw = new Request(`${HOST_ORIGIN}/gw/x`, { method: 'DELETE' })
    await s.routed(gw)
    expect(s.bridgeFetch).toHaveBeenCalledWith(gw, undefined)
    const ext = new Request('https://cdn.example.org/a.json')
    await s.routed(ext)
    expect(s.nativeFetch.mock.calls[0][0 as never]).toBe(ext)
  })

  it('url을 속이는 Request 하위 클래스·모양만 같은 객체는 실제로 보낼 URL로 판정한다', async () => {
    const s = await ready(setup())
    class Liar extends Request {
      get url() {
        return 'https://cdn.example.org/ok'
      }
    }
    await expect(s.routed(new Liar(`${HOST_ORIGIN}/account/login`))).rejects.toThrow(TypeError)
    const fake = {
      url: 'https://cdn.example.org/ok',
      method: 'GET',
      toString: () => '/account/login',
    }
    await expect(s.routed(fake as unknown as Request)).rejects.toThrow(TypeError)
    expect(s.nativeFetch).not.toHaveBeenCalled()
    expect(s.bridgeFetch).not.toHaveBeenCalled()
  })

  it('init에 gatewayPrefixes가 없으면(옛 호스트) hostOrigin 요청은 경로와 무관하게 브리지로', async () => {
    const { gatewayPrefixes: _drop, ...old } = INIT as BridgeInit & { gatewayPrefixes: string[] }
    const s = await ready(setup(old as BridgeInit))
    await s.routed(`${HOST_ORIGIN}/anything`)
    expect(s.bridgeFetch).toHaveBeenCalledWith(`${HOST_ORIGIN}/anything`, undefined)
  })

  it('init 전에 부른 요청은 init을 받은 뒤 같은 표로 보낸다', async () => {
    const nativeFetch = vi.fn(async () => new Response('native'))
    const bridgeFetch = vi.fn(async () => new Response('bridge'))
    let resolve!: (v: BridgeInit) => void
    const pending = new Promise<BridgeInit>((r) => (resolve = r))
    const routed = installDirectFetch(
      { fetch: nativeFetch as unknown as typeof fetch, URL },
      { fetch: bridgeFetch as unknown as typeof fetch, ready: pending },
      { hostOrigin: HOST_ORIGIN },
    )
    const early = routed('/svc/x')
    await flush(3)
    expect(bridgeFetch).not.toHaveBeenCalled()
    resolve(INIT)
    await expect((await early).text()).resolves.toBe('bridge')
  })

  it('__bstage_fetch__를 쓰기 불가로 설치한다', () => {
    const s = setup()
    expect(s.g.__bstage_fetch__).toBe(s.routed)
    expect(() => {
      ;(s.g as Record<string, unknown>).__bstage_fetch__ = () => undefined
    }).toThrow(TypeError)
    expect(Object.getOwnPropertyDescriptor(s.g, '__bstage_fetch__')).toMatchObject({
      writable: false,
      configurable: false,
    })
  })
})

describe('설치 뒤 바뀐 상태에 흔들리지 않는다(잡아 둔 참조)', () => {
  it('템플릿이 init 배열에 파트너·접두사를 넣어도 스냅샷이 이긴다', async () => {
    const init = structuredClone(INIT) as BridgeInit & {
      gatewayPrefixes: string[]
      partnerOrigins: string[]
    }
    const s = await ready(setup(init))
    init.partnerOrigins.push('https://attacker.example')
    init.gatewayPrefixes.push('/')
    await s.routed('https://attacker.example/collect')
    expect(s.bridgeFetch).not.toHaveBeenCalled()
    expect(s.nativeFetch).toHaveBeenCalledTimes(1)
    await expect(s.routed(`${HOST_ORIGIN}/account/login`)).rejects.toThrow(TypeError)
  })

  it('전역 fetch·URL을 바꿔도 원래 것을 쓴다', async () => {
    const s = await ready(setup())
    const fake = vi.fn()
    s.g.fetch = fake as unknown as typeof fetch
    s.g.URL = function () {
      return new URL(`${HOST_ORIGIN}/gw/x`)
    } as unknown as typeof URL
    await s.routed('https://cdn.example.org/a')
    expect(fake).not.toHaveBeenCalled()
    expect(s.nativeFetch).toHaveBeenCalledTimes(1)
    expect(s.bridgeFetch).not.toHaveBeenCalled()
  })
})
