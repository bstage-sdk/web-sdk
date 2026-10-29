import { describe, expect, it } from 'vitest'
import { BridgeError } from '../protocol/errors.js'
import {
  DEFAULT_POLICY,
  filterHeaders,
  normalizePinnedHeaders,
  passThroughHeaders,
  MAX_PASS_THROUGH_HEADERS,
  normalizePartnerOrigins,
  prepareFetch,
  resolveDestination,
  classifyDestination,
  resolvePolicy,
  type DestinationContext,
} from './policy.js'

/**
 * 프레임이 호스트 권한으로 보낼 수 있는 범위를 정하는 곳이라 분기마다 고정한다.
 * 손 검증은 /gw GET 해피패스만 태우므로, 거절 분기(정규화 우회·userinfo·포트·메서드·본문)는 여기서만 실행된다.
 */

const HOST = 'https://space.example.com'
const ctx: DestinationContext = {
  hostOrigin: HOST,
  partnerOrigins: ['https://partner.example.net', 'https://api.partner.io:8443'],
  // external 갈래는 옵트인 — 분류 테스트는 켠 상태를 기준으로 하고, 끈 상태는 `closed`로 본다.
  policy: resolvePolicy({ allowExternal: true }),
}
/** 외부(external) 갈래를 끈 정책 — "다른 origin은 거절" 분기를 보려면 이걸 쓴다(기본은 external로 통과). */
const closed: DestinationContext = { ...ctx, policy: DEFAULT_POLICY }

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn()
  } catch (err) {
    return err instanceof BridgeError ? err.code : 'NOT_BRIDGE_ERROR'
  }
  return undefined
}

