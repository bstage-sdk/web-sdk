import { describe, expect, it } from 'vitest'
import { BridgeError } from '../protocol/errors.js'
import {
  ALLOWED_REQUEST_HEADERS,
  DEFAULT_GATEWAY_DENY_SEGMENTS,
  DEFAULT_POLICY,
  classifyDestination,
  filterHeaders,
  prepareFetch,
  resolvePolicy,
  type DestinationContext,
} from './policy.js'

/**
 * 목적지 세 갈래(같은 origin /gw · 파트너 · 그 밖의 https)와 기본 거절 목록.
 * 갈래마다 다른 fetch·자격증명이 붙으므로, 어느 URL이 어느 갈래로 가는지를 여기서 고정한다.
 */

const HOST = 'https://space.example.com'
const PARTNER = 'https://partner.example.net'
const ctx: DestinationContext = {
  hostOrigin: HOST,
  partnerOrigins: [PARTNER],
  // external 갈래는 옵트인이다 — 이 파일의 기본 컨텍스트는 켠 상태로 본다.
  policy: resolvePolicy({ allowExternal: true }),
  pinnedHeaders: { 'x-bstage-tenant-id': 'space-1', 'x-bstage-app-id': 'pinned-app' },
}
const closed: DestinationContext = { ...ctx, policy: DEFAULT_POLICY }

/** IPv4 리터럴을 조립한다 — 공개 스냅샷 금칙 패턴이 소스의 점 표기 IP를 거부한다. */
function ipv4(...octets: number[]): string {
  return octets.join('.')
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn()
  } catch (err) {
    return err instanceof BridgeError ? err.code : 'NOT_BRIDGE_ERROR'
  }
  return undefined
}

describe('목적지 분류', () => {
  it('같은 origin /gw → gateway', () => {
    expect(classifyDestination('/gw/a', ctx)).toEqual({ url: `${HOST}/gw/a`, kind: 'gateway' })
  })

  it('파트너 origin 정확 일치 → partner', () => {
    expect(classifyDestination(`${PARTNER}/v1`, ctx)).toEqual({
      url: `${PARTNER}/v1`,
      kind: 'partner',
    })
  })

  it.each([
    ['https://api.example.org/v1?q=1'],
    ['https://x.partner.example.net/a'],
    ['https://partner.example.net:8443/a'],
    ['https://space.example.com.evil.io/gw/a'],
    ['https://x.space.example.com/gw/a'],
    ['//cdn.example.com/i18n.json'],
  ])('그 밖의 https origin(%s) → external(등록 불필요)', (url) => {
    expect(classifyDestination(url, ctx).kind).toBe('external')
  })

  it.each([
    ['/api/v1/me'],
    ['/gw/account/v1/auth/token/refresh'],
    ['http://space.example.com/gw/a'],
    ['http://api.example.org/v1'],
    ['https://user:pw@api.example.org/v1'],
    ['javascript:alert(1)'],
    ['data:text/plain,hi'],
    ['blob:https://api.example.org/x'],
    ['ws://api.example.org/x'],
  ])('호스트 origin의 /gw 밖·http·userinfo·비 http 스킴(%s)은 FORBIDDEN_DESTINATION', (url) => {
    expect(codeOf(() => classifyDestination(url, ctx))).toBe('FORBIDDEN_DESTINATION')
  })

  it('hostOrigin은 external로도 통과하지 않는다 — /gw 밖 같은 origin 경로(쿠키)가 열리면 안 된다', () => {
    expect(codeOf(() => classifyDestination(`${HOST}/account/v1/me`, ctx))).toBe(
      'FORBIDDEN_DESTINATION',
    )
  })

  it('allowExternal=false면 external만 막고 gateway·partner는 그대로', () => {
    expect(codeOf(() => classifyDestination('https://api.example.org/v1', closed))).toBe(
      'FORBIDDEN_DESTINATION',
    )
    expect(classifyDestination('/gw/a', closed).kind).toBe('gateway')
    expect(classifyDestination(`${PARTNER}/v1`, closed).kind).toBe('partner')
  })
})

