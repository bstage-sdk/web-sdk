import type {
  BridgeEventMap,
  BridgeHostEventType,
  LogLevel,
  MemberState,
  SlotState,
  TemplateReport,
  ThemeState,
  ToastKind,
  BridgeTranslations,
  BridgeSurface,
  AccountHostQuery,
  AccountSpaceInfo,
  NavigateOptions,
  OtpOp,
  PageLocationState,
  OtpPurpose,
  ReverificationStatus,
  SessionOp,
} from '../protocol/messages.js'
import type { AccountStateStore } from './accountSession.js'
import type { StorageBackend } from './storage.js'
import type { BridgePolicy } from './policy.js'

/** 호스트 메시지 리스너를 다는 창의 최소 모양. */
export interface HostWindow {
  addEventListener(type: 'message', fn: (ev: MessageEventLike) => void): void
  removeEventListener(type: 'message', fn: (ev: MessageEventLike) => void): void
  open?(url: string, target: string, features: string): unknown
  requestAnimationFrame?(cb: () => void): number
  cancelAnimationFrame?(handle: number): void
}

export interface MessageEventLike {
  readonly source: unknown
  readonly origin: string
  readonly data: unknown
}

/** 프레임 창의 최소 모양. */
export interface FrameWindow {
  postMessage(message: unknown, targetOrigin: string): void
}

/** iframe 요소의 최소 모양(`HTMLIFrameElement`가 만족한다). */
export interface IframeLike {
  readonly contentWindow: FrameWindow | null
  readonly ownerDocument?: { readonly defaultView: HostWindow | null } | null
}

/**
 * 호스트가 넘기는 init 원본. `hostOrigin`·`gatewayBase`·`limits`는 호스트 옵션·정책에서 채운다.
 */
export interface BridgeInitInput {
  /** 호스트가 만든 placement 스코프 키(예: 페이지 `page:{경로}`, 위젯 `slot:{id}|{url}`). storage 스코프에도 쓴다. */
  readonly placementId: string
  /** 커스텀 페이지(`page`) 또는 슬롯 위젯(`slot`). 그 밖의 값은 생성 시 TypeError. */
  readonly surface: BridgeSurface
  readonly phase: string
  readonly spaceId: string
  readonly locale: string
  readonly theme: ThemeState
  readonly slot?: SlotState
  readonly member: MemberState
  readonly partnerOrigins: readonly string[]
  readonly translations?: BridgeTranslations
  /**
   * 호스트 페이지의 현재 경로(`/`로 시작)·쿼리(빈 문자열 또는 `?`로 시작), 각 2048자 이하. 형식이 틀리면 init에서 뺀다.
   * 어느 배치에 실을지는 호스트가 정한다 — 계정 세션 배치·플랫폼 인증 콜백 경로(OAuth `code`·`state`가 쿼리에 있다)에는
   * 싣지 말 것. 이후 변화는 `send('page', …)`로 보낸다.
   */
  readonly page?: PageLocationState
  /**
   * 이 배치에 허용된 기능. `account-session`이 있고 page 배치일 때만 계정 세션 요청(session·otp)을 처리한다.
   * 판정 근거는 호스트가 가진 배치 설정이어야 한다 — manifest·프레임 메시지를 근거로 채우지 말 것.
   */
  readonly capabilities?: readonly string[]
  /** 아래 계정 필드는 `account-session` 권한이 있을 때만 init에 실린다(허용 키·형만). */
  readonly query?: AccountHostQuery
  readonly country?: string
  readonly space?: AccountSpaceInfo
  /** 재인증 임시토큰 보관 상태 — 토큰 값은 넣지 않는다(호스트가 실행기 안에서 보관한다). */
  readonly reverification?: ReverificationStatus
}

/**
 * 계정 세션 실행기 — 임베더(플랫폼)가 구현한다. 브리지가 op·본문을 허용 목록으로 다시 만든 뒤 부른다.
 * 실행기는 정해진 계정 엔드포인트만 부르고(인증 헤더 없는 전용 fetch), 성공하면 호스트에서 로그인 쿠키를
 * 설정한다. 돌려준 객체는 브리지가 다시 허용 목록(`ok·status·code·message·httpStatus·createdAt·next`)으로
 * 거르고 이름에 token이 든 키를 지운다 — 그래도 토큰을 담아 돌려주지 말 것.
 */
