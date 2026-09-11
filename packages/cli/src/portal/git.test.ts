import { describe, expect, it } from 'vitest'
import { assertDeployable, readGitState, type Exec } from './git.js'

function fake(map: Record<string, string | Error>): Exec {
  return async (args) => {
    const key = args.join(' ')
    const v = map[key]
    if (v === undefined) throw new Error(`unexpected git ${key}`)
    if (v instanceof Error) throw v
    return v
  }
}

const clean = {
  'rev-parse --abbrev-ref HEAD': 'main\n',
  'rev-parse HEAD': 'abc1234def\n',
  'status --porcelain': '',
  'rev-parse --abbrev-ref --symbolic-full-name @{u}': 'origin/main\n',
  'rev-list --left-right --count HEAD...@{u}': '0\t0\n',
}

describe('readGitState', () => {
  it('깨끗하고 push된 상태를 읽는다', async () => {
    expect(await readGitState(fake(clean))).toEqual({
      branch: 'main',
      head: 'abc1234def',
      dirty: false,
      upstream: 'origin/main',
      ahead: 0,
      behind: 0,
    })
  })
  it('업스트림이 없으면 null·0', async () => {
    const s = await readGitState(
      fake({
        ...clean,
        'rev-parse --abbrev-ref --symbolic-full-name @{u}': new Error('no upstream'),
      }),
    )
    expect(s.upstream).toBeNull()
    expect(s.ahead).toBe(0)
  })
  it('더티·ahead를 읽는다', async () => {
    const s = await readGitState(
      fake({
        ...clean,
        'status --porcelain': ' M a.ts\n',
        'rev-list --left-right --count HEAD...@{u}': '2\t0\n',
      }),
    )
    expect(s.dirty).toBe(true)
    expect(s.ahead).toBe(2)
  })
})

describe('assertDeployable', () => {
  const base = {
    branch: 'main',
    head: 'x',
    dirty: false,
    upstream: 'origin/main',
    ahead: 0,
    behind: 0,
  }
  it('통과', () => expect(() => assertDeployable(base, 'main')).not.toThrow())
  it('더티 트리', () =>
    expect(() => assertDeployable({ ...base, dirty: true }, 'main')).toThrow(/커밋되지 않은 변경/))
  it('다른 브랜치', () =>
    expect(() => assertDeployable({ ...base, branch: 'feat' }, 'main')).toThrow(/main.*브랜치/))
  it('push 안 됨', () =>
    expect(() => assertDeployable({ ...base, ahead: 1 }, 'main')).toThrow(/push/))
  it('업스트림 없음', () =>
    expect(() => assertDeployable({ ...base, upstream: null }, 'main')).toThrow(/push/))
})
