import { checkPath } from './pathSafety.js'
import { BridgeError } from '../protocol/errors.js'
import type { FetchRequest } from '../protocol/messages.js'

/** 호스트 fetch 정책. */
export interface BridgePolicy {
  /** 같은 origin에서 허용할 경로 접두사. 기본 `["/gw/"]`(`/gw` 정확 일치 포함). */
  readonly gatewayPrefixes: readonly string[]
  /**
   * `gatewayPrefixes` 안에서도 막는 경로 접두사. 기본은 인증 경로 — 토큰 갱신
   * (`/gw/account/v1/auth/token/refresh`)은 refresh 쿠키로 새 access token을 **응답 본문**에 돌려주므로
   * 프레임이 닿으면 토큰이 프레임에 들어간다. 디코딩·슬래시 병합·소문자화한 경로로 비교한다.
   */
  readonly gatewayDenyPrefixes: readonly string[]
  /**
   * 위치와 무관하게 막는 경로 세그먼트(소문자). 서비스·버전·phase 접두사가 붙은 실제 인증 경로
   * (`/gw/svc/account/api/v1/auth/token/refresh`·`/gw/svc/api/v1/auth/token/refresh`)도 잡기 위해
   * 접두사가 아니라 세그먼트로 본다. 기본은 {@link DEFAULT_GATEWAY_DENY_SEGMENTS}
   * (`/gw/svc/x/token`·`/gw/svc/x/oauth/callback`·`/gw/svc/x/sso/login`처럼 auth 밖에서 토큰을 내는 경로,
   * 디버그 엔드포인트, 회원 탈퇴 포함). 호스트는 이 상수를 명시해
   * 넘기면 정책이 코드에 드러난다(값은 이 패키지 버전의 기본값과 같다 — 고정이 필요하면 리터럴 목록이나
   * `[...DEFAULT_GATEWAY_DENY_SEGMENTS, '추가']`처럼 넘긴다).
   *
   * 이 목록과 별개로 **`token`이 들어간 세그먼트**(`tokens`·`access-tokens`·`refreshToken`)는 항상
   * 거절한다 — 정책으로 끌 수 없다.
   */
  readonly gatewayDenySegments: readonly string[]
  /**
   * 같은 origin `/gw`·파트너가 아닌 **그 밖의 https origin**을 `externalFetchImpl`로 보낼지. 기본 `false`
   * (옵트인) — 켜면 프레임이 임의 https로 데이터를 보내고 응답을 읽는 양방향 채널이 생기므로, 패키지를
   * 올리기만 해서 열리지 않게 한다. 외부 호출을 허용하는 호스트(web-base)는 `true`를 명시하고,
   * 막아야 하는 호스트(포털 미리보기)는 생략하거나 `false`.
   */
  readonly allowExternal: boolean
  /** 요청 본문 상한(UTF-8 바이트). 기본 1MB. */
  readonly maxBodyBytes: number
  /** 프레임별 분당 요청 상한. 기본 300. */
  readonly maxRequestsPerMinute: number
  /**
   * 응답 본문 상한(UTF-8 바이트). 기본 10MB. 프로토콜에 정해지지 않은 값(구현 선택) — 넘으면 `BODY_TOO_LARGE`.
   * 큰 응답 여러 개를 붙잡아 호스트 메모리를 쓰게 하는 것을 막는다.
   */
  readonly maxResponseBytes: number
}

/**
 * 기본 거절 세그먼트. 인증·토큰 발급(`auth`·`logout`·`mfa`·`token`·`oauth`·`sso`), 디버그 엔드포인트
 * (`debug`·`debugger`·`xdebug`), 회원 탈퇴(`withdraw`). 호스트가 `policy.gatewayDenySegments`로 그대로
 * 넘길 수 있게 공개한다.
 */
