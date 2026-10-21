import { createContext, runInContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { createBridgeHost } from '../host/createBridgeHost.js'
import { createFakeLink, flush, HOST_ORIGIN, SESSION } from '../testing.js'
import { buildFrameCsp, createSrcdoc, type CreateSrcdocOptions } from './createSrcdoc.js'

/**
 * 프레임 네트워크 규칙(항상 적용, 2026-10-22 결정). 토큰이 필요한 API는 브리지, 그 밖의 https는 직접.
 * CSP의 나머지 지시어가 그대로라는 것, 옵트인 스위치가 없다는 것, 템플릿이 전역을 바꿔도 라우팅이 고정된다는 것은
 * 여기서만 확인된다.
 */

const NONCE = 'AbCdEfGhIjKlMnOpQrStUv'
const PARTNER = 'https://partner.example.net'
const OPTS: CreateSrcdocOptions = {
  nonce: NONCE,
  session: SESSION,
  hostOrigin: HOST_ORIGIN,
  assetOrigin: 'https://cdn.example.com',
  entryUrl: 'https://cdn.example.com/t/abc/index.js',
  elementName: 'bstage-tpl-abc',
  title: 't',
}

function scriptOf(html: string): string {
  const m = /<script nonce="[^"]+">\n([\s\S]*)\n<\/script>/.exec(html)
  if (!m) throw new Error('bootstrap script not found')
  return m[1]
}

function cspOf(html: string): Map<string, string> {
  const csp = /content="([^"]+)"/.exec(html)?.[1].replace(/&#39;/g, "'") ?? ''
  return new Map(csp.split('; ').map((d) => [d.split(' ')[0], d] as const))
}

describe('CSP', () => {
  it('connect-src는 항상 https: wss:이고 connect-src none은 어디에도 없다', () => {
    const csp = buildFrameCsp(NONCE, 'https://cdn.example.com', ['https://img.example.net'])
    expect(csp).toContain('connect-src https: wss:')
    expect(csp).not.toContain("connect-src 'none'")
    expect(createSrcdoc(OPTS)).not.toContain('connect-src &#39;none&#39;')
  })

  it('평문(http:·ws:)과 와일드카드는 어느 지시어에도 없고, frame-src·form-action은 none', () => {
    const map = cspOf(createSrcdoc(OPTS))
    for (const d of map.values()) {
      expect(d.split(' ')).not.toContain('http:')
      expect(d.split(' ')).not.toContain('ws:')
      expect(d.split(' ')).not.toContain('*')
    }
    expect(map.get('connect-src')).toBe('connect-src https: wss:')
    expect(map.get('frame-src')).toBe("frame-src 'none'")
    expect(map.get('form-action')).toBe("form-action 'none'")
    expect(map.get('img-src')).toBe('img-src https://cdn.example.com data: blob:')
  })

  it('옵트인 스위치가 없다 — 옛 directNetwork 값은 무시되고 문서는 항상 같다(라우터 포함)', () => {
    const html = createSrcdoc(OPTS)
    expect(scriptOf(html)).toContain('__bstage_fetch__')
    for (const legacy of [false, true, 'false']) {
      expect(createSrcdoc({ ...OPTS, directNetwork: legacy } as CreateSrcdocOptions)).toBe(html)
    }
  })
})

/** 부트스트랩이 쓰는 최소 DOM + 직접 fetch용 전역(`fetch`·`URL`)만 둔 빈 realm. */
function frameRealm(link: ReturnType<typeof createFakeLink>, nativeFetch: unknown) {
  let define!: () => void
  const defined = new Promise<void>((r) => (define = r))
  const sandbox: Record<string, unknown> = {
    parent: link.parent,
    addEventListener: link.frameGlobal.addEventListener,
    crypto: globalThis.crypto,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Headers,
    Response,
    URLSearchParams,
    DOMException,
    // 하위 클래스 — 템플릿이 realm 안에서 접근자를 덮어도 테스트 realm의 URL.prototype은 그대로다.
    URL: class extends URL {},
    fetch: nativeFetch,
    requestAnimationFrame: (cb: () => void) => setTimeout(cb, 0),
    customElements: { whenDefined: () => defined },
    document: {
      createElement: (tagName: string) => ({ tagName }),
      head: { appendChild: () => undefined },
      body: { appendChild: () => undefined, getBoundingClientRect: () => ({ height: 1 }) },
    },
  }
  return { context: createContext(sandbox), sandbox, define }
}

function hostFor(link: ReturnType<typeof createFakeLink>) {
  const fetchImpl = vi.fn(async () => new Response('gateway'))
  const partnerFetchImpl = vi.fn(async () => new Response('partner'))
  createBridgeHost({
    iframe: link.iframe,
    session: SESSION,
    hostOrigin: HOST_ORIGIN,
    init: {
      placementId: 'p',
      surface: 'page',
      phase: 'dev',
      spaceId: 's',
      locale: 'ko',
      theme: { dark: false },
      member: { signedIn: true },
      partnerOrigins: [PARTNER],
    },
    fetchImpl,
    partnerFetchImpl,
    policy: { gatewayPrefixes: ['/gw/', '/svc/'] },
  })
  return { fetchImpl, partnerFetchImpl }
}

