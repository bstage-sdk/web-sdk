import { describe, expect, it } from 'vitest'
import { subpathOf } from './devVitePlugin.js'

/**
 * `resolveId`가 `exports['.']`만 보고 있어서 `bstage-design/user` 같은 서브패스가 루트 엔트리로
 * 해석됐다 — design 루트는 아무것도 export하지 않아 `does not provide an export named 'color'`로
 * 깨졌다. 서브패스 계산이 그 수정의 핵심이라 여기서 따로 덮는다.
 */
describe('subpathOf', () => {
  it('스코프 패키지 자체는 `.`', () => {
    expect(subpathOf('@bstage-sdk/core')).toBe('.')
  })

  it('서브패스 한 단계', () => {
    expect(subpathOf('@bstage-sdk/design/user')).toBe('./user')
    expect(subpathOf('@bstage-sdk/design/admin')).toBe('./admin')
  })

  it('서브패스 여러 단계 (css 파일 등)', () => {
    expect(subpathOf('@bstage-sdk/design/css/user.css')).toBe('./css/user.css')
  })

  it('스코프 없는 패키지도 같은 규칙', () => {
    expect(subpathOf('picocolors')).toBe('.')
    expect(subpathOf('vite/client')).toBe('./client')
  })
})
