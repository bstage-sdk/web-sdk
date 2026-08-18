// ---------------------------------------------------------------
// bstage 디자인 토큰 — textStyle 로직 (타깃 공용)
// ---------------------------------------------------------------

import { devWarnOnce } from './devWarn.js'
import type { TextStyleResult, TypographyValue } from './types.js'

/**
 * 타이포그래피 토큰을 인라인 스타일 객체로 해석한다.
 *
 * - user: typographyTokens 키 = `{size}/{role}` (2-part), weight는 별도 → 토큰 `{size}/{role}/{weight}`
 * - admin: typographyTokens 키 = `{size}/{role}/{weight}` (3-part), 토큰과 동일
 *
 * 두 형태를 모두 지원: 전체 토큰 키로 먼저 찾고, 없으면 마지막 `/` 앞(base)으로 찾는다.
 * font-weight는 weight 이름(예: `med-link`의 base `med`)으로 매핑한다.
 */
export function resolveTextStyle(
  typographyTokens: Record<string, TypographyValue>,
  fontWeightMap: Record<string, number>,
  token: string,
): TextStyleResult {
  const lastSlash = token.lastIndexOf('/')
  const base = token.slice(0, lastSlash)
  const weight = token.slice(lastSlash + 1)

  const typo = typographyTokens[token] ?? typographyTokens[base]
  if (!typo) {
    throw new Error(
      `[bstage-design] 알 수 없는 타이포그래피 토큰: "${token}". ` +
        `사용 가능: ${Object.keys(typographyTokens).join(', ')}`,
    )
  }

  const weightBase = weight.split('-')[0]
  const resolvedWeight = fontWeightMap[weight] ?? fontWeightMap[weightBase]

  // 모르는 weight는 400으로 떨어진다 — 타입으로 막혀 있지만 `bstage build`는 tsc를 타지 않아
  // 오타가 런타임까지 흘러온다. 프로덕션에서 던지면 굵기 오타 하나로 위젯 렌더가 멈추므로
  // 폴백은 유지하고, 고칠 수 있는 시점(개발 중)에만 드러낸다.
  if (resolvedWeight === undefined && process.env.NODE_ENV !== 'production') {
    devWarnOnce(
      `textStyle:weight:${weight}`,
      `알 수 없는 font weight: "${weight}" (토큰 "${token}"). 400으로 대체합니다. ` +
        `사용 가능: ${Object.keys(fontWeightMap).join(', ')}`,
    )
  }

  return {
    fontSize: typo.fontSize,
    lineHeight: typo.lineHeight,
    fontWeight: resolvedWeight ?? 400,
    letterSpacing: typo.letterSpacing,
  }
}
