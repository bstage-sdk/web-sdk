import { existsSync, readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { createFakeLink, flush, HOST_ORIGIN } from './testing.js'

/**
 * 빌드 산출물 스모크 — tsup이 만든 `dist`에서 `createSrcdoc` 부트스트랩을 꺼내 빈 vm realm에서 돌리고,
 * `dist`의 `createBridgeHost`와 핸드셰이크·fetch까지 왕복한다. 소스 테스트는 vite 변환을 거친 함수를
 * 직렬화하므로, 배포물(esbuild 출력)의 `toString()`이 여전히 자기완결인지는 여기서만 확인된다.
 *
 * `dist`가 없으면(빌드 전 `pnpm test`) 건너뛴다. CI는 build 뒤에 test를 돌린다.
 */

const DIST = new URL('../dist/', import.meta.url)
const built = existsSync(new URL('index.js', DIST)) && existsSync(new URL('host.js', DIST))

/**
 * `moduleResolution: "node"` 소비자(exports 맵을 읽지 않음, 예: web-base)는 `typesVersions`로만 서브패스
 * 타입을 찾는다. exports의 types 경로와 어긋나거나 그 d.ts가 빌드되지 않으면 `/host`·`/frame` import가
 * 타입 없이 깨진다.
 */
const PKG = new URL('../package.json', import.meta.url)
const pkgJson = JSON.parse(readFileSync(PKG, 'utf-8')) as {
  exports: Record<string, { import: { types: string } }>
  typesVersions: Record<string, Record<string, string[]>>
}
const SUBPATHS = Object.keys(pkgJson.exports)
  .filter((k) => k !== '.')
  .map((k) => k.slice(2))

describe('typesVersions(서브패스 타입)', () => {
  it('exports의 서브패스(host·frame)를 빠짐없이 같은 types 경로로 매핑한다', () => {
    expect([...SUBPATHS].sort()).toEqual(['frame', 'host'])
    expect(Object.keys(pkgJson.typesVersions['*']).sort()).toEqual([...SUBPATHS].sort())
    for (const sub of SUBPATHS) {
      expect(pkgJson.typesVersions['*'][sub]).toEqual([pkgJson.exports[`./${sub}`].import.types])
    }
  })

  it.skipIf(!built)('매핑한 d.ts가 dist에 있다', () => {
    for (const sub of SUBPATHS) {
      for (const target of pkgJson.typesVersions['*'][sub]) {
        expect(existsSync(new URL(target, PKG))).toBe(true)
      }
    }
  })
})

describe.skipIf(!built)('dist 스모크', () => {
  it('배포물 부트스트랩이 빈 realm에서 핸드셰이크·엔트리 로드·브리지 fetch까지 돈다', async () => {
    const pkg = await import(new URL('index.js', DIST).href)
    const hostPkg = await import(new URL('host.js', DIST).href)
    const link = createFakeLink()
    const session = pkg.createSession()
    const fetchImpl = vi.fn(
      async () => new Response('{"v":1}', { headers: { 'content-type': 'application/json' } }),
    )
    hostPkg.createBridgeHost({
      iframe: link.iframe,
      session,
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
      fetchImpl,
    })
    const html: string = pkg.createSrcdoc({
      nonce: pkg.createNonce(),
      session,
      hostOrigin: HOST_ORIGIN,
      assetOrigin: 'https://cdn.example.com',
      entryUrl: 'https://cdn.example.com/t/index.js',
      elementName: 'bstage-tpl-x',
      title: 't',
    })
    const script = /<script nonce="[^"]+">\n([\s\S]*)\n<\/script>/.exec(html)![1]
    const appended: Array<{ tagName: string; src?: string }> = []
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
      requestAnimationFrame: (cb: () => void) => setTimeout(cb, 0),
      customElements: { whenDefined: () => new Promise(() => {}) },
      document: {
        createElement: (tagName: string) => ({ tagName }),
        head: { appendChild: (n: never) => appended.push(n) },
        body: { appendChild: (n: never) => appended.push(n) },
      },
    }
    runInContext(script, createContext(sandbox))
    await flush(10)
    expect(appended[0]).toMatchObject({
      tagName: 'script',
      src: 'https://cdn.example.com/t/index.js',
    })
    const bridge = sandbox.__bstage_bridge__ as { fetch: typeof fetch }
    const res = await bridge.fetch('/gw/x')
    await expect(res.json()).resolves.toEqual({ v: 1 })
    expect(fetchImpl).toHaveBeenCalledWith(
      `${HOST_ORIGIN}/gw/x`,
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('배포물 부트스트랩이 옵션 없이 빈 realm에서 __bstage_fetch__로 /gw는 브리지, 외부는 원래 fetch로 보낸다', async () => {
    const pkg = await import(new URL('index.js', DIST).href)
    const hostPkg = await import(new URL('host.js', DIST).href)
    const link = createFakeLink()
    const session = pkg.createSession()
    const fetchImpl = vi.fn(async () => new Response('gateway'))
    hostPkg.createBridgeHost({
      iframe: link.iframe,
      session,
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
      fetchImpl,
    })
    const html: string = pkg.createSrcdoc({
      nonce: pkg.createNonce(),
      session,
      hostOrigin: HOST_ORIGIN,
      assetOrigin: 'https://cdn.example.com',
      entryUrl: 'https://cdn.example.com/t/index.js',
      elementName: 'bstage-tpl-x',
      title: 't',
    })
    expect(html).toContain('connect-src https: wss:')
    expect(html).not.toContain('connect-src &#39;none&#39;')
    const script = /<script nonce="[^"]+">\n([\s\S]*)\n<\/script>/.exec(html)![1]
    const nativeFetch = vi.fn(async () => new Response('native'))
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
      URL,
      fetch: nativeFetch,
      requestAnimationFrame: (cb: () => void) => setTimeout(cb, 0),
      customElements: { whenDefined: () => new Promise(() => {}) },
      document: {
        createElement: (tagName: string) => ({ tagName }),
        head: { appendChild: () => undefined },
        body: { appendChild: () => undefined },
      },
    }
    runInContext(script, createContext(sandbox))
    await flush(10)
    const routed = sandbox.__bstage_fetch__ as typeof fetch
    await expect((await routed('/gw/x')).text()).resolves.toBe('gateway')
    await expect((await routed('https://api.example.org/v1')).text()).resolves.toBe('native')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(nativeFetch).toHaveBeenCalledWith(
      'https://api.example.org/v1',
      expect.objectContaining({ credentials: 'omit', referrerPolicy: 'no-referrer' }),
    )
  })
})
