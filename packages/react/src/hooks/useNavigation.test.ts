import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { PlatformBridge } from '@bstage-sdk/core'
import { BstageContext } from '../BstageContext.js'
import { useNavigation, type NavigationActions } from './useNavigation.js'

/**
 * 훅 단위 확인 — 분기 자체는 navigationActions.test.ts가 고정하고, 여기서는 훅이 실제로
 * `__bstage_bridge__`·BstageContext를 읽어 그 분기로 연결되는지만 본다(DOM 없이 SSR 렌더로 호출).
 */

afterEach(() => vi.unstubAllGlobals())

function capture(bridge?: PlatformBridge): NavigationActions {
  let actions: NavigationActions | undefined
  const Probe = () => {
    actions = useNavigation()
    return null
  }
  const tree = bridge
    ? createElement(BstageContext.Provider, { value: { bridge } }, createElement(Probe))
    : createElement(Probe)
  renderToStaticMarkup(tree)
  return actions!
}

function frameBridge() {
  const bridge = {
    hostOrigin: 'https://h.example',
    getInit: () => undefined,
    request: vi.fn(async () => ({})),
    on: vi.fn(() => () => {}),
    fetch: vi.fn(),
  }
  vi.stubGlobal('__bstage_bridge__', bridge)
  return bridge
}

describe('useNavigation', () => {
  it('격리 프레임이면 BstageContext가 있어도 브리지 요청', () => {
    const fb = frameBridge()
    const pb = { emit: vi.fn() } as unknown as PlatformBridge
    capture(pb).navigate('/a', { b: '1' })
    expect(fb.request).toHaveBeenCalledWith('navigate', { path: '/a?b=1' })
    expect((pb as unknown as { emit: ReturnType<typeof vi.fn> }).emit).not.toHaveBeenCalled()
  })

  it('브리지가 없으면 BstageContext의 PlatformBridge emit(기존 동작)', () => {
    const emit = vi.fn()
    capture({ emit } as unknown as PlatformBridge).goBack()
    expect(emit).toHaveBeenCalledWith('go-back', {})
  })

  it('둘 다 없으면 네이티브 API(기존 동작)', () => {
    const win = { location: { href: '' }, history: { back: vi.fn() }, open: vi.fn() }
    vi.stubGlobal('window', win)
    capture().openExternal('https://x.example')
    expect(win.open).toHaveBeenCalledWith('https://x.example', '_blank')
  })
})
