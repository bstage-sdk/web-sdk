import { createContext, runInContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { createBridgeHost } from '../host/createBridgeHost.js'
import { createFakeLink, flush, HOST_ORIGIN, SESSION } from '../testing.js'
import {
  buildFrameCsp,
  createSrcdoc,
  MAX_ELEMENT_NAME_LENGTH,
  MAX_MEDIA_ORIGINS,
  type CreateSrcdocOptions,
} from './createSrcdoc.js'
import { escapeHtml, toScriptLiteral } from './escape.js'

/**
 * srcdoc는 격리의 바깥 경계(CSP)와 부트스트랩을 만든다. 손 검증은 정상 입력 한 번이라
 * 이스케이프·입력 거절·자기완결성(문자열로 심긴 런타임이 실제로 도는지)은 여기서만 확인된다.
 */

const NONCE = 'AbCdEfGhIjKlMnOpQrStUv'
const OPTS: CreateSrcdocOptions = {
  nonce: NONCE,
  session: SESSION,
  hostOrigin: HOST_ORIGIN,
  assetOrigin: 'https://cdn.example.com',
  entryUrl: 'https://cdn.example.com/t/abc/index.js',
  elementName: 'bstage-tpl-abc',
  title: '라운지 위젯',
}

const EXPECTED_CSP =
  "default-src 'none'; script-src 'nonce-AbCdEfGhIjKlMnOpQrStUv' https://cdn.example.com; " +
  "style-src 'unsafe-inline' https://cdn.example.com; img-src https://cdn.example.com data: blob:; " +
  "font-src https://cdn.example.com data:; media-src https://cdn.example.com blob:; connect-src 'none'; " +
  "frame-src 'none'; form-action 'none'; base-uri 'none'"

function scriptOf(html: string): string {
  const m = /<script nonce="[^"]+">\n([\s\S]*)\n<\/script>/.exec(html)
  if (!m) throw new Error('bootstrap script not found')
  return m[1]
}

describe('CSP', () => {
  it('브리지 프로토콜 문자열과 정확히 같다', () => {
    expect(buildFrameCsp(NONCE, 'https://cdn.example.com')).toBe(EXPECTED_CSP)
  })

  it('meta에 이스케이프되어 실린다(작은따옴표는 &#39;)', () => {
    const html = createSrcdoc(OPTS)
    expect(html).toContain(
      `<meta http-equiv="Content-Security-Policy" content="${EXPECTED_CSP.replace(/'/g, '&#39;')}">`,
    )
  })

  it('img-src·media-src에 맨 https: 와일드카드가 없다(임의 origin GET 유출 차단)', () => {
    const directives = buildFrameCsp(NONCE, 'https://cdn.example.com').split('; ')
    for (const d of directives) {
      expect(d.split(' ')).not.toContain('https:')
      expect(d.split(' ')).not.toContain('http:')
      expect(d.split(' ')).not.toContain('*')
    }
  })

  it('mediaOrigins는 img-src·media-src에만 정확한 origin으로 더해진다', () => {
    const html = createSrcdoc({
      ...OPTS,
      mediaOrigins: [
        'https://img.example.net',
        'https://video.example.org:8443',
        'https://img.example.net',
      ],
    })
    const csp = /content="([^"]+)"/.exec(html)?.[1].replace(/&#39;/g, "'") ?? ''
    const byName = new Map(csp.split('; ').map((d) => [d.split(' ')[0], d] as const))
    expect(byName.get('img-src')).toBe(
      'img-src https://cdn.example.com https://img.example.net https://video.example.org:8443 data: blob:',
    )
    expect(byName.get('media-src')).toBe(
      'media-src https://cdn.example.com https://img.example.net https://video.example.org:8443 blob:',
    )
    expect(byName.get('font-src')).toBe('font-src https://cdn.example.com data:')
    expect(byName.get('connect-src')).toBe("connect-src 'none'")
    expect(byName.get('script-src')).toBe(`script-src 'nonce-${NONCE}' https://cdn.example.com`)
  })

  it('mediaOrigins가 없거나 빈 배열이면 기본 CSP와 같다', () => {
    expect(buildFrameCsp(NONCE, 'https://cdn.example.com', [])).toBe(EXPECTED_CSP)
    expect(createSrcdoc({ ...OPTS, mediaOrigins: [] })).toBe(createSrcdoc(OPTS))
  })

  it.each([
    ['http://img.example.net'],
    ['https:'],
    ['https://*.example.net'],
    ['*'],
    ['https://img.example.net/path'],
    ['https://img.example.net/'],
    ['https://img.example.net?x=1'],
    ['https://u:p@img.example.net'],
    ['https://IMG.example.net'],
    ["https://img.example.net 'unsafe-eval'"],
    ['https://img.example.net; script-src *'],
    ['https://a;b.example.net'],
    ['https://img.example.net" onload="x'],
    ['data:'],
    [''],
  ])('mediaOrigins %j → TypeError(CSP에 실리지 않는다)', (bad) => {
    expect(() => createSrcdoc({ ...OPTS, mediaOrigins: ['https://ok.example.net', bad] })).toThrow(
      TypeError,
    )
    expect(() => buildFrameCsp(NONCE, 'https://cdn.example.com', [bad])).toThrow(TypeError)
  })

  it('mediaOrigins는 배열·최대 개수를 검사한다', () => {
    expect(() =>
      createSrcdoc({ ...OPTS, mediaOrigins: 'https://img.example.net' as never }),
    ).toThrow(TypeError)
    expect(() => createSrcdoc({ ...OPTS, mediaOrigins: [1] as never })).toThrow(TypeError)
    const max = Array.from({ length: MAX_MEDIA_ORIGINS }, (_, i) => `https://m${i}.example.net`)
    expect(() => createSrcdoc({ ...OPTS, mediaOrigins: max })).not.toThrow()
    expect(() =>
      createSrcdoc({ ...OPTS, mediaOrigins: [...max, 'https://extra.example.net'] }),
    ).toThrow(TypeError)
  })

  it('부트스트랩 script에 nonce가 붙고 문서에 다른 script 태그는 없다', () => {
    const html = createSrcdoc(OPTS)
    expect(html.match(/<script/g)).toHaveLength(1)
    expect(html).toContain(`<script nonce="${NONCE}">`)
  })
})

