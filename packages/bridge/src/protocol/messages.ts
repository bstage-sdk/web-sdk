import type { BridgeErrorCode } from './errors.js'

/** 프레임 요청 타임아웃. */
export const REQUEST_TIMEOUT_MS = 15_000

/** 프레임 → 호스트 요청 종류(브리지 프로토콜 표). */
export const REQUEST_TYPES = [
  'fetch',
  'navigate',
  'back',
  'openExternal',
  'navigateExternal',
  'toast',
  'resize',
  'track',
  'storage',
  'log',
  'report',
  'session',
  'otp',
] as const

export type BridgeRequestType = (typeof REQUEST_TYPES)[number]

/** 호스트 → 프레임 이벤트 종류. */
export const HOST_EVENT_TYPES = [
  'slot.context',
  'locale',
  'member',
  'theme',
  'visibility',
  'page',
] as const

export type BridgeHostEventType = (typeof HOST_EVENT_TYPES)[number]

/** 프레임 → 호스트 핸드셰이크 이벤트. */
export const READY_EVENT = 'ready'

/** 호스트 → 프레임 핸드셰이크 응답 type. */
export const INIT_RESPONSE = 'init'

/**
 * 프레임 → 호스트 종료 알림 이벤트. 부트스트랩이 `pagehide`(bfcache 제외)에서 동기로 보낸다.
 * 호스트는 받는 즉시 세션을 끊는다(이후 메시지 무시).
 */
export const FRAME_UNLOAD_EVENT = 'frame-unload'

/** 프레임이 보내는 모든 payload에 붙는 세션. */
export type WithSession<T> = T & { readonly session: string }

export interface ThemeState {
  readonly dark: boolean
}

export interface MemberState {
  readonly signedIn: boolean
  readonly nickname?: string
}

/**
 * 호스트 페이지의 현재 위치(경로·쿼리). 해시는 싣지 않는다.
 * `path`는 `/`로 시작, `search`는 빈 문자열이거나 `?`로 시작한다. 각각 `PAGE_LOCATION_MAX_LENGTH`자 이하.
 */
export interface PageLocationState {
  readonly path: string
  readonly search: string
}

/** page 위치 path·search 각각의 최대 길이(자). 호스트 `validatePath`의 경로 상한과 같은 값이다. */
export const PAGE_LOCATION_MAX_LENGTH = 2048

/** page 위치 형식 검사 — 맞으면 path·search만 담은 새 객체, 아니면 undefined. */
export function toPageLocation(value: unknown): PageLocationState | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const { path, search } = value as Record<string, unknown>
  if (
    typeof path !== 'string' ||
    typeof search !== 'string' ||
    !path.startsWith('/') ||
    // `//host`·`/\\host`는 브라우저가 프로토콜 상대 URL로 읽는다 — 템플릿이 href로 쓰면 외부로 나간다.
    path.startsWith('//') ||
    path.startsWith('/\\') ||
    path.length > PAGE_LOCATION_MAX_LENGTH ||
    (search !== '' && !search.startsWith('?')) ||
    search.length > PAGE_LOCATION_MAX_LENGTH
  ) {
    return undefined
  }
  return { path, search }
}

export interface SlotState {
  readonly id: string
  readonly context: unknown
}

export interface BridgeLimits {
  readonly maxBodyBytes: number
  readonly maxRequestsPerMinute: number
}

/** 격리 템플릿이 놓인 자리 — 커스텀 페이지 또는 슬롯 위젯. */
export const BRIDGE_SURFACES = ['page', 'slot'] as const
export type BridgeSurface = (typeof BRIDGE_SURFACES)[number]

export function isBridgeSurface(value: unknown): value is BridgeSurface {
  return BRIDGE_SURFACES.includes(value as BridgeSurface)
}

/** 번역 사전 — 키 → 문자열(flat). core `TranslationDict`와 같은 모양. */
export type BridgeTranslations = Readonly<Record<string, string>>

/**
 * `res:init` payload. 회원 id·이메일·토큰은 넣지 않는다.
 * `translations`는 현재 locale 사전(선택, 브리지 프로토콜) — core i18n이 CDN 대신 이 값을 쓴다.
 * `placementId`는 호스트가 만든 스코프 키다(예: 페이지 `page:{경로}`, 위젯 `slot:{id}|{url}`).
 */
