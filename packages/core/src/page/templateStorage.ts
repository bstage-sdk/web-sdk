import { getFrameBridge } from '../frameBridge.js'

/** 키 길이 상한 — 브리지 호스트 storage와 같은 값. */
export const TEMPLATE_STORAGE_MAX_KEY_LENGTH = 200
/** 값 길이 상한(문자열 길이) — 브리지 호스트 storage와 같은 값. */
export const TEMPLATE_STORAGE_MAX_VALUE_LENGTH = 4096
/**
 * inline 모드 localStorage 키 접두사. 플랫폼은 로그아웃·세션 만료 때 `bstage:tpl:`로 시작하는 키를 지운다.
 * inline 템플릿은 호스트 문서에서 돌기 때문에 이 접두사 아래를 사이트의 다른 inline 템플릿과 함께 쓴다.
 */
export const INLINE_STORAGE_PREFIX = 'bstage:tpl:inline:'

/** 템플릿 storage. 값은 문자열만 받는다(객체는 `JSON.stringify`). */
export interface TemplateStorage {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  remove(key: string): Promise<void>
}

function assertKey(key: string): void {
  if (typeof key !== 'string' || key.length === 0 || key.length > TEMPLATE_STORAGE_MAX_KEY_LENGTH) {
    throw new TypeError('[bstage] storage: 키는 1~200자 문자열이어야 합니다')
  }
}

function assertValue(value: string): void {
  if (typeof value !== 'string' || value.length > TEMPLATE_STORAGE_MAX_VALUE_LENGTH) {
    throw new TypeError('[bstage] storage: 값은 4096자 이하 문자열이어야 합니다')
  }
}

function readValue(result: unknown): string | null {
  if (typeof result !== 'object' || result === null) return null
  const { value } = result as { value?: unknown }
  return typeof value === 'string' ? value : null
}

/** localStorage를 쓸 수 없는 환경(사파리 비공개 모드·차단 설정 등)의 대체 저장소. 페이지 수명 동안만 남는다. */
let inlineFallback: ReadonlyMap<string, string> = new Map()

/** @internal 테스트 전용. */
export function __resetInlineStorageFallback__(): void {
  inlineFallback = new Map()
}

function localStore(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage
  } catch {
    return undefined
  }
}

function inlineGet(key: string): string | null {
  const full = INLINE_STORAGE_PREFIX + key
  try {
    const store = localStore()
    if (store) return store.getItem(full)
  } catch {
    // 아래 대체 저장소로 내려간다.
  }
  return inlineFallback.get(full) ?? null
}

function inlineSet(key: string, value: string): void {
  const full = INLINE_STORAGE_PREFIX + key
  try {
    const store = localStore()
    if (store) {
      store.setItem(full, value)
      return
    }
  } catch {
    // 용량 초과·접근 거부 — 대체 저장소에 둔다.
  }
  inlineFallback = new Map([...inlineFallback, [full, value]])
}

function inlineRemove(key: string): void {
  const full = INLINE_STORAGE_PREFIX + key
  try {
    localStore()?.removeItem(full)
  } catch {
    // 지우기 실패는 무시한다.
  }
  if (inlineFallback.has(full)) {
    inlineFallback = new Map([...inlineFallback].filter(([k]) => k !== full))
  }
}

/**
 * 템플릿 storage — 격리 프레임과 inline에서 같은 코드로 쓴다.
 *
 * - 격리 프레임: 브리지 `storage` 요청. 페이지·위젯(placement) 단위로 나뉘고, 플랫폼이 영속 저장소를 붙인
 *   경우 새로고침 뒤에도 남는다. 상한은 placement당 키 50개·값 4KB. 호스트가 거절하면 `code`가 붙은 Error로 reject
 *   (`STORAGE_UNAVAILABLE`·`BAD_REQUEST` 등).
 * - inline: 브라우저 `localStorage`의 `bstage:tpl:inline:` 아래(쓸 수 없으면 페이지 수명 메모리).
 *
 * 플랫폼 origin의 다른 스크립트도 읽을 수 있는 저장소다 — 토큰·비밀번호·개인정보는 저장하지 않는다.
 */
export const templateStorage: TemplateStorage = Object.freeze({
  async get(key: string): Promise<string | null> {
    assertKey(key)
    const bridge = getFrameBridge()
    if (bridge) return readValue(await bridge.request('storage', { op: 'get', key }))
    return inlineGet(key)
  },
  async set(key: string, value: string): Promise<void> {
    assertKey(key)
    assertValue(value)
    const bridge = getFrameBridge()
    if (bridge) {
      await bridge.request('storage', { op: 'set', key, value })
      return
    }
    inlineSet(key, value)
  },
  async remove(key: string): Promise<void> {
    assertKey(key)
    const bridge = getFrameBridge()
    if (bridge) {
      await bridge.request('storage', { op: 'remove', key })
      return
    }
    inlineRemove(key)
  },
})
