import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEnvelope, type BridgeEnvelope } from '../protocol/envelope.js'
import { flush, HOST_ORIGIN, SESSION, type FakeLink } from '../testing.js'
import { INIT, request, setup } from './hostTestKit.js'
import { __resetBridgeStorage__, type StorageBackend } from './storage.js'

/**
 * page 위치(init·이벤트)·같은 탭 외부 이동(navigateExternal)·주입 storage 저장소. 손 검증은 정상 호스트의
 * 해피패스만 태우므로 형식 위반 버림·처리기 부재·저장소 예외 분기를 여기서 고정한다.
 */

afterEach(() => {
  __resetBridgeStorage__()
  vi.restoreAllMocks()
})

async function handshakeInit(link: FakeLink): Promise<Record<string, unknown>> {
  link.parent.postMessage(
    createEnvelope('evt', 'ready', `r-${Math.random()}`, { session: SESSION }),
    HOST_ORIGIN,
  )
  await flush()
  const inits = link.toFrame
    .map((m) => m.message as BridgeEnvelope<{ data: Record<string, unknown> }>)
    .filter((m) => m.type === 'init')
  return inits[inits.length - 1].payload.data
}

describe('init.page', () => {
  it('path·search만 복사해 싣는다', async () => {
    const page = { path: '/shop', search: '?id=1', hash: '#x', token: 't' }
    const { link } = setup({ init: { ...INIT, page } as typeof INIT })
    expect((await handshakeInit(link)).page).toEqual({ path: '/shop', search: '?id=1' })
  })

  it('없으면 필드도 없다', async () => {
    const { link } = setup()
    expect(await handshakeInit(link)).not.toHaveProperty('page')
  })

  it.each([
    ['path가 /로 시작하지 않음', { path: 'shop', search: '' }],
    ['search가 ?로 시작하지 않음', { path: '/shop', search: 'id=1' }],
    ['path 2048자 초과', { path: '/' + 'a'.repeat(2048), search: '' }],
    ['search 2048자 초과', { path: '/', search: '?' + 'a'.repeat(2048) }],
    ['문자열 아님', { path: '/', search: 1 }],
    ['객체 아님', '/shop'],
  ])('형식이 틀리면(%s) 필드를 뺀다', async (_label, page) => {
    const { link } = setup({ init: { ...INIT, page } as unknown as typeof INIT })
    expect(await handshakeInit(link)).not.toHaveProperty('page')
  })

  it('경계값(각 2048자, 빈 search)은 싣는다', async () => {
    const page = { path: '/' + 'a'.repeat(2047), search: '' }
    const { link } = setup({ init: { ...INIT, page } })
    expect((await handshakeInit(link)).page).toEqual(page)
  })
})

describe('page 이벤트', () => {
  it('보내고 init 스냅샷에도 반영한다(허용 필드만)', async () => {
    const { link, host } = setup()
    await handshakeInit(link)
    host.send('page', { path: '/a', search: '?q=1', extra: 'x' } as never)
    const sent = link.toFrame.map((m) => m.message as BridgeEnvelope)
    expect(sent[sent.length - 1]).toMatchObject({ kind: 'evt', type: 'page' })
    expect(sent[sent.length - 1].payload).toEqual({ path: '/a', search: '?q=1' })
    expect((await handshakeInit(link)).page).toEqual({ path: '/a', search: '?q=1' })
  })

  it('핸드셰이크 전 page는 init에만 반영한다', async () => {
    const { link, host } = setup({ init: { ...INIT, page: { path: '/a', search: '' } } })
    host.send('page', { path: '/b', search: '?x=1' })
    expect(link.toFrame).toHaveLength(0)
    expect((await handshakeInit(link)).page).toEqual({ path: '/b', search: '?x=1' })
  })

  it('형식이 틀린 page 이벤트는 던지지 않고 버린다(스냅샷도 그대로)', async () => {
    const { link, host } = setup({ init: { ...INIT, page: { path: '/a', search: '' } } })
    await handshakeInit(link)
    const before = link.toFrame.length
    expect(() => host.send('page', { path: 'x', search: '' })).not.toThrow()
    expect(() => host.send('page', { path: '/x', search: 'nope' })).not.toThrow()
    expect(link.toFrame).toHaveLength(before)
    expect((await handshakeInit(link)).page).toEqual({ path: '/a', search: '' })
  })
})

describe('navigateExternal', () => {
  it('검증한 href를 처리기로 넘긴다 — window.open은 쓰지 않는다', async () => {
    const navigateExternal = vi.fn()
    const { link } = setup({}, { navigateExternal })
    expect(
      await request(link, 'navigateExternal', { url: 'https://shop.example.com/p?id=1' }),
    ).toEqual({ ok: true, data: {} })
    expect(navigateExternal).toHaveBeenCalledWith('https://shop.example.com/p?id=1')
    expect(link.hostWin.open).not.toHaveBeenCalled()
  })

  it('처리기가 없으면 UNSUPPORTED — window.open으로 대신하지 않는다', async () => {
    const { link } = setup({}, { openExternal: vi.fn() })
    expect(await request(link, 'navigateExternal', { url: 'https://a.example' })).toMatchObject({
      ok: false,
      error: { code: 'UNSUPPORTED' },
    })
    expect(link.hostWin.open).not.toHaveBeenCalled()
  })

  it.each([
    ['http', 'http://a.example', 'FORBIDDEN_DESTINATION'],
    ['userinfo', 'https://u:p@a.example', 'FORBIDDEN_DESTINATION'],
    ['javascript', 'javascript:alert(1)', 'FORBIDDEN_DESTINATION'],
    ['URL 아님', 'not a url', 'BAD_REQUEST'],
    ['문자열 아님', 1, 'BAD_REQUEST'],
  ])('%s는 거절하고 처리기를 부르지 않는다', async (_label, url, code) => {
    const navigateExternal = vi.fn()
    const { link } = setup({}, { navigateExternal })
    expect(await request(link, 'navigateExternal', { url })).toMatchObject({
      ok: false,
      error: { code },
    })
    expect(navigateExternal).not.toHaveBeenCalled()
  })
})

