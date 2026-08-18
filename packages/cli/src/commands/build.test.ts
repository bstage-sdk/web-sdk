import { describe, expect, it } from 'vitest'
import { BuildRuleError, resolveOutputName, type DiscoveredEntry } from './build.js'

/**
 * 산출물 위치를 정하는 규칙. 릴리즈 전 손 검증은 정상 페이지 하나·정상 위젯 하나를 빌드해보는
 * 데서 끝나므로, 규칙을 어겼을 때의 분기는 전부 비어 있다. 그런데 이 분기들이 조용히 통과하면
 * **엉뚱한 경로로 배포된다** — `bstage build`는 tsc를 타지 않아 타입도 막아주지 않는다.
 */

function page(...segments: string[]): DiscoveredEntry {
  return { kind: 'page', entry: `src/pages/${segments.join('/')}/template.tsx`, segments }
}

function slot(...segments: string[]): DiscoveredEntry {
  return { kind: 'slot', entry: `src/slots/${segments.join('/')}/template.tsx`, segments }
}

describe('페이지', () => {
  it('폴더 구조가 그대로 배포 경로가 된다', () => {
    expect(resolveOutputName(page('landing'), undefined)).toBe('landing')
  })

  it('중첩 폴더는 중첩 그대로 유지한다', () => {
    expect(resolveOutputName(page('settings', 'custom'), undefined)).toBe('settings/custom')
  })

  it('세그먼트가 없으면 dist 바로 아래(루트 페이지)', () => {
    expect(resolveOutputName(page(), undefined)).toBe('')
  })

  it('slot 옵션을 쓰면 막는다 — 위젯을 pages에 둔 경우다', () => {
    expect(() => resolveOutputName(page('banner'), 'user.contents-home.curation:after')).toThrow(
      BuildRuleError,
    )
  })

  it('동적 경로는 아직 지원하지 않는다고 알린다', () => {
    expect(() => resolveOutputName(page('artist', '[id]'), undefined)).toThrow(/동적 경로/)
  })
})

describe('위젯', () => {
  it('슬롯 id를 디렉토리 이름으로 바꿔 내보낸다', () => {
    expect(resolveOutputName(slot('curation-banner'), 'user.contents-home.curation:after')).toBe(
      'user.contents-home.curation--after',
    )
  })

  it('폴더 이름은 산출물 위치에 영향을 주지 않는다', () => {
    const a = resolveOutputName(slot('아무거나'), 'user.my-home.menu:before')
    const b = resolveOutputName(slot('deeply', 'nested', 'name'), 'user.my-home.menu:before')
    expect(a).toBe(b)
  })

  it('slot 옵션이 없으면 막는다 — 위치만으로는 어느 자리인지 알 수 없다', () => {
    expect(() => resolveOutputName(slot('curation-banner'), undefined)).toThrow(BuildRuleError)
  })

  it('카탈로그에 없는 슬롯 id는 막는다', () => {
    expect(() => resolveOutputName(slot('w'), 'user.contents-home.curation:aftre')).toThrow(
      /카탈로그에 없는/,
    )
  })

  it('오타 메시지에 같은 페이지의 자리를 후보로 보여준다', () => {
    let message = ''
    try {
      resolveOutputName(slot('w'), 'user.contents-home.curation:aftre')
    } catch (e) {
      message = (e as Error).message
    }
    expect(message).toContain('user.contents-home.curation:after')
  })

  it('정규화된 이름을 slot에 그대로 적으면 막는다 — 콜론이 원본 형식이다', () => {
    expect(() => resolveOutputName(slot('w'), 'user.contents-home.curation--after')).toThrow(
      /카탈로그에 없는/,
    )
  })
})
