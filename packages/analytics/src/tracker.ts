/**
 * SDK의 Singleton. host 앱에서 init() 트리거 (여기서부터 시작)
 *
 * | 코드 | 조건 | 결과 |
 * | --- | --- | --- |
 * | `E_CRYPTO_UNAVAILABLE` | `crypto`가 없어 식별자를 안전하게 만들 수 없다 | 수집 시작 안 함 |
 * | `E_NAME_INVALID` | 이벤트 이름이 규칙(`^[a-z][a-z0-9_]*$`·`NAME_MAX`)에 맞지 않다 | 이벤트 드롭 |
 * | `E_NAME_RESERVED` | 예약 이름이거나 문자열이 아니다 | 이벤트 드롭 |
 * | `E_PARAMS_TOO_LARGE` | `params` JSON 크기가 `EVENT_MAX`를 넘거나 직렬화가 안 된다 | 이벤트 드롭 |
 * | `E_PARAMS_LIMIT` | `params`가 `PARAM_LIMIT`(키 수·키 길이·값 길이)를 넘겼다 | 경고만, 그대로 전송 |
 *
 * @module
 */
import { BATCH_MAX, Batch } from './batch.js'
import { findTarget, readClick, readEvent } from './click.js'
import { checkConfig, logUrl } from './config.js'
import { Engagement } from './engagement.js'
import { readEnv } from './env.js'
import { Identity, type IdSnapshot } from './identity.js'
import { Impressions, resolveOpt } from './impression.js'
import { EVENT_MAX, checkName, checkParams, isReserved, sizeOf } from './limits.js'
import { readLoad, readPage, readUtm } from './page.js'
import { Persist } from './persist.js'
import { type Held, backoff } from './queue.js'
import { hookRoute, onRoute } from './route.js'
import { ScrollDepth, readRatio } from './scroll.js'
import { overBodyMax, post } from './transport.js'
import type {
  ClickParams,
  Env,
  Event,
  EventParams,
  ImpressionParams,
  InitConfig,
  LoadType,
  LogBatch,
  Page,
  PageViewParams,
  ScrollDepthParams,
  User,
} from './types.js'
import { uuid } from './uuid.js'

/** 자동 계측이 낼 수 있는 이벤트 전부. `emit()`이 받지 못하는 발화 경계 타입을 여기서 건다 */
type AutoEvent =
  | { name: 'page_view'; params: PageViewParams }
  | { name: 'click'; params: ClickParams }
  | { name: 'impression'; params: ImpressionParams }
  | { name: 'scroll_depth'; params: ScrollDepthParams }

export class Tracker {
  private readonly identity = new Identity()
  private readonly engagement = new Engagement()
  private readonly depth = new ScrollDepth((depth) =>
    this.auto({ name: 'scroll_depth', params: { depth } }),
  )
  /** 노출 관찰. init 전에는 없다 */
  private impressions: Impressions | null = null
  private config: InitConfig | null = null
  private env: Env | null = null
  private page: Page | null = null
  private prevUrl: string | undefined
  private warned = false

  private readonly batch = new Batch((evts) => void this.ship(evts))
  private readonly persist = new Persist()
  /**
   * 배치·전송이 쥐고 있는 이벤트. 보관은 write-ahead라 보관소에는 「아직 전송 차례가 오지
   * 않은 것」과 「전송에 실패해 다시 보내야 하는 것」이 섞여 있는데, 이 표시가 그 둘을 가른다.
   *
   * ⛔ **버퍼를 들여다보는 것으로는 가를 수 없다.** 보관분을 읽는 사이에도 이벤트는 추가되고
   * flush되므로, 목록을 읽기 전에 잡으면 그 사이 추가된 것을, 읽은 뒤에 잡으면 그 사이
   * flush된 것을 놓친다. 소유권은 시점이 아니라 상태여야 한다.
   *
   * 이전 세션의 보관분은 여기에 없다 — 그래서 탭이 죽은 뒤의 복구는 그대로 동작한다.
   */
  private readonly owned = new Set<string>()
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private abort: AbortController | null = null
  private unhook: (() => void) | null = null
  private revived = false
  private stopped = false
  private snapshot: IdSnapshot | null = null

  get ready(): boolean {
    return this.config !== null
  }

