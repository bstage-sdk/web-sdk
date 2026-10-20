import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BATCH_MAX, Batch, FLUSH_WAIT } from './batch.js'
import type { Event } from './types.js'

/**
 * 전송은 fire-and-forget이라 응답으로 성공을 확인할 수 없다 — 언제 몇 건이 나가는지를
 * 여기서 못박는다.
 */
function event(name: string): Event {
  return { evtId: name, ts: 0, name, page: { url: '/', path: '/', viewId: 'v' } }
}

describe('Batch', () => {
  let shipped: Event[][]

  beforeEach(() => {
    vi.useFakeTimers()
    shipped = []
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const batch = (size?: number) => new Batch((evts) => shipped.push(evts), size)

  it('개수 임계에 닿으면 한 배치로 묶여 나간다', () => {
    const b = batch(3)

    b.add(event('a'))
    b.add(event('b'))
    expect(shipped).toEqual([])

    b.add(event('c'))

    expect(shipped).toHaveLength(1)
    expect(shipped[0].map((e) => e.name)).toEqual(['a', 'b', 'c'])
  })

  it('시간 임계가 지나면 나간다', () => {
    const b = batch()
    b.add(event('a'))

    vi.advanceTimersByTime(FLUSH_WAIT - 1)
    expect(shipped).toEqual([])

    vi.advanceTimersByTime(1)
    expect(shipped).toHaveLength(1)
  })

  it('개수 임계로 나간 뒤 남은 타이머가 빈 배치를 보내지 않는다', () => {
    const b = batch(2)
    b.add(event('a'))
    b.add(event('b'))

    vi.advanceTimersByTime(FLUSH_WAIT * 2)

    expect(shipped).toHaveLength(1)
  })

  it('버퍼가 비어 있으면 flush가 아무 것도 보내지 않는다', () => {
    batch().flush()

    expect(shipped).toEqual([])
  })

  it('flush 후 새 이벤트는 다음 배치로 간다', () => {
    const b = batch()
    b.add(event('a'))
    b.flush()
    b.add(event('b'))
    b.flush()

    expect(shipped.map((evts) => evts.map((e) => e.name))).toEqual([['a'], ['b']])
  })

  it('기본 개수 임계는 keepalive 제한을 감안한 값이다', () => {
    expect(BATCH_MAX).toBeLessThanOrEqual(20)
  })

  it('pending은 아직 나가지 않은 이벤트만 보여준다', () => {
    const b = batch()
    b.add(event('a'))

    expect(b.pending().map((e) => e.name)).toEqual(['a'])

    b.flush()

    expect(b.pending()).toEqual([])
  })
})
