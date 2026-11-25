// ---------------------------------------------------------------
// @bstage-sdk/design/user — 유저(유저 플랫폼) 디자인 토큰
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
const PREFIX = 'user'

/**
 * picker 색 → 스테이지 컬러 변수. 운영자가 스테이지 디자인 설정에서 고른 버튼·버튼 텍스트·스타 컬러를
 * 플랫폼이 이 이름으로 `:root`에 깐다(플랫폼 프런트엔드의 `color('picker/...')`도 같은 변수를 쓴다).
 * 토큰은 이 변수를 먼저 보고, 없으면 `--user-picker-*` 기본값으로 떨어진다.
 */
export const stageColorVars = Object.freeze({
  'picker/button': '--button-color',
  'picker/button-weak-a': '--button-weak-a-color',
  'picker/on-button': '--button-text-color',
  'picker/star': '--star-color',
} as const satisfies Partial<Record<keyof typeof flatColors, string>>)

function stageColorRef(slug: string): string | undefined {
  const name = (stageColorVars as Readonly<Record<string, string>>)[slug]
  return name ? `var(${name}, ${cssVarRef(slug, PREFIX, 'flat')})` : undefined
}

/** buildColorTree 결과에서 picker 잎만 스테이지 컬러 참조로 바꾼 새 트리. */
function withStageColors(
  tree: Record<string, Record<string, string>>,
): Record<string, Record<string, string>> {
  const picker = tree.picker ?? {}
  const stagePicker = Object.fromEntries(
    Object.entries(picker).map(([leaf, ref]) => [leaf, stageColorRef(`picker/${leaf}`) ?? ref]),
  )
  return { ...tree, picker: stagePicker }
}

/**
 * 색 토큰 — 카테고리별 중첩. 예: `color.text.secondary` === `'var(--user-mode-text-secondary)'`.
 * picker는 스테이지 컬러를 따른다: `color.picker.button` === `'var(--button-color, var(--user-picker-button))'`.
 */
export const color = withStageColors(buildColorTree(modeColors, flatColors, PREFIX))

/** 그림자 — 예: `shadow['default-large']` === `'var(--user-mode-shadow-default-large)'` */
export const shadow = buildShadowRefs(shadowTokens, PREFIX)

export type UserColorSlug = keyof typeof modeColors | keyof typeof flatColors
export type UserTypographyToken = keyof typeof typographyTokens
export type UserFontWeight = keyof typeof fontWeightMap

/** slug → `var(--user-...)` (타입 안전). 예: `cssVar('text/secondary')` */
export function cssVar(slug: UserColorSlug): string {
  const stage = stageColorRef(slug as string)
  if (stage) return stage
  return (slug as string) in modeColors
    ? cssVarRef(slug as string, PREFIX, 'mode')
    : cssVarRef(slug as string, PREFIX, 'flat')
}

/** 타이포그래피 → 인라인 스타일. 예: `textStyle('16/title/semibold')` */
export function textStyle(
  token: `${UserTypographyToken & string}/${UserFontWeight & string}`,
): TextStyleResult {
  return resolveTextStyle(typographyTokens, fontWeightMap, token)
}

/**
 * dev fallback CSS (`:root`-scoped, light + dark).
 * build-css 및 `bstage dev`의 호스트 `:root` 주입에 사용된다.
 * 프로덕션 번들에는 포함하지 않는다.
 */
export function renderCss(): string {
  return renderFallbackCss(
    { modeColors, flatColors, shadowTokens, fontFamily },
    { prefix: PREFIX, dark: true },
  )
}

/**
 * 격리 프레임(srcdoc) 문서용 토큰 CSS (`:root`-scoped, light + dark 토글).
 * 프레임은 호스트 `:root`를 상속하지 못해 값을 문서 안에 직접 깐다. `renderCss`와 달리
 * OS 다크 설정을 따르지 않고 `html.dark`로만 다크가 된다(호스트와 같은 규칙, 브리지 부트스트랩이 토글).
 * 브리지 `createSrcdoc`가 인라인해 쓴다.
 */
export function renderFrameCss(): string {
  return renderFallbackCss(
    { modeColors, flatColors, shadowTokens, fontFamily },
    { prefix: PREFIX, dark: true, target: 'frame' },
  )
}
