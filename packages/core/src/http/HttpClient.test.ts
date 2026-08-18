import { afterEach, describe, expect, it, vi } from 'vitest'
import { HttpClient, HttpError, HttpTimeoutError } from './HttpClient.js'
import type { FetchFunction } from './types.js'

/**
 * 릴리즈 전 손 검증은 **성공 응답만** 태운다 — 스캐폴드 해피패스에서 에러 응답도, 타임아웃도,
 * 인터셉터 체인도 실행되지 않는다. 여기서 그 분기를 덮는다.
 * `HttpClientConfig.fetch`로 fetch를 주입할 수 있어 리팩터 없이 태울 수 있다.
 */

interface Call {
  url: string
  init: RequestInit
}

/** 호출을 기록하면서 지정한 응답을 돌려주는 fetch 스텁. */
function stubFetch(response: () => Response): { fetch: FetchFunction; calls: Call[] } {
  const calls: Call[] = []
  return {
    calls,
    fetch: async (input, init) => {
      calls.push({ url: String(input), init: init ?? {} })
      return response()
    },
  }
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })

afterEach(() => {
  vi.useRealTimers()
})

describe('buildUrl', () => {
  it('baseUrl 뒤 슬래시를 제거하고 경로를 붙인다', async () => {
    const { fetch, calls } = stubFetch(() => json({}))
    await new HttpClient({ baseUrl: 'https://api.example.com///', fetch }).get('/v1/me')
    expect(calls[0].url).toBe('https://api.example.com/v1/me')
  })

  it('절대 URL이면 baseUrl을 붙이지 않는다', async () => {
    const { fetch, calls } = stubFetch(() => json({}))
    await new HttpClient({ baseUrl: 'https://api.example.com', fetch }).get('https://other.dev/x')
    expect(calls[0].url).toBe('https://other.dev/x')
  })

  it('params를 쿼리스트링으로 직렬화한다 (숫자·boolean 포함)', async () => {
    const { fetch, calls } = stubFetch(() => json({}))
    await new HttpClient({ baseUrl: 'https://api.example.com', fetch }).get('/items', {
      params: { page: 2, active: true, q: '검색' },
    })
    const url = new URL(calls[0].url)
    expect(url.searchParams.get('page')).toBe('2')
    expect(url.searchParams.get('active')).toBe('true')
    expect(url.searchParams.get('q')).toBe('검색')
  })

  it('배열 param은 같은 키를 반복한다', async () => {
    const { fetch, calls } = stubFetch(() => json({}))
    await new HttpClient({ baseUrl: 'https://api.example.com', fetch }).get('/items', {
      params: { id: [1, 2, 3] },
    })
    expect(new URL(calls[0].url).searchParams.getAll('id')).toEqual(['1', '2', '3'])
  })

  it('undefined param은 보내지 않는다', async () => {
    const { fetch, calls } = stubFetch(() => json({}))
    await new HttpClient({ baseUrl: 'https://api.example.com', fetch }).get('/items', {
      params: { keep: 'y', skip: undefined },
    })
    const url = new URL(calls[0].url)
    expect(url.searchParams.has('skip')).toBe(false)
    expect(url.searchParams.get('keep')).toBe('y')
  })
})

