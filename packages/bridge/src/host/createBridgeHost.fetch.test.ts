import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEnvelope, type BridgeEnvelope } from '../protocol/envelope.js'
import { flush, HOST_ORIGIN, SESSION } from '../testing.js'
import { MAX_IN_FLIGHT_FETCHES } from './createBridgeHost.js'
import { INIT, okResponse, request, setup } from './hostTestKit.js'
import { __resetBridgeStorage__ } from './storage.js'

/** createBridgeHost — fetch 요청 처리·정책 연결·레이트 리밋(본 파일이 800줄을 넘어 나눴다). */

afterEach(() => {
  __resetBridgeStorage__()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('fetch 요청', () => {
  it('정책을 통과하면 주입 fetch로 보내고 상태·content-type·본문만 돌려준다', async () => {
    const { link, fetchImpl } = setup()
    const res = await request(link, 'fetch', {
      url: '/gw/content/v1/boards',
      method: 'post',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer stolen', Cookie: 'x' },
      body: '{"q":1}',
    })
    expect(fetchImpl).toHaveBeenCalledWith(`${HOST_ORIGIN}/gw/content/v1/boards`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"q":1}',
      credentials: 'same-origin',
      redirect: 'error',
    })
    expect(res).toEqual({
      ok: true,
      data: {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        bodyText: '{"a":1}',
      },
    })
  })

  it('content-type이 없는 응답은 빈 헤더, 4xx도 그대로 전달', async () => {
    const { link } = setup({
      fetchImpl: vi.fn(async () => {
        const r = new Response('nope', { status: 404, statusText: 'Not Found' })
        r.headers.delete('content-type')
        return r
      }),
    })
    const res = await request(link, 'fetch', { url: '/gw/a' })
    expect(res).toEqual({
      ok: true,
      data: { status: 404, statusText: 'Not Found', headers: {}, bodyText: 'nope' },
    })
  })

  it('HEAD는 본문을 읽지 않는다', async () => {
    const text = vi.fn(async () => 'body')
    const { link } = setup({
      fetchImpl: vi.fn(
        async () =>
          ({
            ...okResponse(),
            status: 200,
            statusText: 'OK',
            headers: new Headers(),
            text,
          }) as unknown as Response,
      ),
    })
    const res = await request(link, 'fetch', { url: '/gw/a', method: 'HEAD' })
    expect(res).toMatchObject({ ok: true, data: { bodyText: '' } })
    expect(text).not.toHaveBeenCalled()
  })

  it('파트너 origin은 partnerFetchImpl로 — credentials omit, 인증 fetch(fetchImpl)는 쓰지 않는다', async () => {
    const partnerFetchImpl = vi.fn(async () => okResponse())
    const { link, fetchImpl } = setup({ partnerFetchImpl })
    await request(link, 'fetch', {
      url: 'https://partner.example.net/v1',
      headers: { authorization: 'Bearer x' },
    })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(partnerFetchImpl).toHaveBeenCalledWith('https://partner.example.net/v1', {
      method: 'GET',
      headers: {},
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    })
  })

  it('/gw 요청은 partnerFetchImpl을 쓰지 않는다', async () => {
    const partnerFetchImpl = vi.fn(async () => okResponse())
    const { link, fetchImpl } = setup({ partnerFetchImpl })
    await request(link, 'fetch', { url: '/gw/a' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(partnerFetchImpl).not.toHaveBeenCalled()
  })

  it('partnerFetchImpl 기본값은 globalThis.fetch를 credentials omit·redirect error로 부른다', async () => {
    const native = vi.fn(async () => okResponse())
    vi.stubGlobal('fetch', native)
    try {
      const { link } = setup()
      expect(await request(link, 'fetch', { url: 'https://partner.example.net/v1' })).toMatchObject(
        {
          ok: true,
        },
      )
      expect(native).toHaveBeenCalledWith(
        'https://partner.example.net/v1',
        expect.objectContaining({ credentials: 'omit', redirect: 'error', headers: {} }),
      )
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('partnerOrigins에 hostOrigin이 있어도 /gw 밖 같은 origin 경로는 열리지 않고 init에서도 빠진다', async () => {
    const { link, fetchImpl } = setup({
      init: { ...INIT, partnerOrigins: [HOST_ORIGIN, 'https://partner.example.net'] },
    })
    expect(
      await request(link, 'fetch', { url: '/api/auth/token/refresh', method: 'POST' }),
    ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN_DESTINATION' } })
    expect(fetchImpl).not.toHaveBeenCalled()
    link.parent.postMessage(createEnvelope('evt', 'ready', 'r', { session: SESSION }), HOST_ORIGIN)
    await flush()
    const init = (link.toFrame[link.toFrame.length - 1].message as BridgeEnvelope<{ data: any }>)
      .payload.data
    expect(init.partnerOrigins).toEqual(['https://partner.example.net'])
  })

  it.each([
    [{ url: '/account/v1/me' }, 'FORBIDDEN_DESTINATION'],
    [{ url: '/gw/%2e%2e/account' }, 'FORBIDDEN_DESTINATION'],
    [{ url: 'http://bad.example/path' }, 'FORBIDDEN_DESTINATION'],
    [{ url: '/gw/a', method: 'TRACE' }, 'FORBIDDEN_METHOD'],
    [{ url: '/gw/a', method: 'POST', body: 'x'.repeat(1024 * 1024 + 1) }, 'BODY_TOO_LARGE'],
    [{ url: 42 }, 'BAD_REQUEST'],
  ])('%j → %s, 주입 fetch를 부르지 않는다', async (payload, code) => {
    const { link, fetchImpl } = setup()
    const res = await request(link, 'fetch', payload)
    expect(res).toMatchObject({ ok: false, error: { code } })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('주입 fetch 예외는 NETWORK_ERROR — 예외 메시지를 싣지 않는다', async () => {
    const { link } = setup({
      fetchImpl: vi.fn(async () => {
        throw new Error('internal https://secret.internal/xyz token=abc')
      }),
    })
    const res = await request(link, 'fetch', { url: '/gw/a' })
    expect(res).toEqual({ ok: false, error: { code: 'NETWORK_ERROR', message: 'network error' } })
  })

  it('응답 본문 상한 — content-length 선검사·읽은 뒤 바이트 검사 모두 BODY_TOO_LARGE', async () => {
    const declared = setup({
      policy: { maxResponseBytes: 4 },
      fetchImpl: vi.fn(async () => okResponse('x', { headers: { 'content-length': '100' } })),
    })
    expect(await request(declared.link, 'fetch', { url: '/gw/a' })).toMatchObject({
      ok: false,
      error: { code: 'BODY_TOO_LARGE' },
    })
    const actual = setup({
      policy: { maxResponseBytes: 4 },
      fetchImpl: vi.fn(async () => okResponse('가나')),
    })
    expect(await request(actual.link, 'fetch', { url: '/gw/a' })).toMatchObject({
      ok: false,
      error: { code: 'BODY_TOO_LARGE' },
    })
    const fits = setup({
      policy: { maxResponseBytes: 4 },
      fetchImpl: vi.fn(async () => okResponse('abcd')),
    })
    expect(await request(fits.link, 'fetch', { url: '/gw/a' })).toMatchObject({ ok: true })
  })

  it('content-length 없는 스트리밍 응답도 상한을 넘는 순간 취소하고 BODY_TOO_LARGE', async () => {
    let pulls = 0
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1
        controller.enqueue(new Uint8Array(3))
      },
      cancel() {
        cancelled = true
      },
    })
    const { link } = setup({
      policy: { maxResponseBytes: 8 },
      fetchImpl: vi.fn(async () => new Response(stream, { status: 200 })),
    })
    expect(await request(link, 'fetch', { url: '/gw/a' })).toMatchObject({
      ok: false,
      error: { code: 'BODY_TOO_LARGE' },
    })
    expect(cancelled).toBe(true)
    expect(pulls).toBeLessThan(10)
  })

  it('스트리밍 본문을 멀티바이트 경계와 무관하게 디코딩한다', async () => {
    const bytes = new TextEncoder().encode('가나다')
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 4))
        controller.enqueue(bytes.slice(4))
        controller.close()
      },
    })
    const { link } = setup({ fetchImpl: vi.fn(async () => new Response(stream)) })
    expect(await request(link, 'fetch', { url: '/gw/a' })).toMatchObject({
      ok: true,
      data: { bodyText: '가나다' },
    })
  })

  it('본문이 있는데 스트림을 못 읽는 비표준 Response는 버퍼링하지 않고 NETWORK_ERROR', async () => {
    const text = vi.fn(async () => 'x'.repeat(100))
    const { link } = setup({
      fetchImpl: vi.fn(
        async () =>
          ({
            status: 200,
            statusText: 'OK',
            headers: new Headers(),
            body: {},
            text,
          }) as unknown as Response,
      ),
    })
    expect(await request(link, 'fetch', { url: '/gw/a' })).toMatchObject({
      ok: false,
      error: { code: 'NETWORK_ERROR' },
    })
    expect(text).not.toHaveBeenCalled()
  })

  it('HEAD 응답에 본문이 있으면 취소한다', async () => {
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        c.enqueue(new Uint8Array(1))
      },
      cancel() {
        cancelled = true
      },
    })
    const { link } = setup({ fetchImpl: vi.fn(async () => new Response(stream)) })
    expect(await request(link, 'fetch', { url: '/gw/a', method: 'HEAD' })).toMatchObject({
      ok: true,
      data: { bodyText: '' },
    })
    expect(cancelled).toBe(true)
  })

  it('스트림 읽기 오류는 NETWORK_ERROR', async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error('reset'))
      },
    })
    const { link } = setup({ fetchImpl: vi.fn(async () => new Response(stream)) })
    expect(await request(link, 'fetch', { url: '/gw/a' })).toMatchObject({
      ok: false,
      error: { code: 'NETWORK_ERROR' },
    })
  })

  it('본문 읽기 실패도 NETWORK_ERROR', async () => {
    const { link } = setup({
      fetchImpl: vi.fn(
        async () =>
          ({
            status: 200,
            statusText: 'OK',
            headers: new Headers(),
            text: async () => {
              throw new Error('stream')
            },
          }) as unknown as Response,
      ),
    })
    const res = await request(link, 'fetch', { url: '/gw/a' })
    expect(res).toMatchObject({ ok: false, error: { code: 'NETWORK_ERROR' } })
  })
})