  init(config: Partial<InitConfig> = {}): boolean {
    if (this.ready) return true
    if (typeof document === 'undefined') return false

    const c = globalThis.crypto
    if (!c?.randomUUID && !c?.getRandomValues) {
      this.warn('E_CRYPTO_UNAVAILABLE: crypto is unavailable; analytics did not start')
      return false
    }

    const merged = strip(config)
    const issue = checkConfig(merged)
    if (issue) {
      this.warn(issue)
      return false
    }

    this.config = merged as InitConfig
    this.env = readEnv()
    this.stopped = false
    this.watch()
    this.impressions = new Impressions(resolveOpt(merged.impression), (params) =>
      this.auto({ name: 'impression', params }),
    )
    this.impressions.start()
    this.pageView(this.revived ? 'navigate' : readLoad())
    return true
  }

  identify(userId: string, props?: User['props']): void {
    this.identity.identify(userId, safeProps(props))
  }

  setConsent(analytics: boolean): void {
    this.batch.flush()
    this.identity.setConsent(analytics)

    if (analytics === true) {
      void this.persist.enable().then(() => this.retry())
      return
    }

    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    void this.persist.disable()
  }

  ids(): IdSnapshot {
    return this.identity.peek()
  }

  flush(): void {
    this.batch.flush()
  }

  destroy(): void {
    if (!this.ready) return

    this.stopped = true

    this.flush()

    this.abort?.abort()
    this.abort = null
    this.unhook?.()
    this.unhook = null

    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }

    this.engagement.hide()
    this.depth.reset()
    // Observer는 `signal`로 끊기지 않는다 — 여기서 끊지 않으면 destroy 후에도 발화한다
    this.impressions?.stop()
    this.impressions = null