describe('resolveDestination — (a) 같은 origin + 게이트웨이 접두사', () => {
  it('상대 경로를 hostOrigin 기준으로 정규화해 통과시킨다', () => {
    expect(resolveDestination('/gw/content/v1/boards', ctx)).toBe(`${HOST}/gw/content/v1/boards`)
  })

  it('절대 URL·쿼리를 유지한다', () => {
    expect(resolveDestination(`${HOST}/gw/a?b=1`, ctx)).toBe(`${HOST}/gw/a?b=1`)
  })

  it('/gw 정확 일치를 허용한다', () => {
    expect(resolveDestination('/gw', ctx)).toBe(`${HOST}/gw`)
  })

  it('/gwx 같은 접두사 유사 경로는 거절한다', () => {
    expect(codeOf(() => resolveDestination('/gwx/a', ctx))).toBe('FORBIDDEN_DESTINATION')
    expect(codeOf(() => resolveDestination('/gw-admin', ctx))).toBe('FORBIDDEN_DESTINATION')
  })

  it.each([
    ['/gw/../account/v1/me'],
    ['/gw/%2e%2e/account'],
    ['/gw/%2E%2E/account'],
    ['/gw/.%2e/account'],
    ['/gw\\..\\account'],
    ['/gw/a/../../account'],
  ])('점 세그먼트 우회(%s)는 정규화 후 /gw 밖이라 거절한다', (url) => {
    expect(codeOf(() => resolveDestination(url, ctx))).toBe('FORBIDDEN_DESTINATION')
  })

  it('정규화 결과가 여전히 /gw 안이면 통과하고, 보내는 URL은 정규화된 값이다', () => {
    expect(resolveDestination('/gw/a/../b', ctx)).toBe(`${HOST}/gw/b`)
  })

  it('인코딩된 슬래시(%2f)는 경로 구분자로 풀리지 않아 /gw 밖이다', () => {
    expect(codeOf(() => resolveDestination('/gw%2f..%2faccount', ctx))).toBe(
      'FORBIDDEN_DESTINATION',
    )
  })

  it.each([
    ['/gw/..%2f..%2fadmin'],
    ['/gw/%2e%2e%2fadmin'],
    ['/gw/..;/admin'],
    ['/gw/%252e%252e/x'],
    ['/gw/a%5c..%5cx'],
    ['/gw/x/a%2F..%2F..%2Fapi'],
    ['/gw/%2e%2e/api'],
    ['/gw/x/%25252e%25252e/api'],
    ['/gw/x;jsessionid=1'],
    ['/gw/..%255c..%255cadmin'],
    ['/gw/..%3b/admin'],
    ['/gw/%252525252e%252525252e/api'],
    ['/gw/x/%25%32%65%25%32%65/api'],
    ['/gw/x/%2525%32%65./api'],
    ['/gw/..%c0%af..%c0%afadmin'],
    ['/gw/..%C0%AF..%C0%AFadmin'],
    ['/gw/..%e0%80%af..%e0%80%afadmin'],
    ['/gw/%252e%252e/api'],
    ['/gw/%252E%252E/api'],
    ['/gw/x/%00'],
    ['/gw/x/%0a'],
    ['/gw/x/100%25'],
    ['/gw/x/%25252525252e'],
  ])('세그먼트 안 인코딩 우회(%s)는 /gw/로 시작해도 거절한다', (url) => {
    expect(codeOf(() => resolveDestination(url, ctx))).toBe('FORBIDDEN_DESTINATION')
  })

  it.each([
    ['/gw/x/a%2Fb'],
    ['/gw/x/a%2fb'],
    ['/gw/x/%ED%95%9C'],
    ['/gw/x/a.b'],
    ['/gw/x/..a'],
    ['/gw/x/%2e%2eb'],
  ])('세그먼트 안 정상 인코딩 값(%s)은 inline처럼 통과한다', (url) => {
    expect(resolveDestination(url, ctx)).toBe(`${HOST}${url}`)
  })

  it('쿼리의 인코딩 문자는 경로 판정에 영향이 없다', () => {
    expect(resolveDestination('/gw/a?q=%2e%2f;x', ctx)).toBe(`${HOST}/gw/a?q=%2e%2f;x`)
  })

  it('/gw 밖 같은 origin 경로를 거절한다', () => {
    expect(codeOf(() => resolveDestination('/api/me', ctx))).toBe('FORBIDDEN_DESTINATION')
    expect(codeOf(() => resolveDestination('/', ctx))).toBe('FORBIDDEN_DESTINATION')
  })

  it('userinfo가 붙으면 거절한다', () => {
    expect(codeOf(() => resolveDestination('https://u:p@space.example.com/gw/a', ctx))).toBe(
      'FORBIDDEN_DESTINATION',
    )
    expect(codeOf(() => resolveDestination('https://u@space.example.com/gw/a', ctx))).toBe(
      'FORBIDDEN_DESTINATION',
    )
  })

  it('포트가 다르면 다른 origin이다(gateway가 아니다, 같은 호스트명이라 external도 아니다)', () => {
    expect(codeOf(() => resolveDestination('https://space.example.com:8443/gw/a', ctx))).toBe(
      'FORBIDDEN_DESTINATION',
    )
    expect(codeOf(() => resolveDestination('https://space.example.com:8443/gw/a', closed))).toBe(
      'FORBIDDEN_DESTINATION',
    )
  })

  it('기본 포트 명시(:443)는 같은 origin으로 정규화된다', () => {
    expect(resolveDestination('https://space.example.com:443/gw/a', ctx)).toBe(`${HOST}/gw/a`)
  })

  it('스킴이 다르면(http) 거절한다', () => {
    expect(codeOf(() => resolveDestination('http://space.example.com/gw/a', ctx))).toBe(
      'FORBIDDEN_DESTINATION',
    )
  })

  it('프로토콜 상대 URL로 다른 호스트를 가리키면 gateway가 아니다(external, 끄면 거절)', () => {
    expect(classifyDestination('//evil.example.net/gw/a', ctx).kind).toBe('external')
    expect(codeOf(() => resolveDestination('//evil.example.net/gw/a', closed))).toBe(
      'FORBIDDEN_DESTINATION',
    )
  })

  it('서브도메인·접미사 위장 호스트는 gateway가 아니다(external, 끄면 거절)', () => {
    expect(classifyDestination('https://space.example.com.evil.io/gw/a', ctx).kind).toBe('external')
    expect(classifyDestination('https://x.space.example.com/gw/a', ctx).kind).toBe('external')
    expect(codeOf(() => resolveDestination('https://space.example.com.evil.io/gw/a', closed))).toBe(
      'FORBIDDEN_DESTINATION',
    )
    expect(codeOf(() => resolveDestination('https://x.space.example.com/gw/a', closed))).toBe(
      'FORBIDDEN_DESTINATION',
    )
  })

  it.each([['javascript:alert(1)'], ['data:text/plain,hi'], ['blob:https://space.example.com/x']])(
    '비 http 스킴(%s)을 거절한다',
    (url) => {
      expect(codeOf(() => resolveDestination(url, ctx))).toBe('FORBIDDEN_DESTINATION')
    },
  )

  it('정책 접두사를 바꾸면 그 접두사만 허용한다', () => {
    const narrow = { ...ctx, policy: resolvePolicy({ gatewayPrefixes: ['/gw/content/'] }) }
    expect(resolveDestination('/gw/content/v1', narrow)).toBe(`${HOST}/gw/content/v1`)
    expect(codeOf(() => resolveDestination('/gw/account/v1', narrow))).toBe('FORBIDDEN_DESTINATION')
  })
})