describe('요청 구성', () => {
  it('기본 헤더와 요청별 헤더를 병합한다 (요청별이 우선)', async () => {
    const { fetch, calls } = stubFetch(() => json({}))
    const client = new HttpClient({
      baseUrl: 'https://api.example.com',
      fetch,
      headers: { 'x-base': '1', 'x-both': 'base' },
    })
    await client.get('/x', { headers: { 'x-both': 'req', 'x-req': '2' } })
    expect(calls[0].init.headers).toEqual({ 'x-base': '1', 'x-both': 'req', 'x-req': '2' })
  })

  it('body를 JSON 문자열로 보내고 credentials를 유지한다', async () => {
    const { fetch, calls } = stubFetch(() => json({}))
    await new HttpClient({ baseUrl: 'https://api.example.com', fetch }).post('/x', {
      body: { a: 1 },
    })
    expect(calls[0].init.body).toBe('{"a":1}')
    expect(calls[0].init.credentials).toBe('include')
  })

  it('body가 없으면 undefined로 둔다', async () => {
    const { fetch, calls } = stubFetch(() => json({}))
    await new HttpClient({ baseUrl: 'https://api.example.com', fetch }).post('/x')
    expect(calls[0].init.body).toBeUndefined()
  })

  it.each(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const)(
    '%s 메서드를 그대로 보낸다',
    async (method) => {
      const { fetch, calls } = stubFetch(() => json({}))
      const client = new HttpClient({ baseUrl: 'https://api.example.com', fetch })
      await client.request({ method, url: '/x' })
      expect(calls[0].init.method).toBe(method)
    },
  )
})

describe('응답 파싱', () => {
  it('application/json이면 객체로 파싱한다', async () => {
    const { fetch } = stubFetch(() => json({ ok: true }))
    const res = await new HttpClient({ baseUrl: 'https://api.example.com', fetch }).get('/x')
    expect(res.data).toEqual({ ok: true })
    expect(res.status).toBe(200)
  })

  it('JSON이 아니면 텍스트로 돌려준다', async () => {
    const { fetch } = stubFetch(
      () => new Response('plain', { headers: { 'content-type': 'text/plain' } }),
    )
    const res = await new HttpClient({ baseUrl: 'https://api.example.com', fetch }).get('/x')
    expect(res.data).toBe('plain')
  })

  it('content-type이 없으면 텍스트로 돌려준다', async () => {
    const { fetch } = stubFetch(() => new Response('no-type', { headers: {} }))
    const res = await new HttpClient({ baseUrl: 'https://api.example.com', fetch }).get('/x')
    expect(res.data).toBe('no-type')
  })
})

describe('인터셉터', () => {
  it('요청 인터셉터가 등록 순서대로 누적 적용된다', async () => {
    const { fetch, calls } = stubFetch(() => json({}))
    const client = new HttpClient({ baseUrl: 'https://api.example.com', fetch })
    client.addRequestInterceptor((c) => ({ ...c, headers: { ...c.headers, a: '1' } }))
    client.addRequestInterceptor((c) => ({ ...c, headers: { ...c.headers, b: '2' } }))
    await client.get('/x')
    expect(calls[0].init.headers).toEqual({ a: '1', b: '2' })
  })

  it('요청 인터셉터는 async도 된다', async () => {
    const { fetch, calls } = stubFetch(() => json({}))
    const client = new HttpClient({ baseUrl: 'https://api.example.com', fetch })
    client.addRequestInterceptor(async (c) => ({ ...c, url: '/replaced' }))
    await client.get('/x')
    expect(calls[0].url).toBe('https://api.example.com/replaced')
  })

  it('응답 인터셉터가 data를 변환한다', async () => {
    const { fetch } = stubFetch(() => json({ raw: 1 }))
    const client = new HttpClient({ baseUrl: 'https://api.example.com', fetch })
    client.addResponseInterceptor((r) => ({ ...r, data: { wrapped: r.data } }))
    const res = await client.get('/x')
    expect(res.data).toEqual({ wrapped: { raw: 1 } })
  })

  it('응답 인터셉터는 !ok 검사보다 먼저 돌아 에러 응답도 본다', async () => {
    // 인터셉터를 인증 재시도·로깅에 쓰는 소비자가 에러 응답을 놓치지 않도록 현재 순서를 고정한다.
    const seen: number[] = []
    const { fetch } = stubFetch(() => json({ message: 'nope' }, 500))
    const client = new HttpClient({ baseUrl: 'https://api.example.com', fetch })
    client.addResponseInterceptor((r) => {
      seen.push(r.status)
      return r
    })
    await expect(client.get('/x')).rejects.toBeInstanceOf(HttpError)
    expect(seen).toEqual([500])
  })
})

