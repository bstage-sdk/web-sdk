/**
 * 미전송 이벤트의 보관·복구.
 *
 * | 코드 | 조건 |
 * | --- | --- |
 * | `E_HELD_NO_SNAPSHOT` | 기록 시점 식별자가 없는 보관분을 폐기했다 |
 * | `E_HELD_OVERFLOW` | 보관 상한·수명을 넘긴 이벤트를 폐기했다 |
 *
 * @module
 */
import type { IdSnapshot } from './identity.js'
import { type Held, type HeldStore, openStore, trim, wipeStore } from './queue.js'
import type { Event } from './types.js'
import { uuid } from './uuid.js'

const LOCK_PREFIX = 'bstage-analytics:owner:'
const LEGACY = 'legacy'

type Locks = Pick<LockManager, 'request'>

/**
 * IndexedDB는 origin의 모든 탭이 공유한다. 탭마다 수명 lock을 쥐고 보관분에 소유자를 적어,
 * 살아 있는 탭의 보관분은 다른 탭이 재전송하지 않게 한다. 탭이 죽으면 브라우저가 lock을
 * 풀어 주므로 그때부터 다른 탭이 넘겨받는다.
 *
 * ⚠️ Web Locks가 없는 브라우저는 모든 보관분을 가져간다 — 여러 탭을 동시에 열면 중복될 수
 * 있다. 유실보다 중복을 택한 것이다.
 */
export class Persist {
  readonly owner = uuid()
  private store: HeldStore | null = null
  private enabled = false
  private locked: Promise<void> | null = null
  private readonly held = new Map<string, Held>()

  constructor(
    private readonly now: () => number = Date.now,
    private readonly open: () => Promise<HeldStore | null> = openStore,
    private readonly locks: Locks | null = globalThis.navigator?.locks ?? null,
  ) {}

  get durable(): boolean {
    return this.store !== null
  }

  /** 동의 시 IndexedDB를 연다. 열리지 않으면 메모리 보관만 계속한다 */
  async enable(): Promise<void> {
    if (this.store) return
    this.enabled = true
    const store = await this.open()
    if (!this.enabled) {
      await store?.clear()
      return
    }
    // ⛔ `this.store` 대입보다 먼저다 — lock 없이 쓴 보관분은 다른 탭이 주인이 죽은 것으로
    // 보고 가져간다. 모든 쓰기가 `this.store`를 거치므로 이 순서가 곧 보증이다.
    if (store) await this.lock()
    if (!this.enabled) {
      await store?.clear()
      return
    }
    this.store = store
    // 메모리에 이미 쌓인 것도 함께 영속화한다
    if (this.store && this.held.size > 0) await this.store.put([...this.held.values()])
  }

  /**
   * 동의 철회. 메모리 보관분까지 비우고 저장소를 지운다
   */
  async disable(): Promise<void> {
    this.enabled = false
    const store = this.store
    this.store = null
    this.held.clear()
    if (store) await store.clear()
    else await wipeStore()
  }

  hold(events: Event[], snapshot?: IdSnapshot): void {
    const records = events.map((event) => ({
      evtId: event.evtId,
      event,
      savedAt: this.now(),
      retryCount: 0,
      snapshot,
      owner: this.owner,
    }))
    for (const held of records) this.held.set(held.evtId, held)
    void this.store?.put(records)
  }

  /** 전송이 성공한 이벤트를 보관에서 지운다 */
  settle(evtIds: string[]): void {
    for (const id of evtIds) this.held.delete(id)
    void this.store?.remove(evtIds)
  }

  fail(evtIds: string[]): void {
    const records: Held[] = []
    for (const id of evtIds) {
      const held = this.held.get(id)
      if (held) records.push({ ...held, retryCount: held.retryCount + 1 })
    }
    for (const held of records) this.held.set(held.evtId, held)
    void this.store?.put(records)
  }

