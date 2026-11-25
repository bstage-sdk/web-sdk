import { describe, expect, it } from 'vitest'
import { color, cssVar, renderCss, renderFrameCss, stageColorVars } from './index.js'

/**
 * picker 색은 스테이지 운영자가 고른 컬러(버튼·버튼 텍스트·스타)를 따른다. 플랫폼 화면은 이 값을
 * `--button-color` 등 스테이지 변수로 깔고, 플랫폼 프런트엔드의 `color('picker/...')`도 이 변수를 쓴다.
 * 토큰이 `--user-picker-*`(고정 기본값)만 가리키면 템플릿만 기본 보라로 보인다.
 */
describe('picker 토큰 — 스테이지 컬러', () => {
  it('플랫폼과 같은 스테이지 변수를 먼저 보고, 없으면 기본값으로 떨어진다', () => {
    expect(color.picker.button).toBe('var(--button-color, var(--user-picker-button))')
    expect(color.picker['on-button']).toBe('var(--button-text-color, var(--user-picker-on-button))')
    expect(color.picker['button-weak-a']).toBe(
      'var(--button-weak-a-color, var(--user-picker-button-weak-a))',
    )
    expect(color.picker.star).toBe('var(--star-color, var(--user-picker-star))')
  })

  it('cssVar도 같은 참조를 돌려준다', () => {
    expect(cssVar('picker/button')).toBe(color.picker.button)
    expect(cssVar('picker/star')).toBe(color.picker.star)
  })

  it('picker 밖 토큰은 그대로다', () => {
    expect(color.text.primary).toBe('var(--user-mode-text-primary)')
    expect(cssVar('text/secondary')).toBe('var(--user-mode-text-secondary)')
  })

  it('스테이지 변수 이름 표를 내보낸다(picker slug → 변수)', () => {
    expect(stageColorVars).toEqual({
      'picker/button': '--button-color',
      'picker/button-weak-a': '--button-weak-a-color',
      'picker/on-button': '--button-text-color',
      'picker/star': '--star-color',
    })
  })

  it('fallback CSS는 기본값(--user-picker-*)을 깔고, 스테이지 변수는 덮어쓰지 않는다', () => {
    for (const css of [renderCss(), renderFrameCss()]) {
      expect(css).toContain('--user-picker-button: #654bff;')
      expect(css).toContain('--user-picker-star: #7266ff;')
      expect(css).not.toMatch(/--button-color\s*:/)
      expect(css).not.toMatch(/--star-color\s*:/)
    }
  })
})
