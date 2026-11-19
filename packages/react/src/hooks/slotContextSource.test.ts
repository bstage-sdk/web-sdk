import { describe, expect, it, vi } from 'vitest'
import type { FrameBridgeLike } from '@bstage-sdk/core'
import { readFrameSlotContext, subscribeFrameSlotContext } from './slotContextSource.js'

/**
 * 격리 프레임 슬롯 context — 첫 값은 init.slot에, 이후 값은 `slot.context` 이벤트(`{ id, context }`)로 온다.
 * 위젯에는 두 경로 모두 context 객체만 넘겨야 한다(inline 이벤트 payload와 같은 모양).
 */

function bridgeWith(init: unknown) {
  const handlers = new Map<string, (payload: unknown) => void>()
  const off = vi.fn()
  const bridge = {
    hostOrigin: 'https://h.example',
    getInit: () => init,
    request: vi.fn(),
    on: vi.fn((type: string, fn: (payload: unknown) => void) => {
      handlers.set(type, fn)
      return off
    }),
    fetch: vi.fn(),
  } as unknown as FrameBridgeLike
  return { bridge, handlers, off }
}

const POLL = { poll: { id: 'p1', title: '투표', pollTicket: { id: 't1', name: '투표권' } } }

describe('readFrameSlotContext', () => {
  it('init.slot의 context만 돌려준다(봉투 아님)', () => {
    const { bridge } = bridgeWith({
      slot: { id: 'user.ranking-detail.tabs:before', context: POLL },
    })
    expect(readFrameSlotContext(bridge)).toEqual(POLL)
  })

  it('init이 없거나 slot·context가 객체가 아니면 undefined', () => {
    expect(readFrameSlotContext(bridgeWith(undefined).bridge)).toBeUndefined()
    expect(readFrameSlotContext(bridgeWith({}).bridge)).toBeUndefined()
    expect(readFrameSlotContext(bridgeWith({ slot: { id: 'a' } }).bridge)).toBeUndefined()
    expect(
      readFrameSlotContext(bridgeWith({ slot: { id: 'a', context: 'x' } }).bridge),
    ).toBeUndefined()
    expect(
      readFrameSlotContext(bridgeWith({ slot: { id: 'a', context: null } }).bridge),
    ).toBeUndefined()
  })
})

describe('subscribeFrameSlotContext', () => {
  it('slot.context 이벤트에서 context만 꺼내 넘긴다', () => {
    const { bridge, handlers } = bridgeWith({})
    const fn = vi.fn()
    subscribeFrameSlotContext(bridge, fn)
    expect(bridge.on).toHaveBeenCalledWith('slot.context', expect.any(Function))
    handlers.get('slot.context')!({ id: 'a', context: POLL })
    expect(fn).toHaveBeenCalledWith(POLL)
  })

  it('모양이 틀린 payload는 무시한다', () => {
    const { bridge, handlers } = bridgeWith({})
    const fn = vi.fn()
    subscribeFrameSlotContext(bridge, fn)
    const handler = handlers.get('slot.context')!
    handler(null)
    handler({ id: 'a' })
    handler({ id: 'a', context: 'x' })
    handler(POLL)
    expect(fn).not.toHaveBeenCalled()
  })

  it('해제 함수를 그대로 돌려준다', () => {
    const { bridge, off } = bridgeWith({})
    subscribeFrameSlotContext(bridge, vi.fn())()
    expect(off).toHaveBeenCalled()
  })
})