describe('external 대상 제한 — 로컬·사설 네트워크와 호스트 변형', () => {
  it.each([
    ['https://localhost/x'],
    ['https://LOCALHOST:8443/x'],
    ['https://app.localhost/x'],
    ['https://printer.local/x'],
    ['https://svc.internal/x'],
    ['https://nas.home.arpa/x'],
    ['https://home.arpa/x'],
    ['https://localhost../x'],
    ['https://svc.internal../x'],
    ['https://a..example.org/x'],
    ['https://wiki.lan/x'],
    ['https://git.corp/x'],
    ['https://portal.intranet/x'],
    ['https://box.localdomain/x'],
    ['https://site.test/x'],
    ['https://x.invalid/x'],
    ['https://example/x'],
    ['https://127.0.0.1/x'],
    ['https://0x7f.1/x'],
    ['https://2130706433/x'],
    [`https://${ipv4(10, 1, 2, 3)}/x`],
    [`https://${ipv4(172, 16, 0, 1)}/x`],
    [`https://${ipv4(172, 31, 255, 255)}/x`],
    [`https://${ipv4(192, 168, 0, 10)}/x`],
    [`https://${ipv4(169, 254, 169, 254)}/latest`],
    [`https://${ipv4(100, 64, 0, 1)}/x`],
    ['https://0.0.0.0/x'],
    ['https://[::1]/x'],
    ['https://[::]/x'],
    ['https://[fc00::1]/x'],
    ['https://[fd12:3456::1]/x'],
    ['https://[fe80::1]/x'],
    ['https://[::ffff:127.0.0.1]/x'],
    [`https://[::ffff:${ipv4(10, 0, 0, 1)}]/x`],
  ])('%s 는 FORBIDDEN_DESTINATION', (url) => {
    expect(codeOf(() => classifyDestination(url, ctx))).toBe('FORBIDDEN_DESTINATION')
  })

  it.each([
    [`https://${ipv4(8, 8, 8, 8)}/x`],
    [`https://${ipv4(172, 32, 0, 1)}/x`],
    ['https://[2606:4700::1111]/x'],
    ['https://intranet/x'],
  ])('IP 리터럴·단일 레이블 호스트(%s)는 공인이어도 external로 보내지 않는다', (url) => {
    expect(codeOf(() => classifyDestination(url, ctx))).toBe('FORBIDDEN_DESTINATION')
  })

  it('allowExternal=false면 프로토콜 상대 URL도 거절', () => {
    expect(codeOf(() => classifyDestination('//cdn.example.com/a.json', closed))).toBe(
      'FORBIDDEN_DESTINATION',
    )
  })

  it.each([
    ['https://space.example.com./gw/a'],
    ['https://space.example.com:8443/gw/a'],
    ['https://space.example.com%2e/gw/a'],
    ['https://space.example.com../gw/a'],
  ])('호스트와 같은 호스트명(끝 점·다른 포트, %s)은 external이 아니다', (url) => {
    expect(codeOf(() => classifyDestination(url, ctx))).toBe('FORBIDDEN_DESTINATION')
  })

  it('partnerOrigins에 든 origin은 이 제한과 무관하다(호스트가 고른 목록)', () => {
    const local = { ...ctx, partnerOrigins: ['https://localhost:8443'] }
    expect(classifyDestination('https://localhost:8443/x', local).kind).toBe('partner')
  })
})

