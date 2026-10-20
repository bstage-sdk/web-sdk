import type { EventParams, ReservedName } from './types.js'

export const NAME_MAX = 40
export const TEXT_MAX = 50
/** DOM 속성에서 원문으로 읽는 값(`click.id`·`section`·`impression.itemId`)의 절삭 길이 */
export const ATTR_MAX = 200
/** `utm_*` 값의 절삭 길이. GA4의 캠페인 파라미터 상한과 같다 */
export const UTM_MAX = 100

/** ⛔ `EVENT_MAX` < `BODY_MAX` 관계를 깨지 말 것 — `ship()`의 배치 분할이 수렴하지 않는다 */
export const EVENT_MAX = 16 * 1024

export const PARAM_LIMIT = {
  keys: 25,
  keyLength: 40,
  valueLength: 500,
} as const

export function checkParams(params: EventParams): string[] {
  const issues: string[] = []
  const keys = Object.keys(params)
  if (keys.length > PARAM_LIMIT.keys) {
    issues.push(`params key count ${keys.length} > ${PARAM_LIMIT.keys}`)
  }
  for (const key of keys) {
    if (key.length > PARAM_LIMIT.keyLength) {
      issues.push(`params key "${key}" length > ${PARAM_LIMIT.keyLength}`)
    }
    const value = params[key]
    if (typeof value === 'string' && value.length > PARAM_LIMIT.valueLength) {
      issues.push(`params value of "${key}" length > ${PARAM_LIMIT.valueLength}`)
    }
  }
  return issues
}

export function sizeOf(value: unknown): number | null {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length
  } catch {
    return null
  }
}

const clipped = new Set<string>()

/**
 * 자동 계측이 DOM·URL에서 원문으로 읽는 문자열을 상한에서 자른다.
 *
 * ⚠️ **`send()`의 "크기 초과는 드롭"과 섞지 말 것.** 그쪽은 고객사 `params` 객체 전체이고
 * (자르면 JSON이 깨진다) 이쪽은 SDK가 읽는 문자열 필드 하나다. 자동 계측을 드롭하면
 * 지표에 결번이 생기는데 `202` + `mode:'no-cors'`라 그 결번을 아무도 관측하지 못한다.
 */
export function clip(value: string, max: number, field: string): string {
  if (value.length <= max) return value
  if (!clipped.has(field)) {
    clipped.add(field)
    console.warn(`[bstage-analytics] E_ATTR_CLIPPED: "${field}" exceeds the ${max}-char limit`)
  }
  return value.slice(0, max)
}

/** ⛔ `runtime_error`는 발화부가 없어도 예약을 유지한다 — 적재 측이 이 이름에 의미를 준다 */
export const RESERVED: readonly ReservedName[] = [
  'page_view',
  'click',
  'impression',
  'scroll_depth',
  'runtime_error',
]

export function isReserved(name: unknown): boolean {
  return typeof name === 'string' && (RESERVED as readonly string[]).includes(name)
}

export function checkName(name: string): boolean {
  if (typeof name !== 'string') return false
  return name.length <= NAME_MAX && /^[a-z][a-z0-9_]*$/.test(name)
}
