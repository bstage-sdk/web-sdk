import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  __resetElementRegistry__,
  announceElementName,
  lookupElementName,
} from './elementRegistry.js'

/**
 * manifest.json이 나르던 태그명을 대신하는 통로다. 여기가 어긋나면 호스트가
 * `document.createElement`에 넣을 이름을 못 찾아 **빈 화면만 나온다**.
 *
 * 릴리즈 전 손 검증은 CDN 절대 URL로 위젯 하나를 띄우는 것까지다 — 상대 URL 조회,
 * 여러 번들 동시 로드, `currentScript`가 없는 환경은 지나가지 않는다.
 */

/** 번들이 로드되는 상황을 흉내 낸다 — 실행 중인 스크립트의 src만 있으면 된다. */
function runningScript(src: string | undefined, baseURI = 'https://bstage.io/space/') {
  vi.stubGlobal('document', {
    currentScript: src === undefined ? null : { src },
    baseURI,
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  __resetElementRegistry__()
})

describe('announceElementName', () => {
  it('실행 중인 스크립트 URL로 태그명을 남긴다', () => {
    runningScript('https://cdn.bstage.io/t/landing/template.js')
    announceElementName('bmf-landing')
    expect(lookupElementName('https://cdn.bstage.io/t/landing/template.js')).toBe('bmf-landing')
  })

  it('번들이 여러 템플릿을 등록하면 먼저 등록한 쪽이 대표다', () => {
    runningScript('https://cdn.bstage.io/t/a/template.js')
    announceElementName('bmf-first')
    announceElementName('bmf-second')
    expect(lookupElementName('https://cdn.bstage.io/t/a/template.js')).toBe('bmf-first')
  })

  it('currentScript가 없으면 조용히 넘어간다 (모듈 스크립트·SSR)', () => {
    runningScript(undefined)
    expect(() => announceElementName('bmf-a')).not.toThrow()
  })

  it('document가 없는 환경에서도 던지지 않는다', () => {
    vi.stubGlobal('document', undefined)
    expect(() => announceElementName('bmf-a')).not.toThrow()
  })
})

describe('lookupElementName', () => {
  // 호스트는 관리도구가 준 URL을 그대로 넘기는데 그게 상대 경로일 수 있다.
  // `script.src`는 항상 절대 URL로 읽히므로 정규화하지 않으면 조회가 빗나간다.
  it('상대 URL로 물어도 절대 URL로 남은 기록을 찾는다', () => {
    runningScript('https://bstage.io/cdn/landing/template.js')
    announceElementName('bmf-landing')
    expect(lookupElementName('/cdn/landing/template.js')).toBe('bmf-landing')
  })

  it('등록되지 않은 URL은 undefined', () => {
    runningScript('https://cdn.bstage.io/t/a/template.js')
    announceElementName('bmf-a')
    expect(lookupElementName('https://cdn.bstage.io/t/b/template.js')).toBeUndefined()
  })

  it('여러 번들이 섞여 로드돼도 URL별로 갈라 담는다', () => {
    // loadTemplatesBySlots가 동시에 여러 번들을 로드한다 — "로드 전후 증가분"으로는 섞인다.
    runningScript('https://cdn.bstage.io/t/a/template.js')
    announceElementName('bmf-a')
    runningScript('https://cdn.bstage.io/t/b/template.js')
    announceElementName('bmf-b')

    expect(lookupElementName('https://cdn.bstage.io/t/a/template.js')).toBe('bmf-a')
    expect(lookupElementName('https://cdn.bstage.io/t/b/template.js')).toBe('bmf-b')
  })

  it('URL로 못 쓸 문자열을 넘겨도 던지지 않는다', () => {
    runningScript('https://cdn.bstage.io/t/a/template.js')
    announceElementName('bmf-a')
    expect(lookupElementName('http://[')).toBeUndefined()
  })
})
