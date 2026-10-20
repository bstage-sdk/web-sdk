import { BridgeError } from '../protocol/errors.js'

/** placement당 키 수 상한. */
export const STORAGE_MAX_KEYS = 50
/** 값 상한(문자열 길이, 브리지 프로토콜의 4KB). */
export const STORAGE_MAX_VALUE_LENGTH = 4096
/** 키 길이 상한 — 프로토콜에 정해지지 않은 값(구현 선택). */
export const STORAGE_MAX_KEY_LENGTH = 200

type Store = Readonly<Record<string, string>>

/**
 * placement 스코프 메모리 저장소. 같은 페이지 세션에서 같은 placement 프레임이 다시 마운트되면
 * 값을 이어 쓴다(페이지를 새로 열면 사라진다). 브라우저 storage에는 쓰지 않는다.
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

export function handleStorage(scope: string, req: StorageRequest): { value: string | null } {
  const { op, key, value } = req
  if (typeof key !== 'string' || key.length === 0 || key.length > STORAGE_MAX_KEY_LENGTH) {
    throw new BridgeError('BAD_REQUEST', 'invalid storage key')
  }
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
    if (typeof value !== 'string' || value.length > STORAGE_MAX_VALUE_LENGTH) {
      throw new BridgeError('BAD_REQUEST', 'invalid storage value')
    }
    if (!has && Object.keys(current).length >= STORAGE_MAX_KEYS) {
      throw new BridgeError('BAD_REQUEST', 'storage key limit reached')
    }
    stores = new Map([...stores, [scope, { ...current, [key]: value }]])
    return { value }
  }

  throw new BridgeError('BAD_REQUEST', 'invalid storage op')
}
