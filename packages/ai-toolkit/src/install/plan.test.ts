import { describe, expect, it } from 'vitest'
import { agentsMd } from '../agents/agentsMd.js'
import { AGENTS_MANAGED_VERSION } from '../agents/agentsMdRegion.js'
import { BSTAGE_SKILLS, type SkillContext } from '../skills/registry.js'
import { compareVersions, readSkillStamp, skillStamp } from '../skills/stamp.js'
import { VERSION } from '../version.js'
import { planInstall, type InstallAction, type InstallInput } from './plan.js'

/**
 * planInstall은 "무엇을 쓸지"를 정하는 유일한 자리다. 여기서 분기를 틀리면 CLI는 조용히
 * 사용자 파일을 덮거나(데이터 손실) 최신화를 건너뛴다(에러 없이 옛 스킬 유지) — 손 검증으로는
 * 둘 다 알아채기 어렵다.
 */

const SKILLS_DIR = '.claude/skills'

function input(over: Partial<InstallInput> = {}): InstallInput {
  return {
    kind: 'sdk',
    target: 'user',
    space: 'acme',
    projectName: 'acme-custom-templates-user',
    skillsDir: SKILLS_DIR,
    existing: { skills: {}, agentsMd: null, claudeMd: null },
    ...over,
  }
}

function at(actions: InstallAction[], path: string): InstallAction | undefined {
  return actions.find((a) => a.path === path)
}

const skillPath = (name: string) => `${SKILLS_DIR}/${name}/SKILL.md`

const DEFAULT_CTX: SkillContext = { kind: 'sdk', target: 'user' }

/** 현재 toolkit이 낼 스킬 본문 — 설치본 비교의 기준값이다. */
function renderSkill(name: string, ctx: SkillContext = DEFAULT_CTX): string {
  const skill = BSTAGE_SKILLS.find((s) => s.name === name)
  if (!skill) throw new Error(`알 수 없는 스킬: ${name}`)
  return skill.content(ctx)
}

/** 스탬프는 최신 그대로 두고 본문 한 줄만 손으로 고친 설치본. */
function handEdited(name: string): string {
  const lines = renderSkill(name).split('\n')
  // 스탬프 줄 뒤의 첫 내용 줄을 고친다 — frontmatter·스탬프는 건드리지 않는다.
  const stampAt = lines.indexOf(skillStamp())
  const idx = lines.findIndex((line, i) => i > stampAt && line.trim() !== '')
  return [...lines.slice(0, idx), `${lines[idx]} (손수정)`, ...lines.slice(idx + 1)].join('\n')
}

/** 관리 영역 버전만 한 단계 낮춘 AGENTS.md — stale 분기용. */
function staleAgentsMd(free: string, space = 'acme', projectName = 'acme-repo'): string {
  const fresh = agentsMd({ space, projectName, target: 'user', kind: 'sdk' })
  return (
    fresh.replace(`v=${AGENTS_MANAGED_VERSION}`, `v=${AGENTS_MANAGED_VERSION - 1}`) + `\n${free}\n`
  )
}

