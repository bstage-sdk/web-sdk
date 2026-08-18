// ---------------------------------------------------------------
// bstage 디자인 토큰 — 공용 타입
// ---------------------------------------------------------------

/** Light / Dark 값 쌍 (테마 대응 색·그림자) */
export interface ColorPair {
  light: string
  dark: string
}

/** 그림자 값 쌍 */
export interface ShadowPair {
  light: string
  dark: string
}

/** 타이포그래피 값 (font-weight 제외 — weight는 별도) */
export interface TypographyValue {
  fontSize: string
  lineHeight: string
  letterSpacing: string
}

/** textStyle() 반환 — 인라인 스타일 객체 */
export interface TextStyleResult {
  fontSize: string
  lineHeight: string
  fontWeight: number
  letterSpacing: string
}
