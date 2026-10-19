import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Persist } from './persist.js'
import type { Held, HeldStore } from './queue.js'
import { MAX_HELD } from './queue.js'
import type { Event } from './types.js'

/**
 * 지키려는 것은 비동의 상태에서 저장소를 건드리지 않는 것과 성공한 것만 지우는 것이다 —
 * 앞은 개인정보 요건이고 뒤는 유실과 직결된다.
 */
function memory(): HeldStore & { rows: Map<string, Held>; writes: number; cleared: number } {
  const rows = new Map<string, Held>()
  const self = {
    rows,
    writes: 0,
    cleared: 0,
    async put(records: Held[]) {
      self.writes += 1
      for (const held of records) rows.set(held.evtId, held)
      return true
    },
    async all() {
      return [...rows.values()]
    },
    async remove(ids: string[]) {
      for (const id of ids) rows.delete(id)
    },
    async clear() {
      self.cleared += 1
      rows.clear()
    },
  }
  return self
}

function event(evtId: string): Event {
  return { evtId, ts: 0, name: 'click', page: { url: '/', path: '/', viewId: 'v' } }
}

/** 기록 시점 식별자 픽스처 */
const snap = { tabSId: 't1', consent: { analytics: true } }

describe('Persist', () => {
  let store: ReturnType<typeof memory>
  let at: number
  let persist: Persist

  beforeEach(() => {
    store = memory()
    at = 1_700_000_000_000
    persist = new Persist(
      () => at,
      async () => store,
      null,
    )
  })

  it('저장소를 열기 전에는 메모리에만 보관한다 — 비동의 상태의 동작이다', () => {
    persist.hold([event('a'), event('b')])

    expect(persist.durable).toBe(false)
    expect(persist.size()).toBe(2)
    expect(store.writes).toBe(0)
    expect(store.rows.size).toBe(0)
  })

  it('저장소가 열리면 이미 메모리에 있던 보관분도 영속화한다', async () => {
    persist.hold([event('a')])
    await persist.enable()

    expect(persist.durable).toBe(true)
    expect(store.rows.has('a')).toBe(true)
  })

  it('저장소를 열 수 없으면 메모리 보관으로 degrade하고 던지지 않는다', async () => {
    const blocked = new Persist(
      () => at,
      async () => null,
      null,
    )
    await blocked.enable()

    expect(() => blocked.hold([event('a')])).not.toThrow()
    expect(blocked.durable).toBe(false)
    expect(blocked.size()).toBe(1)
  })

  it('전송 성공분만 보관에서 지운다', async () => {
    await persist.enable()
    persist.hold([event('a'), event('b')])

    persist.settle(['a'])

    expect(persist.size()).toBe(1)
    expect(store.rows.has('a')).toBe(false)
    expect(store.rows.has('b')).toBe(true)
  })

  it('전송 실패는 retryCount를 올려 다시 보관한다', async () => {
    await persist.enable()
    persist.hold([event('a')])

    persist.fail(['a'])
    persist.fail(['a'])

    expect(store.rows.get('a')?.retryCount).toBe(2)
    expect(persist.size()).toBe(1)
  })

  it('철회 시 저장소를 비우고 영속 저장을 끈다', async () => {
    await persist.enable()
    persist.hold([event('a')])

    await persist.disable()

    expect(store.cleared).toBe(1)
    expect(store.rows.size).toBe(0)
    expect(persist.durable).toBe(false)
  })

  it('recover는 저장소 보관분을 메모리와 합쳐 돌려준다', async () => {
    store.rows.set('old', {
      evtId: 'old',
      event: event('old'),
      savedAt: at,
      retryCount: 1,
      snapshot: snap,
    })
    await persist.enable()
    persist.hold([event('new')], snap)

    const records = await persist.recover()

    expect(records.map((r) => r.evtId).sort()).toEqual(['new', 'old'])
    expect(records.find((r) => r.evtId === 'old')?.retryCount).toBe(1)
  })

  it('식별자 정보가 없는 옛 보관분은 폐기한다 — 오분류보다 유실이 안전하다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // snapshot 필드가 생기기 전에 저장된 레코드
    store.rows.set('legacy', {
      evtId: 'legacy',
      event: event('legacy'),
      savedAt: at,
      retryCount: 0,
    })
    await persist.enable()

    const records = await persist.recover()

    expect(records).toEqual([])
    expect(store.rows.has('legacy')).toBe(false)
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })

  it('hold는 기록 시점 식별자를 함께 보관한다 — 재전송 봉투의 근거다', async () => {
    await persist.enable()
    persist.hold([event('e1')], snap)

    expect(store.rows.get('e1')?.snapshot).toEqual(snap)
  })

  it('상한을 넘기면 버리고 폐기 건수를 콘솔에 남긴다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await persist.enable()
    for (let i = 0; i < MAX_HELD + 2; i++) {
      at += 1
      persist.hold([event(`e${i}`)])
    }

    const records = await persist.recover()

    expect(records).toHaveLength(MAX_HELD)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('E_HELD_OVERFLOW: discarded 2 '))
    warn.mockRestore()
  })
})

