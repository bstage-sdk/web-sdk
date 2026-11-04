import { readLocale } from '../i18n.js'
import type {
  AccountClient,
  AccountClientOptions,
  AccountOtpResult,
  AccountSessionError,
  AccountSessionResult,
  AccountSpaceInfo,
  ReverificationState,
} from './types.js'

/**
 * inline(플랫폼 페이지에 직접 마운트) 구현 — 지금까지 계정 템플릿이 직접 하던 동작을 그대로 옮긴 것이다.
 * 동작을 바꾸지 않는 것이 목적이라 헤더·쿠키 속성·엔드포인트·오류 모양을 템플릿과 같게 둔다.
 * 이 파일은 `@bstage-sdk/core/account` 하위 진입점에만 실린다(일반 템플릿 번들에 쿠키 쓰기 코드가
 * 들어가지 않게).
 */

/** 플랫폼 쿠키 이름 — 접두는 스페이스와 무관하게 `bmf_` 고정. */
const COOKIE = {
  ACCESS_TOKEN: 'bmf_bstage_access_token',
  KEEP_LOGGED_IN: 'bmf_bstage_keep_logged_in',
  COUNTRY: 'bmf_bstage_country',
  SPACE_ID: 'bmf_bstage_space_id',
  SHOP_ID: 'bmf_bstage_shop_id',
  SHOP_CURRENCY: 'bmf_bstage_shop_currency_code',
} as const

const API = {
  signup: '/account/api/v1/signup',
  signupSocial: '/account/api/v1/signup/social',
  authToken: '/account/api/v1/auth/token',
  phoneReverification: '/account/api/v1/auth/phone-reverification',
  users: '/account/api/v1/users',
} as const

/** 플랫폼 로그인 흐름이 재인증 임시토큰을 넘겨 주는 전역 키. */
const HANDOFF_KEY = '__bmf_phone_reverification__'
const OTP_TIMEOUT_MS = 15_000
const HOME_PATH = '/'

interface Held {
  readonly token: string
  readonly expiresAt?: string
}

/** 인계받은 재인증 임시토큰 — 메모리에만 둔다(전역·스토리지·쿠키에 쓰지 않는다). */
let heldReverification: Held | undefined

/** @internal 테스트 전용. */
export function __resetInlineState__(): void {
  heldReverification = undefined
}

function doc(): { cookie: string } | undefined {
  const d = (globalThis as { document?: { cookie: string } }).document
  return d && typeof d === 'object' ? d : undefined
}

function loc(): { search?: string; protocol?: string; replace?: (url: string) => void } {
  return ((globalThis as { location?: unknown }).location ?? {}) as {
    search?: string
    protocol?: string
    replace?: (url: string) => void
  }
}

function getCookie(name: string): string | null {
  const d = doc()
  if (!d) return null
  const match = d.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'))
  return match?.[1] ? decodeURIComponent(match[1]) : null
}

/**
 * 로그인 쿠키 쓰기 — 템플릿과 같은 속성. SameSite=Lax 명시(구형 브라우저의 None 취급 방지), https면 secure.
 * HttpOnly는 JS로 설정하는 쿠키라 불가능하다(격리 프레임에서는 호스트가 대신 설정한다).
 */
function setCookie(name: string, value: string): void {
  const d = doc()
  if (!d) return
  const parts = [`${name}=${encodeURIComponent(value)}`, 'path=/', 'samesite=lax']
  if (loc().protocol === 'https:') parts.push('secure')
  d.cookie = parts.join('; ')
}

