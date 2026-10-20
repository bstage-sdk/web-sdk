import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FrameBridgeLike, PlatformBridge } from '@bstage-sdk/core'
import { createNavigationActions } from './navigationActions.js'

/**
 * useNavigation의 분기(격리 프레임 → 플랫폼 브리지 → 네이티브). 훅 자체는 테스트 범위 밖이라
 * 분기를 순수 함수로 빼 두고 여기서 고정한다. 브리지가 없을 때의 두 경로는 기존 동작과 같아야 한다.
 */

afterEach(() => vi.unstubAllGlobals())

function frameBridge(result: Promise<unknown> = Promise.resolve({})) {
  return {
    hostOrigin: 'https://h.example',
    getInit: () => undefined,
    request: vi.fn(() => result),
    on: vi.fn(() => () => {}),
    fetch: vi.fn(),
  } satisfies FrameBridgeLike
}

function platformBridge() {
  return { emit: vi.fn() } as unknown as PlatformBridge & { emit: ReturnType<typeof vi.fn> }
}

describe('격리 프레임', () => {
  it('navigate·back·openExternal을 브리지 요청으로 보낸다(쿼리 포함), 플랫폼 브리지보다 우선', () => {
    const fb = frameBridge()
    const pb = platformBridge()
    const nav = createNavigationActions(fb, pb)
    nav.navigate('/profile', { userId: '1 2' })
    nav.goBack()
    nav.openExternal('https://example.org')
    expect(fb.request.mock.calls).toEqual([
      ['navigate', { path: '/profile?userId=1+2' }],
      ['back', {}],
      ['openExternal', { url: 'https://example.org' }],
    ])
    expect(pb.emit).not.toHaveBeenCalled()
  })

  it('호스트 거절은 삼킨다(unhandled rejection 없음)', async () => {
    const rejected = Promise.reject(new Error('BAD_REQUEST'))
    const fb = frameBridge(rejected)
    expect(() => createNavigationActions(fb, null).navigate('//evil')).not.toThrow()
    await rejected.catch(() => {})
  })
})

describe('브리지 없음(기존 경로)', () => {
  it('플랫폼 브리지 emit', () => {
    const pb = platformBridge()
    const nav = createNavigationActions(undefined, pb)
    nav.navigate('/a', { b: 'c' })
    nav.goBack()
    nav.openExternal('https://x.example')
    expect(pb.emit.mock.calls).toEqual([
      ['navigate', { path: '/a', params: { b: 'c' } }],
      ['go-back', {}],
      ['open-external', { url: 'https://x.example' }],
    ])
  })

  it('네이티브 API', () => {
    const win = { location: { href: '' }, history: { back: vi.fn() }, open: vi.fn() }
    vi.stubGlobal('window', win)
    const nav = createNavigationActions(undefined, null)
    nav.navigate('/a', { b: 'c' })
    expect(win.location.href).toBe('/a?b=c')
    nav.navigate('/plain')
    expect(win.location.href).toBe('/plain')
    nav.goBack()
    expect(win.history.back).toHaveBeenCalled()
    nav.openExternal('https://x.example')
    expect(win.open).toHaveBeenCalledWith('https://x.example', '_blank')
  })
})