/**
 * Web Locks를 흉내 낸다. 수명 lock은 콜백이 끝나지 않으므로 `kill()`로만 풀린다 — 탭이
 * 죽으면 브라우저가 lock을 풀어 주는 동작이다.
 */
function locker() {
  const held = new Set<string>()
  const locks = {
    held,
    kill(owner: string) {
      held.delete(`bstage-analytics:owner:${owner}`)
    },
    async request(name: string, ...rest: unknown[]) {
      const cb = rest.pop() as (lock: { name: string } | null) => unknown
      const opts = (rest[0] ?? {}) as { ifAvailable?: boolean }
      if (held.has(name)) {
        if (opts.ifAvailable) return cb(null)
        return new Promise(() => {})
      }
      held.add(name)
      const result = await cb({ name })
      held.delete(name)
      return result
    },
  }
  return locks
}

type Locks = ConstructorParameters<typeof Persist>[2]

describe('Persist — 탭 간 소유권', () => {
  let store: ReturnType<typeof memory>
  let locks: ReturnType<typeof locker>
  const at = 1_700_000_000_000

  /** 같은 저장소를 공유하는 탭 하나 */
  function tab(): Persist {
    return new Persist(
      () => at,
      async () => store,
      locks as unknown as Locks,
    )
  }

  beforeEach(() => {
    store = memory()
    locks = locker()
  })

  it('살아 있는 다른 탭의 보관분은 가져가지 않는다', async () => {
    const a = tab()
    await a.enable()
    a.hold([event('a1')], snap)

    const b = tab()
    await b.enable()
    const records = await b.recover()

    expect(records.map((r) => r.evtId)).toEqual([])
    expect(store.rows.get('a1')?.owner).toBe(a.owner)
  })

  it('주인 탭이 죽으면 보관분을 가져가고 소유를 넘겨받는다', async () => {
    const a = tab()
    await a.enable()
    a.hold([event('a1')], snap)
    locks.kill(a.owner)

    const b = tab()
    await b.enable()
    const records = await b.recover()

    expect(records.map((r) => r.evtId)).toEqual(['a1'])
    expect(store.rows.get('a1')?.owner).toBe(b.owner)
  })

  it('죽은 탭의 보관분을 두 탭이 동시에 복구해도 한 탭만 가져간다', async () => {
    const a = tab()
    await a.enable()
    a.hold([event('a1')], snap)
    locks.kill(a.owner)

    const b = tab()
    const c = tab()
    await Promise.all([b.enable(), c.enable()])
    const [fromB, fromC] = await Promise.all([b.recover(), c.recover()])

    expect([...fromB, ...fromC].map((r) => r.evtId)).toEqual(['a1'])
  })

  it('먼저 넘겨받은 탭이 살아 있으면 나중 탭은 가져가지 않는다', async () => {
    const a = tab()
    await a.enable()
    a.hold([event('a1')], snap)
    locks.kill(a.owner)

    const b = tab()
    await b.enable()
    await b.recover()

    const c = tab()
    await c.enable()

    expect(await c.recover()).toEqual([])
  })

  it('넘겨받기 전에 읽은 목록으로 lock을 얻어도 다시 읽어 가져가지 않는다', async () => {
    const a = tab()
    await a.enable()
    a.hold([event('a1')], snap)
    locks.kill(a.owner)
    const before = [...store.rows.values()].map((held) => ({ ...held }))

    const b = tab()
    await b.enable()
    await b.recover()

    // c가 b의 넘겨받기 이전 시점에 목록을 읽었고, b가 lock을 푼 뒤에 lock을 얻는 경합이다
    const c = tab()
    await c.enable()
    const all = store.all.bind(store)
    let first = true
    store.all = async () => {
      if (!first) return all()
      first = false
      return before
    }

    expect(await c.recover()).toEqual([])
  })

  it('넘겨받은 소유를 저장하지 못하면 가져가지 않는다 — 다른 탭이 또 넘겨받아 중복된다', async () => {
    const a = tab()
    await a.enable()
    a.hold([event('a1')], snap)
    locks.kill(a.owner)

    const b = tab()
    await b.enable()
    store.put = async () => false

    expect(await b.recover()).toEqual([])
    expect(store.rows.get('a1')?.owner).toBe(a.owner)
  })

  it('소유자 기록이 없는 옛 보관분은 한 탭만 가져간다', async () => {
    store.rows.set('old', {
      evtId: 'old',
      event: event('old'),
      savedAt: at,
      retryCount: 0,
      snapshot: snap,
    })

    const b = tab()
    const c = tab()
    await Promise.all([b.enable(), c.enable()])
    const fromB = await b.recover()
    const fromC = await c.recover()

    expect([...fromB, ...fromC].map((r) => r.evtId)).toEqual(['old'])
  })

  it('Web Locks가 없으면 다른 탭 보관분도 가져간다 — 중복을 감수한 동작이다', async () => {
    const a = new Persist(
      () => at,
      async () => store,
      null,
    )
    await a.enable()
    a.hold([event('a1')], snap)

    const b = new Persist(
      () => at,
      async () => store,
      null,
    )
    await b.enable()

    expect((await b.recover()).map((r) => r.evtId)).toEqual(['a1'])
  })

  it('수명 lock을 쥔 뒤에야 저장소에 쓴다', async () => {
    const a = tab()
    const lockedAtPut: boolean[] = []
    const put = store.put.bind(store)
    store.put = async (records) => {
      lockedAtPut.push(locks.held.has(`bstage-analytics:owner:${a.owner}`))
      return put(records)
    }
    a.hold([event('a1')], snap)
    await a.enable()
    a.hold([event('a2')], snap)

    expect(lockedAtPut.length).toBeGreaterThan(0)
    expect(lockedAtPut.every(Boolean)).toBe(true)
  })

  /** 동의 철회는 개인정보 요건이다 — 철회 전에 읽은 보관분이 철회 뒤에 되살아나면 안 된다 */
  it('복구 중에 철회되면 이미 읽은 보관분을 다시 대기열에 넣지 않는다', async () => {
    const b = tab()
    await b.enable()
    b.hold([event('b1')], snap)

    const pending = b.recover()
    await b.disable()

    expect(await pending).toEqual([])
    expect(b.size()).toBe(0)
    expect(store.rows.size).toBe(0)
  })

  it('넘겨받는 중에 철회되면 지운 보관분을 저장소에 다시 쓰지 않는다', async () => {
    const a = tab()
    await a.enable()
    a.hold([event('a1')], snap)
    locks.kill(a.owner)

    const b = tab()
    await b.enable()
    // lock 안의 재조회가 철회 전에 읽고, 쓰기는 철회 뒤에 일어나는 경합이다
    const all = store.all.bind(store)
    let calls = 0
    let open = () => {}
    const gate = new Promise<void>((resolve) => (open = resolve))
    store.all = async () => {
      calls += 1
      const rows = await all()
      if (calls === 2) await gate
      return rows
    }

    const pending = b.recover()
    while (calls < 2) await Promise.resolve()
    await b.disable()
    open()

    expect(await pending).toEqual([])
    expect(b.size()).toBe(0)
    expect(store.rows.size).toBe(0)
  })

  it('철회 후 다시 동의해도 멈추지 않는다 — 수명 lock은 한 번만 잡는다', async () => {
    const a = tab()
    await a.enable()
    await a.disable()
    await a.enable()

    expect(a.durable).toBe(true)
  })
})
