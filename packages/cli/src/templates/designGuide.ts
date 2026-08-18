/**
 * bstage 디자인 토큰 가이드 생성기.
 *
 * `bstage init` / `bstage skills install`이 생성하는 에이전트 문서(AGENTS.md 관리 영역,
 * bstage-template 스킬)에 삽입할 "디자인 토큰 사용 규칙"을 타깃별(user/admin)로 렌더링한다.
 *
 * 목적: 바이브코딩 에이전트가 색·타이포·그림자를 임의 값으로 하드코딩하지 않고
 * `@bstage-sdk/design`의 토큰만 쓰도록("이 토큰만·이 스케일만") 유도한다.
 *
 * - 값은 플랫폼이 런타임에 `:root`로 주입하고, 로컬은 `bstage dev`가 fallback을 주입한다.
 * - 정확한 토큰 키 목록은 설치된 `.d.ts`를 SSOT로 두고 여기엔 규칙·카테고리·예시만 담는다(drift 방지).
 */

/** 디자인 토큰 타깃 — 유저(유저 플랫폼) / 어드민(어드민 플랫폼) */
export type DesignTarget = 'user' | 'admin'

/** @internal 테스트에서 예시 키를 실제 design 토큰과 대조하기 위해 노출. public API 아님. */
export interface TargetMeta {
  /** 서브패스 import 경로 */
  pkg: string
  /** CSS 변수 접두사 (var(--<prefix>-...)) */
  prefix: string
  /** 색 토큰 예시 (중첩 트리 접근) */
  colorExample: string
  /** cssVar() 예시 slug */
  cssVarExample: string
  /** textStyle() 예시 토큰 */
  textStyleExample: string
  /** shadow 예시 키 */
  shadowExample: string
  /** 테마(다크모드) 안내 */
  themeNote: string
}

/**
 * @internal 타깃별 예시 값 표. 여기 적은 키가 실제 `@bstage-sdk/design` 토큰에
 * 존재하지 않으면 에이전트가 문서를 그대로 베껴 쓰는 순간 조용히 깨지므로, 테스트가 대조한다.
 */
export function meta(target: DesignTarget): TargetMeta {
  if (target === 'admin') {
    return {
      pkg: '@bstage-sdk/design/admin',
      prefix: 'admin',
      colorExample: 'color.text.primary',
      cssVarExample: 'text/primary',
      textStyleExample: '16/title/med',
      shadowExample: 'default-large',
      themeNote: '어드민은 **라이트 전용**(다크모드 없음).',
    }
  }
  return {
    pkg: '@bstage-sdk/design/user',
    prefix: 'user',
    colorExample: 'color.text.secondary',
    cssVarExample: 'text/secondary',
    textStyleExample: '16/title/semibold',
    shadowExample: 'default-large',
    themeNote: '색 토큰은 라이트/다크 자동 대응 — 플랫폼 테마를 따라 값이 바뀐다.',
  }
}

/**
 * AGENTS.md 관리 영역용 — 항상 켜져 있는 간결한 규칙 블록.
 * (상세 코드 예시는 bstage-template 스킬의 `designGuideSection`에 둔다)
 */
export function designRulesBrief(target: DesignTarget): string {
  const m = meta(target)
  return `## 디자인 (bstage 디자인 토큰)

UI의 색·타이포·그림자는 **반드시 \`${m.pkg}\`의 토큰만** 사용한다. hex/rgb 하드코딩 금지.

- **색**: \`${m.colorExample}\`(중첩 트리) 또는 \`cssVar('${m.cssVarExample}')\` → \`var(--${m.prefix}-...)\`. 카테고리: bg / text / border / icon / surface / overlay / service
- **타이포**: \`textStyle('${m.textStyleExample}')\` → 인라인 스타일에 spread
- **그림자**: \`shadow['${m.shadowExample}']\`
- **인터랙션**(hover/press): overlay 토큰 — \`color.overlay['hover-a']\` / \`color.overlay['press-a']\`
- **간격·라운드**: 전용 토큰 없음 — 일관된 스케일(4의 배수 권장)·일관된 radius. 임의값 남발 금지
- **테마**: ${m.themeNote}
- 값은 플랫폼이 런타임에 \`:root\`로 주입하고 로컬은 \`bstage dev\`가 fallback 주입 → 개발 중에도 실제 톤으로 보인다. 정확한 토큰 키는 \`node_modules/${m.pkg.split('/').slice(0, 2).join('/')}/dist/${m.prefix}/index.d.ts\` 참조

자세한 사용법은 SDK 문서 \`DESIGN_TOKENS.md\`(\`bstage docs\`)와 \`bstage-template\` 스킬 참고.`
}

/**
 * bstage-template 스킬용 — 코드 예시 포함 상세 절차 본문(헤딩은 호출부가 붙인다).
 */
export function designGuideSection(target: DesignTarget): string {
  const m = meta(target)
  const pkgRoot = m.pkg.split('/').slice(0, 2).join('/')
  return `UI 스타일은 임의 값 대신 **bstage 디자인 토큰**만 쓴다. 값은 플랫폼이 런타임에 \`:root\`로 주입하고, 로컬 \`bstage dev\`는 fallback을 주입하므로 개발 중에도 실제 톤으로 보인다. **hex/rgb 하드코딩 금지.**

\`\`\`tsx
import { color, shadow, cssVar, textStyle } from '${m.pkg}'

<div
  style={{
    background: color.bg.base,
    color: ${m.colorExample},            // = 'var(--${m.prefix}-mode-text-...)'
    boxShadow: shadow['${m.shadowExample}'],
    ...textStyle('${m.textStyleExample}'), // fontSize/lineHeight/fontWeight/letterSpacing
  }}
/>
\`\`\`

- **색**: \`color.<category>.<name>\` 중첩 트리, 또는 타입 안전 \`cssVar('${m.cssVarExample}')\`. 카테고리: bg / text / border / icon / surface / overlay / service
- **타이포**: \`textStyle('{size}/{role}/{weight}')\` → 인라인 스타일 객체(spread). 정확한 키는 타입 확인
- **그림자**: \`shadow['<name>']\`
- **인터랙션**: hover/press는 overlay 토큰을 위에 얹는다 — \`color.overlay['hover-a']\`, \`color.overlay['press-a']\`
- **간격·라운드**: 전용 토큰 없음 — 일관된 스케일(4의 배수)·일관된 radius를 쓰고 임의값을 남발하지 않는다
- **테마**: ${m.themeNote}
- **정확한 토큰 목록(SSOT)**: \`node_modules/${pkgRoot}/dist/${m.prefix}/index.d.ts\`. 사용 가이드는 SDK 문서 \`DESIGN_TOKENS.md\`(\`bstage docs\`). 기억에 의존해 토큰명을 추측하지 않는다`
}