describe('planInstall — 설치본이 이 toolkit보다 새 버전일 때', () => {
  /** 스탬프를 한 메이저 위로 올리고 본문도 다르게 만든 설치본 — 새 CLI가 놓은 스킬을 옛 CLI가 보는 상황. */
  function newerInstalled(name: string): string {
    const [major = '0', ...rest] = VERSION.split('.')
    const bumped = [String(Number(major) + 1), ...rest].join('.')
    return renderSkill(name).replace(skillStamp(), skillStamp(bumped)) + '\n새 버전에만 있는 줄\n'
  }

  it('본문을 이 toolkit 것으로 되돌리되(stale) 하향임을 알린다 — 자칭 버전으로 덮어쓰기를 막을 수 없다', () => {
    const actions = planInstall(
      input({
        existing: {
          skills: { 'bstage-onboarding': newerInstalled('bstage-onboarding') },
          agentsMd: null,
          claudeMd: null,
        },
      }),
    )
    const a = at(actions, skillPath('bstage-onboarding'))
    expect(a?.reason).toBe('stale')
    expect(a?.content).toBe(renderSkill('bstage-onboarding'))
    expect(a?.note).toContain('하향')
  })

  it('스탬프가 같거나 낮으면 예전처럼 stale이다', () => {
    const [major = '0', minor = '0', patch = '0'] = VERSION.split('.')
    const lower = [major, minor, String(Math.max(0, Number(patch) - 1))].join('.')
    const older =
      renderSkill('bstage-onboarding').replace(skillStamp(), skillStamp(lower)) + '\n옛 줄\n'
    const actions = planInstall(
      input({
        existing: { skills: { 'bstage-onboarding': older }, agentsMd: null, claudeMd: null },
      }),
    )
    expect(at(actions, skillPath('bstage-onboarding'))?.reason).toBe('stale')
  })
})

describe('compareVersions', () => {
  it('숫자 자리로 비교하고 프리릴리즈 꼬리는 무시한다', () => {
    expect(compareVersions('0.5.0', '0.4.9')).toBe(1)
    expect(compareVersions('0.10.0', '0.9.0')).toBe(1)
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('1.0.0-beta.1', '1.0.0')).toBe(0)
    expect(compareVersions('0.4.1', '0.5.0')).toBe(-1)
    expect(compareVersions('garbage', '0.1.0')).toBe(-1)
  })
})

