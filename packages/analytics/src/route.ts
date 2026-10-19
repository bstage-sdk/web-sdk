import type { LoadType } from './types.js'

export const ROUTE_EVENT = 'bstage:route'

const HOOK_FLAG = '__bstageRouteHook'

export interface RouteHost {
  history: Pick<History, 'pushState' | 'replaceState'>
  bus: EventTarget
  flags: Record<string, unknown>
  /** 지금 dispatch 중인 이벤트(`window.event`) */
  event?: () => Event | undefined
}

function browserHost(): RouteHost {
  return {
    history,
    bus: window,
    flags: window as unknown as Record<string, unknown>,
    event: () => window.event,
  }
}

export function hookRoute(host: RouteHost = browserHost()): () => void {
  if (host.flags[HOOK_FLAG]) return () => {}
  host.flags[HOOK_FLAG] = true

  let alive = true
  let popping = false
  const inPop = () => popping || host.event?.()?.type === 'popstate'
  const originals = {} as Pick<History, 'pushState' | 'replaceState'>
  const mine = {} as Pick<History, 'pushState' | 'replaceState'>
  for (const name of ['pushState', 'replaceState'] as const) {
    const original = host.history[name]
    originals[name] = original
    const patched = function (this: History, ...args: Parameters<History['pushState']>) {
      const result = original.apply(this, args)
      if (alive && !(name === 'replaceState' && inPop())) notify(host, 'navigate')
      return result
    }
    mine[name] = patched
    host.history[name] = patched
  }

  const abort = new AbortController()
  // ⛔ 다음 태스크로 미룬다 — 브라우저가 dispatch한 이벤트는 리스너마다 마이크로태스크를
  // 비우므로, 같은 태스크에서 방송하면 뒤에 등록된 게스트 핸들러가 제목을 바꾸기 전에 읽는다.
  // ⛔ 그 사이 Next가 현재 URL로 부르는 `replaceState`는 방송하지 않는다 — 먼저 기록되면 미룬
  // `back_forward`가 같은 URL로 버려진다. Pages Router는 우리보다 먼저 등록된 리스너 안에서 부르므로
  // `popping`과 함께 `window.event`로도 판정한다(`window`에서는 capture로 순서를 바꿀 수 없다).
  host.bus.addEventListener(
    'popstate',
    () => {
      popping = true
      setTimeout(() => {
        popping = false
        if (alive) notify(host, 'back_forward')
      })
    },
    { signal: abort.signal },
  )

  return () => {
    alive = false
    for (const name of ['pushState', 'replaceState'] as const) {
      if (host.history[name] === mine[name]) host.history[name] = originals[name]
    }
    abort.abort()
    delete host.flags[HOOK_FLAG]
  }
}

export function onRoute(
  fn: (loadType: LoadType) => void,
  opts: { signal?: AbortSignal; host?: RouteHost } = {},
): void {
  const host = opts.host ?? browserHost()
  host.bus.addEventListener(
    ROUTE_EVENT,
    (event) => {
      const detail = (event as CustomEvent<unknown>).detail
      if (!isLoadType(detail)) return
      Promise.resolve().then(() => fn(detail))
    },
    { signal: opts.signal },
  )
}

const LOAD_TYPES: readonly LoadType[] = ['navigate', 'reload', 'back_forward']

function isLoadType(value: unknown): value is LoadType {
  return typeof value === 'string' && (LOAD_TYPES as readonly string[]).includes(value)
}

function notify(host: RouteHost, loadType: LoadType): void {
  host.bus.dispatchEvent(new CustomEvent<LoadType>(ROUTE_EVENT, { detail: loadType }))
}