export const DEFAULT_GATEWAY_DENY_SEGMENTS: readonly string[] = Object.freeze([
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

/** 이 문자열이 들어간 세그먼트는 정책과 무관하게 거절한다(소문자 비교). */
const ALWAYS_DENIED_SEGMENT_SUBSTRINGS: readonly string[] = Object.freeze(['token'])

export const DEFAULT_POLICY: BridgePolicy = Object.freeze({
  gatewayPrefixes: Object.freeze(['/gw/']),
  gatewayDenyPrefixes: Object.freeze(['/gw/account/v1/auth/', '/gw/account/v1/users/logout']),
  gatewayDenySegments: DEFAULT_GATEWAY_DENY_SEGMENTS,
  allowExternal: false,
  maxBodyBytes: 1024 * 1024,
  maxRequestsPerMinute: 300,
  maxResponseBytes: 10 * 1024 * 1024,
})

/**
 * external(토큰 없는 그 밖의 https) 요청에 통과시키는 요청 헤더(소문자). 나머지는 버린다.
 * 토큰이 실리는 gateway·partner 요청은 이 목록이 아니라 {@link passThroughHeaders} 규칙을 따른다.
 */
export const ALLOWED_REQUEST_HEADERS: readonly string[] = Object.freeze([
  'content-type',
  'accept',
  'accept-language',
  // BstageClient가 보내는 앱 자격 헤더(파트너 콘솔 발급값, 브라우저 노출 전제 — 회원 토큰이 아니다).
  // 호스트가 `pinnedHeaders`로 값을 주면 그 값이 이긴다.
  'x-bstage-app-id',
  'x-bstage-app-key',
  // BstageClient가 모든 요청에 싣는 core 버전(정보용, 비밀 아님).
  'x-bmf-sdk-version',
])

/**
 * 테넌시 헤더 — 프레임 값은 **절대 통과시키지 않는다**. 호스트가 `pinnedHeaders`로 준 값만 실린다.
 * 프레임이 테넌트를 고르면 사용자 자격증명이 실린 요청을 다른 테넌트로 보내 응답을 읽을 수 있다.
 */
export const HOST_ONLY_HEADERS: readonly string[] = Object.freeze([
  'x-bstage-tenant-id',
  'x-bstage-org-id',
  'x-bstage-enterprise-id',
  // 스페이스 지정 헤더 — 프레임이 다른 스페이스로 회원 자격 요청을 돌리지 못하게 호스트 값만 싣는다.
  'x-bmf-space-id',
  'x-bmf-sid',
])

/**
 * 자격증명 헤더 — 어느 갈래에서도 프레임 값을 통과시키지 않고 `pinnedHeaders`로도 받지 않는다.
 * 회원 토큰·쿠키·CF Access는 호스트의 주입 fetch만 붙인다. 백엔드가 인증·CSRF 근거로 읽는 흔한 이름도 포함한다.
 */
export const CREDENTIAL_HEADERS: readonly string[] = Object.freeze([
  'authorization',
  'proxy-authorization',
  'authentication',
  'cookie',
  'cf-access-client-id',
  'cf-access-client-secret',
  'cf-access-token',
  'x-api-key',
  'api-key',
  'x-auth-token',
  'x-access-token',
  'x-amz-security-token',
  'x-csrf-token',
  'x-xsrf-token',
])

/**
 * 라우팅·신뢰 헤더 — 프록시·게이트웨이가 경로·메서드·클라이언트 IP·내부 티어를 바꾸는 근거로 읽는다.
 * 프레임 값은 통과시키지 않는다(정확 일치 + 접두사).
 */
export const ROUTING_HEADERS: readonly string[] = Object.freeze([
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
])

export const ROUTING_HEADER_PREFIXES: readonly string[] = Object.freeze([
  'x-forwarded-',
  'x-envoy-',
  'x-amz-',
  'proxy-',
  'sec-',
  'cf-',
])

/** 토큰이 실리는 요청에서도 프레임 값을 버리는 헤더인지(자격증명·테넌시·라우팅). */
function isFrameDeniedHeader(name: string): boolean {
  return (
    CREDENTIAL_HEADERS.includes(name) ||
    HOST_ONLY_HEADERS.includes(name) ||
    ROUTING_HEADERS.includes(name) ||
    ROUTING_HEADER_PREFIXES.some((prefix) => name.startsWith(prefix))
  )
}

/** 토큰이 실리는 요청에 프레임이 보낼 수 있는 헤더 개수 상한. */
export const MAX_PASS_THROUGH_HEADERS = 32

/** RFC 9110 field-name(token). */
const HEADER_NAME_RE = /^[!#$%&'*+.^_`|~0-9a-z-]+$/

export const ALLOWED_METHODS: readonly string[] = Object.freeze([
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
])

/** partnerOrigins 최대 개수. */
export const MAX_PARTNER_ORIGINS = 10

/** 요청 URL 최대 길이. 프로토콜에 정해지지 않은 값(구현 선택) — 비정상적으로 긴 URL을 막는 방어선. */
export const MAX_URL_LENGTH = 8192

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

/** 사용자 정책을 기본값과 합치고 검증한다. */
export function resolvePolicy(policy: Partial<BridgePolicy> | undefined): BridgePolicy {
  const merged = { ...DEFAULT_POLICY, ...(policy ?? {}) }
  if (
    !Array.isArray(merged.gatewayPrefixes) ||
    merged.gatewayPrefixes.length === 0 ||
    !merged.gatewayPrefixes.every((p) => typeof p === 'string' && /^\/[^/]/.test(p))
  ) {
    throw new TypeError('[bstage-bridge] gatewayPrefixes는 "/"로 시작하는 경로 목록이어야 합니다')
  }
  if (
    !Array.isArray(merged.gatewayDenyPrefixes) ||
    !merged.gatewayDenyPrefixes.every((p) => typeof p === 'string' && /^\/[^/]/.test(p))
  ) {
    throw new TypeError(
      '[bstage-bridge] gatewayDenyPrefixes는 "/"로 시작하는 경로 목록이어야 합니다',
    )
  }
  if (
    !Array.isArray(merged.gatewayDenySegments) ||
    !merged.gatewayDenySegments.every(
      (x) => typeof x === 'string' && x.length > 0 && !x.includes('/'),
    )
  ) {
    throw new TypeError('[bstage-bridge] gatewayDenySegments는 "/" 없는 세그먼트 목록이어야 합니다')
  }
  if (typeof merged.allowExternal !== 'boolean') {
    throw new TypeError('[bstage-bridge] allowExternal은 불리언이어야 합니다')
  }
  if (
    !isPositiveInteger(merged.maxBodyBytes) ||
    !isPositiveInteger(merged.maxRequestsPerMinute) ||
    !isPositiveInteger(merged.maxResponseBytes)
  ) {
    throw new TypeError(
      '[bstage-bridge] maxBodyBytes·maxRequestsPerMinute·maxResponseBytes는 양의 정수여야 합니다',
    )
  }
  return Object.freeze({
    ...merged,
    gatewayPrefixes: Object.freeze([...merged.gatewayPrefixes]),
    gatewayDenyPrefixes: Object.freeze([...merged.gatewayDenyPrefixes]),
    gatewayDenySegments: Object.freeze(merged.gatewayDenySegments.map((x) => x.toLowerCase())),
  })
}

/** origin 호스트에 허용하는 문자 — 와일드카드(`*`) 등은 URL 파서가 받아도 여기서 거절한다. */
const HOSTNAME_RE = /^(?:[a-z0-9-]+(?:\.[a-z0-9-]+)*|\[[0-9a-f:.]+\])$/

/** 값이 정확한 origin(`scheme://host[:port]`)이면 그 값을, 아니면 undefined. */
export function normalizeExactOrigin(
  value: unknown,
  protocols: readonly string[],
): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value)
    if (!protocols.includes(url.protocol) || !HOSTNAME_RE.test(url.hostname)) return undefined
    return url.origin === value ? value : undefined
  } catch {
    return undefined
  }
}