    this.config = null
    this.env = null
    this.page = null
    this.revived = true
  }

  events(): Event[] {
    return this.batch.pending()
  }

  queue(): { durable: boolean; held: number } {
    return { durable: this.persist.durable, held: this.persist.size() }
  }

  send(name: string, params?: EventParams): void {
    if (!this.ready) return

    if (!checkName(name)) {
      console.warn(
        `[bstage-analytics] E_NAME_INVALID: event name does not match the naming rule; dropped: ${name}`,
      )
      return
    }

    if (params) {
      const size = sizeOf(params)
      if (size === null || size > EVENT_MAX) {
        console.warn(
          `[bstage-analytics] E_PARAMS_TOO_LARGE: params exceed the ${EVENT_MAX}B limit; "${name}" dropped`,
        )
        return
      }
      for (const issue of checkParams(params)) {
        console.warn(`[bstage-analytics] E_PARAMS_LIMIT: ${name}: ${issue}`)
      }
    }

    this.record(name, params)
  }

  /** ⛔ 예약 이름 판정은 여기서만 한다 — `send()`에 두면 자동 계측 경로가 검사를 건너뛴다 */
  private record(name: string, params?: EventParams): void {
    if (typeof name !== 'string' || isReserved(name)) {
      console.warn(
        `[bstage-analytics] E_NAME_RESERVED: event name is reserved or not a string; dropped: ${String(name)}`,
      )
      return
    }
    this.emit(name, params)
  }

  /** 자동 계측 전용 경로. 예약 이름을 낼 수 있는 유일한 곳이라 SDK 내부에서만 부른다 */
  private auto(event: AutoEvent): void {
    this.emit(event.name, event.params)
  }

  private emit(name: string, params?: EventParams): void {
    if (!this.ready) return

    this.snapshot = this.identity.touch()
    const event = {
      evtId: uuid(),
      ts: Date.now(),
      name,
      page: this.page ?? (this.page = readPage(this.prevUrl)),
      params,
    }
    // 배치·전송이 이 이벤트를 쥐고 있는 동안 재전송이 집어가지 않게 표시한다.
    // ⛔ `batch.add`보다 먼저다 — `add`가 상한에서 곧바로 flush를 부르면 그 전송이 소유권을
    // 놓는데, 표시가 그 뒤에 붙으면 아무도 지우지 않는 표시가 남아 영영 재전송되지 않는다.
    this.owned.add(event.evtId)
    this.batch.add(event)
    this.persist.hold([event], this.snapshot)
  }

  /**
   * ⛔ **전송이 시작된 이벤트도 그 전송이 끝날 때까지 소유한다.** 백오프와 `online`이 겹쳐
   * 돌면 재전송이 두 번 시작될 수 있는데, 표시가 없으면 아직 날아가는 중인 보관분을 두
   * 번째 재전송이 다시 집어간다. `record()`가 붙인 표시와 같은 표시다(집합이라 겹쳐도 된다).
   */
  private async ship(evts: Event[], retryCount = 0, held?: IdSnapshot): Promise<void> {
    const evtIds = evts.map((event) => event.evtId)
    for (const id of evtIds) this.owned.add(id)
    try {
      await this.deliver(evts, evtIds, retryCount, held)
    } catch {
      // ⛔ 고객사 페이지에 우리 예외를 남기지 않는다 — `void this.ship()`이라 그대로 두면
      // unhandled rejection이 된다. 보관분은 지우지 않는다: 전송이 실패한 것이지 버릴
      // 이벤트라고 판정된 것이 아니다. 계속 실패하면 보관 상한·수명이 걷어낸다.
      console.warn(
        `[bstage-analytics] E_SHIP_FAILED: could not serialize or send ${evts.length} event(s)`,
      )
      // ⛔ 성공·실패 경로와 같은 생애주기를 태운다. 여기서 상태를 전진시키지 않으면 자체
      // 재시도가 걸리지 않아 외부 `online`이 올 때까지 나가지 못하고, `retryCount`가 0에
      // 묶여 보관 상한(`RETRY_MAX`)에도 걸리지 않아 수명이 다할 때까지 남는다.
      this.persist.fail(evtIds)
      this.scheduleRetry(retryCount)
    } finally {
      // ⛔ **던지더라도 놓는다.** 경로마다 놓으면 언젠가 한 경로를 빠뜨리는데, 쥔 채로 끝난
      // 이벤트는 어떤 재전송도 집지 못하고 표시만 남는다. `identify()`의 props가 순환
      // 참조면 `JSON.stringify`가 실제로 던진다 — 그 props는 검사 없이 봉투에 실린다.
      this.release(evtIds)
    }
  }

  /** ⛔ 쪼갤 수 없는 1건이 상한을 넘으면 드롭한다 — 그대로 보내면 브라우저가 조용히 삼킨다 */
  private async deliver(
    evts: Event[],
    evtIds: string[],
    retryCount: number,
    held?: IdSnapshot,
  ): Promise<void> {
    const config = this.config
    const env = this.env
    const snapshot = held ?? this.snapshot
    if (!config || !env || !snapshot) return

    const { consent, startedAt: _startedAt, ...ids } = snapshot
    const payload: LogBatch = {
      version: 2,
      key: config.key,
      ...ids,
      env,
      consent,
      // 발화 임계값은 **배치당 1회**만 싣는다. 이벤트마다 반복하면 정작 「무엇이 노출됐는가」를
      // 담을 자리가 없어진다 — `ImpressionParams` 주석 참조.
      ...(this.impressions === null ? {} : { impressionOpt: this.impressions.opt }),
      sentAt: Date.now(),
      retryCount,
      evts,
    }
    const body = JSON.stringify(payload)
    if (overBodyMax(body)) {
      if (evts.length > 1) {
        const half = Math.ceil(evts.length / 2)
        // 쪼갠 조각이 각자 소유권을 넘겨받는다 — 여기서 놓으면 이중으로 놓는다
        await Promise.all([
          this.ship(evts.slice(0, half), retryCount, snapshot),
          this.ship(evts.slice(half), retryCount, snapshot),
        ])
        return
      }

      // ⛔ **더 쪼갤 수 없다.** reader들이 원문 필드에 상한을 걸어(`clip`) 여기까지 오지 않는
      // 것이 설계지만, 가드가 있어야 "재귀 분할이 항상 수렴한다"가 주장이 아니라 보증이 된다.
      // **보관분을 함께 정리한다** — 남기면 `RETRY_MAX`까지 실패할 전송을 반복한다.
      console.warn(`[bstage-analytics] 이벤트 1건이 body 상한을 넘어 드롭한다: "${evts[0]?.name}"`)
      this.persist.settle(evtIds)
      return
    }

    if (await post(logUrl(config.endpoint, undefined, config.path), body)) {
      this.persist.settle(evtIds)
      return
    }

    // 실패 이후는 보관분이 소유자다 — `online`·백오프가 이어받는다(소유권은 `ship()`이 놓는다)
    if (navigator.onLine === false) return

    this.persist.fail(evtIds)
    this.scheduleRetry(retryCount)
  }

  /** 배치·전송이 쥐고 있던 이벤트를 놓는다. 놓인 것만 재전송 대상이 된다 */
  private release(evtIds: string[]): void {
    for (const id of evtIds) this.owned.delete(id)
  }

  /**
   * 보관분 재전송.
   *
   * ⛔ **배치 버퍼가 아직 들고 있는 이벤트는 재전송 대상이 아니다.** 보관은 write-ahead라
   * 이벤트가 버퍼에 들어가는 시점에 이미 기록된다 — 걸러내지 않으면 여기서 한 번, 버퍼가
   * 제 차례에 또 한 번 보내 같은 `evtId`가 수집 서버에 두 레코드로 남는다.
   *
   * ⛔ **제외는 꺼내는 쪽인 여기서 한다.** 보관을 늦추면 flush 전에 탭이 죽었을 때 복구되지
   * 않는다 — write-ahead의 목적 자체가 사라진다.
   *
   * ⛔ **소유권 표시로 가른다 — 버퍼를 읽는 시점으로 가르지 않는다.** 보관분을 읽는 사이에도
   * 이벤트는 추가되고 flush되므로 어느 시점에 버퍼를 읽어도 한쪽 창이 남는다(`owned` 참조).
   */
  private async retry(): Promise<void> {
    if (this.stopped) return
    await this.persist.recover()
    // 보관 목록과 소유권을 **같은 시점에** 읽는다 — `recover()`의 반환값은 사본이라,
    // 돌려주는 사이에 끝난 전송의 `settle()`이 반영되지 않는다
    const records = this.persist.pending().filter((held) => !this.owned.has(held.evtId))

    const groups = new Map<string, Held[]>()
    for (const held of records) {
      const key = JSON.stringify(held.snapshot)
      const group = groups.get(key)
      if (group) group.push(held)
      else groups.set(key, [held])
    }

    for (const group of groups.values()) {
      for (let at = 0; at < group.length; at += BATCH_MAX) {
        const slice = group.slice(at, at + BATCH_MAX)
        const attempt = Math.max(...slice.map((held) => held.retryCount))
        void this.ship(
          slice.map((held) => held.event),
          attempt,
          slice[0].snapshot,
        )
      }
    }
  }

  private scheduleRetry(retryCount: number): void {
    if (this.stopped || this.retryTimer !== null) return
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      void this.retry()
    }, backoff(retryCount))
  }

  private pageView(loadType: LoadType, engagementTime?: number): void {
    this.page = readPage(this.prevUrl)
    this.prevUrl = this.page.url

    const { startedAt } = this.identity.touch()
    this.auto({
      name: 'page_view',
      params: {
        loadType,
        ...(engagementTime === undefined ? {} : { engagementTime }),
        ...(startedAt === undefined ? {} : { sessionDuration: Date.now() - startedAt }),
        ...readUtm(location.search),
      },
    })
  }

  private click(event: MouseEvent): void {
    if (!event.isTrusted) return
    const el = findTarget(event)
    if (!el) return
    this.auto({ name: 'click', params: readClick(el, event.pageX, event.pageY) })

    // ⛔ `click`을 대체하지 않고 더한다 — 대체하면 이름을 붙인 요소의 클릭이 click 집계에서
    // 빠져 CTR이 왜곡된다. ⛔ 게스트가 쓴 이름이므로 `auto()`가 아니라 `send()`로 보낸다
    const custom = readEvent(el)
    if (custom) this.send(custom.name, custom.params)
  }

  private watch(): void {
    const abort = (this.abort = new AbortController())
    const { signal } = abort

    if (document.visibilityState === 'visible') this.engagement.show()

    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.visibilityState === 'visible') this.engagement.show()
        else this.engagement.hide()
      },
      { signal },
    )

    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.visibilityState === 'hidden') this.batch.flush()
      },
      { signal },
    )
    addEventListener('pagehide', () => this.batch.flush(), { signal })
    addEventListener('online', () => void this.retry(), { signal })

    document.addEventListener('click', (event) => this.click(event), { capture: true, signal })

    let ticking = false
    addEventListener(
      'scroll',
      (event) => {
        if (!event.isTrusted || ticking) return
        ticking = true
        requestAnimationFrame(() => {
          ticking = false
          this.depth.check(readRatio(scrollY, innerHeight, document.documentElement.scrollHeight))
        })
      },
      { passive: true, signal },
    )

    this.unhook = hookRoute()
    onRoute(
      (loadType) =>
        afterPaint(() => {
          if (location.href === this.prevUrl) return
          this.depth.reset()
          this.impressions?.reset()
          this.pageView(loadType, this.engagement.take())
        }, signal),
      { signal },
    )
  }

  private warn(message: string): void {
    if (this.warned) return
    this.warned = true
    console.warn(`[bstage-analytics] ${message}`)
  }
}