  async recover(): Promise<Held[]> {
    const store = this.store
    const stale: string[] = []
    const valid: Held[] = []
    for (const held of (await store?.all()) ?? []) {
      if (held.snapshot) valid.push(held)
      else stale.push(held.evtId)
    }
    // ⛔ await 뒤마다 철회를 확인한다 — 철회 전에 읽은 목록을 합치면 지운 보관분이 되살아난다
    if (!this.live(store)) return []
    const claimed = await this.claim(valid, store)
    if (!this.live(store)) return []
    for (const held of claimed) {
      if (!this.held.has(held.evtId)) this.held.set(held.evtId, held)
    }
    if (stale.length > 0) {
      void this.store?.remove(stale)
      console.warn(
        `[bstage-analytics] E_HELD_NO_SNAPSHOT: discarded ${stale.length} held event(s) with no identity snapshot`,
      )
    }

    const { keep, dropped } = trim([...this.held.values()], this.now())
    if (dropped > 0) {
      const gone = [...this.held.keys()].filter((id) => !keep.some((held) => held.evtId === id))
      this.held.clear()
      void this.store?.remove(gone)
      console.warn(
        `[bstage-analytics] E_HELD_OVERFLOW: discarded ${dropped} held event(s) over the retention limit`,
      )
    } else {
      this.held.clear()
    }
    for (const held of keep) this.held.set(held.evtId, held)

    return keep
  }

  /** 페이지가 죽을 때까지 쥐는 lock. 콜백이 끝나지 않으므로 브라우저만 풀 수 있다 */
  private lock(): Promise<void> {
    const locks = this.locks
    if (!locks) return Promise.resolve()
    this.locked ??= new Promise<void>((granted) => {
      locks
        .request(LOCK_PREFIX + this.owner, () => {
          granted()
          return new Promise<void>(() => {})
        })
        .catch(() => granted())
    })
    return this.locked
  }

  /**
   * 내 보관분과, 주인 탭이 죽은 보관분만 돌려준다. 죽은 탭의 것은 그 탭의 lock 안에서 다시
   * 읽어 소유를 넘겨받는다 — 두 탭이 동시에 넘겨받으려 해도 lock이 한 쪽만 들여보내고, 늦은
   * 쪽은 다시 읽은 목록이 비어 있다.
   */
  private async claim(rows: Held[], store: HeldStore | null): Promise<Held[]> {
    const locks = this.locks
    if (!locks || !store) return rows

    const mine = rows.filter((held) => held.owner === this.owner)
    const others = new Set(
      rows.filter((held) => held.owner !== this.owner).map((held) => held.owner ?? LEGACY),
    )
    for (const owner of others) {
      await locks
        .request(LOCK_PREFIX + owner, { ifAvailable: true }, async (lock) => {
          if (!lock || !this.live(store)) return
          const orphans = (await store.all())
            .filter((held) => held.snapshot && (held.owner ?? LEGACY) === owner)
            .map((held) => ({ ...held, owner: this.owner }))
          // 담아 둔 `store`로 쓰므로 `this.store?.put()`처럼 철회 뒤에 저절로 무시되지 않는다
          if (!this.live(store)) return
          // 소유가 저장되지 않았으면 가져가지 않는다 — 다른 탭이 같은 보관분을 또 넘겨받는다
          if (await store.put(orphans)) mine.push(...orphans)
        })
        .catch(() => {})
    }
    return mine
  }

  /** 읽기를 시작한 저장소가 아직 쓰이고 있다 — 그 사이 철회·재동의가 없었다 */
  private live(store: HeldStore | null): boolean {
    return this.store === store && (store === null || this.enabled)
  }

  /**
   * 지금 보관 중인 것. ⛔ **`recover()`의 반환값 대신 이것을 쓴다** — 반환값은 그 시점에
   * 고정된 사본이라, 돌려주는 사이에 전송이 끝나 `settle()`이 돌면 이미 지워진 이벤트가
   * 목록에는 남는다. 그것을 재전송하면 방금 보낸 것을 한 번 더 보내게 된다.
   */
  pending(): Held[] {
    return [...this.held.values()]
  }

  /** 보관 중인 건수. 육안 검증용이다 */
  size(): number {
    return this.held.size
  }
}