describe('pinnedHeaders 연결', () => {
  it('호스트 고정 테넌트가 실리고 프레임 테넌트는 버려진다', async () => {
    const { link, fetchImpl } = setup({ pinnedHeaders: { 'x-bstage-tenant-id': 'space-1' } })
    await request(link, 'fetch', { url: '/gw/a', headers: { 'x-bstage-tenant-id': 'victim' } })
    expect(fetchImpl).toHaveBeenCalledWith(
      `${HOST_ORIGIN}/gw/a`,
      expect.objectContaining({ headers: { 'x-bstage-tenant-id': 'space-1' } }),
    )
  })

  it('잘못된 pinnedHeaders는 생성 시 TypeError', () => {
    expect(() => setup({ pinnedHeaders: { authorization: 'Bearer x' } })).toThrow(TypeError)
  })
})

describe('레이트 리밋', () => {
  it('분당 상한을 넘으면 RATE_LIMITED, resize는 세지 않는다', async () => {
    const { link, fetchImpl } = setup({ policy: { maxRequestsPerMinute: 2 } })
    expect(await request(link, 'fetch', { url: '/gw/a' })).toMatchObject({ ok: true })
    expect(await request(link, 'resize', { height: 10 })).toMatchObject({ ok: true })
    expect(await request(link, 'storage', { op: 'get', key: 'a' })).toMatchObject({ ok: true })
    expect(await request(link, 'fetch', { url: '/gw/a' })).toMatchObject({
      ok: false,
      error: { code: 'RATE_LIMITED' },
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('동시 진행 fetch가 상한이면 RATE_LIMITED, 끝나면 다시 허용', async () => {
    const pending: Array<(r: Response) => void> = []
    const fetchImpl = vi.fn(() => new Promise<Response>((r) => pending.push(r)))
    const { link } = setup({ fetchImpl })
    for (let i = 0; i < MAX_IN_FLIGHT_FETCHES; i += 1) {
      link.parent.postMessage(
        createEnvelope('req', 'fetch', `p${i}`, { url: '/gw/a', session: SESSION }),
        HOST_ORIGIN,
      )
    }
    await flush()
    expect(await request(link, 'fetch', { url: '/gw/a' })).toMatchObject({
      ok: false,
      error: { code: 'RATE_LIMITED' },
    })
    pending[0](okResponse())
    await flush(10)
    expect(fetchImpl).toHaveBeenCalledTimes(MAX_IN_FLIGHT_FETCHES)
    const next = request(link, 'fetch', { url: '/gw/a' })
    await flush()
    pending[MAX_IN_FLIGHT_FETCHES](okResponse())
    expect(await next).toMatchObject({ ok: true })
  })

  it('1분이 지나면 다시 허용한다', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000)
    const { link } = setup({ policy: { maxRequestsPerMinute: 1 } })
    expect(await request(link, 'fetch', { url: '/gw/a' })).toMatchObject({ ok: true })
    expect(await request(link, 'fetch', { url: '/gw/a' })).toMatchObject({ ok: false })
    now.mockReturnValue(61_000)
    expect(await request(link, 'fetch', { url: '/gw/a' })).toMatchObject({ ok: true })
  })
})