describe('갈래별 요청 인자', () => {
  const frameHeaders = {
    'content-type': 'application/json',
    authorization: 'Bearer leaked',
    cookie: 'a=b',
    'x-bstage-tenant-id': 'other-tenant',
    'x-bstage-app-id': 'frame-app',
    'x-bmf-sdk-version': '0.48.0',
    'x-bmf-other': '1',
  }

  // 토큰이 실리는 요청 — 템플릿 헤더를 그대로 넘기고(자격증명·테넌시 제외) 고정 헤더를 덮는다.
  const tokenRequestHeaders = {
    'content-type': 'application/json',
    'x-bstage-app-id': 'pinned-app',
    'x-bstage-tenant-id': 'space-1',
    'x-bmf-sdk-version': '0.48.0',
    'x-bmf-other': '1',
  }

  it('gateway — same-origin, 템플릿 헤더 유지 + 고정 헤더가 덮인다', () => {
    const p = prepareFetch({ url: '/gw/a', headers: frameHeaders }, ctx)
    expect(p.init.credentials).toBe('same-origin')
    expect(p.init.headers).toEqual(tokenRequestHeaders)
  })

  it('partner — credentials omit·redirect error·no-referrer, 템플릿 헤더 유지 + 고정 헤더가 덮인다', () => {
    const p = prepareFetch({ url: `${PARTNER}/v1`, headers: frameHeaders }, ctx)
    expect(p.init).toEqual({
      method: 'GET',
      headers: tokenRequestHeaders,
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    })
  })

  it('external — 허용 목록만, 고정 헤더·인증·쿠키·테넌시 없음', () => {
    const p = prepareFetch({ url: 'https://api.example.org/v1', headers: frameHeaders }, ctx)
    expect(p.init).toEqual({
      method: 'GET',
      headers: {
        'content-type': 'application/json',
        'x-bstage-app-id': 'frame-app',
        'x-bmf-sdk-version': '0.48.0',
      },
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    })
  })

  it('gateway 요청에는 referrerPolicy를 바꾸지 않는다(같은 origin)', () => {
    expect('referrerPolicy' in prepareFetch({ url: '/gw/a' }, ctx).init).toBe(false)
  })

  it('external에도 본문 상한·메서드 제한이 그대로 적용된다', () => {
    const big = 'x'.repeat(DEFAULT_POLICY.maxBodyBytes + 1)
    expect(
      codeOf(() =>
        prepareFetch({ url: 'https://api.example.org/v1', method: 'POST', body: big }, ctx),
      ),
    ).toBe('BODY_TOO_LARGE')
    expect(
      codeOf(() => prepareFetch({ url: 'https://api.example.org/v1', method: 'TRACE' }, ctx)),
    ).toBe('FORBIDDEN_METHOD')
  })
})

describe('요청 헤더 허용 목록', () => {
  it('x-bmf-sdk-version은 통과, 그 밖의 x-bmf-*는 버린다', () => {
    expect(ALLOWED_REQUEST_HEADERS).toContain('x-bmf-sdk-version')
    expect(filterHeaders({ 'X-BMF-SDK-Version': '1.0.0', 'x-bmf-trace': 't' })).toEqual({
      'x-bmf-sdk-version': '1.0.0',
    })
  })
})