/**
 * partnerOrigins를 검증한다 — https 정확한 origin만, 중복 제거, `excludeOrigin`(hostOrigin) 제외,
 * 최대 10개. 나머지는 버린다.
 */
export function normalizePartnerOrigins(
  origins: unknown,
  excludeOrigin?: string,
): readonly string[] {
  if (!Array.isArray(origins)) return Object.freeze([])
  const valid = origins
    .map((o) => normalizeExactOrigin(o, ['https:']))
    .filter((o): o is string => o !== undefined && o !== excludeOrigin)
  return Object.freeze([...new Set(valid)].slice(0, MAX_PARTNER_ORIGINS))
}

/** 경로가 접두사에 걸리는지. `/gw/`는 `/gw/...`와 `/gw` 정확 일치를 허용한다. */
function matchesPrefix(pathname: string, prefix: string): boolean {
  const bare = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix
  return pathname === bare || pathname.startsWith(`${bare}/`)
}

/** 거절 목록 비교용 — 슬래시 병합 + 소문자(프록시가 `//`를 합치거나 대소문자를 무시하는 경우 대비). */
function denyKey(form: string): string {
  return form.replace(/\/{2,}/g, '/').toLowerCase()
}

/**
 * 같은 origin 경로가 게이트웨이로 보낼 수 있는지: 구조 검사(`checkPath`) 통과 + 원문이 허용 접두사 안 +
 * 어느 디코딩 단계도 거절 접두사·거절 세그먼트에 걸리지 않을 것.
 */
