import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEnvelope, type BridgeEnvelope } from '../protocol/envelope.js'
import { flush, HOST_ORIGIN, SESSION } from '../testing.js'
import { INIT, okResponse, request, setup } from './hostTestKit.js'
import { __resetBridgeStorage__ } from './storage.js'

/**
 * createBridgeHost — 목적지 갈래별 fetch 연결. 같은 origin /gw는 `fetchImpl`(인증), 파트너는
 * `partnerFetchImpl`, 그 밖의 https는 `externalFetchImpl`. 인증 fetch가 잘못된 갈래에 쓰이면 토큰이
 * 외부로 나가므로 갈래마다 "다른 fetch는 부르지 않는다"까지 고정한다.
 */

afterEach(() => {
  __resetBridgeStorage__()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const EXTERNAL = 'https://api.example.org/v1/items'
const PARTNER = 'https://partner.example.net/v1'
const PINNED = { 'x-bstage-tenant-id': 'space-1', 'x-bstage-app-id': 'pinned-app' }

function three(overrides: Parameters<typeof setup>[0] = {}) {
  const partnerFetchImpl = vi.fn(async () => okResponse('{"p":1}'))
  const externalFetchImpl = vi.fn(async () => okResponse('{"e":1}'))
  const s = setup({
    partnerFetchImpl,
    externalFetchImpl,
    pinnedHeaders: PINNED,
    ...overrides,
    policy: { allowExternal: true, ...overrides.policy },
  })
  return { ...s, partnerFetchImpl, externalFetchImpl }
}

describe('목적지 갈래별 fetch', () => {
  it('external은 externalFetchImpl로만 — fetchImpl·partnerFetchImpl은 부르지 않는다', async () => {
    const { link, fetchImpl, partnerFetchImpl, externalFetchImpl } = three()
    const res = await request(link, 'fetch', {
      url: EXTERNAL,
      headers: {
        authorization: 'Bearer leaked',
        'x-bstage-tenant-id': 'victim',
        'x-bmf-sdk-version': '0.48.0',
      },
    })
    expect(res).toMatchObject({ ok: true, data: { status: 200, bodyText: '{"e":1}' } })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(partnerFetchImpl).not.toHaveBeenCalled()
    expect(externalFetchImpl).toHaveBeenCalledWith(EXTERNAL, {
      method: 'GET',
      headers: { 'x-bmf-sdk-version': '0.48.0' },
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    })
  })

  it('partner는 partnerFetchImpl로만 — 호스트 고정 헤더(테넌시·앱)를 싣지 않는다', async () => {
    const { link, fetchImpl, partnerFetchImpl, externalFetchImpl } = three()
    await request(link, 'fetch', { url: PARTNER, headers: { 'x-bstage-tenant-id': 'victim' } })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(externalFetchImpl).not.toHaveBeenCalled()
    expect(partnerFetchImpl).toHaveBeenCalledWith(PARTNER, {
      method: 'GET',
      headers: {},
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    })
  })

  it('gateway는 fetchImpl로만 — 고정 헤더가 실린다', async () => {
    const { link, fetchImpl, partnerFetchImpl, externalFetchImpl } = three()
    await request(link, 'fetch', { url: '/gw/a' })
    expect(partnerFetchImpl).not.toHaveBeenCalled()
    expect(externalFetchImpl).not.toHaveBeenCalled()
    expect(fetchImpl).toHaveBeenCalledWith(
      `${HOST_ORIGIN}/gw/a`,
      expect.objectContaining({ headers: PINNED, credentials: 'same-origin' }),
    )
  })

  it('externalFetchImpl 기본값은 globalThis.fetch를 credentials omit·redirect error·no-referrer로', async () => {
    const native = vi.fn(async () => okResponse())
    vi.stubGlobal('fetch', native)
    const { link, fetchImpl } = setup({ policy: { allowExternal: true } })
    expect(
      await request(link, 'fetch', {
        url: EXTERNAL,
        method: 'POST',
        body: '{}',
        headers: { 'content-type': 'application/json', cookie: 'a=b' },
      }),
    ).toMatchObject({ ok: true })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(native).toHaveBeenCalledWith(EXTERNAL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    })
  })

  it('기본 정책(allowExternal 생략)이면 external은 FORBIDDEN_DESTINATION — 옵트인', async () => {
    const externalFetchImpl = vi.fn(async () => okResponse())
    const { link, fetchImpl } = setup({ externalFetchImpl })
    expect(await request(link, 'fetch', { url: EXTERNAL })).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN_DESTINATION' },
    })
    expect(externalFetchImpl).not.toHaveBeenCalled()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('allowExternal=false면 FORBIDDEN_DESTINATION, 어느 fetch도 부르지 않는다', async () => {
    const { link, fetchImpl, partnerFetchImpl, externalFetchImpl } = three({
      policy: { allowExternal: false },
    })
    expect(await request(link, 'fetch', { url: EXTERNAL })).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN_DESTINATION' },
    })
    expect(await request(link, 'fetch', { url: PARTNER })).toMatchObject({ ok: true })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(externalFetchImpl).not.toHaveBeenCalled()
    expect(partnerFetchImpl).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['http://api.example.org/v1'],
    [`${HOST_ORIGIN}/account/v1/me`],
    ['https://user:pw@api.example.org/'],
  ])('%s 는 FORBIDDEN_DESTINATION', async (url) => {
    const { link, fetchImpl, partnerFetchImpl, externalFetchImpl } = three()
    expect(await request(link, 'fetch', { url })).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN_DESTINATION' },
    })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(partnerFetchImpl).not.toHaveBeenCalled()
    expect(externalFetchImpl).not.toHaveBeenCalled()
  })

  it('external 응답에도 본문 상한이 적용된다', async () => {
    const { link } = three({
      policy: { maxResponseBytes: 4 },
      externalFetchImpl: vi.fn(async () =>
        okResponse('x', { headers: { 'content-length': '99' } }),
      ),
    })
    expect(await request(link, 'fetch', { url: EXTERNAL })).toMatchObject({
      ok: false,
      error: { code: 'BODY_TOO_LARGE' },
    })
  })

  it('external 응답 헤더는 content-type만 돌려준다', async () => {
    const { link } = three()
    const res = await request(link, 'fetch', { url: EXTERNAL })
    expect(res).toMatchObject({
      ok: true,
      data: { headers: { 'content-type': 'application/json' } },
    })
    expect(Object.keys((res as { data: { headers: object } }).data.headers)).toEqual([
      'content-type',
    ])
  })

  it('external도 분당 상한을 gateway·partner와 함께 센다', async () => {
    const { link, externalFetchImpl } = three({ policy: { maxRequestsPerMinute: 2 } })
    expect(await request(link, 'fetch', { url: '/gw/a' })).toMatchObject({ ok: true })
    expect(await request(link, 'fetch', { url: EXTERNAL })).toMatchObject({ ok: true })
    expect(await request(link, 'fetch', { url: EXTERNAL })).toMatchObject({
      ok: false,
      error: { code: 'RATE_LIMITED' },
    })
    expect(externalFetchImpl).toHaveBeenCalledTimes(1)
  })

  it('externalFetchImpl 예외는 NETWORK_ERROR — 메시지를 싣지 않는다', async () => {
    const { link } = three({
      externalFetchImpl: vi.fn(async () => {
        throw new Error('internal detail https://secret.internal')
      }),
    })
    expect(await request(link, 'fetch', { url: EXTERNAL })).toEqual({
      ok: false,
      error: { code: 'NETWORK_ERROR', message: 'network error' },
    })
  })

  it('externalFetchImpl에 인증 fetchImpl을 그대로 넘기면 생성 시 TypeError', () => {
    const fetchImpl = vi.fn(async () => okResponse())
    expect(() => setup({ fetchImpl, externalFetchImpl: fetchImpl })).toThrow(TypeError)
  })

  it('externalFetchImpl에 partnerFetchImpl(팬 토큰 fetch)을 그대로 넘기면 생성 시 TypeError', () => {
    const partnerFetchImpl = vi.fn(async () => okResponse())
    expect(() => setup({ partnerFetchImpl, externalFetchImpl: partnerFetchImpl })).toThrow(
      TypeError,
    )
  })

  it('partnerFetchImpl에 인증 fetchImpl을 그대로 넘기면 생성 시 TypeError', () => {
    const fetchImpl = vi.fn(async () => okResponse())
    expect(() => setup({ fetchImpl, partnerFetchImpl: fetchImpl })).toThrow(TypeError)
  })

  it('externalFetchImpl이 함수가 아니면 생성 시 TypeError', () => {
    expect(() => setup({ externalFetchImpl: 'x' as never })).toThrow(TypeError)
  })
})

describe('init.surface', () => {
  it.each([['page'], ['slot']])('%s 는 그대로 init에 실린다', async (surface) => {
    const { link } = setup({ init: { ...INIT, surface: surface as 'page' | 'slot' } })
    link.parent.postMessage(createEnvelope('evt', 'ready', 'r', { session: SESSION }), HOST_ORIGIN)
    await flush()
    const init = (link.toFrame[link.toFrame.length - 1].message as BridgeEnvelope<{ data: any }>)
      .payload.data
    expect(init.surface).toBe(surface)
  })

  it.each([['widget'], [''], [undefined]])(
    'page·slot이 아니면(%j) 생성 시 TypeError',
    (surface) => {
      expect(() => setup({ init: { ...INIT, surface: surface as never } })).toThrow(TypeError)
    },
  )
})