/**
 * `identify()`의 props를 거른다.
 *
 * ⛔ **props는 이벤트가 아니라 봉투에 실려 `send()`의 관문을 지나지 않는다.** 직렬화할 수
 * 없는 값이 들어오면 `ship()`의 `JSON.stringify`뿐 아니라 `retry()`의 그룹핑 키까지 던져
 * **그 세션의 보관분 전체가 막힌다.** 상한을 넘으면 어떤 배치도 `BODY_MAX`를 넘겨 재귀
 * 분할이 1건까지 쪼갠 뒤 전부 드롭한다 — 조용한 전량 유실이다.
 *
 * **`userId`는 살린다** — 지표의 축이고 props는 부가 정보다. 어느 쪽이 버려졌는지 경고에
 * 명시해, 고객사가 「불렀는데 props가 없다」를 원인 없이 마주하지 않게 한다.
 *
 * ⛔ **검증한 값 그대로를 돌려준다 — 원본 참조가 아니다.** 참조를 넘기면 호출자가 이후에
 * 객체를 바꿔 검증을 무의미하게 만들 수 있고, 그러면 `retry()`의 그룹핑 키가 던져 보관분
 * 전체가 얼어붙는다. `ship()`의 catch는 그 자리를 덮지 못한다.
 *
 * ⚠️ **직렬화는 한 번만 한다.** 두 번 하면 첫 호출에만 통과하는 getter가 검사를 지난 뒤
 * 복사에서 던져, `identify()`가 호출자에게 예외를 되돌려준다.
 *
 * ⇒ 이것으로 **보관 스냅샷의 모든 값이 JSON으로 안전하다**가 보증된다. 스냅샷에 호출자가
 * 주는 값을 새로 추가한다면 여기와 같은 관문을 함께 만들어야 그 보증이 유지된다.
 */
