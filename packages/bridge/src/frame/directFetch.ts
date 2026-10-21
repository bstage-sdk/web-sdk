import type { BridgeInit } from '../protocol/messages.js'
import type { BridgeClient } from './types.js'

/** `installDirectFetch` 설정 — srcdoc 부트스트랩이 상수로 넘긴다. */
export interface DirectFetchConfig {
  /** 호스트 페이지 origin(srcdoc에 심긴 값). 상대 URL의 기준이자 "같은 origin" 판정 기준. */
  readonly hostOrigin: string
}

/** 프레임 fetch 라우터가 쓰는 전역의 최소 모양 — 테스트에서 가짜 창을 넘길 수 있게 한다. */
export interface DirectFetchGlobal {
  fetch?: typeof globalThis.fetch
  URL?: typeof URL
  Request?: typeof Request
  __bstage_fetch__?: typeof globalThis.fetch
}

/** 갈래 판정 결과. */
export type DirectRoute = 'bridge' | 'direct' | 'reject'

/**
 * 격리 프레임의 fetch 라우터를(`createSrcdoc` 부트스트랩이 항상 설치한다, README "프레임 네트워크")
 * `globalThis.__bstage_fetch__`에 설치한다. inline 모드용으로 쓰인 템플릿이 부르는 그 이름이다.
 *
 * 갈래(`new URL(input, hostOrigin)`으로 정규화한 뒤):
 * - **브리지**(토큰이 필요한 목적지): hostOrigin과 같은 origin이고 경로가 init `gatewayPrefixes` 안, 또는
 *   origin이 init `partnerOrigins`와 정확히 일치. 기존 브리지 fetch(`client.fetch`)로 보내고 호스트가 다시 판정한다.
 * - **직접**: 그 밖의 https. 부트스트랩 때 잡아 둔 프레임의 원래 `fetch`로 `credentials: 'omit'`·
 *   `referrerPolicy: 'no-referrer'`를 덮어 부른다. 인증 헤더는 붙이지 않는다(토큰은 프레임에 없다).
 * - **거절**(`TypeError`): hostOrigin의 게이트웨이 밖 경로(혼동 방지 — 직접 보내지 않는다), https가 아닌 스킴.
 *
 * **자기완결 함수다** — `bridgeRuntime`과 함께 srcdoc에 `toString()`으로 심긴다(runtime.ts 주석 참고).
 * 템플릿 코드보다 먼저 돌고, 판정·전송에 쓰는 전역(`fetch`·`URL`과 그 접근자·`String.prototype.slice`·
 * `Promise.prototype.then`·`Object.assign`·`TypeError`)과 init의 라우팅 목록을 이때 잡아 둔다. 그래서 템플릿이
 * 나중에 전역·프로토타입·init 객체를 바꿔도 갈래가 바뀌지 않는다. 갈래가 바뀌어도 토큰은 새지 않는다 —
 * 브리지로 간 요청은 호스트가 따로 판정하고, 직접 간 요청에는 토큰이 없다. 이 고정은 혼동 방지다.
 *
 * init이 `gatewayPrefixes`를 싣지 않으면(옛 호스트) hostOrigin 요청은 경로와 무관하게 브리지로 보낸다
 * (호스트가 판정하므로 안전한 쪽).
 *
 * @param g 프레임 전역(`globalThis`)
 * @param client 프레임 브리지 클라이언트(`bridgeRuntime` 결과, frozen)
 * @param config srcdoc에 심긴 hostOrigin
 * @returns 설치한 fetch 라우터
 */
