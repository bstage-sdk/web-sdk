// ---------------------------------------------------------------
// @bstage-sdk/design/admin — 어드민(어드민 플랫폼) 디자인 토큰
// 어드민은 Light 전용 (다크모드 없음)
// ---------------------------------------------------------------

import {
  modeColors,
  flatColors,
  shadowTokens,
  typographyTokens,
  fontWeightMap,
  fontFamily,
} from './tokens.generated.js'
import {
  buildColorTree,
  buildShadowRefs,
  cssVarRef,
  renderFallbackCss,
} from '../shared/generator.js'
import { resolveTextStyle } from '../shared/text-style.js'
import type { TextStyleResult } from '../shared/types.js'

export { modeColors, flatColors, shadowTokens, typographyTokens, fontWeightMap, fontFamily }
export type { ColorPair, ShadowPair, TypographyValue, TextStyleResult } from '../shared/types.js'

/** CSS 변수 접두사 (FE 프로덕션과 동일) */
const PREFIX = 'admin'

/** 색 토큰 — 카테고리별 중첩. 예: `color.text.primary` === `'var(--admin-mode-text-primary)'` */
export const color = buildColorTree(modeColors, flatColors, PREFIX)

/** 그림자 — 예: `shadow['default-large']` === `'var(--admin-mode-shadow-default-large)'` */
export const shadow = buildShadowRefs(shadowTokens, PREFIX)

export type AdminColorSlug = keyof typeof modeColors | keyof typeof flatColors
/** 어드민 타이포 토큰 — 3-part 키 `{size}/{role}/{weight}` */
export type AdminTypographyToken = keyof typeof typographyTokens

/** slug → `var(--admin-...)` (타입 안전). 예: `cssVar('text/primary')` */
export function cssVar(slug: AdminColorSlug): string {
  return (slug as string) in modeColors
    ? cssVarRef(slug as string, PREFIX, 'mode')
    : cssVarRef(slug as string, PREFIX, 'flat')
}

/** 타이포그래피 → 인라인 스타일. 예: `textStyle('16/title/med')` */
export function textStyle(token: AdminTypographyToken & string): TextStyleResult {
  return resolveTextStyle(typographyTokens, fontWeightMap, token)
}

/**
 * dev fallback CSS (`:root`-scoped, light 전용 — 어드민은 다크모드 없음).
 * build-css 및 `bstage dev`의 호스트 `:root` 주입에 사용된다.
 */
export function renderCss(): string {
  return renderFallbackCss(
    { modeColors, flatColors, shadowTokens, fontFamily },
    { prefix: PREFIX, dark: false },
  )
}
