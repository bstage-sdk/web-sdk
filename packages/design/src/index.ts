// ---------------------------------------------------------------
// @bstage-sdk/design
//
// 타깃별 토큰은 서브패스로 import 한다:
//   import { color, textStyle } from '@bstage-sdk/design/user'
//   import { color, textStyle } from '@bstage-sdk/design/admin'
//
// 루트(이 파일)는 공용 타입만 노출한다.
// ---------------------------------------------------------------

export type { ColorPair, ShadowPair, TypographyValue, TextStyleResult } from './shared/types.js'