export function isAllowedGatewayPath(pathname: string, policy: BridgePolicy): boolean {
  const check = checkPath(pathname)
  if (!check.ok) return false
  if (!policy.gatewayPrefixes.some((p) => matchesPrefix(pathname, p))) return false
  const deny = policy.gatewayDenyPrefixes.map((p) => p.toLowerCase())
  const denySegments = policy.gatewayDenySegments
  return !check.forms.some((form) => {
    const key = denyKey(form)
    return (
      deny.some((p) => matchesPrefix(key, p)) ||
      key
        .split('/')
        .some(
          (segment) =>
            denySegments.includes(segment) ||
            ALWAYS_DENIED_SEGMENT_SUBSTRINGS.some((part) => segment.includes(part)),
        )
    )
  })
}

/**
 * external로 보내지 않는 로컬·사설·예약 이름. 그 이름 자체와 하위 이름을 모두 막는다(`home.arpa`·`x.home.arpa`).
 * RFC 6761·6762·8375의 특수 용도 이름과 흔한 사내망 접미사.
 */
const LOCAL_HOST_NAMES: readonly string[] = Object.freeze([
  'localhost',
  'local',
  'internal',
  'home.arpa',
  'test',
  'invalid',
  'example',
  'lan',
  'corp',
  'intranet',
  'localdomain',
])

/**
 * external 갈래에 보낼 수 있는 호스트명인지. 요청은 사용자 브라우저에서 호스트 페이지의 `Origin`으로 나가므로
 * (사용자 네트워크 위치·호스트 origin CORS 허용을 빌려 쓴다) 로컬·사설 네트워크를 겨누지 못하게 한다.
 * - 끝 점은 몇 개든 떼고 비교한다(`localhost..`). 그 뒤 빈 레이블(`a..b`)이 있으면 거절.
 * - IP 리터럴(IPv4·IPv6, 파서가 `0x7f.1`·`2130706433`을 정규화한 값 포함)은 공인 대역이어도 거절 —
 *   https + 유효 인증서로 IP를 부르는 공개 API는 드물고, 대역 목록을 열거하면 빈틈이 생긴다.
 * - 단일 레이블(`intranet`)과 {@link LOCAL_HOST_NAMES}(그 이름과 하위 이름)는 거절.
 * - 호스트 자신의 호스트명은 포트·끝 점이 달라도 거절 — 같은 서버의 다른 진입점이다.
 * DNS 이름이 사설 IP로 풀리는 경우는 브라우저 쪽에서 알 수 없다(브라우저의 Local Network Access가 다룬다).
 */
