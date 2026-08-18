import { HttpClient } from '../http/index.js'
import type { FetchFunction, HttpResponse, RequestConfig } from '../http/index.js'
import type { BstageConfig } from './types.js'

/** 경로 템플릿의 `{param}` 자리에 넣을 값. */
export type PathParams = Record<string, string | number>

/** 모든 메서드가 공통으로 받는 옵션. */
export interface RequestOptions {
  /** 경로 템플릿 치환값 — `'/content/v1/boards/{boardId}'` + `{ boardId: 'b1' }` */
  path?: PathParams
  headers?: Record<string, string>
  timeout?: number
}

/** GET 옵션 — 쿼리 파라미터를 받는다. */
export interface QueryRequestOptions extends RequestOptions {
  params?: RequestConfig['params']
}

/** POST·PUT·PATCH 옵션 — 요청 바디를 받는다. */
export interface BodyRequestOptions extends RequestOptions {
  body?: unknown
}

/** 현재 호스트 기반 base URL을 반환. 플랫폼 임베드 시 커스텀 도메인의 쿠키가 전달되도록 한다. */
function resolveBaseUrl(): string {
  if (typeof globalThis.location !== 'undefined') {
    return `${globalThis.location.origin}/gw`
  }
  return '/gw'
}

/** URL 템플릿의 `{param}` 플레이스홀더를 실제 값으로 치환합니다. */
function resolvePath(
  template: string,
  params: Record<string, string | number> | undefined,
): string {
  if (!params) return template
  return template.replace(/\{([^}]+)\}/g, (_, key: string) => {
    const value = params[key]
    if (value === undefined) return `{${key}}`
    return encodeURIComponent(String(value))
  })
}

/**
 * b.stage API를 호출하는 HTTP 클라이언트.
 *
 * 게이트웨이 base URL 해석, 인증 헤더(`X-BSTAGE-APP-ID`/`X-BSTAGE-APP-KEY`/`X-BSTAGE-TENANT-ID`)
 * 자동 포함, 플랫폼 주입 fetch(`__bstage_fetch__`) 해석을 맡는다.
 *
 * 경로와 응답 모양은 **게이트웨이 API Reference Doc**을 보고 호출자가 정한다. 응답 타입은
 * 제네릭으로 명시한다 — SDK가 OpenAPI 스펙에서 타입을 생성하던 방식은 걷어냈다.
 *
 * @example
 * ```ts
 * const client = new BstageClient({ appId: '...', appSecret: '...', tenantId: '...' })
 * const res = await client.get<BoardList>('/content/v1/boards')
 * ```
 */
/** 플랫폼이 주입하는 fetch 함수를 위한 전역 인터페이스 */
interface BstageGlobal {
  __bstage_fetch__?: typeof fetch
}

/**
 * 요청 시점에 플랫폼 주입 fetch를 해석한다.
 *
 * 플랫폼은 `globalThis.__bstage_fetch__`(Authorization·CF Access 헤더 포함)를 템플릿 mount
 * 직전에 주입한다. 모듈 최상단에서 생성된 BstageClient가 이를 **생성 시점에** 캡처하면 주입
 * 이전이라 놓치므로, 매 요청마다 현재 값을 읽어 늦은 주입도 반영한다. 없으면 기본 fetch로 폴백.
 */
const resolveBstageFetch: FetchFunction = (input, init) => {
  const hook = (globalThis as BstageGlobal).__bstage_fetch__
  return hook ? hook(input, init) : globalThis.fetch(input, init)
}

/** 파트너 콘솔이 발급하는 인증 값의 접두사 규약. */
const APP_ID_PREFIX = 'bsa_'
const APP_SECRET_PREFIX = 'bsp_'

/**
 * appId·appSecret이 서로 뒤바뀌어 들어왔는지 검사해 개발 중 경고한다.
 *
 * - appId가 시크릿 접두사(`bsp_`)로 시작하거나 appSecret이 앱 ID 접두사(`bsa_`)로 시작하면 swap으로 판단.
 * - 정상 접두사·placeholder·빈값·미설정(undefined)은 조용히 통과한다.
 * - throw 하지 않고 `console.warn`만 하므로, 값을 올바로 넣은 프로덕션 런타임엔 아무 부담이 없다.
 */
function warnOnSwappedCredentials(appId: string, appSecret: string): void {
  const appIdLooksLikeSecret = typeof appId === 'string' && appId.startsWith(APP_SECRET_PREFIX)
  const appSecretLooksLikeId = typeof appSecret === 'string' && appSecret.startsWith(APP_ID_PREFIX)
  if (!appIdLooksLikeSecret && !appSecretLooksLikeId) return

  console.warn(
    `[b.stage] appId와 appSecret이 서로 바뀐 것 같습니다.\n` +
      `  appId는 "${APP_ID_PREFIX}", appSecret은 "${APP_SECRET_PREFIX}"로 시작해야 합니다.\n` +
      `  파트너 콘솔에서 발급받은 값을 다시 확인해 주세요.`,
  )
}

export class BstageClient {
  readonly http: HttpClient

  constructor(config: BstageConfig) {
    warnOnSwappedCredentials(config.appId, config.appSecret)

    // __bstage_fetch__ 해석을 요청 시점으로 미룬다(resolveBstageFetch 참고).
    // config.fetch(명시 주입)가 있으면 그대로 우선.
    const fetchFn: FetchFunction = config.fetch ?? resolveBstageFetch

    this.http = new HttpClient({
      baseUrl: config.baseUrl ?? resolveBaseUrl(),
      timeout: config.timeout,
      fetch: fetchFn,
      headers: {
        'Content-Type': 'application/json',
        'X-BSTAGE-APP-ID': config.appId,
        'X-BSTAGE-APP-KEY': config.appSecret,
        'X-BSTAGE-TENANT-ID': config.tenantId,
      },
    })
  }

  // ── GET ──────────────────────────────────────────────────────────────
  get<T = unknown>(url: string, options?: QueryRequestOptions): Promise<HttpResponse<T>> {
    const { path, ...rest } = options ?? {}
    return this.http.get<T>(resolvePath(url, path), rest)
  }

  // ── POST ─────────────────────────────────────────────────────────────
  post<T = unknown>(url: string, options?: BodyRequestOptions): Promise<HttpResponse<T>> {
    const { path, ...rest } = options ?? {}
    return this.http.post<T>(resolvePath(url, path), rest)
  }

  // ── PUT ──────────────────────────────────────────────────────────────
  put<T = unknown>(url: string, options?: BodyRequestOptions): Promise<HttpResponse<T>> {
    const { path, ...rest } = options ?? {}
    return this.http.put<T>(resolvePath(url, path), rest)
  }

  // ── PATCH ────────────────────────────────────────────────────────────
  patch<T = unknown>(url: string, options?: BodyRequestOptions): Promise<HttpResponse<T>> {
    const { path, ...rest } = options ?? {}
    return this.http.patch<T>(resolvePath(url, path), rest)
  }

  // ── DELETE ───────────────────────────────────────────────────────────
  delete<T = unknown>(url: string, options?: RequestOptions): Promise<HttpResponse<T>> {
    const { path, ...rest } = options ?? {}
    return this.http.delete<T>(resolvePath(url, path), rest)
  }
}
