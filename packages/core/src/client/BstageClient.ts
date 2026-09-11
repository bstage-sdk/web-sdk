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
 * const client = new BstageClient({ appId: '...', appKey: '...', tenantId: '...' })
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
const APP_KEY_PREFIX = 'bsp_'

/**
 * appId·appKey가 서로 뒤바뀌어 들어왔는지 검사해 개발 중 경고한다.
 *
 * - appId가 앱 키 접두사(`bsp_`)로 시작하거나 appKey가 앱 ID 접두사(`bsa_`)로 시작하면 swap으로 판단.
 * - 정상 접두사·placeholder·빈값·미설정(undefined)은 조용히 통과한다.
 * - throw 하지 않고 `console.warn`만 하므로, 값을 올바로 넣은 프로덕션 런타임엔 아무 부담이 없다.
 */
function warnOnSwappedCredentials(appId: string, appKey: string | undefined): void {
  const appIdLooksLikeKey = typeof appId === 'string' && appId.startsWith(APP_KEY_PREFIX)
  const appKeyLooksLikeId = typeof appKey === 'string' && appKey.startsWith(APP_ID_PREFIX)
  if (!appIdLooksLikeKey && !appKeyLooksLikeId) return

  console.warn(
    `[b.stage] appId와 appKey가 서로 바뀐 것 같습니다.\n` +
      `  appId는 "${APP_ID_PREFIX}", appKey는 "${APP_KEY_PREFIX}"로 시작해야 합니다.\n` +
      `  파트너 콘솔에서 발급받은 값을 다시 확인해 주세요.`,
  )
}

/**
 * 앱 키를 해석한다 — `appKey`가 정본이고 `appSecret`은 같은 값의 옛 이름(deprecated)이다.
 * 둘 다 오면 `appKey`가 우선하되, 빈 문자열은 없는 값으로 본다(cli의 env 별칭과 같은 규칙 — `.env`의
 * `VITE_BSTAGE_APP_KEY=`처럼 이름만 있는 줄이 유효한 `appSecret`을 가리지 않도록). 별칭 제거 시점은
 * `BstageConfig.appSecret` 참고.
 */
function resolveAppKey(config: BstageConfig): string | undefined {
  return config.appKey || config.appSecret || undefined
}

/**
 * 앱 키가 아예 없으면 개발 중 알 수 있게 경고한다. 타입은 둘 다 선택 필드라 막지 못하고(`bstage build`는
 * tsc를 타지 않는다), 헤더가 빠진 요청은 게이트웨이 401로만 드러나므로 원인을 콘솔에 남긴다.
 * throw 하지 않는다 — 값이 없는 채로 렌더만 하는 템플릿을 깨뜨리지 않기 위해.
 */
function warnOnMissingAppKey(appKey: string | undefined): void {
  if (appKey !== undefined) return
  console.warn(
    `[b.stage] appKey가 없습니다 — X-BSTAGE-APP-KEY 헤더 없이 호출되어 API가 401을 냅니다.\n` +
      `  .env의 VITE_BSTAGE_APP_KEY(파트너 콘솔의 APP KEY)를 확인해 주세요.`,
  )
}

export class BstageClient {
  readonly http: HttpClient

  constructor(config: BstageConfig) {
    const appKey = resolveAppKey(config)
    warnOnMissingAppKey(appKey)
    warnOnSwappedCredentials(config.appId, appKey)

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
        // 값이 없으면(UI 전용 템플릿의 빈 .env) 헤더 자체를 빼서 "undefined" 문자열이 실리지 않게 한다.
        ...(appKey !== undefined ? { 'X-BSTAGE-APP-KEY': appKey } : {}),
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
