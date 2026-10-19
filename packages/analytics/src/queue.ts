import type { IdSnapshot } from './identity.js'
import type { Event } from './types.js'

export interface Held {
  evtId: string
  event: Event
  savedAt: number
  retryCount: number
  snapshot?: IdSnapshot
  /** 보관한 페이지. 없으면 소유자 기록 이전(0.5.2 이하)의 보관분이다 */
  owner?: string
}

export const MAX_HELD = 500
export const MAX_AGE = 3 * 24 * 60 * 60 * 1000
export const RETRY_MAX = 5

export function trim(records: Held[], now: number): { keep: Held[]; dropped: number } {
  const alive = records.filter(
    (held) => now - held.savedAt <= MAX_AGE && held.retryCount < RETRY_MAX,
  )
  const sorted = [...alive].sort((a, b) => a.savedAt - b.savedAt)
  const keep = sorted.slice(Math.max(0, sorted.length - MAX_HELD))
  return { keep, dropped: records.length - keep.length }
}

export function backoff(retryCount: number): number {
  return 1000 * 2 ** Math.min(retryCount, 4)
}

export interface HeldStore {
  /** 커밋됐으면 true */
  put(records: Held[]): Promise<boolean>
  all(): Promise<Held[]>
  remove(evtIds: string[]): Promise<void>
  clear(): Promise<void>
}

const DB_NAME = 'bstage-analytics'
const STORE_NAME = 'held'

export async function wipeStore(): Promise<void> {
  try {
    const store = await openStore()
    await store?.clear()
  } catch {
    return
  }
}

export async function openStore(): Promise<HeldStore | null> {
  let db = await openDb()

  if (db && !db.objectStoreNames.contains(STORE_NAME)) {
    db.close()
    await deleteDb()
    db = await openDb()
  }
  if (!db?.objectStoreNames.contains(STORE_NAME)) return null

  const run = <T>(mode: IDBTransactionMode, body: (store: IDBObjectStore) => IDBRequest<T>) =>
    new Promise<T | null>((resolve) => {
      try {
        const request = body(db.transaction(STORE_NAME, mode).objectStore(STORE_NAME))
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => resolve(null)
      } catch {
        resolve(null)
      }
    })

  return {
    // ⛔ 한 트랜잭션으로 쓴다 — 트랜잭션은 생성 순서대로 커밋되는데, 건마다 await하며 열면
    // 두 번째부터는 그 사이 열린 `clear()`보다 늦게 커밋돼 철회로 지운 보관분이 되살아난다.
    // 트랜잭션은 호출 시점에 동기로 열린다 — 호출자가 확인과 호출 사이에 await하지 않으면 된다.
    // 한 건의 요청 오류는 `preventDefault()`로 삼킨다 — 두지 않으면 트랜잭션 전체가 롤백된다.
    // 커밋 여부를 돌려준다: 트랜잭션이 중단되면(용량 초과 등) 아무것도 쓰이지 않았다.
    put(records) {
      return new Promise<boolean>((resolve) => {
        if (records.length === 0) return resolve(true)
        try {
          const tx = db.transaction(STORE_NAME, 'readwrite')
          const store = tx.objectStore(STORE_NAME)
          for (const held of records) {
            try {
              store.put(held).onerror = (event) => event.preventDefault()
            } catch {
              continue
            }
          }
          tx.oncomplete = () => resolve(true)
          tx.onabort = () => resolve(false)
        } catch {
          resolve(false)
        }
      })
    },
    async all() {
      return (await run<Held[]>('readonly', (store) => store.getAll())) ?? []
    },
    async remove(evtIds) {
      for (const id of evtIds) await run('readwrite', (store) => store.delete(id))
    },
    async clear() {
      await run('readwrite', (store) => store.clear())
    },
  }
}

function deleteDb(): Promise<void> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.deleteDatabase(DB_NAME)
      request.onsuccess = () => resolve()
      request.onerror = () => resolve()
      request.onblocked = () => resolve()
    } catch {
      resolve()
    }
  })
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, 1)
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'evtId' })
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(null)
      request.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}
