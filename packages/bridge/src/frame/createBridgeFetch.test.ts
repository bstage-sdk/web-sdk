import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FetchResult } from '../protocol/messages.js'
import { createBridgeFetch } from './createBridgeFetch.js'

/**
 * HttpClient가 이 함수를 fetch로 쓴다 — Response 재구성(null-body 상태·HEAD)·abort·오류 변환은
 * 정상 GET 한 번으로는 실행되지 않는다.
 */

afterEach(() => vi.useRealTimers())

function stubClient(result: Partial<FetchResult> | Error = {}) {
  const calls: Array<{ type: string; payload: any }> = []
  const client = {
    request: vi.fn((type: string, payload: unknown) => {
      calls.push({ type, payload })
      if (result instanceof Error) return Promise.reject(result)
      return Promise.resolve({
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        bodyText: '{"a":1}',
        ...result,
      })
    }),
  }
  return { calls, fetch: createBridgeFetch(client as never) }
}

describe('createBridgeFetch — 요청 변환', () => {
  it('문자열 URL·init을 fetch 요청으로 바꾼다(헤더는 소문자 평면 객체)', async () => {
    const { calls, fetch } = stubClient()
    await fetch('https://h.example/gw/a', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-BSTAGE-APP-ID': 'bsa' },
      body: '{}',
      credentials: 'include',
    })
    expect(calls).toEqual([
      {
        type: 'fetch',
        payload: {
          url: 'https://h.example/gw/a',
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-bstage-app-id': 'bsa' },
          body: '{}',
        },
      },
    ])
  })

  it('URL 객체·Request 입력', async () => {
    const { calls, fetch } = stubClient()
    await fetch(new URL('https://h.example/gw/u'))
    await fetch(
      new Request('https://h.example/gw/r', { method: 'DELETE', headers: { accept: 'x' } }),
    )
    expect(calls[0].payload).toEqual({
      url: 'https://h.example/gw/u',
      method: 'GET',
      headers: {},
      body: null,
    })
    expect(calls[1].payload).toEqual({
      url: 'https://h.example/gw/r',
      method: 'DELETE',
      headers: { accept: 'x' },
      body: null,
    })
  })

  it('본문이 있는 Request 입력은 init.body 없이 거절한다(조용히 버리지 않는다)', async () => {
    const { calls, fetch } = stubClient()
    await expect(
      fetch(new Request('https://h.example/gw/r', { method: 'POST', body: 'x' })),
    ).rejects.toThrow(TypeError)
    expect(calls).toHaveLength(0)
    await fetch(new Request('https://h.example/gw/r', { method: 'POST', body: 'x' }), { body: 'y' })
    expect(calls[0].payload.body).toBe('y')
  })

  it('URLSearchParams 본문은 문자열 + 기본 content-type', async () => {
    const { calls, fetch } = stubClient()
    await fetch('/gw/a', { method: 'POST', body: new URLSearchParams({ a: '1' }) })
    expect(calls[0].payload).toMatchObject({
      body: 'a=1',
      headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    })
    await fetch('/gw/a', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: new URLSearchParams({ a: '1' }),
    })
    expect(calls[1].payload.headers).toEqual({ 'content-type': 'text/plain' })
  })

  it('지원하지 않는 본문(Blob 등)은 TypeError, 요청하지 않는다', async () => {
    const { calls, fetch } = stubClient()
    await expect(fetch('/gw/a', { method: 'POST', body: new Blob(['x']) })).rejects.toThrow(
      TypeError,
    )
    expect(calls).toHaveLength(0)
  })
})

