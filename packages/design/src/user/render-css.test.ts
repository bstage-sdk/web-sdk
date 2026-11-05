import { describe, expect, it } from 'vitest'
import { renderCss, renderFrameCss } from './index.js'

/**
 * 격리 프레임(srcdoc)은 호스트 `:root`를 상속하지 못해 토큰 값을 문서 안에 직접 깔아야 한다.
 * dev fallback(`renderCss`)과 달리 OS 다크 설정을 따르면 안 된다 — 호스트는 스테이지 테마
 * (`html.dark`)로만 다크가 되므로, 라이트 스테이지가 OS 설정 때문에 프레임만 어두워진다.
 */
describe('renderFrameCss', () => {
  const css = renderFrameCss()

  it('라이트 값을 :root에 깐다', () => {
    expect(css).toMatch(/:root \{[^}]*--user-mode-bg-base: #ffffff;/)
    expect(css).toMatch(/:root \{[^}]*--user-mode-text-primary: #151515;/)
  })

  it('다크 값은 호스트와 같은 토글(html.dark·data-bspoke)로만 켠다', () => {
    expect(css).toMatch(
      /:root\[data-bspoke="dark"\],\n:root\.dark \{[^}]*--user-mode-text-primary: #eeeeee;/,
    )
  })

  it('OS 다크 설정(prefers-color-scheme)을 따르지 않는다', () => {
    expect(css).not.toContain('prefers-color-scheme')
  })

  it('색 토큰 집합은 dev fallback과 같다(값 출처 하나)', () => {
    const names = (s: string) => [...s.matchAll(/(--user-[\w-]+):/g)].map((m) => m[1]).sort()
    expect(names(css)).toEqual(
      names(renderCss().replace(/@media \(prefers-color-scheme: dark\) \{[\s\S]*?\n\}\n/, '')),
    )
  })

  it('<style> 안에 그대로 넣어도 요소를 닫거나 주석을 열지 않는다', () => {
    expect(css).not.toMatch(/<\/style|<!--/i)
  })
})

describe('renderCss(dev fallback)', () => {
  it('종전대로 OS 다크 설정을 따른다', () => {
    expect(renderCss()).toContain('@media (prefers-color-scheme: dark)')
  })
})