export function installDirectFetch(
  g: DirectFetchGlobal,
  client: Pick<BridgeClient, 'fetch' | 'ready'>,
  config: DirectFetchConfig,
): typeof globalThis.fetch {
  const hostOrigin = config.hostOrigin
  const callFn = Function.prototype.call
  const NativeURL = g.URL
  const rawFetch = g.fetch
  // f(thisArg, ...args) 꼴 — 이후 Function.prototype.call 교체의 영향을 받지 않는다.
  const nativeFetch =
    typeof rawFetch === 'function'
      ? (callFn.bind(rawFetch) as unknown as (
          self: unknown,
          input: RequestInfo | URL,
          init: RequestInit,
        ) => Promise<Response>)
      : undefined
  const bridgeFetch = client.fetch
  const strSlice = callFn.bind(String.prototype.slice) as unknown as (
    s: string,
    start: number,
    end?: number,
  ) => string
  const promiseThen = callFn.bind(Promise.prototype.then) as unknown as <T, R>(
    p: Promise<T>,
    onOk: (v: T) => R | Promise<R>,
  ) => Promise<R>
  const promiseReject = Promise.reject.bind(Promise) as (e: unknown) => Promise<never>
  const assign = Object.assign
  const TypeErr = TypeError

  /** URL 접근자 원본을 프로토타입 체인에서 찾아 묶는다(템플릿이 URL.prototype 접근자를 바꿔도 영향 없음). */
  function getter(ctor: unknown, name: string): ((u: unknown) => string) | undefined {
    if (typeof ctor !== 'function') return undefined
    let proto: object | null = (ctor as { prototype: object }).prototype
    while (proto) {
      const desc = Object.getOwnPropertyDescriptor(proto, name)
      if (desc && typeof desc.get === 'function') {
        return callFn.bind(desc.get) as unknown as (u: unknown) => string
      }
      proto = Object.getPrototypeOf(proto)
    }
    return undefined
  }
  const getHref = getter(NativeURL, 'href')
  const getOrigin = getter(NativeURL, 'origin')
  const getProtocol = getter(NativeURL, 'protocol')
  const getPathname = getter(NativeURL, 'pathname')
  // Request의 내부 URL을 읽는 원본 접근자 — 하위 클래스가 url 접근자를 속여도 fetch가 실제로 쓰는 URL로 판정한다.
  // 진짜 Request가 아니면 던진다(그때는 문자열 입력으로 다룬다).
  const getRequestUrl = getter(g.Request, 'url')

  // init 스냅샷(사본). 템플릿이 getInit() 객체의 배열을 바꿔도 여기는 그대로다.
  let gatewayPrefixes: string[] | null = null
  let partnerOrigins: string[] = []
  let routesReady = false

  function copyStrings(value: unknown): string[] | null {
    if (!Array.isArray(value)) return null
    const out: string[] = []
    for (let i = 0; i < value.length; i += 1) {
      if (typeof value[i] === 'string') out[out.length] = value[i]
    }
    return out
  }

  function takeSnapshot(init: BridgeInit): void {
    if (routesReady) return
    const raw = init as unknown as { gatewayPrefixes?: unknown; partnerOrigins?: unknown }
    gatewayPrefixes = copyStrings(raw.gatewayPrefixes)
    partnerOrigins = copyStrings(raw.partnerOrigins) || []
    routesReady = true
  }
  // 부트스트랩이 엔트리 로드(ready.then)보다 **먼저** 등록한다 — 템플릿 코드가 돌기 전에 스냅샷이 잡힌다.
  promiseThen(client.ready, takeSnapshot)

  /** `/gw/`는 `/gw/...`와 `/gw` 정확 일치를 허용한다(호스트 policy의 matchesPrefix와 같은 규칙). */
  function matchesPrefix(pathname: string, prefix: string): boolean {
    const bare = strSlice(prefix, prefix.length - 1) === '/' ? strSlice(prefix, 0, -1) : prefix
    return pathname === bare || strSlice(pathname, 0, bare.length + 1) === bare + '/'
  }

  function routeOf(origin: string, protocol: string, pathname: string): DirectRoute {
    if (origin === hostOrigin) {
      if (gatewayPrefixes === null) return 'bridge'
      for (let i = 0; i < gatewayPrefixes.length; i += 1) {
        if (matchesPrefix(pathname, gatewayPrefixes[i])) return 'bridge'
      }
      return 'reject'
    }
    for (let i = 0; i < partnerOrigins.length; i += 1) {
      if (origin === partnerOrigins[i]) return 'bridge'
    }
    return protocol === 'https:' ? 'direct' : 'reject'
  }

  /** 진짜 Request면 내부 URL, 아니면 undefined(모양만 같은 객체·URL 객체 등은 문자열로 다룬다). */
  function requestUrlOf(input: unknown): string | undefined {
    if (!getRequestUrl || typeof input !== 'object' || input === null) return undefined
    try {
      return getRequestUrl(input)
    } catch {
      return undefined
    }
  }

  function dispatch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    if (typeof NativeURL !== 'function' || !getHref || !getOrigin || !getProtocol || !getPathname) {
      return promiseReject(new TypeErr('bstage fetch: URL is unavailable'))
    }
    const requestUrl = requestUrlOf(input)
    const request = requestUrl !== undefined
    let parsed: URL
    try {
      parsed = new NativeURL(request ? requestUrl : String(input), hostOrigin)
    } catch {
      return promiseReject(new TypeErr('bstage fetch: invalid url'))
    }
    const href = getHref(parsed)
    const route = routeOf(getOrigin(parsed), getProtocol(parsed), getPathname(parsed))
    // 판정한 그 URL로 보낸다. 진짜 Request는 본문·메서드를 지키려고 그대로 넘긴다 — fetch는 판정에 쓴 그 내부 URL을 쓴다.
    // (브리지로 간 Request는 호스트가 다시 판정하므로 하위 클래스가 url을 속여도 정책 밖으로 가지 않는다.)
    const target = request ? input : href
    if (route === 'bridge') return bridgeFetch(target, init)
    if (route === 'reject') {
      return promiseReject(new TypeErr('bstage fetch: destination not allowed'))
    }
    if (!nativeFetch) return promiseReject(new TypeErr('bstage fetch: fetch is unavailable'))
    return nativeFetch(
      g,
      target,
      assign({}, init, { credentials: 'omit', referrerPolicy: 'no-referrer' }) as RequestInit,
    )
  }

  function bstageFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    try {
      if (routesReady) return dispatch(input, init)
      // init 전 호출은 라우팅 목록을 받을 때까지 기다린다(ready는 reject하지 않는다).
      return promiseThen(client.ready, function (value: BridgeInit) {
        takeSnapshot(value)
        return dispatch(input, init)
      })
    } catch {
      return promiseReject(new TypeErr('bstage fetch: request failed'))
    }
  }

  // 템플릿 코드가 덮어쓰지 못하게 쓰기 불가로 설치한다.
  Object.defineProperty(g, '__bstage_fetch__', {
    value: bstageFetch,
    writable: false,
    configurable: false,
    enumerable: false,
  })
  return bstageFetch as typeof globalThis.fetch
}
