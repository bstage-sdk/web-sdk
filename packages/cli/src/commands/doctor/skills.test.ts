import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VERSION, skillStamp, skillsFor } from '@bstage-sdk/ai-toolkit'
import { afterEach, describe, expect, it } from 'vitest'
import { diagnoseSkills } from './skills.js'

/**
 * doctor의 스킬 판정은 자동 동기화(덮어쓰기)의 근거다. 옛 CLI가 새 CLI의 설치본을 "구버전"으로
 * 보면 그대로 하향 덮어쓰기가 일어난다 — 손 검증은 항상 최신 CLI로 하므로 이 분기를 지나지 않는다.
 */

const dirs: string[] = []

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

function project(skills: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'bstage-doctor-skills-'))
  dirs.push(root)
  writeFileSync(join(root, 'package.json'), '{"name":"t","private":true}\n', 'utf-8')
  for (const [name, content] of Object.entries(skills)) {
    const dir = join(root, '.claude', 'skills', name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'SKILL.md'), content, 'utf-8')
  }
  return root
}

function rendered(name: string): string {
  const skill = skillsFor('sdk').find((s) => s.name === name)
  if (!skill) throw new Error(`알 수 없는 스킬: ${name}`)
  return skill.content({ kind: 'sdk', target: 'user' })
}

describe('diagnoseSkills', () => {
  it('설치본의 스탬프가 이 CLI의 toolkit보다 높으면 stale이 아니라 newer다', async () => {
    const [major = '0', ...rest] = VERSION.split('.')
    const bumped = [String(Number(major) + 1), ...rest].join('.')
    const newer = rendered('bstage-deploy').replace(skillStamp(), skillStamp(bumped)) + '\n새 줄\n'
    const root = project({ 'bstage-deploy': newer })

    const rows = await diagnoseSkills(root, 'sdk')

    expect(rows.find((r) => r.name === 'bstage-deploy')?.status).toBe('newer')
    expect(rows.find((r) => r.name === 'bstage-onboarding')?.status).toBe('missing')
  })

  it('스탬프가 같은데 본문이 다르면 stale이다', async () => {
    const root = project({ 'bstage-deploy': rendered('bstage-deploy') + '\n손수정\n' })

    const rows = await diagnoseSkills(root, 'sdk')

    expect(rows.find((r) => r.name === 'bstage-deploy')?.status).toBe('stale')
  })
})
