import { describe, expect, it } from 'vitest'
import { BstageClient } from './BstageClient.js'

/**
 * OpenAPI 코드젠을 걷어내면서 5개 메서드의 오버로드가 사라지고 본문이 전부 다시 쓰였다.
 * 경로 치환·옵션 전달이 메서드마다 한 줄씩 반복되는 모양이라, 한 곳만 어긋나도 타입은
 * 통과하고 런타임에서만 드러난다.
 *
 * 릴리즈 전 손 검증은 GET 한두 번으로 끝나 put·patch·delete를 태우지 않으므로 여기서 고정한다.
 * `bstage build`가 `tsc`를 타지 않는다는 점까지 겹치면 소비자 쪽에서도 조용히 지나간다.
 */

/** 호출된 URL·init을 받아두는 fetch 스텁. */
function stubFetch() {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = []
  const fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    return Promise.resolve(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    )
  }
  return { calls, fetch: fetch as unknown as typeof globalThis.fetch }
}

function makeClient(fetch: typeof globalThis.fetch) {
  return new BstageClient({
    appId: 'bsa_test',
    appSecret: 'bsp_test',
    tenantId: 'space-1',
    baseUrl: 'https://example.test/gw',
    fetch,
  })
}

describe('경로 템플릿 치환', () => {
  it('{param}을 path 옵션 값으로 바꾼다', async () => {
    const { calls, fetch } = stubFetch()
    await makeClient(fetch).get('/content/v1/boards/{boardId}/posts/{postId}', {
      path: { boardId: 'b1', postId: 'p1' },
    })
    expect(calls[0].url).toBe('https://example.test/gw/content/v1/boards/b1/posts/p1')
  })

  it('path 값을 URL 인코딩한다', async () => {
    const { calls, fetch } = stubFetch()
    await makeClient(fetch).get('/content/v1/boards/{boardId}', { path: { boardId: 'a/b c' } })
    expect(calls[0].url).toBe('https://example.test/gw/content/v1/boards/a%2Fb%20c')
  })

  it('path 옵션 자체가 쿼리로 새지 않는다', async () => {
    const { calls, fetch } = stubFetch()
    await makeClient(fetch).get('/content/v1/boards/{boardId}', {
      path: { boardId: 'b1' },
      params: { pageSize: 20 },
    })
    expect(calls[0].url).toBe('https://example.test/gw/content/v1/boards/b1?pageSize=20')
  })

  it('값이 없는 {param}은 치환하지 않는다 — 잘못된 경로가 조용히 만들어지지 않도록', async () => {
    const { calls, fetch } = stubFetch()
    await makeClient(fetch).get('/content/v1/boards/{boardId}')
    // 자리표시자가 남은 채 URL 생성 단계에서 인코딩된다. 404로 드러나야 맞다.
    expect(calls[0].url).toBe('https://example.test/gw/content/v1/boards/%7BboardId%7D')
  })
})

describe('메서드별 전달', () => {
  it('get은 params를 쿼리로 보낸다', async () => {
    const { calls, fetch } = stubFetch()
    await makeClient(fetch).get('/home/v1/menu', { params: { locale: 'ko' } })
    expect(calls[0].url).toBe('https://example.test/gw/home/v1/menu?locale=ko')
    expect(calls[0].init?.method).toBe('GET')
  })

  it.each([
    ['post', 'POST'],
    ['put', 'PUT'],
    ['patch', 'PATCH'],
  ] as const)('%s는 body를 실어 %s로 보낸다', async (method, httpMethod) => {
    const { calls, fetch } = stubFetch()
    const client = makeClient(fetch)
    await client[method]('/content/v1/boards/{boardId}/posts', {
      path: { boardId: 'b1' },
      body: { title: 'Hello' },
    })
    expect(calls[0].url).toBe('https://example.test/gw/content/v1/boards/b1/posts')
    expect(calls[0].init?.method).toBe(httpMethod)
    expect(calls[0].init?.body).toBe('{"title":"Hello"}')
  })

  it('delete는 DELETE로 보내고 경로를 치환한다', async () => {
    const { calls, fetch } = stubFetch()
    await makeClient(fetch).delete('/content/v1/boards/{boardId}', { path: { boardId: 'b1' } })
    expect(calls[0].url).toBe('https://example.test/gw/content/v1/boards/b1')
    expect(calls[0].init?.method).toBe('DELETE')
  })

  it('인증 헤더와 요청별 헤더가 함께 실린다', async () => {
    const { calls, fetch } = stubFetch()
    await makeClient(fetch).get('/home/v1/menu', { headers: { 'X-Custom': '1' } })
    const headers = new Headers(calls[0].init?.headers)
    expect(headers.get('X-BSTAGE-APP-ID')).toBe('bsa_test')
    expect(headers.get('X-BSTAGE-APP-KEY')).toBe('bsp_test')
    expect(headers.get('X-BSTAGE-TENANT-ID')).toBe('space-1')
    expect(headers.get('X-Custom')).toBe('1')
  })
})
