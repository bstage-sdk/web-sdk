import type { BridgeErrorCode } from './errors.js'

/** 프레임 요청 타임아웃. */
export const REQUEST_TIMEOUT_MS = 15_000

/** 프레임 → 호스트 요청 종류(브리지 프로토콜 표). */
export const REQUEST_TYPES = [
  'fetch',
  'navigate',
  'back',
  'openExternal',
  'toast',
  'resize',
  'track',
  'storage',
  'log',
] as const

export type BridgeRequestType = (typeof REQUEST_TYPES)[number]

/** 호스트 → 프레임 이벤트 종류. */
export const HOST_EVENT_TYPES = ['slot.context', 'locale', 'member', 'theme', 'visibility'] as const

export type BridgeHostEventType = (typeof HOST_EVENT_TYPES)[number]

/** 프레임 → 호스트 핸드셰이크 이벤트. */
export const READY_EVENT = 'ready'

/** 호스트 → 프레임 핸드셰이크 응답 type. */
export const INIT_RESPONSE = 'init'

/** 프레임이 보내는 모든 payload에 붙는 세션. */
export type WithSession<T> = T & { readonly session: string }

export interface ThemeState {
  readonly dark: boolean
}

export interface MemberState {
  readonly signedIn: boolean
  readonly nickname?: string
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
 * `placementId`는 호스트가 만든 스코프 키다(예: `page:{경로}|{url}`, `slot:{id}|{url}`).
 */
export interface BridgeInit {
  readonly placementId: string
  readonly surface: BridgeSurface
  readonly phase: string
  readonly spaceId: string
  readonly hostOrigin: string
  readonly gatewayBase: string
  readonly locale: string
  readonly theme: ThemeState
  readonly slot?: SlotState
  readonly member: MemberState
  readonly limits: BridgeLimits
  readonly partnerOrigins: readonly string[]
  readonly translations?: BridgeTranslations
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

/** 요청 type별 payload·결과 타입. */
export interface BridgeRequestMap {
  fetch: { req: FetchRequest; res: FetchResult }
  navigate: { req: { readonly path: string }; res: Record<string, never> }
  back: { req: Record<string, never>; res: Record<string, never> }
  openExternal: { req: { readonly url: string }; res: Record<string, never> }
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
}

/** 이벤트 type별 payload. */
export interface BridgeEventMap {
  'slot.context': SlotState
  locale: { readonly locale: string; readonly translations?: BridgeTranslations }
  member: MemberState
  theme: ThemeState
  visibility: { readonly visible: boolean }
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