function safeProps(props?: User['props']): User['props'] | undefined {
  if (!props) return undefined

  let json: string | undefined
  try {
    json = JSON.stringify(props)
  } catch {
    json = undefined
  }
  // 함수처럼 `stringify`가 값을 내지 않는 입력도 여기서 걸린다
  if (json === undefined) {
    console.warn(
      '[bstage-analytics] E_PROPS_UNSERIALIZABLE: identify props could not be serialized; props dropped, userId kept',
    )
    return undefined
  }
  if (new TextEncoder().encode(json).length > EVENT_MAX) {
    console.warn(
      `[bstage-analytics] E_PROPS_TOO_LARGE: identify props exceed the ${EVENT_MAX}B limit; props dropped, userId kept`,
    )
    return undefined
  }
  return JSON.parse(json) as User['props']
}

function strip(config: Partial<InitConfig>): Partial<InitConfig> {
  return Object.fromEntries(Object.entries(config).filter(([, v]) => v !== undefined))
}

/** 숨은 탭에서는 rAF가 돌지 않는다 — 이 시간이 지나면 프레임을 기다리지 않는다 */
const PAINT_MAX = 100

/**
 * ⛔ 라우터가 `pushState` 다음 태스크의 렌더 커밋 뒤에 `<title>`을 바꾼다(Next Pages Router의
 * `next/head`) — 그보다 먼저 읽으면 이전 화면의 제목이 실린다. 첫 rAF는 커밋보다 앞설 수 있어
 * 두 번 기다린다.
 */
function afterPaint(fn: () => void, signal: AbortSignal): void {
  let done = false
  const run = () => {
    if (done || signal.aborted) return
    done = true
    fn()
  }
  requestAnimationFrame(() => requestAnimationFrame(run))
  setTimeout(run, PAINT_MAX)
}
