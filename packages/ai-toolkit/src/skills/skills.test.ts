import { describe, expect, it } from 'vitest'
import { agentsManagedBody } from '../agents/agentsMd.js'
import { VERSION } from '../version.js'
import { BSTAGE_SKILLS, skillsFor, type ProjectKind } from './registry.js'
import { readSkillStamp } from './stamp.js'

const KINDS: ProjectKind[] = ['sdk', 'liquid']

/** 이모지 탐지 — 본문에 하나라도 있으면 컨벤션 위반. */
const EMOJI_RE = /\p{Extended_Pictographic}/u

/**
 * 금칙어 게이트는 비어 있다 — 게이트 설정과 스크립트는 이 저장소에 들어오지 않는다.
 * 본문 검사는 소스를 만드는 쪽에서 돌고, 여기서는 나머지 규약(스탬프·frontmatter 등)만 본다.
 */
function loadGate(): { forbidden: RegExp[]; substitute: (s: string) => string } {
  return { forbidden: [], substitute: (s) => s }
}

const gate = loadGate()

function expectPublicSafe(label: string, body: string): void {
  const substituted = gate.substitute(body)
  for (const re of gate.forbidden) {
    const hit = re.exec(substituted)
    expect(hit ? `${label}: /${re.source}/ 에 걸림 → ${hit[0]}` : null).toBeNull()
  }
}

describe('스킬 레지스트리', () => {
  it('sdk 프로젝트에는 template·migrate·onboarding·deploy 스킬이 설치된다', () => {
    const names = skillsFor('sdk').map((s) => s.name)
    expect([...names].sort()).toEqual([
      'bstage-deploy',
      'bstage-migrate',
      'bstage-onboarding',
      'bstage-template',
    ])
  })

  it('liquid 프로젝트에는 migrate·onboarding·deploy·liquid 스킬이 설치된다', () => {
    const names = skillsFor('liquid').map((s) => s.name)
    expect([...names].sort()).toEqual([
      'bstage-deploy',
      'bstage-liquid',
      'bstage-migrate',
      'bstage-onboarding',
    ])
  })
})

describe('스킬 본문 공통 규약', () => {
  for (const kind of KINDS) {
    for (const skill of skillsFor(kind)) {
      describe(`${skill.name} (${kind})`, () => {
        const body = skill.content({ kind, target: 'user' })

        it('frontmatter의 name이 디렉토리명과 같다', () => {
          expect(body.startsWith('---\n')).toBe(true)
          expect(body).toContain(`name: ${skill.name}\n`)
        })

        it('frontmatter 바로 다음 줄이 버전 스탬프다', () => {
          const lines = body.split('\n')
          const end = lines.indexOf('---', 1)
          expect(end).toBeGreaterThan(0)
          expect(lines[end + 1]).toBe(`<!-- bstage-ai-toolkit ${VERSION} -->`)
          expect(readSkillStamp(body)).toBe(VERSION)
        })

        it('이모지가 없다', () => {
          expect(EMOJI_RE.test(body)).toBe(false)
        })

        it('공개 스냅샷 금칙어가 없다', () => {
          expectPublicSafe(skill.name, body)
        })

        it('본문이 300줄 이내다', () => {
          expect(body.split('\n').length).toBeLessThanOrEqual(300)
        })
      })
    }
  }

  it('모든 스킬은 kinds에 적힌 종류에서 렌더링된다', () => {
    for (const skill of BSTAGE_SKILLS) {
      expect(skill.kinds.length).toBeGreaterThan(0)
    }
  })
})

describe('스탬프 읽기', () => {
  const frontmatter = '---\nname: bstage-demo\n---\n'

  it('frontmatter 다음 첫 줄의 스탬프를 읽는다', () => {
    expect(readSkillStamp(`${frontmatter}<!-- bstage-ai-toolkit 1.2.3 -->\n\n# 역할\n`)).toBe(
      '1.2.3',
    )
  })

  it('빈 줄이 끼어 있어도 첫 비어 있지 않은 줄이면 읽는다', () => {
    expect(readSkillStamp(`${frontmatter}\n<!-- bstage-ai-toolkit 1.2.3 -->\n`)).toBe('1.2.3')
  })

  it('본문 아래쪽의 스탬프처럼 생긴 주석은 읽지 않는다', () => {
    const body = `${frontmatter}\n# 역할\n\n예시: <!-- bstage-ai-toolkit 0.0.1 -->\n\n<!-- bstage-ai-toolkit 9.9.9 -->\n`
    expect(readSkillStamp(body)).toBeNull()
  })

  it('frontmatter가 없으면 null이다', () => {
    expect(readSkillStamp('<!-- bstage-ai-toolkit 1.2.3 -->\n\n# 역할\n')).toBeNull()
  })
})

