import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ROUTE_EVENT, type RouteHost, hookRoute, onRoute } from './route.js'

/**
 * 후킹의 계약은 전역을 원래대로 되돌릴 수 있다는 것이다 — 원복이 틀리면 정지 후에도 수집이
 * 계속되고, 소유권 판정이 틀리면 남의 패치를 걷어낸다. `bus`는 실제 `EventTarget`을 쓴다.
 */
describe('hookRoute', () => {
  let host: RouteHost
  let pushed: unknown[][]
  let base: Pick<History, 'pushState' | 'replaceState'>
  let seen: string[]

  beforeEach(() => {
    pushed = []
    base = {
      pushState: (...args: unknown[]) => {
        pushed.push(args)
      },
      replaceState: () => {},
    } as unknown as Pick<History, 'pushState' | 'replaceState'>
    host = { history: { ...base }, bus: new EventTarget(), flags: {} }

    seen = []
    host.bus.addEventListener(ROUTE_EVENT, (event) => {
      seen.push(String((event as CustomEvent<unknown>).detail))
    })
  })

  it('pushState가 원본을 호출하고 전환을 방송한다', () => {
    hookRoute(host)
    host.history.pushState(null, '', '/next')

    expect(pushed).toHaveLength(1)
    expect(seen).toEqual(['navigate'])
  })

  it('원복하면 history가 원본 함수로 되돌아가고 방송이 멈춘다', () => {
    const unhook = hookRoute(host)
    expect(host.history.pushState).not.toBe(base.pushState)

    unhook()

    expect(host.history.pushState).toBe(base.pushState)
    expect(host.history.replaceState).toBe(base.replaceState)

    host.history.pushState(null, '', '/next')
    expect(pushed).toHaveLength(1) // 원본은 여전히 동작한다
    expect(seen).toEqual([]) // 방송은 없다
  })

  it('원복하면 popstate 구독도 해제된다', () => {
    vi.useFakeTimers()
    const unhook = hookRoute(host)
    host.bus.dispatchEvent(new Event('popstate'))
    vi.runAllTimers()
    expect(seen).toEqual(['back_forward'])

    unhook()
    host.bus.dispatchEvent(new Event('popstate'))
    vi.runAllTimers()
    expect(seen).toEqual(['back_forward'])
    vi.useRealTimers()
  })

  /**
   * 브라우저가 dispatch한 이벤트는 리스너마다 마이크로태스크를 비운다. 같은 태스크 안에서
   * 방송하면 뒤에 등록된 게스트의 `popstate` 핸들러보다 먼저 `document.title`을 읽는다.
   */
  it('popstate는 다음 태스크에서 방송한다 — 같은 popstate의 다른 리스너가 먼저 끝난다', async () => {
    vi.useFakeTimers()
    hookRoute(host)
    host.bus.dispatchEvent(new Event('popstate'))

    await Promise.resolve()
    expect(seen).toEqual([])

    vi.runAllTimers()
    expect(seen).toEqual(['back_forward'])
    vi.useRealTimers()
  })

  it('뒤에 등록된 popstate 리스너가 바꾼 값을 방송 수신 측이 본다', () => {
    vi.useFakeTimers()
    let title = '이전 화면'
    const read: string[] = []
    hookRoute(host)
    host.bus.addEventListener('popstate', () => {
      title = '돌아온 화면'
    })
    host.bus.addEventListener(ROUTE_EVENT, () => read.push(title))

    host.bus.dispatchEvent(new Event('popstate'))
    vi.runAllTimers()

    expect(read).toEqual(['돌아온 화면'])
    vi.useRealTimers()
  })

  /**
   * App Router는 popstate를 처리하는 같은 태스크 안에서 현재 URL로 `replaceState`를 부른다.
   * 그 호출을 `navigate`로 방송하면 tracker가 먼저 기록하고, 미룬 `back_forward`는 같은 URL로 버려진다.
   */
  it('popstate 직후 같은 태스크의 replaceState는 방송하지 않는다 — back_forward 1건만 나간다', () => {
    vi.useFakeTimers()
    hookRoute(host)
    host.bus.dispatchEvent(new Event('popstate'))
    host.history.replaceState(null, '', '/back')
    expect(seen).toEqual([])

    vi.runAllTimers()
    expect(seen).toEqual(['back_forward'])
    vi.useRealTimers()
  })

  /**
   * Pages Router는 hydration 때 등록한 자기 popstate 리스너 안에서 동기로 `replaceState`를 부른다.
   * 그 리스너가 우리보다 먼저라 구간 표시가 아직 없다 — 지금 처리 중인 이벤트로 판정한다.
   */
  it('먼저 등록된 popstate 리스너 안의 replaceState도 방송하지 않는다', () => {
    vi.useFakeTimers()
    let current: Event | undefined
    host.event = () => current
    host.bus.addEventListener('popstate', (event) => {
      current = event
      host.history.replaceState(null, '', '/back')
      current = undefined
    })
    hookRoute(host)

    host.bus.dispatchEvent(new Event('popstate'))
    expect(seen).toEqual([])

    vi.runAllTimers()
    expect(seen).toEqual(['back_forward'])
    vi.useRealTimers()
  })

  it('처리 중인 이벤트가 popstate가 아니면 replaceState를 navigate로 방송한다', () => {
    host.event = () => new Event('click')
    hookRoute(host)
    host.history.replaceState(null, '', '/next')
    expect(seen).toEqual(['navigate'])
  })

  it('popstate 밖의 replaceState는 navigate로 방송한다', () => {
    hookRoute(host)
    host.history.replaceState(null, '', '/next')
    expect(seen).toEqual(['navigate'])
  })

  it('popstate 직후라도 pushState는 navigate로 방송한다 — 새 전환이다', () => {
    vi.useFakeTimers()
    hookRoute(host)
    host.bus.dispatchEvent(new Event('popstate'))
    host.history.pushState(null, '', '/elsewhere')
    expect(seen).toEqual(['navigate'])

    vi.runAllTimers()
    expect(seen).toEqual(['navigate', 'back_forward'])
    vi.useRealTimers()
  })

  it('back_forward 방송 뒤에 온 replaceState는 navigate로 방송한다 — Pages Router 경로', () => {
    vi.useFakeTimers()
    hookRoute(host)
    host.bus.dispatchEvent(new Event('popstate'))
    vi.runAllTimers()
    host.history.replaceState(null, '', '/back')

    expect(seen).toEqual(['back_forward', 'navigate'])
    vi.useRealTimers()
  })

  it('방송 전에 원복하면 popstate 방송을 하지 않는다 — 정지 후 page_view 누수 가드', () => {
    vi.useFakeTimers()
    const unhook = hookRoute(host)
    host.bus.dispatchEvent(new Event('popstate'))
    unhook()
    vi.runAllTimers()

    expect(seen).toEqual([])
    vi.useRealTimers()
  })

  it('원복 후 다시 후킹할 수 있다 — 가드 플래그가 지워진다', () => {
    hookRoute(host)()
    expect(host.flags).toEqual({})

    hookRoute(host)
    host.history.pushState(null, '', '/next')
    expect(seen).toEqual(['navigate'])
  })

  it('이미 후킹돼 있으면 두 번 패치하지 않는다 — page_view 2배 발화 가드', () => {
    hookRoute(host)
    hookRoute(host)

    host.history.pushState(null, '', '/next')
    expect(seen).toEqual(['navigate'])
  })

  /**
   * 우리가 패치한 뒤에 다른 코드가 다시 감쌀 수 있다 — 무조건 원복하면 그쪽 래퍼가
   * 사라져 라우트 추적이 죽는다.
   */
  it('나중에 남이 우리 위를 감쌌으면 원복하지 않는다', () => {
    const unhook = hookRoute(host)

    let theirCalls = 0
    const ourWrap = host.history.pushState
    const theirWrap = function (this: History, ...args: Parameters<History['pushState']>) {
      theirCalls++
      return ourWrap.apply(this, args)
    }
    host.history.pushState = theirWrap

    unhook()

    expect(host.history.pushState).toBe(theirWrap) // 남의 래퍼가 살아 있다
    expect(host.history.pushState).not.toBe(base.pushState)

    host.history.pushState(null, '', '/next')
    expect(theirCalls).toBe(1) // 남의 로직이 계속 돈다
    expect(pushed).toHaveLength(1) // 원본도 계속 불린다
  })

  /**
   * 되돌리지 못한 우리 래퍼가 계속 방송하면 다음 후킹의 새 래퍼와 함께 두 번 방송해
   * `page_view`가 2배가 된다.
   */
  it('원복하지 못한 우리 래퍼는 더 이상 방송하지 않는다', () => {
    const unhook = hookRoute(host)
    const ourWrap = host.history.pushState
    host.history.pushState = function (this: History, ...args: Parameters<History['pushState']>) {
      return ourWrap.apply(this, args)
    }

    unhook()
    host.history.pushState(null, '', '/silent')
    expect(seen).toEqual([]) // 남아 있어도 방송은 없다

    // 재후킹 후에도 pushState 1회당 방송 1건이어야 한다
    hookRoute(host)
    host.history.pushState(null, '', '/again')
    expect(seen).toEqual(['navigate'])
  })

  /**
   * 소유권 규칙의 핵심. SDK가 두 번 로드된 상황에서 나중에 로드된 쪽이 원복하면 먼저
   * 설치한 쪽의 라우트 추적이 죽는다.
   */
  it('남이 설치한 패치는 원복하지 못한다', () => {
    hookRoute(host) // 소유자
    const foreign = hookRoute(host) // 두 번째 호출자 — no-op을 받는다

    foreign()

    expect(host.flags).toHaveProperty('__bstageRouteHook')
    host.history.pushState(null, '', '/next')
    expect(seen).toEqual(['navigate']) // 소유자의 패치가 살아 있다
  })
})

