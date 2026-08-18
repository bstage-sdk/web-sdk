import { afterEach, describe, expect, it, vi } from 'vitest'
import { recoverLegacyElementName } from './loadTemplate.js'

/**
 * 옛 번들(태그명을 스스로 알리지 않던 시절)에서 태그명을 되찾는 폴백.
 *
 * 릴리즈 전 손 검증은 새 CLI로 방금 빌드한 번들을 띄우는 것뿐이라 **이 분기는 아예 지나가지
 * 않는다.** 그런데 여기가 틀리면 이미 배포된 커스텀 페이지가 통째로 안 뜬다.
 *
 * 특히 위험한 건 잘못 되찾는 경우다 — 엉뚱한 이름으로 `createElement`를 하면 빈 요소가 붙어
 * 오류 없이 화면만 비어 보인다. 그래서 후보를 추측으로 쓰지 않고 등록 여부로 확인한다.
 */

/** 이 이름들이 `customElements.define`으로 등록돼 있는 상황을 만든다. */
function registered(...names: string[]) {
  vi.stubGlobal('customElements', {
    get: (name: string) => (names.includes(name) ? class {} : undefined),
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('recoverLegacyElementName', () => {
  it('옛 산출물은 디렉토리 이름이 곧 태그명이라 되찾는다', () => {
    registered('bmf-hello')
    expect(recoverLegacyElementName('https://cdn.bstage.io/3pp/_/_/_/bmf-hello/template.js')).toBe(
      'bmf-hello',
    )
  })

  it('옛 manifest.json URL로 물어도 같은 자리를 본다', () => {
    registered('bmf-hello')
    expect(
      recoverLegacyElementName('https://cdn.bstage.io/3pp/_/_/_/bmf-hello/manifest.json'),
    ).toBe('bmf-hello')
  })

  it('쿼리·해시가 붙어도 디렉토리를 찾는다', () => {
    registered('bmf-hello')
    expect(recoverLegacyElementName('https://cdn.bstage.io/x/bmf-hello/template.js?v=2#a')).toBe(
      'bmf-hello',
    )
  })

  // 여기부터가 폴백을 "확인"으로 만든 이유다. 후보를 그냥 쓰면 새 산출물 경로가
  // 태그명으로 둔갑해 빈 요소가 붙는다.
  it('새 페이지 경로는 되찾지 않는다 — 등록된 이름이 아니다', () => {
    registered('bmf-landing')
    expect(recoverLegacyElementName('https://cdn.bstage.io/x/landing/template.js')).toBeUndefined()
  })

  it('새 위젯 경로도 되찾지 않는다 — 하이픈이 있어도 등록된 이름이 아니다', () => {
    registered('bmf-curation-banner')
    expect(
      recoverLegacyElementName(
        'https://cdn.bstage.io/x/user.contents-home.curation--after/template.js',
      ),
    ).toBeUndefined()
  })

  it('등록되지 않은 이름이면 undefined', () => {
    registered()
    expect(
      recoverLegacyElementName('https://cdn.bstage.io/x/bmf-hello/template.js'),
    ).toBeUndefined()
  })

  it('디렉토리 세그먼트가 없으면 undefined', () => {
    registered('template')
    expect(recoverLegacyElementName('template.js')).toBeUndefined()
  })
})