describe('resolveDestination — (b) 파트너 origin 정확 일치', () => {
  it('승인된 origin의 임의 경로를 통과시킨다', () => {
    expect(resolveDestination('https://partner.example.net/v1/x', ctx)).toBe(
      'https://partner.example.net/v1/x',
    )
  })

  it('포트까지 일치해야 한다', () => {
    expect(resolveDestination('https://api.partner.io:8443/a', ctx)).toBe(
      'https://api.partner.io:8443/a',
    )
    expect(classifyDestination('https://api.partner.io/a', ctx).kind).toBe('external')
    expect(codeOf(() => resolveDestination('https://api.partner.io/a', closed))).toBe(
      'FORBIDDEN_DESTINATION',
    )
  })

  it('하위 도메인·http는 일치가 아니다', () => {
    expect(classifyDestination('https://x.partner.example.net/a', ctx).kind).toBe('external')
    expect(codeOf(() => resolveDestination('https://x.partner.example.net/a', closed))).toBe(
      'FORBIDDEN_DESTINATION',
    )
    expect(codeOf(() => resolveDestination('http://partner.example.net/a', ctx))).toBe(
      'FORBIDDEN_DESTINATION',
    )
  })

  it('hostOrigin이 파트너 목록에 있어도 같은 origin은 게이트웨이 규칙만 적용한다', () => {
    const withHost = { ...ctx, partnerOrigins: [HOST, ...ctx.partnerOrigins] }
    expect(codeOf(() => resolveDestination('/api/auth/token/refresh', withHost))).toBe(
      'FORBIDDEN_DESTINATION',
    )
    expect(classifyDestination('/gw/a', withHost)).toEqual({ url: `${HOST}/gw/a`, kind: 'gateway' })
    expect(classifyDestination('https://partner.example.net/a', withHost).kind).toBe('partner')
  })

  it.each([
    ['/gw/account/v1/auth/token/refresh'],
    ['/gw/ACCOUNT/v1/Auth/token/refresh'],
    ['/gw/account/v1/auth%2ftoken%2frefresh'],
    ['/gw/account%2Fv1%2Fauth%2Ftoken%2Frefresh'],
    ['/gw/%61ccount/v1/auth/token/refresh'],
    ['/gw//account/v1/auth/token/refresh'],
    ['/gw/account/v1/users/logout'],
    ['/gw/account/v1/users/logout/all'],
  ])('기본 거절 접두사(%s)는 FORBIDDEN_DESTINATION', (url) => {
    expect(codeOf(() => resolveDestination(url, ctx))).toBe('FORBIDDEN_DESTINATION')
  })

  it.each([
    ['/gw/svc/account/api/v1/auth/token/refresh'],
    ['/gw/svc/api/v1/auth/token/refresh'],
    ['/gw/svc/account/api/v1/AUTH/token'],
    ['/gw/svc/account/api/v1/%61uth/token/refresh'],
    ['/gw/svc/x/a%2Fauth%2Ftoken'],
    ['/gw/svc/x/users/logout'],
    ['/gw/svc/x/mfa/verify'],
    ['/gw/svc/account/api/v1/token'],
    ['/gw/svc/account/api/v1/token/refresh'],
    ['/gw/svc/x/TOKEN'],
    ['/gw/svc/x/%74oken'],
    ['/gw/svc/x/oauth/callback'],
    ['/gw/svc/x/oauth'],
    ['/gw/svc/x/OAuth/authorize'],
    ['/gw/svc/x/sso/login'],
    ['/gw/svc/x/a%2Fsso'],
  ])('거절 세그먼트(%s)는 서비스·버전 접두사와 무관하게 거절', (url) => {
    expect(codeOf(() => resolveDestination(url, ctx))).toBe('FORBIDDEN_DESTINATION')
  })

  it('세그먼트 일부만 같은 값(authors·logouts·oauth2·ssor)은 통과 — token이 든 세그먼트는 예외', () => {
    expect(resolveDestination('/gw/svc/x/authors/1', ctx)).toBe(`${HOST}/gw/svc/x/authors/1`)
    expect(resolveDestination('/gw/svc/x/logouts', ctx)).toBe(`${HOST}/gw/svc/x/logouts`)
    expect(codeOf(() => resolveDestination('/gw/svc/x/tokens', ctx))).toBe('FORBIDDEN_DESTINATION')
    expect(resolveDestination('/gw/svc/x/oauth2', ctx)).toBe(`${HOST}/gw/svc/x/oauth2`)
    expect(resolveDestination('/gw/svc/x/ssor', ctx)).toBe(`${HOST}/gw/svc/x/ssor`)
  })

  it('거절 접두사 밖 account 경로·logout 유사 경로는 통과', () => {
    expect(resolveDestination('/gw/account/v1/users/me', ctx)).toBe(
      `${HOST}/gw/account/v1/users/me`,
    )
    expect(resolveDestination('/gw/account/v1/users/logoutx', ctx)).toBe(
      `${HOST}/gw/account/v1/users/logoutx`,
    )
  })

  it('거절 접두사는 정책으로 바꿀 수 있다(빈 목록 허용)', () => {
    const open = {
      ...ctx,
      policy: resolvePolicy({ gatewayDenyPrefixes: [], gatewayDenySegments: [] }),
    }
    expect(resolveDestination('/gw/account/v1/auth/x', open)).toBe(`${HOST}/gw/account/v1/auth/x`)
    const custom = { ...ctx, policy: resolvePolicy({ gatewayDenyPrefixes: ['/gw/admin/'] }) }
    expect(codeOf(() => resolveDestination('/gw/Admin/x', custom))).toBe('FORBIDDEN_DESTINATION')
  })

  it('normalizePartnerOrigins는 hostOrigin을 뺀다', () => {
    expect(normalizePartnerOrigins([HOST, 'https://p.example'], HOST)).toEqual([
      'https://p.example',
    ])
  })

  it('파트너 요청 init은 credentials omit', () => {
    expect(prepareFetch({ url: 'https://partner.example.net/a' }, ctx)).toMatchObject({
      kind: 'partner',
      init: { credentials: 'omit', redirect: 'error' },
    })
  })

  it('번역 CDN 등 assetOrigin을 파트너로 자동 포함하지 않는다(무인증 external일 뿐)', () => {
    expect(classifyDestination('https://cdn.example.com/i18n.json', ctx).kind).toBe('external')
    expect(codeOf(() => resolveDestination('https://cdn.example.com/i18n.json', closed))).toBe(
      'FORBIDDEN_DESTINATION',
    )
  })
})

