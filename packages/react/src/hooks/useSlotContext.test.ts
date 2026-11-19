import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { useSlotContext } from './useSlotContext.js'

/**
 * 훅 연결 확인 — 격리 프레임이면 첫 렌더에서 바로 init.slot.context를 돌려준다(DOM 없이 SSR 렌더로 호출).
 * 이벤트 구독 분기는 slotContextSource.test.ts가 고정한다.
 */

afterEach(() => vi.unstubAllGlobals())

function capture(): unknown {
  let value: unknown = 'unset'
  const Probe = () => {
    value = useSlotContext<'user.ranking-detail.tabs:before'>()
    return null
  }
  renderToStaticMarkup(createElement(Probe))
  return value
}

describe('useSlotContext', () => {
  it('격리 프레임이면 첫 렌더부터 init.slot의 context', () => {
    const context = {
      poll: {
        id: 'p1',
        title: '투표',
        progressStatus: 'IN_PROGRESS',
        pollTicket: { id: 't', name: 'n' },
      },
    }
    vi.stubGlobal('__bstage_bridge__', {
      hostOrigin: 'https://h.example',
      getInit: () => ({ slot: { id: 'user.ranking-detail.tabs:before', context } }),
      request: vi.fn(),
      on: vi.fn(() => () => {}),
      fetch: vi.fn(),
    })
    expect(capture()).toEqual(context)
  })

  it('격리 프레임이 아니면 처음엔 undefined(inline 이벤트를 기다림 — 기존 동작)', () => {
    expect(capture()).toBeUndefined()
  })
})
