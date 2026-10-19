import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FLUSH_WAIT } from './batch.js'
import { Tracker } from './tracker.js'
import type { LogBatch } from './types.js'

/**
 * 지키려는 것은 **이벤트 1건이 전송도 1건**이라는 것이다.
 *
 * 보관(`Persist`)은 write-ahead라 이벤트가 배치 버퍼에 들어가는 시점에 이미 기록된다 — 즉
 * 보관소에는 「아직 전송 차례가 오지 않은 것」과 「전송에 실패해 다시 보내야 하는 것」이 섞여
 * 있다. `retry()`가 그 둘을 구분하지 않으면 버퍼가 아직 들고 있는 이벤트를 가로채 보내고,
 * 버퍼는 제 차례에 같은 이벤트를 한 번 더 보낸다.
 *
 * ⛔ **이 하네스는 그 순서를 실제로 표현해야 한다.** `setConsent(true)`가 저장소를 여는 것은
 * 비동기이고 `init()`은 동기라, 둘 사이의 경합이 재현되지 않는 하네스로는 가드가 회귀를
 * 잡는지 증명할 수 없다. 그래서 전역을 흉내 내 `Tracker`를 통째로 돌린다.
 */

/** 전송된 배치. `sendBeacon`이 받은 body를 그대로 파싱한다 */
let sent: LogBatch[]
/** false면 전송이 실패한다 — 보관분이 남는 경로를 만든다 */
let deliver: boolean
let bus: EventTarget

function setupGlobals(): void {
  sent = []
  deliver = true
  bus = new EventTarget()

  const doc = {
    visibilityState: 'visible',
    cookie: '',
    title: '테스트 문서',
    referrer: '',
    documentElement: { scrollHeight: 2000 },
    addEventListener: () => {},
    removeEventListener: () => {},
  }

  vi.stubGlobal('document', doc)
  vi.stubGlobal('location', { href: 'https://space.test/event-board', pathname: '/event-board' })
  vi.stubGlobal('history', { pushState: () => {}, replaceState: () => {} })
  vi.stubGlobal('screen', { width: 1440, height: 900 })
  vi.stubGlobal('innerWidth', 1440)
  vi.stubGlobal('innerHeight', 900)
  vi.stubGlobal('scrollY', 0)
  vi.stubGlobal('requestAnimationFrame', () => 0)
  vi.stubGlobal('navigator', {
    userAgent: 'test-agent',
    language: 'ko-KR',
    onLine: true,
    sendBeacon: (_url: string, blob: Blob) => {
      if (!deliver) return false
      void blob.text().then((body) => sent.push(JSON.parse(body) as LogBatch))
      return true
    },
  })
  // `sendBeacon`이 false면 `post()`가 여기로 넘어온다 — 실패를 결정적으로 만든다
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')))

  // `window`는 globalThis 자신이다 — `route.ts`의 `browserHost()`가 `bus`와 `flags`로 같은
  // 객체를 쓰므로, 둘을 다른 객체로 두면 후킹 플래그와 이벤트 버스가 갈린다.
  vi.stubGlobal('window', globalThis)
  vi.stubGlobal('addEventListener', bus.addEventListener.bind(bus))
  vi.stubGlobal('removeEventListener', bus.removeEventListener.bind(bus))
  vi.stubGlobal('dispatchEvent', bus.dispatchEvent.bind(bus))
}

/** 마이크로태스크를 흘린다 — 저장소 열기·전송이 전부 promise 체인이다 */
async function tick(times = 10): Promise<void> {
  for (let at = 0; at < times; at += 1) await Promise.resolve()
}

/** 전송된 모든 배치의 이벤트를 편다 */
function events(): { evtId: string; name: string }[] {
  return sent.flatMap((batch) => batch.evts.map(({ evtId, name }) => ({ evtId, name })))
}