describe('resolveDestination — 입력 형식', () => {
  it.each([[undefined], [42], [''], ['x'.repeat(9000)]])('잘못된 url(%s)은 BAD_REQUEST', (url) => {
    expect(codeOf(() => resolveDestination(url, ctx))).toBe('BAD_REQUEST')
  })

  it('파싱 불가 URL은 BAD_REQUEST', () => {
    expect(codeOf(() => resolveDestination('https://[bad', ctx))).toBe('BAD_REQUEST')
  })
})

describe('normalizePartnerOrigins', () => {
  it('https 정확한 origin만 남기고 경로·와일드카드·http·중복을 버린다', () => {
    expect(
      normalizePartnerOrigins([
        'https://a.example',
        'https://a.example',
        'https://b.example/path',
        'https://*.example',
        'http://c.example',
        'https://d.example:8443',
        'https://e.example/',
        42,
      ]),
    ).toEqual(['https://a.example', 'https://d.example:8443'])
  })

  it('최대 10개', () => {
    const many = Array.from({ length: 12 }, (_, i) => `https://p${i}.example`)
    expect(normalizePartnerOrigins(many)).toHaveLength(10)
  })

  it('배열이 아니면 빈 목록', () => {
    expect(normalizePartnerOrigins(undefined)).toEqual([])
  })
})