describe('createBridgeFetch — 응답 재구성', () => {
  it('상태·statusText·content-type·본문으로 Response를 만든다', async () => {
    const { fetch } = stubClient({ status: 201, statusText: 'Created' })
    const res = await fetch('/gw/a')
    expect(res.status).toBe(201)
    expect(res.statusText).toBe('Created')
    expect(res.ok).toBe(true)
    expect(res.headers.get('content-type')).toBe('application/json')
    await expect(res.json()).resolves.toEqual({ a: 1 })
  })

  it('bodyText가 문자열이 아니면 빈 본문', async () => {
    const { fetch } = stubClient({ bodyText: undefined as never })
    await expect((await fetch('/gw/a')).text()).resolves.toBe('')
  })

  it('4xx도 resolve(fetch 의미)', async () => {
    const { fetch } = stubClient({ status: 404, statusText: 'Not Found', bodyText: 'x' })
    const res = await fetch('/gw/a')
    expect(res.ok).toBe(false)
    await expect(res.text()).resolves.toBe('x')
  })

  it.each([[204], [205], [304]])('null-body 상태(%i)는 본문 없이 만든다', async (status) => {
    const { fetch } = stubClient({ status, bodyText: 'ignored' })
    const res = await fetch('/gw/a')
    expect(res.status).toBe(status)
    await expect(res.text()).resolves.toBe('')
  })

  it('HEAD는 본문 없이', async () => {
    const { fetch } = stubClient({ bodyText: 'ignored' })
    const res = await fetch('/gw/a', { method: 'head' })
    await expect(res.text()).resolves.toBe('')
  })

  it('content-type이 없으면 응답 헤더도 없다(문자열 본문 기본값만)', async () => {
    const { fetch } = stubClient({ headers: {} })
    const res = await fetch('/gw/a')
    expect(res.headers.get('content-type')).toBe('text/plain;charset=UTF-8')
  })

  it('Response로 만들 수 없는 상태(0)는 TypeError', async () => {
    const { fetch } = stubClient({ status: 0 })
    await expect(fetch('/gw/a')).rejects.toThrow('bridge fetch: invalid response')
  })
})

describe('createBridgeFetch — 오류·abort', () => {
  it('브리지 오류는 code가 붙은 TypeError', async () => {
    const err = Object.assign(new Error('x'), { code: 'FORBIDDEN_DESTINATION' })
    const { fetch } = stubClient(err)
    await expect(fetch('/x')).rejects.toMatchObject({
      name: 'TypeError',
      code: 'FORBIDDEN_DESTINATION',
      message: 'bridge fetch failed: FORBIDDEN_DESTINATION',
    })
  })

  it('code가 없는 오류는 NETWORK_ERROR', async () => {
    const { fetch } = stubClient(new Error('x'))
    await expect(fetch('/x')).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
  })

  it('이미 abort된 signal은 요청하지 않고 AbortError', async () => {
    const { calls, fetch } = stubClient()
    const ac = new AbortController()
    ac.abort()
    await expect(fetch('/gw/a', { signal: ac.signal })).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(calls).toHaveLength(0)
  })

  it('진행 중 abort되면 AbortError로 끊고 늦은 응답은 무시(HttpClient 타임아웃 경로)', async () => {
    let resolve!: (v: unknown) => void
    const client = { request: vi.fn(() => new Promise((r) => (resolve = r))) }
    const fetch = createBridgeFetch(client as never)
    const ac = new AbortController()
    const p = fetch('/gw/a', { signal: ac.signal })
    ac.abort()
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
    resolve({ status: 200, statusText: 'OK', headers: {}, bodyText: '' })
  })

  it('abort 후 늦은 실패도 무시', async () => {
    let reject!: (e: unknown) => void
    const client = { request: vi.fn(() => new Promise((_r, j) => (reject = j))) }
    const fetch = createBridgeFetch(client as never)
    const ac = new AbortController()
    const p = fetch('/gw/a', { signal: ac.signal })
    ac.abort(new Error('custom reason'))
    await expect(p).rejects.toThrow('custom reason')
    reject(new Error('late'))
  })

  it('abort reason이 없으면 DOMException AbortError', async () => {
    const { fetch } = stubClient()
    const signal = { aborted: true, reason: undefined } as unknown as AbortSignal
    await expect(fetch('/gw/a', { signal })).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('응답 후에는 abort 리스너를 뗀다', async () => {
    const { fetch } = stubClient()
    const ac = new AbortController()
    const remove = vi.spyOn(ac.signal, 'removeEventListener')
    await fetch('/gw/a', { signal: ac.signal })
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
  })
})