function isExternalHostAllowed(hostname: string, hostHostname: string): boolean {
  const name = hostname.replace(/\.+$/, '')
  if (name === '' || name.startsWith('[') || /^[0-9.]+$/.test(name)) return false
  const labels = name.split('.')
  if (labels.length < 2 || labels.some((label) => label === '')) return false
  if (LOCAL_HOST_NAMES.some((base) => name === base || name.endsWith(`.${base}`))) return false
  return name !== hostHostname.replace(/\.+$/, '')
}

export interface DestinationContext {
  readonly hostOrigin: string
  readonly partnerOrigins: readonly string[]
  readonly policy: BridgePolicy
  /** 토큰이 실리는 요청(gateway·partner)에 호스트가 덮어 싣는 헤더(`normalizePinnedHeaders` 결과). 외부 요청에는 싣지 않는다. */
  readonly pinnedHeaders?: Readonly<Record<string, string>>
}

/**
 * 목적지 종류.
 * - `gateway`: 같은 origin `/gw` — 쿠키·인증 fetch(`fetchImpl`), 고정 헤더.
 * - `partner`: `partnerOrigins` 정확 일치 — `partnerFetchImpl`(호스트가 팬 토큰을 붙일 수 있는 백엔드).
 * - `external`: 그 밖의 https origin(hostOrigin 제외) — `externalFetchImpl`, 무인증. `policy.allowExternal`로 끈다.
 */
export type DestinationKind = 'gateway' | 'partner' | 'external'

export interface Destination {
  readonly url: string
  readonly kind: DestinationKind
}

/**
 * 목적지 판정. `new URL(url, hostOrigin)`으로 정규화한 뒤(`..`·`%2e`·역슬래시는 여기서 해소된다)
 * (a) 같은 origin + 게이트웨이 접두사 + 모호하지 않은 경로 → gateway, (b) **hostOrigin이 아닌** 파트너
 * origin 정확 일치 → partner, (c) 그 밖의 https origin(`allowExternal`일 때, IP 리터럴·로컬 이름·
 * 호스트와 같은 호스트명 제외) → external.
 * hostOrigin은 (b)·(c)로 통과하지 않는다 — 그러면 /gw 밖 같은 origin 경로(쿠키 포함)가 열린다.
 * http·userinfo·비 http 스킴은 모두 거절한다.
 *
 * 돌려주는 `url`은 **판정한 그 URL**(`href`)이다 — 호출자는 이 값으로 보낸다(판정과 전송이 같은 URL).
 */
export function classifyDestination(rawUrl: unknown, ctx: DestinationContext): Destination {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0 || rawUrl.length > MAX_URL_LENGTH) {
    throw new BridgeError('BAD_REQUEST', 'invalid url')
  }
  let url: URL
  try {
    url = new URL(rawUrl, ctx.hostOrigin)
  } catch {
    throw new BridgeError('BAD_REQUEST', 'invalid url')
  }
  if (url.username !== '' || url.password !== '') {
    throw new BridgeError('FORBIDDEN_DESTINATION', 'destination not allowed')
  }
  const host = new URL(ctx.hostOrigin)
  if (url.origin === host.origin) {
    if (url.protocol === host.protocol && isAllowedGatewayPath(url.pathname, ctx.policy)) {
      return { url: url.href, kind: 'gateway' }
    }
    throw new BridgeError('FORBIDDEN_DESTINATION', 'destination not allowed')
  }
  if (url.protocol !== 'https:') {
    throw new BridgeError('FORBIDDEN_DESTINATION', 'destination not allowed')
  }
  if (ctx.partnerOrigins.includes(url.origin)) return { url: url.href, kind: 'partner' }
  if (ctx.policy.allowExternal && isExternalHostAllowed(url.hostname, host.hostname)) {
    return { url: url.href, kind: 'external' }
  }
  throw new BridgeError('FORBIDDEN_DESTINATION', 'destination not allowed')
}