function establishSession(accessToken: string): void {
  setCookie(COOKIE.ACCESS_TOKEN, accessToken)
  setCookie(COOKIE.KEEP_LOGGED_IN, '')
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

interface ApiOutcome {
  /** 서버가 응답했는가(본문 해석 실패 포함). 1회용 토큰 폐기 판단에 쓴다. */
  readonly responded?: boolean
  readonly ok: boolean
  readonly data: Record<string, unknown>
  readonly error?: AccountSessionError
}

/** 계정 API 호출 — 템플릿 `apiFetch`와 같은 헤더·파싱. `withAuth`면 액세스 토큰 쿠키를 Authorization으로. */
async function accountFetch(
  options: AccountClientOptions,
  method: 'GET' | 'POST',
  path: string,
  body: unknown,
  withAuth: boolean,
): Promise<ApiOutcome> {
  let responded = false
  try {
    const language = options.language ? options.language() : readLocale()
    const shopId = getCookie(COOKIE.SHOP_ID)
    const currency = getCookie(COOKIE.SHOP_CURRENCY)
    const country = getCookie(COOKIE.COUNTRY)
    const accessToken = withAuth ? getCookie(COOKIE.ACCESS_TOKEN) : null
    const response = await globalThis.fetch(`${options.apiBase ?? '/svc'}${path}`, {
      method,
      credentials: 'same-origin',
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
        'x-bmf-sid': getCookie(COOKIE.SPACE_ID) ?? options.spaceIdFallback ?? 'bstage',
        ...(language ? { 'X-BMF-LANGUAGE': language } : {}),
        ...(shopId ? { 'X-BMF-SHOP-ID': shopId } : {}),
        ...(currency ? { 'X-BMF-CURRENCY': currency } : {}),
        ...(country ? { 'X-BMF-COUNTRY': country } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    responded = true
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
    const text = await response.text()
    const parsed = contentType.includes('application/json') && text ? JSON.parse(text) : {}
    if (!response.ok) {
      const e = asObject(parsed)
      return {
        responded: true,
        ok: false,
        data: {},
        error: {
          ...(typeof e.code === 'number' ? { code: e.code } : {}),
          ...(typeof e.message === 'string' ? { message: e.message } : {}),
          httpStatus: response.status,
        },
      }
    }
    return { responded: true, ok: true, data: asObject(parsed) }
  } catch (err) {
    return {
      responded,
      ok: false,
      data: {},
      error: { message: err instanceof Error ? err.message : String(err) },
    }
  }
}

/**
 * 같은 origin 앱 경로만 통과시킨다. 아니면 홈.
 * 브리지 `validatePath`와 같은 기준이다 — 브라우저는 URL 해석 때 탭·개행을 지우므로 `/\t/x`는 `//x`(프로토콜
 * 상대)가 된다. 그래서 공백·제어문자·역슬래시를 먼저 거르고, 해석한 결과가 같은 origin인지 다시 본다.
 */
function sameOriginPath(path: string): string {
  if (
    typeof path !== 'string' ||
    !path.startsWith('/') ||
    path.startsWith('//') ||
    // eslint-disable-next-line no-control-regex -- 제어문자를 거르는 것이 목적이다
    /[\s\\\u0000-\u001f\u007f]/.test(path)
  ) {
    return HOME_PATH
  }
  const origin = (globalThis as { location?: { origin?: unknown } }).location?.origin
  if (typeof origin !== 'string') return path
  try {
    const resolved = new URL(path, origin)
    if (resolved.origin !== origin || resolved.pathname.startsWith('//')) return HOME_PATH
    return `${resolved.pathname}${resolved.search}${resolved.hash}`
  } catch {
    return HOME_PATH
  }
}

function failed(outcome: ApiOutcome): AccountSessionResult {
  return { ok: false, ...(outcome.error ? { error: outcome.error } : {}) }
}

function createdAtOf(data: Record<string, unknown>): { createdAt?: string } {
  return typeof data.createdAt === 'string' ? { createdAt: data.createdAt } : {}
}

/** 전역 인계를 읽고 지운다. 새 값이 있으면 보관값을 바꾼다(재진입 시 옛 토큰이 되살아나지 않게). */
function consumeHandoff(): void {
  const holder = globalThis as Record<string, unknown>
  const raw = asObject(holder[HANDOFF_KEY])
  if (HANDOFF_KEY in holder) delete holder[HANDOFF_KEY]
  if (typeof raw.token === 'string' && raw.token) {
    heldReverification = {
      token: raw.token,
      ...(typeof raw.expiresAt === 'string' ? { expiresAt: raw.expiresAt } : {}),
    }
  }
}

function usableReverification(): Held | undefined {
  consumeHandoff()
  const held = heldReverification
  if (!held) return undefined
  if (held.expiresAt) {
    const until = new Date(held.expiresAt).getTime()
    if (!Number.isNaN(until) && Date.now() >= until) {
      heldReverification = undefined
      return undefined
    }
  }
  return held
}

async function otpFetch<T>(
  options: AccountClientOptions,
  endpoint: 'send' | 'verify',
  body: Record<string, unknown>,
): Promise<AccountOtpResult<T>> {
  if (!options.otpGatewayBaseUrl) return { ok: false, status: 0, error: { code: 'NOT_CONFIGURED' } }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), OTP_TIMEOUT_MS)
  try {
    const response = await globalThis.fetch(
      `${options.otpGatewayBaseUrl.replace(/\/$/, '')}/v1/otp/${endpoint}`,
      {
        method: 'POST',
        // 게이트웨이는 세션이 없다 — 쿠키를 보내면 CORS 면적만 넓어진다.
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      },
    )
    const payload = asObject(await response.json())
    if (!response.ok || payload.success !== true) {
      return {
        ok: false,
        status: response.status,
        error: asObject(payload.error) as AccountOtpResult<T>['error'],
      }
    }
    return { ok: true, status: response.status, data: payload.data as T }
  } catch {
    // 응답을 받지 못했다는 뜻일 뿐, 발송이 안 됐다는 뜻은 아니다(CORS 실패·끊김 후에도 SMS는 나갔을 수 있다).
    return { ok: false, status: 0, error: { code: 'PROVIDER_UNAVAILABLE' } }
  } finally {
    clearTimeout(timer)
  }
}

export function createInlineAccountClient(options: AccountClientOptions): AccountClient {
  return {
    mode: 'inline',
    supported: true,

    async signup(body) {
      // 가입·로그인 계열은 세션 없이 부른다 — 남아 있는 옛 액세스 토큰을 싣지 않는다.
      const outcome = await accountFetch(options, 'POST', API.signup, body, false)
      if (!outcome.ok) return failed(outcome)
      // 이메일 가입은 응답 토큰이 아니라 auth/token으로 로그인한다(지금 템플릿·플랫폼과 같은 흐름).
      return { ok: true, status: 'LOGIN_REQUIRED', ...createdAtOf(outcome.data) }
    },

    async signupSocial(body) {
      const params = new URLSearchParams(loc().search ?? '')
      const outcome = await accountFetch(
        options,
        'POST',
        API.signupSocial,
        { ...body, code: params.get('code'), state: params.get('state') },
        false,
      )
      if (!outcome.ok) return failed(outcome)
      if (typeof outcome.data.accessToken === 'string' && outcome.data.accessToken) {
        establishSession(outcome.data.accessToken)
      }
      return { ok: true, status: 'SUCCESS', ...createdAtOf(outcome.data) }
    },

    async loginAfterSignup(body) {
      const outcome = await accountFetch(options, 'POST', API.authToken, body, false)
      if (!outcome.ok) return failed(outcome)
      const status = typeof outcome.data.status === 'string' ? outcome.data.status : undefined
      if (typeof outcome.data.accessToken === 'string' && outcome.data.accessToken) {
        establishSession(outcome.data.accessToken)
        return { ok: true, status: status ?? 'SUCCESS' }
      }
      return { ok: true, status: status ?? 'UNKNOWN' }
    },

    async phoneReverify(body) {
      const held = usableReverification()
      if (!held) return { ok: false, status: 'REVERIFICATION_UNAVAILABLE' }
      // 세션 없이 부른다 — 남아 있는 옛 액세스 토큰을 Authorization에 싣지 않는다.
      const outcome = await accountFetch(
        options,
        'POST',
        API.phoneReverification,
        { ...body, reverificationToken: held.token },
        false,
      )
      // 서버 응답을 받으면 결과와 무관하게 1회로 끝낸다(실패 재시도는 재로그인부터).
      if (outcome.responded) heldReverification = undefined
      if (!outcome.ok) return failed(outcome)
      const status = typeof outcome.data.status === 'string' ? outcome.data.status : 'SUCCESS'
      if (status !== 'SUCCESS') return { ok: true, status }
      if (typeof outcome.data.accessToken === 'string' && outcome.data.accessToken) {
        establishSession(outcome.data.accessToken)
      }
      return { ok: true, status: 'SUCCESS', next: { path: HOME_PATH } }
    },

    async completeLogin(result) {
      if (!result.ok) return
      const replace = loc().replace
      if (typeof replace !== 'function') return
      if (result.next) {
        replace(sameOriginPath(result.next.path))
        return
      }
      // 가입 직후 — 통합계정 안내 팝업 여부를 새 토큰으로 조회해 붙인다(지금 템플릿 흐름과 같다).
      const users = await accountFetch(options, 'GET', API.users, undefined, true)
      replace(
        users.ok && users.data.isShowIntegratedAccountPopup === true
          ? `${HOME_PATH}?showIntegratedAccountPopup=true`
          : HOME_PATH,
      )
    },

    otpSendSignup: (body) => otpFetch(options, 'send', { ...body, purpose: 'SIGNUP' }),
    otpSendPhoneChange: (body) => otpFetch(options, 'send', { ...body, purpose: 'PHONE_CHANGE' }),
    otpVerifySignup: (body) => otpFetch(options, 'verify', { ...body, purpose: 'SIGNUP' }),
    otpVerifyPhoneChange: (body) =>
      otpFetch(options, 'verify', { ...body, purpose: 'PHONE_CHANGE' }),

    hostQuery() {
      const socialType = new URLSearchParams(loc().search ?? '').get('socialType')
      return socialType ? { socialType } : {}
    },

    hostCountry() {
      return getCookie(COOKIE.COUNTRY) ?? undefined
    },

    spaceInfo(): AccountSpaceInfo {
      try {
        const next = asObject((globalThis as { __NEXT_DATA__?: unknown }).__NEXT_DATA__)
        const space = asObject(asObject(asObject(asObject(next.props).pageProps).base).space)
        const title = asObject(space.seoData).title
        const corp = asObject(space.primaryCorporation)
        return {
          ...(typeof title === 'string' ? { title } : {}),
          corporation: {
            ...(typeof corp.name === 'string' ? { name: corp.name } : {}),
            ...(typeof corp.country === 'string' ? { country: corp.country } : {}),
          },
        }
      } catch {
        return {}
      }
    },

    reverificationStatus(): ReverificationState {
      const held = usableReverification()
      return held
        ? { available: true, ...(held.expiresAt ? { expiresAt: held.expiresAt } : {}) }
        : { available: false }
    },

    releaseReverification() {
      heldReverification = undefined
    },
  }
}
