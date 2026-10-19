import { afterEach, describe, expect, it, vi } from 'vitest'
import { type Held, MAX_AGE, MAX_HELD, RETRY_MAX, backoff, openStore, trim } from './queue.js'

/**
 * 보관 정책의 계약은 버릴 때 몇 건 버렸는지 알리는 것이다 — 조용히 유실되면 도달률을
 * 신뢰할 수 없다.
 */
function held(over: Partial<Held> = {}): Held {
  return { evtId: 'e', event: {} as Held['event'], savedAt: 0, retryCount: 0, ...over }
}

const NOW = 1_700_000_000_000

describe('trim', () => {
  it('상한 안이면 아무 것도 버리지 않는다', () => {
    const records = [held({ evtId: 'a', savedAt: NOW }), held({ evtId: 'b', savedAt: NOW })]

    expect(trim(records, NOW)).toEqual({ keep: records, dropped: 0 })
  })

  it('보관 기간을 넘긴 것을 버린다', () => {
    const records = [
      held({ evtId: 'old', savedAt: NOW - MAX_AGE - 1 }),
      held({ evtId: 'new', savedAt: NOW }),
    ]

    const { keep, dropped } = trim(records, NOW)

    expect(keep.map((r) => r.evtId)).toEqual(['new'])
    expect(dropped).toBe(1)
  })

  it('재전송 포기 횟수에 닿은 것을 버린다', () => {
    const records = [
      held({ evtId: 'dead', savedAt: NOW, retryCount: RETRY_MAX }),
      held({ evtId: 'alive', savedAt: NOW, retryCount: RETRY_MAX - 1 }),
    ]

    const { keep, dropped } = trim(records, NOW)

    expect(keep.map((r) => r.evtId)).toEqual(['alive'])
    expect(dropped).toBe(1)
  })

  it('건수 상한을 넘으면 오래된 것부터 버린다', () => {
    const records = Array.from({ length: MAX_HELD + 3 }, (_, i) =>
      held({ evtId: `e${i}`, savedAt: NOW - (MAX_HELD + 3 - i) }),
    )

    const { keep, dropped } = trim(records, NOW)

    expect(keep).toHaveLength(MAX_HELD)
    expect(dropped).toBe(3)
    expect(keep[0].evtId).toBe('e3')
  })

  it('전부 버려도 건수를 정확히 센다', () => {
    const records = [held({ savedAt: NOW - MAX_AGE - 1 }), held({ evtId: 'x', savedAt: 0 })]

    expect(trim(records, NOW).dropped).toBe(2)
  })
})

describe('backoff', () => {
  it('1s부터 두 배씩 늘고 16s에서 멈춘다', () => {
    expect([0, 1, 2, 3, 4, 9].map(backoff)).toEqual([1000, 2000, 4000, 8000, 16000, 16000])
  })
})

/**
 * IndexedDB의 readwrite 트랜잭션은 **생성된 순서대로** 커밋된다. 요청 오류를 `preventDefault()`
 * 하지 않으면 그 트랜잭션 전체가 롤백된다 — 이 두 가지만 흉내 낸다. `bad`로 시작하는 키의
 * 쓰기는 요청 오류를 내고, `abortNext()`는 다음 트랜잭션을 커밋 시점에 중단시킨다(용량 초과 등).
 */
function fakeIdb() {
  const rows = new Map<string, Held>()
  const queue: (() => void)[] = []
  let scheduled = false
  let abortNext = false
  const flush = () => {
    scheduled = false
    while (queue.length > 0) queue.shift()?.()
  }

  const transaction = () => {
    const ops: (() => boolean)[] = []
    const undo: (() => void)[] = []
    const tx = {
      oncomplete: null as null | (() => void),
      onerror: null,
      onabort: null as null | (() => void),
    }
    const request = (apply: () => unknown, fails = false) => {
      const req = {
        result: undefined as unknown,
        onsuccess: null as null | (() => void),
        onerror: null as null | ((event: { preventDefault(): void }) => void),
      }
      ops.push(() => {
        if (!fails) {
          req.result = apply()
          req.onsuccess?.()
          return true
        }
        let handled = false
        req.onerror?.({ preventDefault: () => (handled = true) })
        return handled
      })
      return req
    }
    const write = (id: string, next?: Held) => {
      const prev = rows.get(id)
      undo.push(() => (prev ? rows.set(id, prev) : rows.delete(id)))
      if (next) rows.set(id, next)
      else rows.delete(id)
    }
    Object.assign(tx, {
      objectStore: () => ({
        put: (held: Held) => request(() => write(held.evtId, held), held.evtId.startsWith('bad')),
        delete: (id: string) => request(() => write(id)),
        clear: () =>
          request(() => {
            for (const id of [...rows.keys()]) write(id)
          }),
        getAll: () => request(() => [...rows.values()]),
      }),
    })
    const aborts = abortNext
    abortNext = false
    queue.push(() => {
      const ok = ops.every((op) => op())
      if (ok && !aborts) return tx.oncomplete?.()
      for (const step of undo.reverse()) step()
      tx.onabort?.()
    })
    if (!scheduled) {
      scheduled = true
      queueMicrotask(flush)
    }
    return tx
  }

  const db = { objectStoreNames: { contains: () => true }, transaction, close: () => {} }
  const indexedDB = {
    open: () => {
      const req = { result: db, onsuccess: null as null | (() => void), onerror: null }
      queueMicrotask(() => req.onsuccess?.())
      return req
    },
  }
  return { rows, indexedDB, abortNext: () => (abortNext = true) }
}

describe('openStore', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('여러 건을 쓴 직후 비우면 한 건도 남지 않는다 — 철회 뒤 보관분이 되살아나지 않는다', async () => {
    const fake = fakeIdb()
    vi.stubGlobal('indexedDB', fake.indexedDB)
    const store = await openStore()
    const records = ['a', 'b', 'c'].map((evtId) => held({ evtId }))

    const writing = store?.put(records)
    await store?.clear()
    await writing
    await new Promise((resolve) => setTimeout(resolve))

    expect(fake.rows.size).toBe(0)
  })

  it('여러 건을 한 번에 쓰고 읽는다', async () => {
    const fake = fakeIdb()
    vi.stubGlobal('indexedDB', fake.indexedDB)
    const store = await openStore()

    await store?.put(['a', 'b', 'c'].map((evtId) => held({ evtId })))

    expect((await store?.all())?.map((r) => r.evtId).sort()).toEqual(['a', 'b', 'c'])
  })

  it('한 건의 쓰기 오류가 나머지를 롤백하지 않는다', async () => {
    const fake = fakeIdb()
    vi.stubGlobal('indexedDB', fake.indexedDB)
    const store = await openStore()

    const ok = await store?.put(['a', 'bad', 'c'].map((evtId) => held({ evtId })))

    expect(ok).toBe(true)
    expect([...fake.rows.keys()].sort()).toEqual(['a', 'c'])
  })

  it('트랜잭션이 중단되면 쓰지 못했다고 알린다', async () => {
    const fake = fakeIdb()
    vi.stubGlobal('indexedDB', fake.indexedDB)
    const store = await openStore()

    fake.abortNext()
    const ok = await store?.put(['a', 'b'].map((evtId) => held({ evtId })))

    expect(ok).toBe(false)
    expect(fake.rows.size).toBe(0)
  })
})
