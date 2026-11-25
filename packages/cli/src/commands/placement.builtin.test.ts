import { describe, expect, it } from 'vitest'
import type { Exec } from '../portal/git.js'
import { fake, project } from './builtinFake.js'
import { placementCreateCommand } from './placement.js'

/** fake() 위에 빌드·배치 라우트를 얹는다(성공 빌드 없음 → 빌드부터). */
function portal(opts: Parameters<typeof fake>[0]) {
  const f = fake(opts)
  const created: string[] = []
  const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s })
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname
    const method = init?.method ?? 'GET'
    const build = {
      id: 'b1',
      surface: 'USER',
      stageRepoId: 'r1',
      commitSha: 'abc',
      status: 'SUCCEEDED',
      requestedAt: '2026-09-30T01:00:00Z',
      artifacts: [{ name: 'home', kind: 'sdk' }],
    }
    if (path.endsWith('/builds') && method === 'POST') {
      created.push('build')
      return j({ ...build, status: 'QUEUED' }, 201)
    }
    if (path.endsWith('/builds')) return j({ builds: [] })
    if (path.endsWith('/builds/b1')) return j(build)
    if (path.endsWith('/builds/b1/log')) return new Response('log\n')
    if (path.endsWith('/placements') && method === 'POST') {
      created.push('placement')
      return j(
        {
          id: 'p1',
          surface: 'USER',
          kind: 'PAGE',
          path: '/home',
          stageRepoId: 'r1',
          status: 'READY',
        },
        201,
      )
    }
    if (path.endsWith('/placements')) return j({ placements: [] })
    return f.fetch(input, init)
  }) as unknown as typeof fetch
  return { fetch: fetchFn, created }
}

const failGit: Exec = async () => {
  throw new Error('git 을 부르면 안 됩니다')
}

describe('placement create — 저장소 종류', () => {
  it('내장 저장소는 git 사전점검 없이 빌드부터 한다', async () => {
    const p = portal({ source: 'builtin' })
    const s = await project()
    await placementCreateCommand(
      { template: 'home', yes: true },
      { ...s, fetch: p.fetch, exec: failGit, out: () => {}, sleep: async () => {} },
    )
    expect(p.created).toEqual(['build', 'placement'])
  })

  it('source 가 없으면 기존처럼 git 사전점검을 먼저 한다', async () => {
    const p = portal({})
    const s = await project()
    const dirty: Exec = async (a) => (a.join(' ') === 'status --porcelain' ? ' M x\n' : '')
    await expect(
      placementCreateCommand(
        { template: 'home', yes: true },
        { ...s, fetch: p.fetch, exec: dirty, out: () => {}, sleep: async () => {} },
      ),
    ).rejects.toMatchObject({ code: 2 })
    expect(p.created).toEqual([])
  })

  // AWS Security Agent 8차 M, Ruling 26
  it('서버가 builtin 이어도 링크 파일이 builtin 이 아니면 git 점검을 건너뛰고 빌드하지 않는다', async () => {
    const p = portal({ source: 'builtin' })
    const s = await project({}, undefined, null)
    await expect(
      placementCreateCommand(
        { template: 'home', yes: true },
        { ...s, fetch: p.fetch, exec: failGit, out: () => {}, sleep: async () => {} },
      ),
    ).rejects.toMatchObject({ code: 2 })
    expect(p.created).toEqual([])
  })
})
