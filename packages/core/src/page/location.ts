import { getFrameBridge, type FrameBridgeLike } from '../frameBridge.js'

/** 템플릿이 받는 호스트 페이지 위치. `query`는 호출마다 새로 만든 사본이다(고쳐도 다른 호출에 영향 없음). */
export interface PageLocation {
  readonly path: string
  readonly query: URLSearchParams
}

/** inline 모드에서 호스트가 위치 변화를 알리는 window 이벤트 이름. `detail: { path, search }`. */
export const PAGE_LOCATION_EVENT = 'bstage:page'

/** path·search 각각의 최대 길이 — 브리지 `PAGE_LOCATION_MAX_LENGTH`와 같은 값(core는 bridge에 의존하지 않는다). */
const MAX_LENGTH = 2048

interface RawLocation {
  readonly path: string
  readonly search: string
}

const EMPTY: RawLocation = Object.freeze({ path: '', search: '' })

/** 형식 검사 — 브리지 호스트(`toPageLocation`)와 같은 규칙. 맞으면 path·search만 담은 새 객체. */
function toRaw(value: unknown): RawLocation | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const { path, search } = value as Record<string, unknown>
  if (
    typeof path !== 'string' ||
    typeof search !== 'string' ||
    !path.startsWith('/') ||
    // `//host`·`/\\host`는 프로토콜 상대 URL — 템플릿이 href로 쓰면 외부로 나간다(브리지 toPageLocation과 같은 규칙).
    path.startsWith('//') ||
    path.startsWith('/\\') ||
    path.length > MAX_LENGTH ||
    (search !== '' && !search.startsWith('?')) ||
    search.length > MAX_LENGTH
  ) {
    return undefined
  }
  return { path, search }
}

function toLocation(raw: RawLocation): PageLocation {
  return { path: raw.path, query: new URLSearchParams(raw.search) }
}

// ── 격리 프레임 ──────────────────────────────────────────

/**
 * 브리지별 마지막 `page` 이벤트 값. 런타임 init 스냅샷이 page를 반영하지 않는(옛 부트스트랩) 경우에도
 * 최신 값을 주려고 core가 직접 구독해 둔다.
 */
const latestByBridge = new WeakMap<FrameBridgeLike, RawLocation>()

function watchFrame(bridge: FrameBridgeLike): void {
  if (latestByBridge.has(bridge)) return
  latestByBridge.set(bridge, EMPTY)
  bridge.on('page', (payload) => {
    const raw = toRaw(payload)
    if (raw) latestByBridge.set(bridge, raw)
  })
}

function readFrame(bridge: FrameBridgeLike): RawLocation {
  watchFrame(bridge)
  const fromEvent = latestByBridge.get(bridge)
  if (fromEvent && fromEvent !== EMPTY) return fromEvent
  // init.page가 없으면(호스트가 싣지 않는 배치·옛 호스트) 빈 위치.
  return toRaw(bridge.getInit()?.page) ?? EMPTY
}

// ── inline ───────────────────────────────────────────────

interface InlineWindow {
  readonly location?: { readonly pathname?: unknown; readonly search?: unknown }
  addEventListener?(type: string, fn: (ev: Event) => void): void
  removeEventListener?(type: string, fn: (ev: Event) => void): void
}

function inlineWindow(): InlineWindow {
  return globalThis as unknown as InlineWindow
}

function readInline(): RawLocation {
  const loc = inlineWindow().location
  return toRaw({ path: loc?.pathname, search: loc?.search }) ?? EMPTY
}

// ── 공개 API ─────────────────────────────────────────────

/**
 * 호스트 페이지의 현재 경로·쿼리.
 *
 * - 격리 프레임: 호스트가 init에 실은 `page`와 이후 `page` 이벤트. 호스트가 싣지 않는 배치(계정 세션 화면 등)나
 *   옛 호스트에서는 `{ path: '', query: 빈 URLSearchParams }`.
 * - inline: `window.location`의 pathname·search.
 *
 * 쿼리를 바꾸려면 `navigate({ path: '/x?id=1' })`처럼 경로에 쿼리를 붙여 이동한다.
 */
export function getPageLocation(): PageLocation {
  const bridge = getFrameBridge()
  return toLocation(bridge ? readFrame(bridge) : readInline())
}

/**
 * 호스트 페이지 위치가 바뀔 때마다 `cb`를 부른다. 해제 함수를 돌려준다.
 *
 * - 격리 프레임: 브리지 `page` 이벤트.
 * - inline: 호스트가 `window`에 내는 `bstage:page` CustomEvent(`detail: { path, search }`).
 *
 * 형식이 틀린 값은 건너뛴다. 처음 값은 부르지 않으므로 `getPageLocation()`으로 먼저 읽는다.
 */
export function onPageLocationChange(cb: (loc: PageLocation) => void): () => void {
  const bridge = getFrameBridge()
  if (bridge) {
    // 최신 값 보관 구독을 먼저 걸어, cb 안에서 getPageLocation()을 불러도 새 값이 나오게 한다.
    watchFrame(bridge)
    return bridge.on('page', (payload) => {
      const raw = toRaw(payload)
      if (raw) cb(toLocation(raw))
    })
  }
  const win = inlineWindow()
  if (typeof win.addEventListener !== 'function') return () => {}
  const listener = (ev: Event) => {
    const raw = toRaw((ev as CustomEvent).detail)
    if (raw) cb(toLocation(raw))
  }
  win.addEventListener(PAGE_LOCATION_EVENT, listener)
  return () => win.removeEventListener?.(PAGE_LOCATION_EVENT, listener)
}
