import type {
  BridgeEventMap,
  BridgeInit,
  BridgeRequestMap,
  BridgeRequestType,
} from '../protocol/messages.js'

/** 프레임 런타임 설정 — srcdoc 부트스트랩이 상수로 넘긴다. */
export interface BridgeClientConfig {
  readonly session: string
  readonly hostOrigin: string
}

/** 이벤트 구독 해제 함수. */
export type Unsubscribe = () => void

/**
 * 프레임 안 브리지 클라이언트. `globalThis.__bstage_bridge__`에 설치된다.
 * core·react 어댑터는 이 모양을 구조적으로 읽는다(패키지 의존 없음).
 */
export interface BridgeClient {
  readonly version: 1
  readonly hostOrigin: string
  /** init 수신 시 resolve. reject하지 않는다(호스트가 늦게 붙으면 ready를 계속 재전송한다). */
  readonly ready: Promise<BridgeInit>
  /** 지금까지 받은 init(이후 locale·member·theme·slot.context 이벤트가 반영된 값). 수신 전이면 undefined. */
  getInit(): BridgeInit | undefined
  request<T extends BridgeRequestType>(
    type: T,
    payload: BridgeRequestMap[T]['req'],
  ): Promise<BridgeRequestMap[T]['res']>
  on<E extends keyof BridgeEventMap>(type: E, fn: (payload: BridgeEventMap[E]) => void): Unsubscribe
  /** 브리지 경유 fetch(`createBridgeFetch(this)`). */
  readonly fetch: typeof globalThis.fetch
}

/** 프레임 런타임이 쓰는 전역의 최소 모양 — 테스트에서 가짜 창을 넘길 수 있게 한다. */
export interface RuntimeGlobal {
  parent: { postMessage(message: unknown, targetOrigin: string): void } | null
  /**
   * `message`(호스트 응답·이벤트)와 `pagehide`(frame-unload 전송, capture)에 쓴다.
   * 처리기 인자 모양은 type마다 다르다 — message는 `{ source, origin, data }`, pagehide는 `{ persisted }`.
   */
  addEventListener(type: 'message' | 'pagehide', fn: (ev: never) => void, capture?: boolean): void
  crypto?: { getRandomValues<T extends ArrayBufferView | null>(array: T): T }
  /** pagehide 이벤트 생성자 — `persisted` 원본 접근자를 부트스트랩 때 잡는 데 쓴다(없으면 이벤트 속성을 읽는다). */
  PageTransitionEvent?: { readonly prototype: object }
  __bstage_bridge__?: BridgeClient
}

/** `createBridgeFetch`가 요구하는 클라이언트 부분. */
export type BridgeRequester = Pick<BridgeClient, 'request'>