export interface BridgeInit {
  readonly placementId: string
  readonly surface: BridgeSurface
  readonly phase: string
  readonly spaceId: string
  readonly hostOrigin: string
  readonly gatewayBase: string
  /**
   * 호스트 정책의 같은 origin 게이트웨이 경로 접두사(`policy.gatewayPrefixes`). 프레임
   * 라우터(`__bstage_fetch__`)가 "브리지로 보낼 같은 origin 경로"를 가르는 데 쓴다. 판정의 정본은 여전히 호스트다.
   * 이 필드가 없는 옛 호스트면 라우터는 hostOrigin 요청을 모두 브리지로 보낸다.
   */
  readonly gatewayPrefixes?: readonly string[]
  readonly locale: string
  readonly theme: ThemeState
  readonly slot?: SlotState
  readonly member: MemberState
  readonly limits: BridgeLimits
  readonly partnerOrigins: readonly string[]
  readonly translations?: BridgeTranslations
  /**
   * 호스트 페이지의 현재 경로·쿼리. 호스트가 싣기로 한 배치에만 있다(계정 세션 배치·플랫폼 인증 콜백 경로에는
   * 싣지 않는다 — 판단은 호스트 몫). 이후 변화는 `page` 이벤트로 온다. 없는 옛 호스트도 있다.
   */
  readonly page?: PageLocationState
  /** 이 배치에 허용된 기능. 알려진 값만 싣는다(`ACCOUNT_SESSION_CAPABILITY`). 없으면 필드 자체가 없다. */
  readonly capabilities?: readonly string[]
  /** 아래 계정 필드는 `account-session` 권한이 있는 배치에만 실린다. */
  readonly query?: AccountHostQuery
  /** 호스트의 국가 코드(가입 폼 기본 국가). */
  readonly country?: string
  readonly space?: AccountSpaceInfo
  /** 재인증 임시토큰 보관 상태. 토큰 값은 싣지 않는다. */
  readonly reverification?: ReverificationStatus
}

/** 계정 세션 요청(session·otp)을 여는 배치 권한. 호스트가 이 값을 받아야만 처리한다(fail-closed). */
export const ACCOUNT_SESSION_CAPABILITY = 'account-session'
/** init.capabilities에 실을 수 있는 값. 그 밖의 값은 버린다. */
export const KNOWN_CAPABILITIES: readonly string[] = [ACCOUNT_SESSION_CAPABILITY]

/** 호스트 URL 쿼리 중 프레임에 주는 키(허용 목록). OAuth `code`·`state`는 싣지 않는다. */
export interface AccountHostQuery {
  readonly socialType?: string
}

export interface AccountSpaceInfo {
  readonly title?: string
  readonly corporation?: { readonly name?: string; readonly country?: string }
}

export interface ReverificationStatus {
  readonly available: boolean
  readonly expiresAt?: string
}

/** 호스트가 대신 호출하는 계정 세션 작업. 엔드포인트는 호스트가 고정한다. */
export const SESSION_OPS = ['signup', 'signupSocial', 'loginAfterSignup', 'phoneReverify'] as const
export type SessionOp = (typeof SESSION_OPS)[number]

/** SMS OTP 작업. 목적(purpose)은 op로 호스트가 고정한다 — 프레임이 고르지 않는다. */
export const OTP_OPS = [
  'sendSignup',
  'sendPhoneChange',
  'verifySignup',
  'verifyPhoneChange',
] as const
export type OtpOp = (typeof OTP_OPS)[number]
export type OtpPurpose = 'SIGNUP' | 'PHONE_CHANGE'

export interface SessionRequest {
  readonly op: SessionOp
  readonly body: Readonly<Record<string, unknown>>
}

/**
 * `session` 결과. 토큰·회원 식별자는 싣지 않는다(허용 목록). `next`가 있으면 프레임 SDK가
 * 그 경로로 전체 리로드 이동을 요청한다(호스트가 새 로그인 상태로 페이지를 다시 그리게).
 */
export interface SessionResult {
  readonly ok: boolean
  readonly status?: string
  readonly code?: number
  readonly message?: string
  readonly httpStatus?: number
  /** signup·signupSocial 성공 시 가입 시각. */
  readonly createdAt?: string
  readonly next?: { readonly path: string; readonly reload: true }
}

export interface OtpRequest {
  readonly op: OtpOp
  readonly body: Readonly<Record<string, unknown>>
}

export interface OtpResult {
  readonly ok: boolean
  /** 게이트웨이 HTTP 상태. 응답을 받지 못했으면 0. */
  readonly status: number
  readonly data?: Readonly<Record<string, string | number>>
  readonly error?: {
    readonly code?: string
    readonly message?: { readonly en?: string; readonly vi?: string }
    readonly retryAfterSeconds?: number
  }
}

