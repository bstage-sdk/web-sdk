import type {
  FetchFunction,
  HttpClientConfig,
  HttpResponse,
  RequestConfig,
  RequestInterceptor,
  ResponseInterceptor,
} from './types.js'

/**
 * Fetch 기반 HTTP 클라이언트. 요청/응답 인터셉터를 지원한다.
 *
 * 직접 사용보다는 {@link BstageClient}를 통해 사용하는 것을 권장.
 */
export class HttpClient {
  private baseUrl: string
  private defaultHeaders: Record<string, string>
  private defaultTimeout: number
  private fetchFn: FetchFunction
  private requestInterceptors: RequestInterceptor[] = []
  private responseInterceptors: ResponseInterceptor[] = []

  constructor(config: HttpClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '')
    this.defaultHeaders = config.headers ?? {}
    this.defaultTimeout = config.timeout ?? 30_000
    this.fetchFn = config.fetch ?? globalThis.fetch.bind(globalThis)
  }

  addRequestInterceptor(interceptor: RequestInterceptor): void {
    this.requestInterceptors.push(interceptor)
  }

  addResponseInterceptor(interceptor: ResponseInterceptor): void {
    this.responseInterceptors.push(interceptor)
  }

  async request<T = unknown>(config: RequestConfig): Promise<HttpResponse<T>> {
    let resolvedConfig = { ...config }

    for (const interceptor of this.requestInterceptors) {
      resolvedConfig = await interceptor(resolvedConfig)
    }

    const url = this.buildUrl(resolvedConfig.url, resolvedConfig.params)
    const timeout = resolvedConfig.timeout ?? this.defaultTimeout
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    try {
      const fetchResponse = await this.fetchFn(url, {
        method: resolvedConfig.method,
        headers: {
          ...this.defaultHeaders,
          ...resolvedConfig.headers,
        },
        body: resolvedConfig.body != null ? JSON.stringify(resolvedConfig.body) : undefined,
        signal: controller.signal,
        credentials: 'include',
      })

      const data = await this.parseResponse<T>(fetchResponse)

      let response: HttpResponse<T> = {
        status: fetchResponse.status,
        headers: fetchResponse.headers,
        data,
      }

      for (const interceptor of this.responseInterceptors) {
        response = (await interceptor(response as HttpResponse)) as HttpResponse<T>
      }

      if (!fetchResponse.ok) {
        throw new HttpError(response)
      }

      return response
    } catch (error) {
      if (error instanceof HttpError) throw error
      if (isAbortError(error)) {
        throw new HttpTimeoutError(timeout, url)
      }
      throw error
    } finally {
      clearTimeout(timeoutId)
    }
  }

  async get<T = unknown>(
    url: string,
    options?: {
      params?: RequestConfig['params']
      headers?: Record<string, string>
      timeout?: number
    },
  ): Promise<HttpResponse<T>> {
    return this.request<T>({ method: 'GET', url, ...options })
  }

  async post<T = unknown>(
    url: string,
    options?: {
      body?: unknown
      headers?: Record<string, string>
      timeout?: number
    },
  ): Promise<HttpResponse<T>> {
    return this.request<T>({ method: 'POST', url, ...options })
  }

  async put<T = unknown>(
    url: string,
    options?: {
      body?: unknown
      headers?: Record<string, string>
      timeout?: number
    },
  ): Promise<HttpResponse<T>> {
    return this.request<T>({ method: 'PUT', url, ...options })
  }

  async patch<T = unknown>(
    url: string,
    options?: {
      body?: unknown
      headers?: Record<string, string>
      timeout?: number
    },
  ): Promise<HttpResponse<T>> {
    return this.request<T>({ method: 'PATCH', url, ...options })
  }

  async delete<T = unknown>(
    url: string,
    options?: { headers?: Record<string, string>; timeout?: number },
  ): Promise<HttpResponse<T>> {
    return this.request<T>({ method: 'DELETE', url, ...options })
  }

  private buildUrl(
    path: string,
    params?: Record<string, string | number | boolean | (string | number | boolean)[] | undefined>,
  ): string {
    const full =
      path.startsWith('http://') || path.startsWith('https://') ? path : `${this.baseUrl}${path}`
    const url = new URL(full)
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined) continue
        if (Array.isArray(value)) {
          for (const item of value) {
            url.searchParams.append(key, String(item))
          }
        } else {
          url.searchParams.set(key, String(value))
        }
      }
    }
    return url.toString()
  }

  private async parseResponse<T>(response: Response): Promise<T> {
    const contentType = response.headers.get('content-type')
    if (contentType?.includes('application/json')) {
      return response.json() as Promise<T>
    }
    return response.text() as unknown as T
  }
}

/**
 * abort로 인한 에러인지 판정한다.
 *
 * `instanceof DOMException`으로 좁히면 표준 fetch만 커버된다 — 폴리필이나 플랫폼이 주입하는
 * `__bstage_fetch__` 같은 래퍼가 이름만 `AbortError`인 평범한 Error로 reject하면 타임아웃이
 * {@link HttpTimeoutError}로 바뀌지 않고 원본 에러로 새어나간다.
 *
 * 이 클라이언트는 타임아웃 외에 abort를 걸지 않으므로(요청별 signal 옵션이 없다) name만 보고
 * 타임아웃으로 판정해도 오탐이 생기지 않는다.
 */
function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'AbortError'
  )
}

/** HTTP 응답 상태가 2xx가 아닐 때 발생하는 에러. status, headers, data를 포함한다. */
export class HttpError extends Error {
  readonly status: number
  readonly headers: Headers
  readonly data: unknown

  constructor(response: HttpResponse) {
    super(`HTTP ${response.status}`)
    this.name = 'HttpError'
    this.status = response.status
    this.headers = response.headers
    this.data = response.data
  }
}

/** 요청이 설정된 타임아웃을 초과했을 때 발생하는 에러. timeout(ms)과 url을 포함한다. */
export class HttpTimeoutError extends Error {
  readonly timeout: number
  readonly url: string

  constructor(timeout: number, url: string) {
    super(`Request timed out after ${timeout}ms: ${url}`)
    this.name = 'HttpTimeoutError'
    this.timeout = timeout
    this.url = url
  }
}