describe('AGENTS.md 관리 영역 금칙어', () => {
  for (const kind of KINDS) {
    it(`${kind} 본문에 금칙어·이모지가 없다`, () => {
      const body = agentsManagedBody({ space: 'acme', projectName: 'acme-templates', kind })
      expect(EMOJI_RE.test(body)).toBe(false)
      expectPublicSafe(`agentsManagedBody(${kind})`, body)
    })
  }
})

/**
 * 내부 버전 번호는 공개판에서 **가리키는 대상이 없다.** 두 채널은 번호가 완전히 따로 논다
 * (내부 cli 0.5x ↔ 공개 0.x). 스냅샷은 패키지 이름만 치환하므로 "cli 0.58 이상" 같은 문장이
 * 그대로 나가면, 공개 사용자는 존재하지 않는 버전을 찾게 된다. 기능 유무는 번호가 아니라
 * **증상**으로 안내한다.
 */
describe('배포되는 본문에 버전 번호 단정이 없다', () => {
  // 버전으로 **기능 유무를 가르는** 문장만 잡는다. 마이그레이션 스킬처럼 헤더 표기 예시로
  // 버전을 인용하는 것은 정상이므로 '이상·미만·이후·부터'가 따라붙는 경우로 좁힌다.
  const VERSION_CLAIM =
    /(cli|core|react|host|design)(가|는|은|를|이)?\s+\d+\.\d+[^\n]{0,12}?(이상|미만|이후|부터)/i

  for (const kind of KINDS) {
    it(`${kind} AGENTS.md 관리 영역`, () => {
      const body = agentsManagedBody({ space: 'acme', projectName: 'acme-templates', kind })
      expect(body).not.toMatch(VERSION_CLAIM)
    })
  }

  for (const skill of BSTAGE_SKILLS) {
    for (const kind of skill.kinds) {
      it(`${skill.name} (${kind})`, () => {
        expect(skill.content({ kind, target: 'user' })).not.toMatch(VERSION_CLAIM)
      })
    }
  }
})

describe('스킬별 핵심 문구', () => {
  const bodyOf = (name: string, kind: ProjectKind) => {
    const skill = BSTAGE_SKILLS.find((s) => s.name === name)
    if (!skill) throw new Error(`스킬을 찾을 수 없습니다: ${name}`)
    return skill.content({ kind, target: 'user' })
  }

  it('deploy 스킬은 배포 명령·확인 생략 옵션·상태 확인·종료 코드를 다룬다', () => {
    const body = bodyOf('bstage-deploy', 'sdk')
    expect(body).toContain('bstage deploy')
    expect(body).toContain('--yes')
    expect(body).toContain('bstage list')
    expect(body).toMatch(/종료 ?코드/)
  })

  it('liquid 스킬은 구조 규약을 다룬다', () => {
    const body = bodyOf('bstage-liquid', 'liquid')
    expect(body).toContain('public/user')
    expect(body).toContain('data.json')
    expect(body).toContain('template.liquid')
  })

  /**
   * 플랫폼이 넣는 최상위 이름은 다섯 개고, 이걸 모르면 로컬에서만 그려지고 배포하면 비는
   * 템플릿이 나온다. 스킬이 이 계약을 직접 들고 있어야 한다 — SDK 의존 없이 `.liquid` 파일만
   * 둔 레포에는 문서가 설치되지 않아 다른 데서 알아낼 길이 없다.
   */
  it('liquid 스킬이 플랫폼 데이터 계약 다섯 개를 직접 들고 있다', () => {
    const body = bodyOf('bstage-liquid', 'liquid')
    for (const key of [
      'lounges',
      'stories',
      'contentSections',
      'latestContents',
      'shopCategories',
    ]) {
      expect(body).toContain(key)
    }
  })

  /**
   * 에셋을 레포에 두고 상대 경로로 참조하라는 옛 안내는 신규 포털에서 404다. 로컬 프리뷰는
   * 반대로 동작해 그 안내를 확인해 주기까지 하므로, 스킬이 반대 방향을 명시해야 한다.
   */
  it('liquid 스킬은 에셋을 포털 미디어에 올리라고 안내하고 상대 경로를 막는다', () => {
    const body = bodyOf('bstage-liquid', 'liquid')
    expect(body).toContain('미디어')
    expect(body).toMatch(/상대 경로로 참조하면 배포 후 깨진다/)
    expect(body).toMatch(/프리뷰에서 보였다는 것을 근거로 삼지 않는다/)
  })

  it('onboarding 스킬은 생성·연결·배포 명령을 모두 안내한다', () => {
    const body = bodyOf('bstage-onboarding', 'sdk')
    expect(body).toContain('bstage init')
    expect(body).toContain('bstage link')
    expect(body).toContain('bstage deploy')
  })
})
