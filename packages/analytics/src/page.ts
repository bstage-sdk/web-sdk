import { UTM_MAX, clip } from './limits.js'
import { mask, maskUrl } from './mask.js'
import type { LoadType, Page } from './types.js'
import { uuid } from './uuid.js'

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const

/** `readUtm`이 싣는 키. ⛔ `PageViewParams`의 `utm_*`와 같은 이름이어야 한다 */
export type Utm = Partial<Record<(typeof UTM_KEYS)[number], string>>

export function readPage(logicalRef?: string): Page {
  const { href, pathname } = location
  return {
    url: mask(href),
    // ⚠️ `pathname`도 마스킹을 지난다 — 길이 상한(`MASK_MAX`)이 함께 딸려 오고,
    // 경로에 실려 오는 리셋 토큰류도 같은 규칙으로 처리된다.
    path: mask(pathname),
    title: maskUrl(document.title),
    ref: maskUrl(document.referrer || undefined),
    logicalRef: maskUrl(logicalRef),
    viewId: uuid(),
  }
}

export function readUtm(search: string): Utm {
  const query = new URLSearchParams(search)
  const utm: Utm = {}
  for (const key of UTM_KEYS) {
    const value = query.get(key)
    // 쿼리 값은 방문 링크가 통제하므로 길이에 상한이 없다
    if (value) utm[key] = clip(value, UTM_MAX, key)
  }
  return utm
}

export function readLoad(): LoadType {
  const entry = performance?.getEntriesByType?.('navigation')[0] as { type?: string } | undefined
  return entry?.type === 'reload' || entry?.type === 'back_forward' ? entry.type : 'navigate'
}