describe('filterHeaders', () => {
  it('허용 목록(content-type·accept·accept-language·앱 헤더·x-bmf-sdk-version)만 통과(대소문자 무시)', () => {
    expect(
      filterHeaders({
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'accept-language': 'ko',
        Authorization: 'Bearer x',
        Cookie: 'a=b',
        'X-BMF-TIER': 'admin',
        'x-bmf-sdk-version': '1',
        'X-BSTAGE-APP-KEY': 'bsp_x',
        'X-BSTAGE-APP-ID': 'bsa_x',
        'x-bstage-tenant-id': 't',
        'X-Bstage-Org-Id': 'o',
        'x-bstage-enterprise-id': 'e',
        'x-bstage-member-token': 'nope',
      }),
    ).toEqual({
      'content-type': 'application/json',
      accept: 'application/json',
      'accept-language': 'ko',
      'x-bstage-app-key': 'bsp_x',
      'x-bstage-app-id': 'bsa_x',
      'x-bmf-sdk-version': '1',
    })
  })

  it('테넌시 헤더(tenant·org·enterprise)는 프레임 값을 버린다', () => {
    expect(
      filterHeaders({
        'x-bstage-tenant-id': 'victim',
        'X-BSTAGE-ORG-ID': 'o',
        'x-bstage-enterprise-id': 'e',
      }),
    ).toEqual({})
  })

  it('문자열이 아니거나 개행이 든 값은 버린다', () => {
    expect(filterHeaders({ accept: 1, 'content-type': 'a\r\nCookie: x' })).toEqual({})
  })

  it('객체가 아니면 빈 헤더', () => {
    expect(filterHeaders(null)).toEqual({})
    expect(filterHeaders(['accept', 'x'])).toEqual({})
  })
})

