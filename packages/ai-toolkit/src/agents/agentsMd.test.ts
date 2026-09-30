import { describe, expect, it } from 'vitest'
import { agentsMd, agentsManagedBody } from './agentsMd.js'
import { AGENTS_MANAGED_VERSION } from './agentsMdRegion.js'

const opts = { space: 'acme', projectName: 'acme-templates' } as const

describe('AGENTS.md 관리 영역 — kind 분기', () => {
  it('kind 기본값은 sdk다 (기존 호출부 무변경)', () => {
    expect(agentsManagedBody({ ...opts })).toBe(agentsManagedBody({ ...opts, kind: 'sdk' }))
  })

  it('sdk 본문은 기존 내용에 배포 절이 더해진 것이다', () => {
    const body = agentsManagedBody({ ...opts, kind: 'sdk' })
    expect(body).toContain('template.tsx')
    expect(body).toContain('createTemplate')
    expect(body).toContain('## 배포')
  })

  it('liquid 본문에는 React·Shadow DOM 서술이 없다', () => {
    const body = agentsManagedBody({ ...opts, kind: 'liquid' })
    expect(body).not.toContain('template.tsx')
    expect(body).not.toContain('createTemplate')
    expect(body).not.toContain('Shadow DOM')
  })

  it('liquid 본문에는 디자인 토큰·API 호출 절이 없다', () => {
    const body = agentsManagedBody({ ...opts, kind: 'liquid' })
    expect(body).not.toContain('디자인 토큰')
    expect(body).not.toContain('BstageClient')
    expect(body).not.toContain('client.get')
  })

  it('liquid 본문은 liquid 구조 규약을 담는다', () => {
    const body = agentsManagedBody({ ...opts, kind: 'liquid' })
    expect(body).toContain('template.liquid')
    expect(body).toContain('public/user')
    expect(body).toContain('data.json')
    expect(body).toContain('## 배포')
  })

  it('세 kind 모두 프로젝트 정체성(space·레포)을 적는다', () => {
    for (const kind of ['sdk', 'liquid', 'mixed'] as const) {
      const body = agentsManagedBody({ ...opts, kind })
      expect(body).toContain('**Space**: acme')
      expect(body).toContain('`acme-templates`')
    }
  })

  it('liquid 본문은 sdk와의 공존을 막지 않는다', () => {
    const body = agentsManagedBody({ ...opts, kind: 'liquid' })
    expect(body).not.toMatch(/섞지 않는다|포털이 빌드하지 못한다/)
  })

  it('mixed 본문은 두 구조와 공존 규칙(sdk 페이지 user·admin 금지 · dev --kind)을 담는다', () => {
    const body = agentsManagedBody({ ...opts, kind: 'mixed', target: 'user' })
    expect(body).toContain('src/pages')
    expect(body).toContain('template.tsx')
    expect(body).toContain('createTemplate')
    expect(body).toContain('public/user')
    expect(body).toContain('template.liquid')
    expect(body).toContain('src/pages/user')
    expect(body).toContain('bstage dev --kind liquid')
    expect(body).toContain('## 배포')
    expect(body).not.toMatch(/섞지 않는다|포털이 빌드하지 못한다/)
  })

  it('mixed 본문은 두 kind의 금지 사항을 함께 든다', () => {
    const body = agentsManagedBody({ ...opts, kind: 'mixed' })
    expect(body).toContain('Shadow DOM')
    expect(body).toContain('{% render %}')
    expect(body).toContain('lounges')
  })
})

describe('정체성 값 방어', () => {
  // 정제는 cli가 하지만, 개행이 섞이면 관리 영역 마커가 깨져 복구가 안 된다 — 여기서도 막는다.
  it('개행이 든 space·projectName은 거부한다', () => {
    expect(() => agentsManagedBody({ space: 'acme', projectName: 'a\nb' })).toThrow()
    expect(() => agentsManagedBody({ space: 'a\nb', projectName: 'acme' })).toThrow()
    expect(() => agentsMd({ space: 'acme', projectName: 'a\r\nb' })).toThrow()
  })
})

describe('관리 영역 버전', () => {
  it('본문이 바뀌었으므로 15다', () => {
    expect(AGENTS_MANAGED_VERSION).toBe(15)
  })
})

describe('AGENTS.md 배포 절 — 배치 생성', () => {
  it.each(['sdk', 'liquid', 'mixed'] as const)(
    '%s 본문은 배치 생성을 bstage placement create 로 안내한다',
    (kind) => {
      const body = agentsManagedBody({ ...opts, kind })
      expect(body).toContain('bstage placement create')
      expect(body).not.toMatch(/배치\(페이지\) 생성과 레포 연결은/)
    },
  )
})