/** `classifyDestination`의 URL만. */
export function resolveDestination(rawUrl: unknown, ctx: DestinationContext): string {
  return classifyDestination(rawUrl, ctx).url
}

export function resolveMethod(method: unknown): string {
  if (method === undefined) return 'GET'
  if (typeof method !== 'string') throw new BridgeError('BAD_REQUEST', 'invalid method')
  const upper = method.toUpperCase()
  if (!ALLOWED_METHODS.includes(upper)) {
    throw new BridgeError('FORBIDDEN_METHOD', 'method not allowed')
  }
  return upper
}

const UNSAFE_HEADER_VALUE_RE = /[\r\n\0]/

/**
 * 호스트가 고정하는 헤더를 검증·소문자화한다. 올바른 헤더 이름이면 받고, 자격증명 헤더
 * ({@link CREDENTIAL_HEADERS})는 TypeError — 이 경로로 authorization 같은 값을 실수로 넣지 못하게.
 */
export function normalizePinnedHeaders(pinned: unknown): Readonly<Record<string, string>> {
  if (pinned === undefined) return Object.freeze({})
  if (typeof pinned !== 'object' || pinned === null || Array.isArray(pinned)) {
    throw new TypeError('[bstage-bridge] pinnedHeaders는 객체여야 합니다')
  }
  const entries = Object.entries(pinned as Record<string, unknown>).map(([k, v]) => {
    const key = k.toLowerCase()
    if (!HEADER_NAME_RE.test(key) || CREDENTIAL_HEADERS.includes(key)) {
      throw new TypeError(`[bstage-bridge] pinnedHeaders에 허용되지 않는 헤더: ${k}`)
    }
    if (typeof v !== 'string' || UNSAFE_HEADER_VALUE_RE.test(v)) {
      throw new TypeError(`[bstage-bridge] pinnedHeaders 값이 잘못됐습니다: ${k}`)
    }
    return [key, v] as const
  })
  return Object.freeze(Object.fromEntries(entries))
}

/**
 * 토큰이 실리는 요청(gateway·partner)의 프레임 헤더 — 템플릿이 붙인 헤더를 그대로 넘긴다(inline 실행과 같은
 * 계약). 자격증명({@link CREDENTIAL_HEADERS})·테넌시·스페이스({@link HOST_ONLY_HEADERS})·라우팅
 * ({@link ROUTING_HEADERS}·{@link ROUTING_HEADER_PREFIXES}) 헤더만 버린다. 테넌시·스페이스는 `pinnedHeaders`로만 실린다.
 * 이름이 올바르지 않거나 값이 문자열이 아니거나 개행이 든 항목은 버리고, {@link MAX_PASS_THROUGH_HEADERS}개를
 * 넘으면 거절한다.
 */
export function passThroughHeaders(headers: unknown): Readonly<Record<string, string>> {
  if (typeof headers !== 'object' || headers === null || Array.isArray(headers)) return {}
  const raw = Object.entries(headers as Record<string, unknown>)
  if (raw.length > MAX_PASS_THROUGH_HEADERS) {
    throw new BridgeError('BAD_REQUEST', 'too many headers')
  }
  const entries = raw
    .map(([k, v]) => [k.toLowerCase(), v] as const)
    .filter(
      (entry): entry is readonly [string, string] =>
        HEADER_NAME_RE.test(entry[0]) &&
        !isFrameDeniedHeader(entry[0]) &&
        typeof entry[1] === 'string' &&
        !UNSAFE_HEADER_VALUE_RE.test(entry[1]),
    )
  return Object.freeze(Object.fromEntries(entries))
}

/** 토큰이 실리는 요청의 헤더 — 프레임 헤더({@link passThroughHeaders}) 위에 호스트 고정 헤더를 덮는다. */
export function mergeHeaders(
  frameHeaders: unknown,
  pinned: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  return Object.freeze({ ...passThroughHeaders(frameHeaders), ...pinned })
}

