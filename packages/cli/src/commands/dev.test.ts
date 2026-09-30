import { describe, expect, it } from 'vitest'
import { resolveDevMode } from './dev.js'

/**
 * 혼합 레포(sdk + liquid)에서 `bstage dev`는 서버를 하나만 띄운다 — 기본은 sdk(Vite)이고
 * `--kind liquid`로 liquid 프리뷰를 고른다. 단일 종류 레포에서 어긋난 `--kind`는 멈춘다
 * (`ai install --kind`와 같은 규칙: 판정과 다르면 덮어쓰지 않는다).
 */
describe('resolveDevMode', () => {
  it('sdk·unknown은 Vite, liquid는 liquid 프리뷰', () => {
    expect(resolveDevMode('sdk', undefined)).toEqual({ mode: 'sdk' })
    expect(resolveDevMode('unknown', undefined)).toEqual({ mode: 'sdk' })
    expect(resolveDevMode('liquid', undefined)).toEqual({ mode: 'liquid' })
  })

  it('mixed는 기본 sdk이고 liquid 프리뷰 방법을 안내한다', () => {
    const r = resolveDevMode('mixed', undefined)
    expect(r.mode).toBe('sdk')
    expect(r.hint).toContain('--kind liquid')
  })

  it('mixed에서 --kind로 어느 쪽을 띄울지 고른다', () => {
    expect(resolveDevMode('mixed', 'liquid')).toEqual({ mode: 'liquid' })
    expect(resolveDevMode('mixed', 'sdk')).toEqual({ mode: 'sdk' })
  })

  it('판정과 어긋난 --kind는 종료코드 2', () => {
    expect(() => resolveDevMode('liquid', 'sdk')).toThrow(expect.objectContaining({ code: 2 }))
    expect(() => resolveDevMode('sdk', 'liquid')).toThrow(expect.objectContaining({ code: 2 }))
  })

  it('알 수 없는 --kind 값은 종료코드 2', () => {
    expect(() => resolveDevMode('mixed', 'bogus')).toThrow(expect.objectContaining({ code: 2 }))
  })
})