describe('planInstall — 스킬', () => {
  it('파일이 없으면 create이고 본문에 현재 버전 스탬프가 들어간다', () => {
    const a = at(planInstall(input()), skillPath('bstage-onboarding'))
    expect(a?.reason).toBe('create')
    expect(a?.content).toContain(`<!-- bstage-ai-toolkit ${VERSION} -->`)
  })

  it('본문이 현재 렌더 결과와 완전히 같으면 keep이고 본문을 만들지 않는다', () => {
    const actions = planInstall(
      input({
        existing: {
          skills: { 'bstage-onboarding': renderSkill('bstage-onboarding') },
          agentsMd: null,
          claudeMd: null,
        },
      }),
    )
    const a = at(actions, skillPath('bstage-onboarding'))
    expect(a?.reason).toBe('keep')
    expect(a?.content).toBeNull()
  })

  it('손수정 드리프트는 덮기 전에 백업하라는 표시(backup)가 붙고, 옛 버전 stale에는 붙지 않는다', () => {
    const edited = planInstall(
      input({
        existing: {
          skills: { 'bstage-onboarding': handEdited('bstage-onboarding') },
          agentsMd: null,
          claudeMd: null,
        },
      }),
    )
    const a = at(edited, skillPath('bstage-onboarding'))
    expect(a?.reason).toBe('stale')
    expect(a?.backup).toBe(true)
    expect(a?.note).toContain('.bak')

    const [major = '0', minor = '0', patch = '0'] = VERSION.split('.')
    const lower = [major, minor, String(Math.max(0, Number(patch) - 1))].join('.')
    const older = renderSkill('bstage-onboarding').replace(skillStamp(), skillStamp(lower))
    const outdated = planInstall(
      input({
        existing: { skills: { 'bstage-onboarding': older }, agentsMd: null, claudeMd: null },
      }),
    )
    expect(at(outdated, skillPath('bstage-onboarding'))?.backup).toBeUndefined()
  })

  it('스탬프가 최신이어도 본문 한 줄이 다르면 stale이다(손수정 드리프트)', () => {
    const drifted = handEdited('bstage-onboarding')
    // 스탬프는 최신 그대로다 — 스탬프만 봤다면 keep으로 새어 나갔을 상태다.
    expect(readSkillStamp(drifted)).toBe(VERSION)

    const actions = planInstall(
      input({
        existing: { skills: { 'bstage-onboarding': drifted }, agentsMd: null, claudeMd: null },
      }),
    )
    const a = at(actions, skillPath('bstage-onboarding'))
    expect(a?.reason).toBe('stale')
    expect(a?.content).toBe(renderSkill('bstage-onboarding'))
  })

  it('스탬프가 다르면 stale이고 새 본문을 싣는다', () => {
    const old = renderSkill('bstage-onboarding').replace(skillStamp(), skillStamp('0.0.0-old'))
    const actions = planInstall(
      input({
        existing: { skills: { 'bstage-onboarding': old }, agentsMd: null, claudeMd: null },
      }),
    )
    const a = at(actions, skillPath('bstage-onboarding'))
    expect(a?.reason).toBe('stale')
    expect(a?.content).toContain(`<!-- bstage-ai-toolkit ${VERSION} -->`)
  })

  it('스탬프가 없으면(도입 전 설치본) stale로 본다', () => {
    const unstamped = renderSkill('bstage-onboarding').replace(`${skillStamp()}\n`, '')
    expect(readSkillStamp(unstamped)).toBeNull()

    const actions = planInstall(
      input({
        existing: { skills: { 'bstage-onboarding': unstamped }, agentsMd: null, claudeMd: null },
      }),
    )
    expect(at(actions, skillPath('bstage-onboarding'))?.reason).toBe('stale')
  })

  it('kind에 해당하는 스킬만 대상으로 삼는다', () => {
    const sdk = planInstall(input()).map((a) => a.path)
    expect(sdk).toContain(skillPath('bstage-template'))
    expect(sdk).not.toContain(skillPath('bstage-liquid'))

    const liquid = planInstall(input({ kind: 'liquid' })).map((a) => a.path)
    expect(liquid).toContain(skillPath('bstage-liquid'))
    expect(liquid).not.toContain(skillPath('bstage-template'))
  })

  it('mixed는 두 세트를 모두 대상으로 삼고, 어느 스킬도 kind 밖(extra)이 아니다', () => {
    const actions = planInstall(
      input({
        kind: 'mixed',
        existing: {
          skills: {
            'bstage-template': renderSkill('bstage-template', { kind: 'mixed', target: 'user' }),
            'bstage-liquid': renderSkill('bstage-liquid', { kind: 'mixed', target: 'user' }),
          },
          agentsMd: null,
          claudeMd: null,
        },
      }),
    )
    const paths = actions.map((a) => a.path)
    expect(paths).toContain(skillPath('bstage-template'))
    expect(paths).toContain(skillPath('bstage-liquid'))
    expect(at(actions, skillPath('bstage-template'))?.reason).toBe('keep')
    expect(at(actions, skillPath('bstage-template'))?.note).toBeUndefined()
    expect(at(actions, skillPath('bstage-liquid'))?.note).toBeUndefined()
  })

  it('kind 밖 스킬이 설치돼 있어도 지우지 않고 note를 단 keep으로 알린다', () => {
    const actions = planInstall(
      input({
        kind: 'liquid',
        existing: {
          skills: { 'bstage-template': renderSkill('bstage-template') },
          agentsMd: null,
          claudeMd: null,
        },
      }),
    )
    const a = at(actions, skillPath('bstage-template'))
    expect(a?.reason).toBe('keep')
    expect(a?.content).toBeNull()
    expect(a?.note).toBeTruthy()
  })

  it('SDK 소유가 아닌 스킬은 아예 계획에 들어오지 않는다', () => {
    const actions = planInstall(
      input({
        existing: { skills: { 'my-own-skill': '# 내 스킬\n' }, agentsMd: null, claudeMd: null },
      }),
    )
    expect(at(actions, skillPath('my-own-skill'))).toBeUndefined()
  })
})

