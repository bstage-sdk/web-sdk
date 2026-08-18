export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

/** fetch 함수와 동일한 시그니처. 커스텀 fetch 구현을 주입할 때 사용한다. */
export type FetchFunction = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

/** {@link HttpClient} 생성 옵션. */
export interface HttpClientConfig {
  /** 모든 요청의 기본 URL. 상대 경로 요청 시 앞에 붙는다. */
  baseUrl: string
  /** 모든 요청에 포함할 기본 헤더. */
  headers?: Record<string, string>
  /** 요청 타임아웃 (ms). 기본값 30,000. */
  timeout?: number
  /** 커스텀 fetch 함수. 미지정 시 globalThis.fetch 사용. */
  fetch?: FetchFunction
}

/** HTTP 요청 설정. {@link HttpClient.request}에 전달된다. */
export interface RequestConfig {
  method: HttpMethod
  url: string
  headers?: Record<string, string>
  params?: Record<string, string | number | boolean | (string | number | boolean)[] | undefined>
  body?: unknown
  timeout?: number
}

/** HTTP 응답. status, headers, 파싱된 data를 포함한다. */
export interface HttpResponse<T = unknown> {
  status: number
  headers: Headers
  data: T
}

/** 요청 전에 실행되는 인터셉터. {@link RequestConfig}를 변환하여 반환한다. */
export type RequestInterceptor = (config: RequestConfig) => RequestConfig | Promise<RequestConfig>

/** 응답 후에 실행되는 인터셉터. {@link HttpResponse}를 변환하여 반환한다. */
export type ResponseInterceptor = (response: HttpResponse) => HttpResponse | Promise<HttpResponse>