export type SessionImpl = (
  op: SessionOp,
  body: Readonly<Record<string, unknown>>,
) => Promise<{
  readonly ok: boolean
  readonly status?: string
  readonly code?: number
  readonly message?: string
  readonly httpStatus?: number
  readonly createdAt?: string
  /** 성공 뒤 프레임이 전체 리로드로 이동할 같은 origin 경로. */
  readonly next?: { readonly path: string }
}>

/** SMS OTP 실행기 — 목적지 게이트웨이는 임베더가 phase로 정한다. purpose는 브리지가 op에서 고정해 넘긴다. */
export type OtpImpl = (request: {
  readonly op: OtpOp
  readonly endpoint: 'send' | 'verify'
  readonly purpose: OtpPurpose
  readonly body: Readonly<Record<string, unknown>>
}) => Promise<{
  readonly ok: boolean
  readonly status: number
  readonly data?: Readonly<Record<string, unknown>>
  readonly error?: Readonly<Record<string, unknown>>
}>

/** 요청별 호스트 처리기. 없으면 해당 요청은 `UNSUPPORTED`(openExternal·log는 기본 동작이 있다). */
export interface BridgeHostHandlers {
  /** 옵션은 프레임이 `replace`·`reload`를 줬을 때만 두 번째 인자로 넘어온다. */
  readonly navigate?: (path: string, options?: NavigateOptions) => void
  readonly back?: () => void
  /** 없으면 `window.open(url, '_blank', 'noopener,noreferrer')`. */
  readonly openExternal?: (url: string) => void
  /**
   * 같은 탭 외부 이동(https만, userinfo 없음 — 검증된 href). 확인 창을 띄우고 사용자가 거절하면 이동하지 않는다.
   * 없으면 `UNSUPPORTED`(window.open 등 기본 동작으로 대신하지 않는다).
   */
  readonly navigateExternal?: (url: string) => void
  readonly toast?: (message: string, kind?: ToastKind) => void
  /** rAF로 디바운스된 높이(px, 0~200000). */
  readonly resize?: (height: number) => void
  readonly track?: (name: string, params?: Readonly<Record<string, unknown>>) => void
  /** real이 아닌 phase에서만 호출. 없으면 console. */
  readonly log?: (level: LogLevel, message: string) => void
}

/** 호스트가 주입하는 fetch. 플랫폼은 목적지 허용 목록·redirect 차단·인증을 적용하는 자체 fetch를 넘긴다. */
export type HostFetch = (url: string, init: RequestInit) => Promise<Response>

