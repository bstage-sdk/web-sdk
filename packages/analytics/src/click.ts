import { ATTR_MAX, PARAM_LIMIT, TEXT_MAX, clip } from './limits.js'
import type { ClickParams, EventParams } from './types.js'
import { mask, maskUrl } from './mask.js'

/** 명시 추적 대상 표시. 고객사가 붙인다 */
export const CLICK_ATTR = 'data-log-click'
/** 섹션 이름을 자동 추출하는 속성. 가장 가까운 조상에서 찾는다 */
export const SECTION_ATTR = 'data-log-section'
/** 고객사가 이벤트 이름을 지정하는 속성. 이것만 있으면 커스텀 이벤트가 발화한다 */
export const EVENT_ATTR = 'data-log-event'
/** 커스텀 이벤트에 함께 실을 값. 접두어 뒤가 params 키가 된다 */
export const PARAM_PREFIX = 'data-log-param-'

/** 클릭측정 대상. button, a 이외의 클릭 측정은 `data-log-click` attr 을 붙인다. */
const TARGET = `a, button, [${CLICK_ATTR}], [${EVENT_ATTR}]`

export interface ClickNode {
  tagName: string
  id: string
  textContent: string | null
  href?: string
  closest(selector: string): { getAttribute(name: string): string | null } | null
}

/** `readEvent`가 쓰는 DOM 표면. `Element`가 이 형태를 만족한다 */
export interface EventNode {
  getAttribute(name: string): string | null
  getAttributeNames(): string[]
  closest(selector: string): EventNode | null
}

/** 주의: compose: false 인 클릭은 감지되지 않음. (js) */
export function findTarget(event: Event): Element | null {
  for (const node of event.composedPath()) {
    if (node instanceof Element && node.matches(TARGET)) return node
  }
  const target = event.target
  return target instanceof Element ? target.closest(TARGET) : null
}

export function readClick(node: ClickNode, x: number, y: number): ClickParams {
  return {
    tag: node.tagName.toLowerCase(),
    id: node.id ? clip(node.id, ATTR_MAX, 'click.id') : undefined,
    text: readText(node),
    href: node.tagName === 'A' ? maskUrl(node.href) : undefined,
    x,
    y,
    section: readSection(node),
  }
}

/** 섹션 이름. `impression`도 이 reader를 그대로 쓴다 — 같은 키여야 조인이 성립한다 */
export function readSection(node: Pick<ClickNode, 'closest'>): string | undefined {
  const section = node.closest(`[${SECTION_ATTR}]`)?.getAttribute(SECTION_ATTR)
  return section ? clip(section, ATTR_MAX, SECTION_ATTR) : undefined
}

/**
 * 고객사가 지정한 이벤트 이름과 값. 이름이 없으면 null이다.
 *
 * ⛔ **이름 규칙·예약 이름 검사를 여기서 하지 않는다.** 결과를 `Tracker.send()`로 넘기면
 * `send()`가 이름 규칙·크기를, `record()`가 예약 이름을 검사한다 — 게스트가 쓴 문자열이
 * 그 두 관문을 반드시 지나야 하므로 `auto()`로 보내면 안 된다.
 */
export function readEvent(node: EventNode): { name: string; params?: EventParams } | null {
  const owner = node.closest(`[${EVENT_ATTR}]`)
  const name = owner?.getAttribute(EVENT_ATTR)?.trim()
  if (!owner || !name) return null
  return { name, params: readParams(owner) }
}

/** 이름을 선언한 요소의 `data-log-param-*`을 모은다. 값은 마스킹 후 상한에서 자른다 */
function readParams(owner: EventNode): EventParams | undefined {
  let params: EventParams | undefined
  let count = 0
  for (const attr of owner.getAttributeNames()) {
    if (!attr.startsWith(PARAM_PREFIX)) continue
    if (count >= PARAM_LIMIT.keys) break
    const key = toCamel(attr.slice(PARAM_PREFIX.length))
    const value = owner.getAttribute(attr)?.trim()
    if (!okKey(key) || !value) continue
    // 게스트 마크업이 통제하는 값이라 `click.text`와 같은 규칙을 적용한다
    params = { ...params, [key]: clip(mask(value), ATTR_MAX, PARAM_PREFIX) }
    count += 1
  }
  return params
}

/** 오염에 쓰이는 키. 이름 규칙을 통과하므로 따로 막는다 */
const UNSAFE_KEYS: readonly string[] = ['constructor', 'prototype', '__proto__']

/**
 * ⛔ **키를 값처럼 자르면 안 된다 — 규칙에 맞지 않으면 버린다.** 키는 그대로 JSON 필드명이
 * 되어 적재까지 가므로, 게스트 마크업이 데이터셋 스키마를 좌우하게 된다. `checkParams()`는
 * 경고만 하고 드롭하지 않아 여기서 막지 않으면 통과한다.
 *
 * ⛔ **소문자로 시작해야 하고, 오염 키 검사는 소문자로 비교한다.** 둘 다 필요하다 —
 * `toCamel`이 선행 하이픈까지 소비해 `-constructor`가 `Constructor`가 되고(첫 글자 규칙이
 * 막는다), `con-structor`는 `conStructor`가 되어 **소문자로 정규화하는 소비자에게** 오염
 * 키가 된다(소문자 비교가 막는다). 기존 params가 전부 소문자로 시작하는 것과도 맞는다.
 *
 * ⚠️ SDK 프로토타입 자체는 오염되지 않는다 — 이 파일의 대입은 computed key다. 막는 이유는
 * `params`를 객체에 merge하는 **하위 소비자 보호**다.
 */
function okKey(key: string): boolean {
  if (key.length === 0 || key.length > PARAM_LIMIT.keyLength) return false
  if (UNSAFE_KEYS.includes(key.toLowerCase())) return false
  return /^[a-z][a-zA-Z0-9_]*$/.test(key)
}

/** `item-id` → `itemId`. 기존 params가 camelCase라 맞춘다 */
function toCamel(key: string): string {
  return key.replace(/-([a-z0-9])/g, (_, char: string) => char.toUpperCase())
}

function readText(node: ClickNode): string | undefined {
  const text = node.textContent?.replace(/\s+/g, ' ').trim()
  if (!text) return undefined
  // mask 가 slice 보다 먼저: 먼저 slice 시 민감정보 필터링에 실패할 수 있음
  return mask(text).slice(0, TEXT_MAX)
}