describe('onRoute', () => {
  let host: RouteHost

  beforeEach(() => {
    host = { history: {} as RouteHost['history'], bus: new EventTarget(), flags: {} }
  })

  function notify(detail: unknown): void {
    host.bus.dispatchEvent(new CustomEvent(ROUTE_EVENT, { detail }))
  }

  it('전환을 마이크로태스크 뒤에 전달한다', async () => {
    const got: string[] = []
    onRoute((loadType) => got.push(loadType), { host })

    notify('navigate')
    expect(got).toEqual([]) // 동기적으로는 오지 않는다

    await Promise.resolve()
    expect(got).toEqual(['navigate'])
  })

  it('아는 loadType이 아니면 무시한다', async () => {
    const got: string[] = []
    onRoute((loadType) => got.push(loadType), { host })

    notify('teleport')
    notify({ loadType: 'navigate' })

    await Promise.resolve()
    expect(got).toEqual([])
  })

  it('signal을 abort하면 더 이상 전달하지 않는다', async () => {
    const abort = new AbortController()
    const got: string[] = []
    onRoute((loadType) => got.push(loadType), { host, signal: abort.signal })

    notify('navigate')
    await Promise.resolve()
    expect(got).toEqual(['navigate'])

    abort.abort()
    notify('back_forward')
    await Promise.resolve()
    expect(got).toEqual(['navigate'])
  })
})