describe('Tracker — 전송 1회 보장', () => {
  let tracker: Tracker

  beforeEach(() => {
    vi.useFakeTimers()
    setupGlobals()
    delete (globalThis as unknown as Record<string, unknown>).__bstageRouteHook
    tracker = new Tracker()
  })

  afterEach(() => {
    tracker.destroy()
    delete (globalThis as unknown as Record<string, unknown>).__bstageRouteHook
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  /**
   * 호스트 배선이 `identify → setConsent → init` 순서라 이 경합이 매 로드마다 일어난다.
   * `setConsent(true)`가 연 저장소의 복구가 `init()`의 첫 `page_view`보다 늦게 도착한다.
   */
  it('동의 직후 init한 첫 page_view를 한 번만 보낸다', async () => {
    tracker.setConsent(true)
    tracker.init({ key: 'test-space', endpoint: '/collect' })

    // 저장소가 열리며 retry()가 돈다 — 이 시점에 보관된 것은 방금 그 page_view뿐이다
    await tick()
    // 배치 버퍼가 제 차례에 flush한다
    await vi.advanceTimersByTimeAsync(FLUSH_WAIT)
    await tick()

    expect(events()).toHaveLength(1)
    expect(events()[0]?.name).toBe('page_view')
  })

  it('같은 evtId를 두 배치에 나눠 싣지 않는다', async () => {
    tracker.setConsent(true)
    tracker.init({ key: 'test-space', endpoint: '/collect' })

    await tick()
    await vi.advanceTimersByTimeAsync(FLUSH_WAIT)
    await tick()

    const ids = events().map((event) => event.evtId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  /**
   * ⛔ **대조군이다.** 버퍼가 비어 있으면 `retry()`는 보관분을 그대로 다시 보내야 한다 —
   * 탭이 죽은 뒤의 복구가 영속 큐의 존재 이유이고, 버퍼 제외가 그것까지 막으면
   * **중복은 사라지지만 유실이 생긴다.**
   */
  /**
   * ⛔ **재전송이 보관분을 읽는 동안에도 이벤트는 계속 쌓인다.** `online` 이벤트로 `retry()`를
   * 시작시키면 보관분을 읽는 `await`에서 멈추므로, 그 자리에서 낸 이벤트가 정확히 그 창에
   * 들어간다 — 버퍼 목록을 `await` 전에 잡아두면 이 이벤트를 걸러내지 못한다.
   */
  it('재전송이 보관분을 읽는 동안 쌓인 이벤트도 가로채지 않는다', async () => {
    deliver = false
    tracker.setConsent(true)
    tracker.init({ key: 'test-space', endpoint: '/collect' })
    await tick()
    await vi.advanceTimersByTimeAsync(FLUSH_WAIT)
    await tick()
    expect(tracker.queue().held).toBe(1)

    deliver = true
    // 리스너는 동기로 불린다 — retry()가 보관분을 읽는 지점까지 진행한 뒤 제어가 돌아온다
    bus.dispatchEvent(new Event('online'))
    tracker.send('during_recover')

    await tick()
    await vi.advanceTimersByTimeAsync(FLUSH_WAIT)
    await tick()

    const ids = events().map((event) => event.evtId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  /**
   * ⛔ 앞 테스트와 정확히 반대 방향의 창이다. 보관분을 읽는 동안 **flush가 일어나면** 그
   * 이벤트는 버퍼에서 빠지는데(`flush()`가 동기로 비운다) 전송이 끝나기 전이라 보관소에는
   * 남아 있다 — 버퍼 목록을 읽은 뒤에 잡으면 이 이벤트를 걸러내지 못한다.
   */
  it('재전송이 보관분을 읽는 동안 flush된 이벤트도 가로채지 않는다', async () => {
    deliver = false
    tracker.setConsent(true)
    tracker.init({ key: 'test-space', endpoint: '/collect' })
    await tick()
    await vi.advanceTimersByTimeAsync(FLUSH_WAIT)
    await tick()
    expect(tracker.queue().held).toBe(1)

    deliver = true
    tracker.send('pending_event')
    // retry()가 보관분을 읽는 사이에 버퍼가 비워진다 — 전송은 아직 끝나지 않았다
    bus.dispatchEvent(new Event('online'))
    tracker.flush()

    await tick()
    await vi.advanceTimersByTimeAsync(FLUSH_WAIT)
    await tick()

    const ids = events().map((event) => event.evtId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  /**
   * ⛔ 재전송은 겹쳐 돌 수 있다 — `online` 복귀와 백오프 타이머가 동시에 걸리는 경우다.
   * 먼저 시작한 재전송이 아직 날아가는 중인 보관분을, 뒤이은 재전송이 다시 집어가면 안 된다.
   */
  it('겹쳐 도는 재전송이 같은 보관분을 두 번 보내지 않는다', async () => {
    deliver = false
    tracker.setConsent(true)
    tracker.init({ key: 'test-space', endpoint: '/collect' })
    await tick()
    await vi.advanceTimersByTimeAsync(FLUSH_WAIT)
    await tick()
    expect(tracker.queue().held).toBe(1)

    deliver = true
    // 둘 다 보관분을 읽는 지점까지 진행한 뒤 멈춘다 — 같은 것을 보고 있다
    bus.dispatchEvent(new Event('online'))
    bus.dispatchEvent(new Event('online'))

    await tick()
    await vi.advanceTimersByTimeAsync(FLUSH_WAIT)
    await tick()

    const ids = events().map((event) => event.evtId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  /**
   * ⛔ 전송이 던지면 소유권을 놓고 **상태도 전진시켜야 한다** — `persist.fail()`·백오프가 없으면
   * 외부 `online`이 오기 전까지 영영 나가지 못하고, `retryCount`가 0에 묶여 보관 상한에도
   * 걸리지 않는다. 여기서는 **외부 이벤트를 쏘지 않고** 자체 회복만으로 확인한다.
   *
   * ⚠️ `send()`도 `params`를 참조로 저장하므로, 검사를 지난 뒤 호출자가 바꾸면 전송 시점에
   * 던진다. `identify()`와 달리 그룹핑 키에는 들어가지 않아 보관분 전체가 얼지는 않는다 —
   * **이 경로가 catch 가드가 실제로 받는 자리다.**
   */
  it('전송이 던져도 소유권을 놓고 스스로 재시도한다', async () => {
    let calls = 0
    const params = {
      // `send()`가 크기·제한 검사로 두 번 읽고, 세 번째가 전송 시점의 직렬화다
      get amount(): number {
        calls += 1
        if (calls === 3) throw new Error('serialize boom')
        return 1000
      },
    }

    tracker.setConsent(true)
    tracker.init({ key: 'test-space', endpoint: '/collect' })
    // init의 page_view를 먼저 흘려보내고 관측을 비운다 — 전송 기록이 비동기로 들어온다
    tracker.flush()
    await tick()
    sent = []

    tracker.send('purchase', params as unknown as Record<string, number>)

    await tick()
    await vi.advanceTimersByTimeAsync(FLUSH_WAIT)
    await tick()
    // 직렬화가 실패해 전송은 0건이지만 보관분은 남아 있어야 한다
    expect(events()).toHaveLength(0)
    expect(tracker.queue().held).toBe(1)

    // ⛔ 외부 이벤트 없이 백오프만으로 회복해야 한다
    await vi.advanceTimersByTimeAsync(FLUSH_WAIT)
    await tick()

    expect(events()).toHaveLength(1)
    expect(events()[0]?.name).toBe('purchase')
    expect(tracker.queue().held).toBe(0)
  })

  /**
   * ⛔ props는 봉투에 실리므로 `send()`의 관문을 지나지 않는다. 직렬화할 수 없는 값이 들어오면
   * `ship()`뿐 아니라 `retry()`의 그룹핑까지 던져 **그 세션의 보관분 전체가 막힌다.**
   */
  it('직렬화할 수 없는 identify props를 버리고 userId와 이벤트는 살린다', async () => {
    const circular: Record<string, unknown> = { a: 1 }
    circular.self = circular

    tracker.setConsent(true)
    tracker.identify('u1', circular as unknown as Record<string, string>)
    tracker.init({ key: 'test-space', endpoint: '/collect' })
    tracker.send('after_identify')

    await tick()
    await vi.advanceTimersByTimeAsync(FLUSH_WAIT)
    await tick()

    expect(events()).toHaveLength(2)
    expect(tracker.queue().held).toBe(0)
    expect(sent[0]?.user).toEqual({ id: 'u1' })
  })

  /**
   * ⛔ **검증한 값과 저장하는 값이 달라지면 관문이 무의미해진다.** 원본 참조를 그대로 두면
   * 호출자가 `identify()` 이후에 객체를 바꿔 직렬화 불가로 만들 수 있고, 그러면 `retry()`의
   * 그룹핑이 던져 보관분 전체가 얼어붙는다 — `ship()`의 catch는 그 자리를 덮지 못한다.
   */
  it('identify 이후 호출자가 props를 바꿔도 수집이 멈추지 않는다', async () => {
    const props: Record<string, unknown> = { plan: 'pro' }

    tracker.setConsent(true)
    tracker.identify('u1', props as unknown as Record<string, string>)
    // 검증을 통과한 뒤 호출자가 같은 객체를 오염시킨다
    props.self = props

    tracker.init({ key: 'test-space', endpoint: '/collect' })
    tracker.send('after_mutation')

    await tick()
    await vi.advanceTimersByTimeAsync(FLUSH_WAIT)
    await tick()

    expect(events()).toHaveLength(2)
    expect(tracker.queue().held).toBe(0)
    // 검증 시점의 값이 그대로 실린다 — 오염된 참조가 아니다
    expect(sent[0]?.user).toEqual({ id: 'u1', props: { plan: 'pro' } })
  })

  /**
   * ⛔ props가 `BODY_MAX`를 넘으면 **어떤 배치도** 상한을 넘겨, 재귀 분할이 1건까지 쪼갠 뒤
   * 전부 드롭한다 — 조용한 전량 유실이다. 게다가 경고가 원인을 이벤트로 잘못 지목한다.
   */
  it('상한을 넘는 identify props를 버리고 이벤트는 정상 전송한다', async () => {
    const warned: string[] = []
    const spy = vi.spyOn(console, 'warn').mockImplementation((message: unknown) => {
      warned.push(String(message))
    })

    tracker.setConsent(true)
    tracker.identify('u1', { blob: 'x'.repeat(60 * 1024) })
    tracker.init({ key: 'test-space', endpoint: '/collect' })
    tracker.send('after_identify')

    await tick()
    await vi.advanceTimersByTimeAsync(FLUSH_WAIT)
    await tick()
    spy.mockRestore()

    expect(events()).toHaveLength(2)
    expect(sent[0]?.user).toEqual({ id: 'u1' })
    // 원인을 props로 지목하는 경고 1건만 남는다 — 이벤트 드롭 경고가 아니다
    expect(warned.filter((w) => w.includes('E_PROPS_TOO_LARGE'))).toHaveLength(1)
    expect(warned.filter((w) => w.includes('body 상한'))).toHaveLength(0)
  })

  it('전송에 실패한 보관분은 버퍼가 빈 뒤에 재전송된다', async () => {
    deliver = false
    tracker.setConsent(true)
    tracker.init({ key: 'test-space', endpoint: '/collect' })

    await tick()
    await vi.advanceTimersByTimeAsync(FLUSH_WAIT)
    await tick()
    // 전송이 실패했으므로 도달은 0건이고 보관분만 남는다
    expect(events()).toHaveLength(0)
    expect(tracker.queue().held).toBe(1)
    // 버퍼는 flush로 비었다 — 이제 그 이벤트의 소유자는 보관소뿐이다
    expect(tracker.events()).toHaveLength(0)

    deliver = true
    // 백오프가 만료되며 retry()가 돈다
    await vi.advanceTimersByTimeAsync(FLUSH_WAIT)
    await tick()

    expect(events()).toHaveLength(1)
    expect(events()[0]?.name).toBe('page_view')
    expect(tracker.queue().held).toBe(0)
  })
})

/**
 * Next Pages Router의 `next/head`는 `pushState` 다음 태스크의 렌더 커밋 뒤에 `<title>`을 바꾼다.
 * 전환 `page_view`를 그보다 먼저 만들면 이전 화면의 제목이 실린다.
 */
describe('Tracker — 전환 page_view는 렌더 뒤에 만든다', () => {
  let tracker: Tracker
  let frames: FrameRequestCallback[]

  /** 쌓인 rAF 콜백을 한 프레임만큼 실행한다 */
  function frame(): void {
    const run = frames
    frames = []
    for (const cb of run) cb(0)
  }

  function views(): { url: string; title?: string }[] {
    const pending = tracker.events().filter((event) => event.name === 'page_view')
    return pending.map(({ page }) => ({ url: page.url, title: page.title }))
  }

  function go(path: string): void {
    location.href = `https://space.test${path}`
    history.pushState(null, '', path)
  }

  beforeEach(() => {
    vi.useFakeTimers()
    setupGlobals()
    frames = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb))
    delete (globalThis as unknown as Record<string, unknown>).__bstageRouteHook
    tracker = new Tracker()
    tracker.init({ key: 'test-space', endpoint: '/collect' })
  })

  afterEach(() => {
    tracker.destroy()
    delete (globalThis as unknown as Record<string, unknown>).__bstageRouteHook
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('렌더가 바꾼 제목을 싣는다', async () => {
    go('/next')
    await tick()
    document.title = '다음 화면'
    expect(views()).toHaveLength(1)

    frame()
    frame()

    expect(views()).toHaveLength(2)
    expect(views()[1]).toEqual({ url: 'https://space.test/next', title: '다음 화면' })
  })

  it('프레임이 오지 않아도(숨은 탭) 상한 뒤에 만든다', async () => {
    go('/next')
    await tick()
    expect(views()).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(100)

    expect(views()).toHaveLength(2)
  })

  it('기다리는 중에 정지하면 만들지 않는다', async () => {
    go('/next')
    await tick()
    tracker.destroy()

    frame()
    frame()
    await vi.advanceTimersByTimeAsync(100)
    await tick()

    expect(events().filter((event) => event.name === 'page_view')).toHaveLength(1)
  })

  it('기다리는 중에 URL이 다시 바뀌면 최종 URL로 1건만 만든다', async () => {
    go('/a')
    go('/b')
    await tick()

    frame()
    frame()
    await vi.advanceTimersByTimeAsync(100)

    expect(views().map((view) => view.url)).toEqual([
      'https://space.test/event-board',
      'https://space.test/b',
    ])
  })
})