/** external 요청용 — 허용 헤더만 남긴다(키 소문자화). 문자열이 아니거나 개행이 든 값은 버린다. */
export function filterHeaders(headers: unknown): Readonly<Record<string, string>> {
  if (typeof headers !== 'object' || headers === null || Array.isArray(headers)) return {}
  const entries = Object.entries(headers as Record<string, unknown>)
    .map(([k, v]) => [k.toLowerCase(), v] as const)
    .filter(
      (entry): entry is readonly [string, string] =>
        ALLOWED_REQUEST_HEADERS.includes(entry[0]) &&
        typeof entry[1] === 'string' &&
        !/[\r\n\0]/.test(entry[1]),
    )
  return Object.freeze(Object.fromEntries(entries))
}

/** UTF-8 바이트 길이가 상한을 넘는지. 문자열 길이만으로 확정되는 경우 인코딩을 건너뛴다. */
export function exceedsBytes(body: string, max: number): boolean {
  if (body.length > max) return true
  if (body.length * 3 <= max) return false
  return new TextEncoder().encode(body).length > max
}

export function resolveBody(
  body: unknown,
  method: string,
  maxBodyBytes: number,
): string | undefined {
  if (body === undefined || body === null) return undefined
  if (typeof body !== 'string') throw new BridgeError('BAD_REQUEST', 'body must be a string')
  if (method === 'GET' || method === 'HEAD') {
    throw new BridgeError('BAD_REQUEST', 'GET/HEAD cannot have a body')
  }
  if (exceedsBytes(body, maxBodyBytes)) throw new BridgeError('BODY_TOO_LARGE', 'body too large')
  return body
}

export interface PreparedFetch {
  readonly url: string
  readonly kind: DestinationKind
  readonly init: {
    readonly method: string
    readonly headers: Readonly<Record<string, string>>
    readonly body?: string
    /** gateway는 `same-origin`(주입 인증 fetch), partner·external은 `omit`(쿠키 없음). */
    readonly credentials: 'same-origin' | 'omit'
    readonly redirect: 'error'
    /** partner·external만 — 호스트 페이지 URL(경로·쿼리)을 다른 origin에 Referer로 흘리지 않는다. */
    readonly referrerPolicy?: 'no-referrer'
  }
}

/** 프레임의 fetch 요청을 정책에 따라 실제 호출 인자로 바꾼다. 위반이면 BridgeError. */
export function prepareFetch(payload: unknown, ctx: DestinationContext): PreparedFetch {
  if (typeof payload !== 'object' || payload === null) {
    throw new BridgeError('BAD_REQUEST', 'invalid payload')
  }
  const req = payload as Partial<FetchRequest>
  const method = resolveMethod(req.method)
  const { url, kind } = classifyDestination(req.url, ctx)
  const body = resolveBody(req.body, method, ctx.policy.maxBodyBytes)
  // 토큰이 실리는 갈래(gateway·partner)는 템플릿 헤더를 그대로 넘기고 호스트 고정 헤더를 덮는다.
  // external은 토큰이 없으므로 허용 목록만.
  const headers =
    kind === 'external'
      ? filterHeaders(req.headers)
      : mergeHeaders(req.headers, ctx.pinnedHeaders ?? {})
  return {
    url,
    kind,
    init: {
      method,
      headers,
      ...(body !== undefined ? { body } : {}),
      credentials: kind === 'gateway' ? 'same-origin' : 'omit',
      ...(kind === 'gateway' ? {} : { referrerPolicy: 'no-referrer' as const }),
      // 브리지 프로토콜 인자에 더한 방어선: redirect를 따라가면 판정한 URL과 실제 목적지가 달라진다
      // (파트너 origin이 같은 origin의 /gw 밖 경로로 돌려보내면 쿠키가 실린 요청이 된다).
      redirect: 'error',
    },
  }
}
