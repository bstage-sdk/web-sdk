import { beforeEach, describe, expect, it } from 'vitest'
import { BID_NAME, IDLE_MAX, Identity, SID_NAME } from './identity.js'
import type { Store } from './store.js'

/**
 * 비동의 상태에서 저장소를 건드리지 않는 것이 요건이라, 발급 여부만이 아니라 쓰기가
 * 일어났는지를 본다. 쿠키 대신 메모리 구현을 넣어 쓰기를 센다.
 */
function memory(): Store & { writes: string[]; removes: string[]; data: Map<string, string> } {
  const data = new Map<string, string>()
  const writes: string[] = []
  const removes: string[] = []
  return {
    data,
    writes,
    removes,
    get: (name) => data.get(name) ?? null,
    set: (name, value) => {
      writes.push(name)
      data.set(name, value)
    },
    remove: (name) => {
      removes.push(name)
      data.delete(name)
    },
  }
}

describe('Identity', () => {
  let store: ReturnType<typeof memory>
  let at: number
  const clock = () => at

  beforeEach(() => {
    store = memory()
    at = 1_700_000_000_000
  })

  it('기본값은 비동의이고 tabSId만 채운다', () => {
    const snap = new Identity(store, clock).touch()

    expect(snap.consent).toEqual({ analytics: false })
    expect(snap.tabSId).toMatch(/^[0-9a-f-]{36}$/)
    expect(snap.bId).toBeUndefined()
    expect(snap.sId).toBeUndefined()
    expect(snap.user).toBeUndefined()
  })

  it('비동의 상태에서는 저장소 쓰기가 한 번도 일어나지 않는다', () => {
    const identity = new Identity(store, clock)

    identity.identify('u123')
    identity.touch()
    identity.touch()

    expect(store.writes).toEqual([])
  })

  it('tabSId는 동의 여부와 무관하게 같은 인스턴스에서 유지된다', () => {
    const identity = new Identity(store, clock)
    const before = identity.touch().tabSId

    identity.setConsent(true)

    expect(identity.touch().tabSId).toBe(before)
  })

  it('동의 시점부터 bId·sId를 발급하고 bId는 재호출에도 유지된다', () => {
    const identity = new Identity(store, clock)
    identity.setConsent(true)

    const first = identity.touch()
    at += 1000
    const second = identity.touch()

    expect(first.bId).toMatch(/^[0-9a-f-]{36}$/)
    expect(second.bId).toBe(first.bId)
    expect(second.sId).toBe(first.sId)
    expect(store.data.get(BID_NAME)).toBe(first.bId)
  })

  it('무활동 30분을 넘기면 sId가 갱신되고 bId는 유지된다', () => {
    const identity = new Identity(store, clock)
    identity.setConsent(true)
    const first = identity.touch()

    at += IDLE_MAX + 1
    const next = identity.touch()

    expect(next.sId).not.toBe(first.sId)
    expect(next.bId).toBe(first.bId)
    expect(next.startedAt).toBe(at)
  })

  it('30분 이내 활동은 같은 sId를 유지하고 시작 시각도 바뀌지 않는다', () => {
    const identity = new Identity(store, clock)
    identity.setConsent(true)
    const first = identity.touch()

    at += IDLE_MAX
    const next = identity.touch()

    expect(next.sId).toBe(first.sId)
    expect(next.startedAt).toBe(first.startedAt)
  })

  it('identify는 동의 상태에서만 user를 싣는다', () => {
    const identity = new Identity(store, clock)
    identity.identify('u123', { plan: 'pro' })

    expect(identity.touch().user).toBeUndefined()

    identity.setConsent(true)

    expect(identity.touch().user).toEqual({ id: 'u123', props: { plan: 'pro' } })
  })

  it('동의를 철회하면 우리가 만든 쿠키만 지우고 식별자를 뗀다', () => {
    const identity = new Identity(store, clock)
    identity.setConsent(true)
    identity.touch()

    identity.setConsent(false)
    const snap = identity.touch()

    expect(store.removes).toEqual([BID_NAME, SID_NAME])
    expect(snap.bId).toBeUndefined()
    expect(snap.sId).toBeUndefined()
    expect(snap.consent).toEqual({ analytics: false })
  })

  it('깨진 세션 레코드는 새 세션으로 대체한다', () => {
    store.data.set(SID_NAME, 'garbage')
    const identity = new Identity(store, clock)
    identity.setConsent(true)

    const snap = identity.touch()

    expect(snap.sId).toMatch(/^[0-9a-f-]{36}$/)
    expect(snap.startedAt).toBe(at)
  })
})

describe('동의 철회 — 보안 리뷰 대응', () => {
  it('새 로드에서 setConsent(false)가 이전 방문의 쿠키를 지운다', () => {
    // 값 비교로 조기 반환하면 이전 방문이 남긴 쿠키가 그대로 남아 다음 동의에서
    // 옛 식별자가 재채택된다
    const store = memory()
    store.set(BID_NAME, 'old-bid', 1)
    store.set(SID_NAME, 'old-sid|1|1', 1)
    const identity = new Identity(store, () => 1000)

    identity.setConsent(false)

    expect(store.get(BID_NAME)).toBeNull()
    expect(store.get(SID_NAME)).toBeNull()
  })

  it('철회는 주입된 user도 버린다 — 다음 동의 때 재부착되지 않아야 한다', () => {
    const identity = new Identity(memory(), () => 1000)
    identity.setConsent(true)
    identity.identify('u1', { email: 'a@b.c' })

    identity.setConsent(false)
    identity.setConsent(true)

    expect(identity.touch().user).toBeUndefined()
  })

  it('비-boolean은 동의로 열리지 않는다(fail-closed)', () => {
    const identity = new Identity(memory(), () => 1000)

    identity.setConsent('true' as unknown as boolean)

    expect(identity.consent.analytics).toBe(false)
  })

  it('peek는 상태를 바꾸지 않는다 — ids()가 세션 만료 기준을 밀지 않아야 한다', () => {
    const store = memory()
    const identity = new Identity(store, () => 1000)
    identity.setConsent(true)
    identity.touch()
    const before = store.get(SID_NAME)

    identity.peek()

    expect(store.get(SID_NAME)).toBe(before)
  })
})
