import { BridgeError } from '../protocol/errors.js'

/** placement당 키 수 상한. */
export const STORAGE_MAX_KEYS = 50
/** 값 상한(문자열 길이, 브리지 프로토콜의 4KB). */
export const STORAGE_MAX_VALUE_LENGTH = 4096
/** 키 길이 상한 — 프로토콜에 정해지지 않은 값(구현 선택). */
export const STORAGE_MAX_KEY_LENGTH = 200

type Store = Readonly<Record<string, string>>

/**
 * 호스트가 주입하는 storage 저장소(`CreateBridgeHostOptions.storageBackend`). 동기 API다.
 * 키는 브리지가 만든 전체 키(`${scope}\u0000${key}`)이고, `keys(prefix)`는 그 접두사로 시작하는 **전체 키**를
 * 돌려준다. 예외를 던지면 브리지가 처리한다 — set은 `STORAGE_UNAVAILABLE`, get은 없음(null), remove는 무시.
 */
export interface StorageBackend {
  get(key: string): string | null
  set(key: string, value: string): void
  remove(key: string): void
  keys(prefix: string): readonly string[]
}

/**
 * placement 스코프 저장소. 기본은 이 모듈의 메모리다 — 같은 페이지 세션에서 같은 placement 프레임이 다시
 * 마운트되면 값을 이어 쓰고, 페이지를 새로 열면 사라진다(브라우저 storage에는 쓰지 않는다). 호스트가
 * `storageBackend`를 주입하면 그 저장소에 쓰므로 리로드 뒤에도 남을 수 있다. 어느 쪽이든 템플릿이 읽고
 * 쓰는 값이라 토큰·시크릿·개인정보를 담지 않는다.
 */
let stores: ReadonlyMap<string, Store> = new Map()

/** @internal 테스트 전용. */
export function __resetBridgeStorage__(): void {
  stores = new Map()
}

export interface StorageRequest {
  readonly op?: unknown
  readonly key?: unknown
  readonly value?: unknown
}

function assertKey(key: unknown): asserts key is string {
  if (typeof key !== 'string' || key.length === 0 || key.length > STORAGE_MAX_KEY_LENGTH) {
    throw new BridgeError('BAD_REQUEST', 'invalid storage key')
  }
}

function assertValue(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length > STORAGE_MAX_VALUE_LENGTH) {
    throw new BridgeError('BAD_REQUEST', 'invalid storage value')
  }
}

const KEY_LIMIT = (): BridgeError => new BridgeError('BAD_REQUEST', 'storage key limit reached')
const UNAVAILABLE = (): BridgeError => new BridgeError('STORAGE_UNAVAILABLE', 'storage unavailable')

/**
 * 주입 저장소 경로. 스코프 구분자(`\u0000`)가 든 키는 거절한다 — 다른 placement 접두사와 겹치는 키를
 * 만들 수 없게 한다(메모리 경로는 스코프별 객체라 해당 없음).
 */
function handleBackendStorage(
  backend: StorageBackend,
  scope: string,
  req: StorageRequest,
): { value: string | null } {
  const { op, key, value } = req
  assertKey(key)
  if (key.includes('\u0000')) throw new BridgeError('BAD_REQUEST', 'invalid storage key')
  const prefix = `${scope}\u0000`
  const fullKey = prefix + key

  if (op === 'get') {
    try {
      const stored = backend.get(fullKey)
      return { value: typeof stored === 'string' ? stored : null }
    } catch {
      return { value: null }
    }
  }

  if (op === 'remove') {
    try {
      backend.remove(fullKey)
    } catch {
      // 지우지 못해도 프레임이 할 수 있는 것이 없다.
    }
    return { value: null }
  }

  if (op === 'set') {
    assertValue(value)
    let existing: readonly string[]
    try {
      existing = backend.keys(prefix)
    } catch {
      throw UNAVAILABLE()
    }
    if (!existing.includes(fullKey) && existing.length >= STORAGE_MAX_KEYS) throw KEY_LIMIT()
    try {
      backend.set(fullKey, value)
    } catch {
      // 저장소 예외 메시지(용량·정책)는 싣지 않는다.
      throw UNAVAILABLE()
    }
    return { value }
  }

  throw new BridgeError('BAD_REQUEST', 'invalid storage op')
}

export function handleStorage(
  scope: string,
  req: StorageRequest,
  backend?: StorageBackend,
): { value: string | null } {
  if (backend) return handleBackendStorage(backend, scope, req)
  const { op, key, value } = req
  assertKey(key)
  const current: Store = stores.get(scope) ?? {}
  const has = Object.prototype.hasOwnProperty.call(current, key)

  if (op === 'get') return { value: has ? current[key] : null }

  if (op === 'remove') {
    if (has) {
      const next = Object.fromEntries(Object.entries(current).filter(([k]) => k !== key))
      stores = new Map([...stores, [scope, next]])
    }
    return { value: null }
  }

  if (op === 'set') {
    assertValue(value)
    if (!has && Object.keys(current).length >= STORAGE_MAX_KEYS) throw KEY_LIMIT()
    stores = new Map([...stores, [scope, { ...current, [key]: value }]])
    return { value }
  }

  throw new BridgeError('BAD_REQUEST', 'invalid storage op')
}