describe('passThroughHeaders', () => {
  it('토큰 요청용 — 템플릿 헤더를 그대로 넘기고 자격증명·테넌시 헤더만 버린다(대소문자 무시)', () => {
    expect(
      passThroughHeaders({
        'Content-Type': 'application/json',
        'X-Bmf-Space-Id': 'space-1',
        'X-BMF-LANGUAGE': 'ko',
        'x-custom-trace': 't',
        Authorization: 'Bearer x',
        'Proxy-Authorization': 'p',
        Cookie: 'a=b',
        'CF-Access-Client-Id': 'id',
        'cf-access-client-secret': 's',
        'cf-access-token': 't',
        'x-bstage-tenant-id': 'victim',
        'X-Bstage-Org-Id': 'o',
        'x-bstage-enterprise-id': 'e',
      }),
    ).toEqual({
      'content-type': 'application/json',
      'x-bmf-language': 'ko',
      'x-custom-trace': 't',
    })
  })

  it.each([
    // 인증·CSRF 근거로 읽히는 이름
    'authentication',
    'x-api-key',
    'api-key',
    'x-auth-token',
    'x-access-token',
    'x-amz-security-token',
    'x-csrf-token',
    'x-xsrf-token',
    // 스페이스 지정 — 호스트 고정값만
    'x-bmf-space-id',
    'x-bmf-sid',
    // 라우팅·신뢰
    'host',
    'forwarded',
    'x-real-ip',
    'x-client-ip',
    'true-client-ip',
    'x-original-url',
    'x-rewrite-url',
    'x-original-method',
    'x-http-method-override',
    'x-http-method',
    'x-method-override',
    'x-bmf-tier',
    'x-forwarded-for',
    'x-forwarded-host',
    'x-envoy-original-path',
    'x-amz-date',
    'proxy-connection',
    'sec-fetch-site',
    'cf-connecting-ip',
  ])('%s는 프레임 값을 버린다', (name) => {
    expect(passThroughHeaders({ [name.toUpperCase()]: 'v', 'x-keep': 'k' })).toEqual({
      'x-keep': 'k',
    })
  })

  it('이름이 올바르지 않거나 값이 문자열이 아니거나 개행이 든 항목은 버린다', () => {
    expect(
      passThroughHeaders({ 'bad name': 'x', accept: 1, 'x-a': 'a\r\nCookie: x', 'x-b': 'b\0' }),
    ).toEqual({})
  })

  it(`${MAX_PASS_THROUGH_HEADERS}개를 넘으면 BAD_REQUEST`, () => {
    const many = Object.fromEntries(
      Array.from({ length: MAX_PASS_THROUGH_HEADERS + 1 }, (_, i) => [`x-h${i}`, 'v']),
    )
    expect(() => passThroughHeaders(many)).toThrow(BridgeError)
    const max = Object.fromEntries(
      Array.from({ length: MAX_PASS_THROUGH_HEADERS }, (_, i) => [`x-h${i}`, 'v']),
    )
    expect(Object.keys(passThroughHeaders(max))).toHaveLength(MAX_PASS_THROUGH_HEADERS)
  })

  it('객체가 아니면 빈 헤더', () => {
    expect(passThroughHeaders(null)).toEqual({})
    expect(passThroughHeaders(['accept'])).toEqual({})
  })
})

