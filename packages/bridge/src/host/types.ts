import type {
  BridgeEventMap,
  BridgeHostEventType,
  LogLevel,
  MemberState,
  SlotState,
  ThemeState,
  ToastKind,
  BridgeTranslations,
  BridgeSurface,
} from '../protocol/messages.js'
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
  /** 호스트가 만든 placement 스코프 키(예: `page:{경로}|{url}`, `slot:{id}|{url}`). storage 스코프에도 쓴다. */
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
}

/** 요청별 호스트 처리기. 없으면 해당 요청은 `UNSUPPORTED`(openExternal·log는 기본 동작이 있다). */
export interface BridgeHostHandlers {
  readonly navigate?: (path: string) => void
  readonly back?: () => void
  /** 없으면 `window.open(url, '_blank', 'noopener,noreferrer')`. */
  readonly openExternal?: (url: string) => void
  readonly toast?: (message: string, kind?: ToastKind) => void
  /** rAF로 디바운스된 높이(px, 0~20000). */
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
   * 게이트웨이 요청에 호스트가 덮어 싣는 헤더. 테넌시 헤더(`x-bstage-tenant-id`·`x-bstage-org-id`·
   * `x-bstage-enterprise-id`)는 프레임 값이 버려지고 **여기 준 값만** 실린다. 앱 헤더
   * (`x-bstage-app-id`·`x-bstage-app-key`)는 여기 주면 프레임 값을 덮는다. 그 밖의 키는 TypeError.
   */
  readonly pinnedHeaders?: Readonly<Record<string, string>>
  readonly handlers?: BridgeHostHandlers
  readonly policy?: Partial<BridgePolicy>
  /**
   * 호스트가 dispose될 때 한 번 불린다. `frame-unload`(프레임 문서가 내려감)·`frame-mismatch`(토큰이 없거나 다른
   * 메시지 = 같은 창의 다른 문서)는 호스트가 스스로 끊은 경우, `manual`은 `dispose()` 호출이다. 임베더가 iframe을
   * 바로 걷어 내는 데 쓴다. 이 콜백의 예외는 삼킨다.
   */
  readonly onDispose?: (reason: BridgeDisposeReason) => void
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