describe('planInstall — AGENTS.md', () => {
  it('없으면 create — 관리 영역 마커와 배포 절을 담은 전체 파일', () => {
    const a = at(planInstall(input()), 'AGENTS.md')
    expect(a?.reason).toBe('create')
    expect(a?.content).toContain('BSTAGE:MANAGED:START')
    expect(a?.content).toContain('## 배포')
  })

  it('kind가 liquid면 liquid 본문으로 만든다', () => {
    const a = at(planInstall(input({ kind: 'liquid' })), 'AGENTS.md')
    expect(a?.content).toContain('template.liquid')
  })

  it('kind가 mixed면 두 구조를 함께 담은 본문으로 만든다', () => {
    const a = at(planInstall(input({ kind: 'mixed' })), 'AGENTS.md')
    expect(a?.content).toContain('template.liquid')
    expect(a?.content).toContain('template.tsx')
    expect(a?.content).toContain('src/pages/user')
  })

  it('마커가 없으면 legacy — 쓰지 않고 안내만 남긴다', () => {
    const actions = planInstall(
      input({ existing: { skills: {}, agentsMd: '# AGENTS.md\n\n옛날 파일\n', claudeMd: null } }),
    )
    const a = at(actions, 'AGENTS.md')
    expect(a?.reason).toBe('legacy')
    expect(a?.content).toBeNull()
    expect(a?.note).toContain('bstage-migrate')
  })

  it('관리 영역 버전이 낮으면 update — 자유 영역은 그대로 보존한다', () => {
    const free = '## 우리 팀 규칙\n\n절대 지워지면 안 되는 문장.'
    const actions = planInstall(
      input({ existing: { skills: {}, agentsMd: staleAgentsMd(free), claudeMd: null } }),
    )
    const a = at(actions, 'AGENTS.md')
    expect(a?.reason).toBe('update')
    expect(a?.content).toContain('절대 지워지면 안 되는 문장.')
    expect(a?.content).toContain(`v=${AGENTS_MANAGED_VERSION}`)
  })

  it('update는 기존 파일의 정체성(Space·레포)을 입력값보다 우선한다', () => {
    const actions = planInstall(
      input({
        space: 'ignored',
        projectName: 'ignored-repo',
        existing: { skills: {}, agentsMd: staleAgentsMd('', 'kept', 'kept-repo'), claudeMd: null },
      }),
    )
    const content = at(actions, 'AGENTS.md')?.content ?? ''
    expect(content).toContain('**Space**: kept')
    expect(content).toContain('`kept-repo`')
    expect(content).not.toContain('ignored-repo')
  })

  it('최신이면 keep', () => {
    const fresh = agentsMd({ space: 'acme', projectName: 'acme-repo', target: 'user', kind: 'sdk' })
    const actions = planInstall(
      input({ existing: { skills: {}, agentsMd: fresh, claudeMd: null } }),
    )
    const a = at(actions, 'AGENTS.md')
    expect(a?.reason).toBe('keep')
    expect(a?.content).toBeNull()
  })
})

describe('planInstall — CLAUDE.md·결정론', () => {
  it('없으면 create', () => {
    expect(at(planInstall(input()), 'CLAUDE.md')?.reason).toBe('create')
  })

  it('있으면 내용과 무관하게 keep — 사용자 파일이다', () => {
    const actions = planInstall(
      input({ existing: { skills: {}, agentsMd: null, claudeMd: '# 내가 쓴 CLAUDE.md\n' } }),
    )
    const a = at(actions, 'CLAUDE.md')
    expect(a?.reason).toBe('keep')
    expect(a?.content).toBeNull()
  })

  it('액션은 경로 오름차순으로 정렬된다', () => {
    const paths = planInstall(input()).map((a) => a.path)
    expect(paths).toEqual([...paths].sort())
  })

  it('입력 객체를 바꾸지 않는다', () => {
    const i = input({
      existing: {
        skills: { 'bstage-template': renderSkill('bstage-template') },
        agentsMd: null,
        claudeMd: null,
      },
    })
    const snapshot = JSON.stringify(i)
    planInstall(i)
    expect(JSON.stringify(i)).toBe(snapshot)
  })
})