describe('pinnedHeaders', () => {
  it('게이트웨이 요청에 호스트 고정값을 덮어 싣는다 — 테넌시는 고정값만, 앱 헤더는 고정값이 이긴다', () => {
    const pinned = normalizePinnedHeaders({
      'X-BSTAGE-TENANT-ID': 'space-1',
      'x-bstage-app-id': 'bsa_host',
    })
    const prepared = prepareFetch(
      {
        url: '/gw/a',
        headers: {
          'x-bstage-tenant-id': 'victim',
          'x-bstage-app-id': 'bsa_frame',
          'x-bstage-app-key': 'k',
        },
      },
      { ...ctx, pinnedHeaders: pinned },
    )
    expect(prepared.init.headers).toEqual({
      'x-bstage-tenant-id': 'space-1',
      'x-bstage-app-id': 'bsa_host',
      'x-bstage-app-key': 'k',
    })
  })

  it('파트너 요청에도 고정 헤더를 싣는다(토큰이 실리는 요청)', () => {
    const pinned = normalizePinnedHeaders({ 'x-bstage-tenant-id': 'space-1' })
    const partnerCtx = {
      ...ctx,
      partnerOrigins: ['https://partner.example.net'],
      pinnedHeaders: pinned,
    }
    expect(prepareFetch({ url: 'https://partner.example.net/a' }, partnerCtx).init.headers).toEqual(
      {
        'x-bstage-tenant-id': 'space-1',
      },
    )
  })

  it('외부 요청에는 고정 헤더를 싣지 않는다', () => {
    const pinned = normalizePinnedHeaders({ 'x-bstage-tenant-id': 'space-1' })
    const externalCtx = {
      ...ctx,
      policy: { ...ctx.policy, allowExternal: true },
      pinnedHeaders: pinned,
    }
    expect(prepareFetch({ url: 'https://api.example.org/a' }, externalCtx).init.headers).toEqual({})
  })

  it('스페이스 헤더(x-bmf-space-id·x-bmf-sid)는 고정값만 실린다 — 프레임 값은 덮이지 않고 버려진다', () => {
    const pinned = normalizePinnedHeaders({ 'X-Bmf-Space-Id': 'space-1', 'x-bmf-sid': 'space-1' })
    expect(pinned).toEqual({ 'x-bmf-space-id': 'space-1', 'x-bmf-sid': 'space-1' })
    expect(
      prepareFetch(
        { url: '/gw/a', headers: { 'x-bmf-space-id': 'victim', 'x-bmf-sid': 'victim' } },
        { ...ctx, pinnedHeaders: pinned },
      ).init.headers,
    ).toEqual({ 'x-bmf-space-id': 'space-1', 'x-bmf-sid': 'space-1' })
    expect(
      prepareFetch({ url: '/gw/a', headers: { 'x-bmf-space-id': 'victim' } }, ctx).init.headers,
    ).toEqual({})
  })

  it.each([
    [{ authorization: 'Bearer x' }],
    [{ 'Proxy-Authorization': 'x' }],
    [{ 'cf-access-client-secret': 's' }],
    [{ 'x-api-key': 'k' }],
    [{ 'x-csrf-token': 't' }],
    [{ 'bad name': 'x' }],
    [{ cookie: 'a=b' }],
    [{ 'x-bstage-tenant-id': 'a\r\nb' }],
    [{ accept: 1 }],
    [[]],
    ['x'],
  ])('허용되지 않는 키·값(%j)은 TypeError', (pinned) => {
    expect(() => normalizePinnedHeaders(pinned)).toThrow(TypeError)
  })

  it('생략하면 빈 객체', () => {
    expect(normalizePinnedHeaders(undefined)).toEqual({})
  })
})