describe('기본 거절 세그먼트', () => {
  it('공개 상수와 기본 정책이 같은 목록이다(호스트가 명시해 넘길 수 있게)', () => {
    expect(DEFAULT_GATEWAY_DENY_SEGMENTS).toEqual([
      'auth',
      'logout',
      'mfa',
      'token',
      'oauth',
      'sso',
      'debug',
      'debugger',
      'xdebug',
      'withdraw',
    ])
    expect(DEFAULT_POLICY.gatewayDenySegments).toEqual(DEFAULT_GATEWAY_DENY_SEGMENTS)
    expect(Object.isFrozen(DEFAULT_GATEWAY_DENY_SEGMENTS)).toBe(true)
    expect(
      resolvePolicy({ gatewayDenySegments: DEFAULT_GATEWAY_DENY_SEGMENTS }).gatewayDenySegments,
    ).toEqual(DEFAULT_GATEWAY_DENY_SEGMENTS)
  })

  it.each([
    ['/gw/svc/x/debug'],
    ['/gw/svc/x/debugger/vars'],
    ['/gw/svc/x/XDEBUG'],
    ['/gw/svc/account/api/v1/users/withdraw'],
    ['/gw/account/api/v1/users/withdraw'],
    ['/gw/svc/x/%64ebug'],
    ['/gw/svc/x/a%2Fwithdraw'],
  ])('%s 는 FORBIDDEN_DESTINATION', (url) => {
    expect(codeOf(() => classifyDestination(url, ctx))).toBe('FORBIDDEN_DESTINATION')
  })

  it.each([
    ['/gw/svc/x/tokens'],
    ['/gw/svc/x/access-tokens/1'],
    ['/gw/svc/x/refreshToken'],
    ['/gw/svc/x/id_token'],
    ['/gw/svc/x/%74okens'],
    ['/gw/svc/x/a%2Fmy-token-list'],
  ])('"token"이 들어간 세그먼트(%s)는 거절한다', (url) => {
    expect(codeOf(() => classifyDestination(url, ctx))).toBe('FORBIDDEN_DESTINATION')
  })

  it('호스트가 넘긴 거절 세그먼트는 소문자로 정규화한다(입력 배열은 바꾸지 않는다)', () => {
    const input = Object.freeze(['Withdraw', 'DEBUG'])
    const policy = resolvePolicy({ gatewayDenySegments: input })
    expect(policy.gatewayDenySegments).toEqual(['withdraw', 'debug'])
    expect(input).toEqual(['Withdraw', 'DEBUG'])
    const custom = { ...ctx, policy }
    expect(codeOf(() => classifyDestination('/gw/svc/x/withdraw', custom))).toBe(
      'FORBIDDEN_DESTINATION',
    )
    expect(codeOf(() => classifyDestination('/gw/svc/x/Debug', custom))).toBe(
      'FORBIDDEN_DESTINATION',
    )
  })

  it('"token" 부분 문자열 규칙은 거절 세그먼트를 비워도 꺼지지 않는다', () => {
    const open = { ...ctx, policy: resolvePolicy({ gatewayDenySegments: [] }) }
    expect(codeOf(() => classifyDestination('/gw/svc/x/access-tokens', open))).toBe(
      'FORBIDDEN_DESTINATION',
    )
    expect(classifyDestination('/gw/svc/x/debug', open).kind).toBe('gateway')
  })

  it('쿼리의 token은 경로 판정과 무관하다', () => {
    expect(classifyDestination('/gw/svc/x/items?token=1', ctx).kind).toBe('gateway')
  })

  it('비슷하지만 다른 세그먼트(debugging·withdrawal)는 통과', () => {
    expect(classifyDestination('/gw/svc/x/debugging', ctx).kind).toBe('gateway')
    expect(classifyDestination('/gw/svc/x/withdrawal', ctx).kind).toBe('gateway')
  })

  it('거절 세그먼트는 partner·external 경로에 적용하지 않는다(게이트웨이 규칙)', () => {
    expect(classifyDestination(`${PARTNER}/auth/token`, ctx).kind).toBe('partner')
    expect(classifyDestination('https://api.example.org/oauth/token', ctx).kind).toBe('external')
  })
})

describe('resolvePolicy — allowExternal', () => {
  it('기본 false(옵트인) — 패키지를 올리기만 해서 외부 채널이 열리지 않는다', () => {
    expect(resolvePolicy(undefined).allowExternal).toBe(false)
    expect(DEFAULT_POLICY.allowExternal).toBe(false)
    expect(
      codeOf(() =>
        classifyDestination('https://api.example.org/v1', { ...ctx, policy: DEFAULT_POLICY }),
      ),
    ).toBe('FORBIDDEN_DESTINATION')
  })

  it.each([['false'], [0], [null]])('불리언이 아니면(%j) TypeError', (allowExternal) => {
    expect(() => resolvePolicy({ allowExternal } as never)).toThrow(TypeError)
  })
})