describe('에러 변환', () => {
  it('2xx가 아니면 HttpError로 status·data·headers를 담아 던진다', async () => {
    const { fetch } = stubFetch(() => json({ code: 'FORBIDDEN' }, 403))
    const client = new HttpClient({ baseUrl: 'https://api.example.com', fetch })

    const err = await client.get('/x').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(HttpError)
    const httpErr = err as HttpError
    expect(httpErr.status).toBe(403)
    expect(httpErr.message).toBe('HTTP 403')
    expect(httpErr.data).toEqual({ code: 'FORBIDDEN' })
    expect(httpErr.headers.get('content-type')).toContain('application/json')
    expect(httpErr.name).toBe('HttpError')
  })

  it('타임아웃되면 HttpTimeoutError로 바꾼다', async () => {
    vi.useFakeTimers()
    const fetch: FetchFunction = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          // 브라우저·Node의 fetch가 abort 시 던지는 것과 같은 형태
          reject(new DOMException('The operation was aborted.', 'AbortError'))
        })
      })

    const client = new HttpClient({ baseUrl: 'https://api.example.com', fetch, timeout: 5_000 })
    const pending = client.get('/slow').catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(5_000)

    const err = await pending
    expect(err).toBeInstanceOf(HttpTimeoutError)
    const timeoutErr = err as HttpTimeoutError
    expect(timeoutErr.timeout).toBe(5_000)
    expect(timeoutErr.url).toBe('https://api.example.com/slow')
    expect(timeoutErr.name).toBe('HttpTimeoutError')
  })

  it('요청별 timeout이 기본값을 덮어쓴다', async () => {
    vi.useFakeTimers()
    const fetch: FetchFunction = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'))
        })
      })

    const client = new HttpClient({ baseUrl: 'https://api.example.com', fetch, timeout: 30_000 })
    const pending = client.get('/slow', { timeout: 100 }).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(100)

    expect(((await pending) as HttpTimeoutError).timeout).toBe(100)
  })

  it('그 밖의 네트워크 에러는 그대로 전파한다', async () => {
    const boom = new TypeError('Failed to fetch')
    const client = new HttpClient({
      baseUrl: 'https://api.example.com',
      fetch: () => Promise.reject(boom),
    })
    await expect(client.get('/x')).rejects.toBe(boom)
  })

  it('DOMException이 아닌 AbortError도 타임아웃으로 변환한다', async () => {
    // 폴리필·래핑된 fetch(플랫폼이 주입하는 __bstage_fetch__ 등)는 이름만 AbortError인 평범한
    // Error로 reject할 수 있다. instanceof DOMException으로 좁히면 여기서 타임아웃을 놓친다.
    const abortLike = Object.assign(new Error('aborted'), { name: 'AbortError' })
    const client = new HttpClient({
      baseUrl: 'https://api.example.com',
      fetch: () => Promise.reject(abortLike),
      timeout: 1_234,
    })

    const err = await client.get('/x').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(HttpTimeoutError)
    expect((err as HttpTimeoutError).timeout).toBe(1_234)
  })

  it('AbortError가 아닌 이름의 에러는 변환하지 않는다', async () => {
    const other = Object.assign(new Error('boom'), { name: 'NetworkError' })
    const client = new HttpClient({
      baseUrl: 'https://api.example.com',
      fetch: () => Promise.reject(other),
    })
    await expect(client.get('/x')).rejects.toBe(other)
  })

  it('문자열을 던져도 죽지 않고 그대로 전파한다', async () => {
    // isAbortError가 객체가 아닌 값에도 안전해야 한다.
    const client = new HttpClient({
      baseUrl: 'https://api.example.com',
      fetch: () => Promise.reject('문자열 에러'),
    })
    await expect(client.get('/x')).rejects.toBe('문자열 에러')
  })
})