/** Map 기반 가짜 저장소 — keys는 접두사로 시작하는 전체 키를 돌려준다. */
function fakeBackend(seed: ReadonlyArray<readonly [string, string]> = []) {
  const data = new Map<string, string>(seed)
  const backend: StorageBackend = {
    get: vi.fn((k: string) => data.get(k) ?? null),
    set: vi.fn((k: string, v: string) => void data.set(k, v)),
    remove: vi.fn((k: string) => void data.delete(k)),
    keys: vi.fn((prefix: string) => [...data.keys()].filter((k) => k.startsWith(prefix))),
  }
  return { backend, data }
}

describe('storageBackend 주입', () => {
  it('주입 저장소에 spaceId·placementId 스코프 키로 쓰고 새 호스트(리로드)에서도 읽는다', async () => {
    const { backend, data } = fakeBackend()
    const first = setup({ storageBackend: backend })
    await request(first.link, 'storage', { op: 'set', key: 'cart', value: '[1]' })
    expect([...data.keys()]).toEqual(['space-1\u0000pl-1\u0000cart'])
    first.host.dispose()
    __resetBridgeStorage__()
    const second = setup({ storageBackend: backend })
    expect(await request(second.link, 'storage', { op: 'get', key: 'cart' })).toEqual({
      ok: true,
      data: { value: '[1]' },
    })
  })

  it('생략하면 메모리 저장소 — 주입 저장소와 섞이지 않는다', async () => {
    const { backend, data } = fakeBackend()
    const mem = setup()
    await request(mem.link, 'storage', { op: 'set', key: 'k', value: 'v' })
    expect(data.size).toBe(0)
    const injected = setup({ storageBackend: backend })
    expect(await request(injected.link, 'storage', { op: 'get', key: 'k' })).toEqual({
      ok: true,
      data: { value: null },
    })
  })

  it('get·set 실패 코드가 프레임에 STORAGE_UNAVAILABLE로 간다', async () => {
    const { backend } = fakeBackend()
    const broken: StorageBackend = {
      ...backend,
      set: () => {
        throw new Error('QuotaExceededError: internal detail')
      },
    }
    const { link } = setup({ storageBackend: broken })
    expect(await request(link, 'storage', { op: 'set', key: 'k', value: 'v' })).toEqual({
      ok: false,
      error: { code: 'STORAGE_UNAVAILABLE', message: 'storage unavailable' },
    })
  })

  it.each([null, {}, { get() {}, set() {}, remove() {} }, 'x'])(
    '모양이 틀리면(%j) 생성 시 TypeError',
    (storageBackend) => {
      expect(() => setup({ storageBackend: storageBackend as never })).toThrow(TypeError)
    },
  )
})

describe('보안 회귀', () => {
  it('toPageLocation은 프로토콜 상대 경로(//host, /\\host)를 버린다', async () => {
    const { toPageLocation } = await import('../protocol/messages.js')
    expect(toPageLocation({ path: '//evil.com', search: '' })).toBeUndefined()
    expect(toPageLocation({ path: '/\\evil.com', search: '' })).toBeUndefined()
    expect(toPageLocation({ path: '/shop', search: '?id=1' })).toEqual({
      path: '/shop',
      search: '?id=1',
    })
  })

  it('storageScopeOf는 NUL이 든 성분으로 다른 배치의 스코프를 만들 수 없다', async () => {
    const { storageScopeOf } = await import('./createBridgeHost.js')
    const victim = storageScopeOf('space', 'page:/a')
    const forged = storageScopeOf('space\u0000page:/a', '')
    expect(forged).not.toBe(victim)
    expect(forged.startsWith(`${victim}\u0000`)).toBe(false)
    expect(storageScopeOf('a', 'b\u0000c')).not.toContain('b\u0000c')
  })
})

describe('계정 세션 배치에는 page를 싣지 않는다', () => {
  const ACCOUNT_INIT = {
    ...INIT,
    capabilities: ['account-session'],
    page: { path: '/signup/v2', search: '?code=c&state=s' },
  }

  it('init에서 page를 뺀다', async () => {
    const { link } = setup({ init: ACCOUNT_INIT })
    expect(await handshakeInit(link)).not.toHaveProperty('page')
  })

  it('page 이벤트를 보내지도 스냅샷에 반영하지도 않는다', async () => {
    const { link, host } = setup({ init: ACCOUNT_INIT })
    await handshakeInit(link)
    const before = link.toFrame.length
    host.send('page', { path: '/signup/v2', search: '?code=c2' })
    expect(link.toFrame).toHaveLength(before)
    expect(await handshakeInit(link)).not.toHaveProperty('page')
  })
})