export interface CreateBridgeHostOptions {
  readonly iframe: IframeLike
  readonly session: string
  readonly hostOrigin: string
  readonly init: BridgeInitInput
  /** 같은 origin `/gw` 요청용 fetch(플랫폼 인증 fetch). `credentials: 'same-origin'`으로 호출된다. */
  readonly fetchImpl: HostFetch
  /**
   * 파트너 origin 요청용 fetch. 기본은 `globalThis.fetch`를 `credentials: 'omit'`·`redirect: 'error'`로,
   * 인증 헤더 없이 호출한다. **인증을 붙이는 fetch를 주입하면** 파트너 백엔드가 그 자격증명을 응답에
   * 되돌려 프레임으로 흘릴 수 있다는 위험을 주입하는 쪽이 받아들이는 것이다.
   * `init.partnerOrigins`는 **팬 토큰을 보낼 vibe 백엔드 목록**이다 — 토큰 없이 부를 외부 API는 등록할
   * 필요가 없다(external).
   */
  readonly partnerFetchImpl?: HostFetch
  /**
   * 그 밖의 https origin(파트너 아님, hostOrigin 아님) 요청용 fetch. 기본은 `globalThis.fetch`를
   * `credentials: 'omit'`·`redirect: 'error'`·`referrerPolicy: 'no-referrer'`로, 인증 헤더 없이 호출한다.
   * 요청 헤더 허용 목록은 그대로 적용되고 `pinnedHeaders`(테넌시·앱)는 싣지 않는다.
   * `policy.allowExternal: true`일 때만 호출된다(기본 false, 옵트인). 인증을 붙이는 fetch를 주입하지 말 것.
   */
  readonly externalFetchImpl?: HostFetch
  /**
   * 토큰이 실리는 요청(gateway·partner)에 호스트가 덮어 싣는 헤더. 그 요청에는 템플릿이 붙인 헤더가 그대로
   * 실리고(자격증명·테넌시 헤더 제외) 그 위에 이 값이 덮인다. 테넌시 헤더(`x-bstage-tenant-id`·
   * `x-bstage-org-id`·`x-bstage-enterprise-id`)는 프레임 값이 버려지고 **여기 준 값만** 실린다. 그 밖의 키는
   * 프레임 값을 덮는다. 자격증명 헤더(`authorization`·`cookie`·CF Access)나 올바르지 않은 이름은 TypeError.
   */
  readonly pinnedHeaders?: Readonly<Record<string, string>>
  readonly handlers?: BridgeHostHandlers
  /** 계정 세션 실행기. `init.capabilities`에 `account-session`이 없으면 주입돼 있어도 부르지 않는다(NOT_ALLOWED). */
  readonly sessionImpl?: SessionImpl
  /** SMS OTP 실행기. 권한 조건은 sessionImpl과 같다. */
  readonly otpImpl?: OtpImpl
  /**
   * 계정 상한·카운터 저장소. 리로드로 호스트가 다시 만들어져도 상한이 이어지게 한다. 생략하면 호스트 탭의
   * sessionStorage(접근 불가면 메모리). 테스트·SSR에서 바꿔 끼운다.
   */
  readonly accountStateStore?: AccountStateStore
  /**
   * `storage` 요청의 저장소. 생략하면 페이지 세션 메모리(리로드하면 사라진다). 주입하면 그 저장소에
   * `${spaceId}\u0000${placementId}\u0000${key}` 키로 쓴다(예: 호스트 localStorage 래퍼 — 리로드 뒤에도 남는다).
   * 상한(placement당 키 50개·값 4096자·키 200자)은 같다. 템플릿이 쓰는 값이므로 토큰·시크릿·개인정보를 담는
   * 저장소와 섞지 말 것.
   */
  readonly storageBackend?: StorageBackend
  readonly policy?: Partial<BridgePolicy>
  /**
   * 호스트가 dispose될 때 한 번 불린다. `frame-unload`(프레임 문서가 내려감)·`frame-mismatch`(토큰이 없거나 다른
   * 메시지 = 같은 창의 다른 문서)는 호스트가 스스로 끊은 경우, `manual`은 `dispose()` 호출이다. 임베더가 iframe을
   * 바로 걷어 내는 데 쓴다. 이 콜백의 예외는 삼킨다.
   */
  readonly onDispose?: (reason: BridgeDisposeReason) => void
  /**
   * 프레임의 `report`(템플릿 에러 보고)를 검증한 뒤 부른다. phase와 무관하게(real 포함) 불린다.
   * 프레임 세션(이 호스트)당 `REPORTS_PER_SESSION`(5)건까지만 부르고 넘치는 보고는 조용히 버린다.
   * 넘기는 값은 `{ kind, message, frames, count }`뿐이다 — 어느 템플릿인지는 프레임이 보낸 값이 아니라
   * 호스트가 띄운 templateUrl로 임베더가 귀속한다. message·frames는 템플릿이 만든 문자열이라 텍스트로만 다루고,
   * 밖으로 보내기 전 스크러빙은 임베더 몫이다. 이 콜백의 예외는 삼킨다.
   */
  readonly onTemplateReport?: (report: TemplateReport) => void
}

/** `onDispose` 사유. */
export type BridgeDisposeReason = 'frame-unload' | 'frame-mismatch' | 'manual'

export interface BridgeHost {
  /**
   * 프레임에 이벤트를 보낸다. 이후 ready에 답하는 init에도 반영된다.
   * 프레임 토큰이 묶이기(첫 유효 메시지) 전에는 보내지 않고 init에만 반영한다.
   */
  send<E extends BridgeHostEventType>(type: E, payload: BridgeEventMap[E]): void
  /**
   * 리스너·대기 중인 resize를 정리한다. 이후 메시지는 무시되고, 진행 중이던 요청의 응답도 프레임에 보내지 않는다.
   * 프레임이 `frame-unload`를 보내거나 다른 프레임 토큰이 오면 호스트가 스스로 부른다.
   */
  dispose(): void
}
