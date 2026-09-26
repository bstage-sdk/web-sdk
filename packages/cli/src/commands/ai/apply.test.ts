import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { InstallAction } from '@bstage-sdk/ai-toolkit'
import { afterEach, describe, expect, it } from 'vitest'
import { INSTALL_REASONS, applyActions } from './apply.js'

/**
 * 손으로 고친 스킬을 덮는 것은 계약이지만, 고친 내용이 흔적 없이 사라지면 사용자는 무엇을
 * 잃었는지도 모른다. 백업이 실제로 남는지는 파일을 써 봐야 안다.
 */

const dirs: string[] = []

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

function root(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'bstage-apply-'))
  dirs.push(dir)
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true })
    writeFileSync(join(dir, rel), content, 'utf-8')
  }
  return dir
}

const PATH = '.claude/skills/bstage-deploy/SKILL.md'

describe('applyActions — 손수정 백업', () => {
  it('backup 표시가 있으면 덮기 전 내용을 .bak으로 남긴다', () => {
    const dir = root({ [PATH]: '손으로 고친 본문\n' })
    const action: InstallAction = {
      path: PATH,
      content: '새 본문\n',
      reason: 'stale',
      backup: true,
    }

    applyActions(dir, [action], INSTALL_REASONS)

    expect(readFileSync(join(dir, PATH), 'utf-8')).toBe('새 본문\n')
    expect(readFileSync(join(dir, `${PATH}.bak`), 'utf-8')).toBe('손으로 고친 본문\n')
  })

  it('.bak 자리에 심볼릭 링크가 있으면 따라 쓰지 않고 멈춘다 — 원본도 그대로다', () => {
    const dir = root({ [PATH]: '손으로 고친 본문\n', 'outside.txt': '밖\n' })
    symlinkSync(join(dir, 'outside.txt'), join(dir, `${PATH}.bak`))
    const action: InstallAction = {
      path: PATH,
      content: '새 본문\n',
      reason: 'stale',
      backup: true,
    }

    expect(() => applyActions(dir, [action], INSTALL_REASONS)).toThrow(/심볼릭 링크/)
    expect(readFileSync(join(dir, 'outside.txt'), 'utf-8')).toBe('밖\n')
    expect(readFileSync(join(dir, PATH), 'utf-8')).toBe('손으로 고친 본문\n')
  })

  it('쓰기 대상 자체가 심볼릭 링크면 따라 쓰지 않고 멈춘다', () => {
    const dir = root({ 'outside.txt': '밖\n' })
    mkdirSync(join(dir, PATH, '..'), { recursive: true })
    symlinkSync(join(dir, 'outside.txt'), join(dir, PATH))
    const action: InstallAction = { path: PATH, content: '새 본문\n', reason: 'create' }

    expect(() => applyActions(dir, [action], INSTALL_REASONS)).toThrow(/심볼릭 링크/)
    expect(readFileSync(join(dir, 'outside.txt'), 'utf-8')).toBe('밖\n')
  })

  it('중간 디렉터리가 루트 밖으로의 링크면 쓰지 않고 멈춘다 — 경로 문자열만으로는 안에 있어 보인다', () => {
    const dir = root()
    const outside = mkdtempSync(join(tmpdir(), 'bstage-apply-outside-'))
    dirs.push(outside)
    mkdirSync(join(dir, '.claude'), { recursive: true })
    symlinkSync(outside, join(dir, '.claude/skills'))
    const action: InstallAction = { path: PATH, content: '새 본문\n', reason: 'create' }

    expect(() => applyActions(dir, [action], INSTALL_REASONS)).toThrow(/루트|심볼릭 링크/)
    expect(existsSync(join(outside, 'bstage-deploy'))).toBe(false)
  })

  it('이미 있는 일반 파일 .bak은 새 백업으로 바뀐다', () => {
    const dir = root({ [PATH]: '두 번째 손수정\n', [`${PATH}.bak`]: '첫 백업\n' })
    const action: InstallAction = {
      path: PATH,
      content: '새 본문\n',
      reason: 'stale',
      backup: true,
    }

    applyActions(dir, [action], INSTALL_REASONS)

    expect(readFileSync(join(dir, `${PATH}.bak`), 'utf-8')).toBe('두 번째 손수정\n')
  })

  it('backup 표시가 없으면 .bak을 만들지 않는다', () => {
    const dir = root({ [PATH]: '옛 본문\n' })
    const action: InstallAction = { path: PATH, content: '새 본문\n', reason: 'stale' }

    applyActions(dir, [action], INSTALL_REASONS)

    expect(existsSync(join(dir, `${PATH}.bak`))).toBe(false)
  })
})