describe('이스케이프', () => {
  it('title의 HTML을 이스케이프한다', () => {
    const html = createSrcdoc({ ...OPTS, title: '</title><script>alert(1)</script>&"\'' })
    expect(html).toContain(
      '<title>&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;&amp;&quot;&#39;</title>',
    )
    expect(html.match(/<script/g)).toHaveLength(1)
  })

  it('스크립트 리터럴은 </script>·<!--·U+2028로 빠져나갈 수 없다', () => {
    const lit = toScriptLiteral('</script><!--\u2028\u2029&')
    expect(lit).not.toMatch(/<|>|&|\u2028|\u2029/)
    expect(JSON.parse(lit)).toBe('</script><!--\u2028\u2029&')
  })

  it('entryUrl의 특수문자는 URL 정규화 + 스크립트 이스케이프를 거친다', () => {
    const html = createSrcdoc({
      ...OPTS,
      entryUrl: 'https://cdn.example.com/t/"</script><script>alert(1)//.js',
    })
    expect(html.match(/<\/script/g)).toHaveLength(1)
    expect(html.match(/<script/g)).toHaveLength(1)
  })

  it('escapeHtml', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    )
  })
})

describe('입력 검증', () => {
  it.each([
    [{ nonce: 'short' }],
    [{ nonce: `${NONCE}" onload="x` }],
    [{ session: 'xyz' }],
    [{ hostOrigin: 'https://space.example.com/' }],
    [{ hostOrigin: 'not a url' }],
    [{ assetOrigin: "https://cdn.example.com 'unsafe-eval'" }],
    [{ assetOrigin: 'https://cdn.example.com/path' }],
    [{ assetOrigin: 'javascript:alert(1)' }],
    [{ assetOrigin: 'https://*.example.com' }],
    [{ assetOrigin: 'https://a;b.example.com' }],
    [{ entryUrl: 'https://evil.example/x.js' }],
    [{ entryUrl: 'https://u:p@cdn.example.com/x.js' }],
    [{ entryUrl: 'nope' }],
    [{ elementName: 'nodash' }],
    [{ elementName: 'Bad-Name' }],
    [{ elementName: 'x-"><script>' }],
    [{ title: 1 }],
  ])('%j → TypeError', (patch) => {
    expect(() => createSrcdoc({ ...OPTS, ...patch } as never)).toThrow(TypeError)
  })
})

describe('입력 검증 — 선형 시간', () => {
  // 이전 ELEMENT_NAME_RE는 `a` + `-`×16K 같은 실패 입력에서 이차 백트래킹(~0.4s)이었다.
  // 길이 상한은 정규식 앞에서 걸리므로, 정규식 자체도 상한 없이 선형인지 같이 본다.
  const ADVERSARIAL = [
    `a${'-'.repeat(20000)}!`,
    `a${'a-'.repeat(10000)}!`,
    `a${'.-'.repeat(10000)}A`,
  ]

  function elapsed(fn: () => void): number {
    const start = performance.now()
    fn()
    return performance.now() - start
  }

  it.each(ADVERSARIAL.map((s) => [s.slice(0, 8), s] as const))(
    'elementName %s…(20K자)는 50ms 안에 거절된다',
    (_label, name) => {
      expect(
        elapsed(() =>
          expect(() => createSrcdoc({ ...OPTS, elementName: name })).toThrow(TypeError),
        ),
      ).toBeLessThan(50)
    },
  )

  it('길이 상한 전후', () => {
    const at = `a-${'b'.repeat(MAX_ELEMENT_NAME_LENGTH - 2)}`
    expect(() => createSrcdoc({ ...OPTS, elementName: at })).not.toThrow()
    expect(() => createSrcdoc({ ...OPTS, elementName: `${at}c` })).toThrow(TypeError)
  })

  it.each([['a-'], ['a--b'], ['a.b-c'], ['bstage-tpl-abc'], ['x-1.2_3']])(
    '하이픈 규칙은 이전과 같다: %s 허용',
    (name) => {
      expect(() => createSrcdoc({ ...OPTS, elementName: name })).not.toThrow()
    },
  )

  it.each([['-a'], ['ab'], ['1-a'], ['a-B']])('하이픈 규칙은 이전과 같다: %s 거절', (name) => {
    expect(() => createSrcdoc({ ...OPTS, elementName: name })).toThrow(TypeError)
  })

  it('nonce·origin 검증도 20K자 적대 입력에서 50ms 안에 끝난다', () => {
    const cases: Array<Partial<CreateSrcdocOptions>> = [
      { nonce: `${'A'.repeat(20000)}!` },
      { nonce: `${'A'.repeat(20000)}===` },
      { assetOrigin: `https://${'a.'.repeat(10000)}!` },
      { assetOrigin: `https://${'a-'.repeat(10000)}.` },
      { mediaOrigins: [`https://${'a.'.repeat(10000)}!`] },
    ]
    for (const patch of cases) {
      expect(
        elapsed(() => expect(() => createSrcdoc({ ...OPTS, ...patch })).toThrow(TypeError)),
      ).toBeLessThan(50)
    }
  })
})