describe('부트스트랩(빈 realm) — 프레임 네트워크 라우터', () => {
  it('옵션 없이도 __bstage_fetch__를 쓰기 불가로 설치한다', async () => {
    const link = createFakeLink()
    hostFor(link)
    const realm = frameRealm(link, vi.fn())
    runInContext(scriptOf(createSrcdoc(OPTS)), realm.context)
    await flush(10)
    expect(typeof realm.sandbox.__bstage_fetch__).toBe('function')
    const desc = Object.getOwnPropertyDescriptor(realm.sandbox, '__bstage_fetch__')
    expect(desc?.writable).toBe(false)
  })

  it('init의 gatewayPrefixes·partnerOrigins로 브리지·직접·거절을 가르고, 템플릿이 전역을 바꿔도 그대로다', async () => {
    const link = createFakeLink()
    const { fetchImpl, partnerFetchImpl } = hostFor(link)
    const nativeFetch = vi.fn(async () => new Response('native'))
    const realm = frameRealm(link, nativeFetch)
    runInContext(scriptOf(createSrcdoc(OPTS)), realm.context)
    await flush(10)

    // 템플릿 코드 — 부트스트랩 뒤에 전역·프로토타입·init 객체를 바꿔 라우팅을 흔들어 본다.
    runInContext(
      `
      var hijack = function () { return Promise.resolve('hijacked'); };
      globalThis.fetch = hijack;
      String.prototype.slice = function () { return '/gw/'; };
      String.prototype.startsWith = function () { return true; };
      Object.defineProperty(URL.prototype, 'origin', { get: function () { return ${JSON.stringify(HOST_ORIGIN)}; } });
      Object.defineProperty(URL.prototype, 'pathname', { get: function () { return '/gw/x'; } });
      var init = globalThis.__bstage_bridge__.getInit();
      init.partnerOrigins.push('https://attacker.example');
      try { globalThis.__bstage_fetch__ = hijack; } catch (e) {}
      `,
      realm.context,
    )
    const routed = realm.sandbox.__bstage_fetch__ as typeof fetch

    await expect((await routed('/svc/account/api/v1/me')).text()).resolves.toBe('gateway')
    expect(fetchImpl).toHaveBeenCalledWith(
      `${HOST_ORIGIN}/svc/account/api/v1/me`,
      expect.objectContaining({ credentials: 'same-origin' }),
    )
    await expect((await routed(`${HOST_ORIGIN}/gw/content/v1`)).text()).resolves.toBe('gateway')
    await expect((await routed(`${PARTNER}/api/items`)).text()).resolves.toBe('partner')
    expect(partnerFetchImpl).toHaveBeenCalledTimes(1)

    // 외부 https — 원래 fetch로, 무인증. 브리지(호스트)는 거치지 않는다.
    await expect((await routed('https://attacker.example/collect')).text()).resolves.toBe('native')
    await expect((await routed('https://api.example.org/v1')).text()).resolves.toBe('native')
    expect(nativeFetch).toHaveBeenCalledTimes(2)
    for (const call of nativeFetch.mock.calls as unknown as Array<[string, RequestInit]>) {
      expect(call[1]).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer' })
      expect(JSON.stringify(call[1]).toLowerCase()).not.toContain('authorization')
    }
    expect(fetchImpl).toHaveBeenCalledTimes(2)

    // 같은 origin 게이트웨이 밖 경로·평문은 거절.
    await expect(routed(`${HOST_ORIGIN}/account/login`)).rejects.toThrow('destination not allowed')
    await expect(routed('http://api.example.org/v1')).rejects.toThrow('destination not allowed')
    expect(nativeFetch).toHaveBeenCalledTimes(2)
    expect(realm.sandbox.__bstage_fetch__).toBe(routed)
  })

  it('브리지 fetch(__bstage_bridge__.fetch)는 그대로 외부 갈래를 중계한다(allowExternal 호환)', async () => {
    const link = createFakeLink()
    const externalFetchImpl = vi.fn(async () => new Response('relayed'))
    createBridgeHost({
      iframe: link.iframe,
      session: SESSION,
      hostOrigin: HOST_ORIGIN,
      init: {
        placementId: 'p',
        surface: 'page',
        phase: 'dev',
        spaceId: 's',
        locale: 'ko',
        theme: { dark: false },
        member: { signedIn: false },
        partnerOrigins: [],
      },
      fetchImpl: vi.fn(),
      externalFetchImpl,
      policy: { allowExternal: true },
    })
    const realm = frameRealm(link, vi.fn())
    runInContext(scriptOf(createSrcdoc(OPTS)), realm.context)
    await flush(10)
    const bridge = realm.sandbox.__bstage_bridge__ as { fetch: typeof fetch }
    await expect((await bridge.fetch('https://api.example.org/v1')).text()).resolves.toBe('relayed')
    expect(externalFetchImpl).toHaveBeenCalledTimes(1)
  })
})
