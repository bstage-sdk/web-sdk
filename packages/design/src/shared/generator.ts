// ---------------------------------------------------------------
// bstage 디자인 토큰 — CSS 변수명 규칙 + dev fallback CSS 생성
//
// 변수명은 FE 프로덕션과 동일하게 맞춘다(상속을 위해):
//   mode 색·그림자: --{prefix}-mode-{slug}   (예: --user-mode-text-primary)
//   flat 색:        --{prefix}-{slug}        (예: --user-picker-button)
//
// 이 파일이 내는 CSS는 `:root`-scoped **fallback** 이다(`:host` 하드 주입 없음).
// 배포 시엔 플랫폼 :root 값을 상속하고, 이 fallback은 개발/미리보기 전용으로만 쓰인다.
// ---------------------------------------------------------------

import type { ColorPair, ShadowPair } from './types.js'

export interface FallbackTokens {
  /** 테마 대응 색 (--{p}-mode-{slug}) */
  modeColors: Record<string, ColorPair>
  /** 테마 비의존 색 (--{p}-{slug}) */
  flatColors: Record<string, string>
  /** 그림자 (--{p}-mode-shadow-*) */
  shadowTokens: Record<string, ShadowPair>
  /** 폰트 패밀리 스택 */
  fontFamily: string
}

/** slug → CSS 변수명. mode 계열(색·그림자)은 `--{p}-mode-*`, flat 계열은 `--{p}-*` */
export function cssVarName(slug: string, prefix: string, kind: 'mode' | 'flat'): string {
  const s = slug.replace(/\//g, '-')
  return kind === 'mode' ? `--${prefix}-mode-${s}` : `--${prefix}-${s}`
}

/** slug → `var(--...)` 참조 문자열 (개발자가 코드에서 쓰는 "이름 계약") */
export function cssVarRef(slug: string, prefix: string, kind: 'mode' | 'flat'): string {
  return `var(${cssVarName(slug, prefix, kind)})`
}

/**
 * 색 토큰을 카테고리별 중첩 객체로. 예: color.text.secondary === 'var(--user-mode-text-secondary)'
 * modeColors → mode 계열, flatColors → flat 계열.
 */
export function buildColorTree(
  modeColors: Record<string, unknown>,
  flatColors: Record<string, unknown>,
  prefix: string,
): Record<string, Record<string, string>> {
  const tree: Record<string, Record<string, string>> = {}
  const add = (slug: string, kind: 'mode' | 'flat') => {
    const [cat, ...rest] = slug.split('/')
    const leaf = rest.join('/').replace(/\//g, '-') || cat
    ;(tree[cat] ??= {})[leaf] = cssVarRef(slug, prefix, kind)
  }
  for (const slug of Object.keys(modeColors)) add(slug, 'mode')
  for (const slug of Object.keys(flatColors)) add(slug, 'flat')
  return tree
}

/** 그림자 slug → var 참조. 예: shadow['default-large'] === 'var(--user-mode-shadow-default-large)' */
export function buildShadowRefs(
  shadowTokens: Record<string, unknown>,
  prefix: string,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const slug of Object.keys(shadowTokens)) {
    const leaf = slug.replace(/^shadow\//, '')
    out[leaf] = cssVarRef(slug, prefix, 'mode')
  }
  return out
}

function colorLines(t: FallbackTokens, prefix: string, mode: 'light' | 'dark'): string {
  return [
    ...Object.entries(t.modeColors).map(
      ([slug, pair]) => `  ${cssVarName(slug, prefix, 'mode')}: ${pair[mode]};`,
    ),
    ...Object.entries(t.shadowTokens).map(
      ([slug, pair]) => `  ${cssVarName(slug, prefix, 'mode')}: ${pair[mode]};`,
    ),
  ].join('\n')
}

/**
 * dev fallback CSS 문자열. `:root`-scoped 만 (`:host` 없음).
 * dark=true(유저)면 `@media (prefers-color-scheme: dark)` + `[data-bspoke="dark"]` 토글 지원.
 * target='frame'이면 OS 설정 미디어 쿼리를 빼고 `html.dark` 토글만 남긴다(격리 프레임용 — 브리지 부트스트랩이
 * 호스트 테마로 토글한다). `[data-bspoke="dark"]` 셀렉터도 남지만 플랫폼은 프레임에 그 속성을 심지 않는다.
 */
export function renderFallbackCss(
  t: FallbackTokens,
  opts: { prefix: string; dark?: boolean; target?: 'dev' | 'frame' },
): string {
  const p = opts.prefix
  const flat = Object.entries(t.flatColors)
    .map(([slug, v]) => `  ${cssVarName(slug, p, 'flat')}: ${v};`)
    .join('\n')

  const lightColors = colorLines(t, p, 'light')

  const frame = opts.target === 'frame'
  const header = frame
    ? `/* bstage 디자인 토큰 — 격리 프레임 (${p}). 호스트 :root를 상속하지 못하는 프레임 문서용 */`
    : `/* ================================================================
 * bstage 디자인 토큰 — dev fallback (${p})
 * @bstage-sdk/design 생성물. 개발/미리보기 전용(:root fallback).
 * 배포 시엔 플랫폼 :root 값을 상속하며 이 파일은 번들되지 않는다.
 * ================================================================ */`
  let css = `${header}

:root {
${lightColors}

${flat}

  --${p}-font-family: ${t.fontFamily};
}
`

  if (opts.dark) {
    const darkColors = colorLines(t, p, 'dark')
    // 프레임은 OS 설정을 따르지 않는다 — 호스트가 스테이지 테마(html.dark)로만 다크가 되므로,
    // 따르면 라이트 스테이지에서 프레임만 어두워진다. 다크 전환은 아래 토글(html.dark)로만.
    if (!frame) {
      css += `
@media (prefers-color-scheme: dark) {
  :root:not([data-bspoke="light"]) {
${darkColors.replace(/^ {2}/gm, '    ')}
  }
}
`
    }
    css += `
:root[data-bspoke="dark"],
:root.dark {
${darkColors}
}
`
  }

  return css
}