describe('prepareFetch', () => {
  it('정규화 URL·대문자 메서드·same-origin credentials·redirect error로 만든다', () => {
    expect(
      prepareFetch(
        {
          url: '/gw/a',
          method: 'post',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        },
        ctx,
      ),
    ).toEqual({
      url: `${HOST}/gw/a`,
      kind: 'gateway',
      init: {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
        credentials: 'same-origin',
        redirect: 'error',
      },
    })
  })

  it('메서드 생략은 GET, 본문 없음', () => {
    expect(prepareFetch({ url: '/gw/a' }, ctx).init).toEqual({
      method: 'GET',
      headers: {},
      credentials: 'same-origin',
      redirect: 'error',
    })
  })

  it.each([['TRACE'], ['CONNECT'], ['OPTIONS'], ['get2']])('메서드 %s는 FORBIDDEN_METHOD', (m) => {
    expect(codeOf(() => prepareFetch({ url: '/gw/a', method: m }, ctx))).toBe('FORBIDDEN_METHOD')
  })

  it.each([['GET'], ['HEAD'], ['POST'], ['PUT'], ['PATCH'], ['DELETE']])('메서드 %s 허용', (m) => {
    expect(prepareFetch({ url: '/gw/a', method: m }, ctx).init.method).toBe(m)
  })

  it('문자열이 아닌 메서드는 BAD_REQUEST', () => {
    expect(codeOf(() => prepareFetch({ url: '/gw/a', method: 1 }, ctx))).toBe('BAD_REQUEST')
  })

  it('본문 상한 — 바이트 기준(멀티바이트 포함)', () => {
    const small = { ...ctx, policy: resolvePolicy({ maxBodyBytes: 10 }) }
    expect(
      prepareFetch({ url: '/gw/a', method: 'POST', body: 'x'.repeat(10) }, small).init.body,
    ).toBe('x'.repeat(10))
    expect(
      codeOf(() => prepareFetch({ url: '/gw/a', method: 'POST', body: 'x'.repeat(11) }, small)),
    ).toBe('BODY_TOO_LARGE')
    // 4글자지만 12바이트
    expect(
      codeOf(() => prepareFetch({ url: '/gw/a', method: 'POST', body: '가나다라' }, small)),
    ).toBe('BODY_TOO_LARGE')
    expect(
      prepareFetch(
        { url: '/gw/a', method: 'POST', body: '가나다' },
        { ...ctx, policy: resolvePolicy({ maxBodyBytes: 9 }) },
      ).init.body,
    ).toBe('가나다')
  })

  it('기본 상한 1MB', () => {
    expect(
      codeOf(() =>
        prepareFetch({ url: '/gw/a', method: 'PUT', body: 'x'.repeat(1024 * 1024 + 1) }, ctx),
      ),
    ).toBe('BODY_TOO_LARGE')
  })

  it('문자열이 아닌 본문·GET 본문은 BAD_REQUEST', () => {
    expect(codeOf(() => prepareFetch({ url: '/gw/a', method: 'POST', body: {} }, ctx))).toBe(
      'BAD_REQUEST',
    )
    expect(codeOf(() => prepareFetch({ url: '/gw/a', method: 'GET', body: 'x' }, ctx))).toBe(
      'BAD_REQUEST',
    )
  })

  it('null 본문은 본문 없음', () => {
    expect(prepareFetch({ url: '/gw/a', method: 'POST', body: null }, ctx).init).not.toHaveProperty(
      'body',
    )
  })

  it('payload가 객체가 아니면 BAD_REQUEST', () => {
    expect(codeOf(() => prepareFetch(null, ctx))).toBe('BAD_REQUEST')
  })

  it('목적지보다 메서드를 먼저 본다(어느 쪽이든 거절)', () => {
    expect(codeOf(() => prepareFetch({ url: 'https://evil.example', method: 'TRACE' }, ctx))).toBe(
      'FORBIDDEN_METHOD',
    )
  })
})

describe('resolvePolicy', () => {
  it('기본값', () => {
    expect(resolvePolicy(undefined)).toEqual({
      gatewayPrefixes: ['/gw/'],
      gatewayDenyPrefixes: ['/gw/account/v1/auth/', '/gw/account/v1/users/logout'],
      gatewayDenySegments: [
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
      ],
      allowExternal: false,
      maxBodyBytes: 1048576,
      maxRequestsPerMinute: 300,
      maxResponseBytes: 10485760,
    })
  })

  it.each([
    [{ gatewayPrefixes: [] }],
    [{ gatewayPrefixes: ['gw/'] }],
    [{ gatewayPrefixes: ['//evil'] }],
    [{ maxBodyBytes: 0 }],
    [{ maxRequestsPerMinute: 1.5 }],
    [{ maxResponseBytes: 0 }],
    [{ gatewayDenyPrefixes: ['account'] }],
    [{ gatewayDenyPrefixes: 'x' }],
    [{ gatewayDenySegments: ['a/b'] }],
    [{ gatewayDenySegments: [''] }],
  ])('잘못된 정책(%o)은 생성 시 TypeError', (p) => {
    expect(() => resolvePolicy(p as never)).toThrow(TypeError)
  })
})