/**
 * 프레임 문서가 쓰는 최소 DOM만 세운 빈 vm 컨텍스트에서 부트스트랩을 실행한다. 이 realm에는 넘긴 전역만
 * 보이므로(`fetch`·`TextEncoder`·이 모듈의 import 모두 없음) 런타임이 바깥 식별자를 참조하면 여기서
 * 깨진다(자기완결성 검사).
 */
function frameRealm(link: ReturnType<typeof createFakeLink>) {
  const appended: Array<{ tagName: string; src?: string; onerror?: () => void }> = []
  const observed: unknown[] = []
  let define!: () => void
  const defined = new Promise<void>((r) => (define = r))
  const el = (tagName: string) => ({ tagName }) as { tagName: string; src?: string }
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
    ResizeObserver: class {
      constructor(_cb: unknown) {}
      observe(target: unknown) {
        observed.push(target)
      }
    },
    customElements: { whenDefined: () => defined },
    document: {
      documentElement: {},
      createElement: el,
      head: { appendChild: (n: never) => appended.push(n) },
      body: {
        appendChild: (n: never) => appended.push(n),
        getBoundingClientRect: () => ({ height: 321.4 }),
      },
    },
  }
  return { sandbox, appended, observed, define }
}

function runBootstrap(script: string, sandbox: Record<string, unknown>): void {
  runInContext(script, createContext(sandbox))
}

describe('부트스트랩(빈 realm에서 실행)', () => {
  it('init 수신 후 엔트리를 로드하고, 요소 정의 후 마운트·높이 보고, 브리지 fetch가 호스트로 간다', async () => {
    const link = createFakeLink()
    const resize = vi.fn()
    const fetchImpl = vi.fn(
      async () => new Response('{"v":1}', { headers: { 'content-type': 'application/json' } }),
    )
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
      fetchImpl,
      handlers: { resize },
    })
    const realm = frameRealm(link)
    runBootstrap(scriptOf(createSrcdoc(OPTS)), realm.sandbox)

    expect(realm.appended).toHaveLength(0)
    await flush(10)
    expect(realm.appended[0]).toMatchObject({ tagName: 'script', src: OPTS.entryUrl })

    realm.define()
    await flush(10)
    expect(realm.appended[1]).toEqual({ tagName: 'bstage-tpl-abc' })
    expect(realm.observed).toHaveLength(1)
    await new Promise((r) => setTimeout(r, 40))
    expect(resize).toHaveBeenCalledWith(322)

    const bridge = realm.sandbox.__bstage_bridge__ as { fetch: typeof fetch }
    const res = await bridge.fetch(`${HOST_ORIGIN}/gw/content/v1`, {
      headers: { authorization: 'Bearer from-frame' },
    })
    await expect(res.json()).resolves.toEqual({ v: 1 })
    expect(fetchImpl).toHaveBeenCalledWith(`${HOST_ORIGIN}/gw/content/v1`, {
      method: 'GET',
      headers: {},
      credentials: 'same-origin',
      redirect: 'error',
    })
  })

  it('엔트리 로드 실패를 log 요청으로 알린다', async () => {
    const link = createFakeLink()
    const log = vi.fn()
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
      handlers: { log },
    })
    const realm = frameRealm(link)
    runBootstrap(scriptOf(createSrcdoc(OPTS)), realm.sandbox)
    await flush(10)
    realm.appended[0].onerror?.()
    await flush(10)
    expect(log).toHaveBeenCalledWith('error', 'template entry failed to load')
  })

  it('세션·hostOrigin은 스크립트 상수로만 심기고 전역 설정으로 노출되지 않는다', () => {
    const script = scriptOf(createSrcdoc(OPTS))
    expect(script).toContain(`var SESSION = "${SESSION}";`)
    expect(script).toContain(`var HOST_ORIGIN = "${HOST_ORIGIN}";`)
    expect(script).not.toContain('__bstage_bridge_config__')
  })
})