/** navigate 옵션. `reload`는 같은 origin 경로로 전체 리로드 이동(로그인 직후 등). */
export interface NavigateOptions {
  readonly replace?: boolean
  readonly reload?: boolean
}

export interface FetchRequest {
  readonly url: string
  readonly method?: string
  readonly headers?: Readonly<Record<string, string>>
  readonly body?: string | null
}

export interface FetchResult {
  readonly status: number
  readonly statusText: string
  readonly headers: { readonly 'content-type'?: string }
  readonly bodyText: string
}

export type ToastKind = 'info' | 'success' | 'warning' | 'error'
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type StorageOp = 'get' | 'set' | 'remove'

/** 템플릿 에러 보고 종류 — 전역 에러, 처리 안 된 Promise 거절, 엔트리 스크립트 로드 실패. */
export const TEMPLATE_REPORT_KINDS = ['error', 'rejection', 'load'] as const
export type TemplateReportKind = (typeof TEMPLATE_REPORT_KINDS)[number]

/** report message 최대 길이(자). 프레임 수집기는 이 길이로 잘라 보내고, 호스트는 넘으면 거절한다. */
export const REPORT_MESSAGE_MAX_LENGTH = 300
/** report frames 최대 개수. */
export const REPORT_MAX_FRAMES = 10
/** report frame 한 줄 최대 길이(자). */
export const REPORT_FRAME_MAX_LENGTH = 200
/** report count 상한(같은 fingerprint 누적 횟수). 하한은 1. */
export const REPORT_COUNT_MAX = 100
/** 프레임 세션당 report 상한. 프레임 수집기와 호스트가 각자 지킨다. */
export const REPORTS_PER_SESSION = 5

/**
 * `report` payload — 격리 프레임이 잡은 템플릿 에러 하나(같은 fingerprint는 count로 묶는다).
 * URL·placement 같은 귀속 정보는 싣지 않는다 — 호스트가 자기가 띄운 템플릿으로 귀속한다.
 */
export interface TemplateReport {
  readonly kind: TemplateReportKind
  readonly message: string
  readonly frames: readonly string[]
  readonly count: number
}

/** 요청 type별 payload·결과 타입. */
export interface BridgeRequestMap {
  fetch: { req: FetchRequest; res: FetchResult }
  navigate: { req: { readonly path: string } & NavigateOptions; res: Record<string, never> }
  back: { req: Record<string, never>; res: Record<string, never> }
  openExternal: { req: { readonly url: string }; res: Record<string, never> }
  /** 같은 탭에서 외부 https 사이트로 이동. 호스트가 확인 창을 띄우고 거절할 수 있다. */
  navigateExternal: { req: { readonly url: string }; res: Record<string, never> }
  toast: {
    req: { readonly message: string; readonly kind?: ToastKind }
    res: Record<string, never>
  }
  resize: { req: { readonly height: number }; res: Record<string, never> }
  track: {
    req: { readonly name: string; readonly params?: Readonly<Record<string, unknown>> }
    res: Record<string, never>
  }
  storage: {
    req: { readonly op: StorageOp; readonly key: string; readonly value?: string }
    res: { readonly value: string | null }
  }
  log: { req: { readonly level: LogLevel; readonly message: string }; res: Record<string, never> }
  report: { req: TemplateReport; res: Record<string, never> }
  session: { req: SessionRequest; res: SessionResult }
  otp: { req: OtpRequest; res: OtpResult }
}

/** 이벤트 type별 payload. */
export interface BridgeEventMap {
  'slot.context': SlotState
  locale: { readonly locale: string; readonly translations?: BridgeTranslations }
  member: MemberState
  theme: ThemeState
  visibility: { readonly visible: boolean }
  page: PageLocationState
}

/** `res` payload — 성공이면 `data`, 실패면 코드만 담긴 `error`. */
export type BridgeResult<T> =
  | { readonly ok: true; readonly data: T }
  | {
      readonly ok: false
      readonly error: { readonly code: BridgeErrorCode; readonly message: string }
    }

/** 격리 iframe 속성. 호스트(플랫폼·미리보기)가 iframe을 만들 때 그대로 쓴다. */
export const IFRAME_ATTRIBUTES = {
  sandbox: 'allow-scripts',
  allow: 'autoplay; fullscreen; picture-in-picture; encrypted-media; clipboard-write',
  referrerpolicy: 'no-referrer',
} as const

export function isRequestType(value: unknown): value is BridgeRequestType {
  return REQUEST_TYPES.includes(value as BridgeRequestType)
}

export function isHostEventType(value: unknown): value is BridgeHostEventType {
  return HOST_EVENT_TYPES.includes(value as BridgeHostEventType)
}
