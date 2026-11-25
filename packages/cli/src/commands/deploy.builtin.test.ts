import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { Exec } from '../portal/git.js'
import { fake, project, sha } from './builtinFake.js'
import { deployCommand } from './deploy.js'

const HEAD = 'a'.repeat(32)

/** fake() 위에 빌드·배치 라우트를 얹고 호출 순서를 기록한다. */
function portal(opts: Parameters<typeof fake>[0]) {
  const f = fake(opts)
  const order: string[] = []
  const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s })
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname
    const method = init?.method ?? 'GET'
    if (path.endsWith('/builds') && method === 'POST') {
      order.push('build')
      return j(
        {
          id: 'b1',
          status: 'QUEUED',
          commitSha: 'abc',
          ...(opts?.source === 'builtin' ? { sourceVersionNo: 5 } : {}),
        },
        201,
      )
    }
    if (path.endsWith('/builds/b1'))
      return j({
        id: 'b1',
        status: 'SUCCEEDED',
        commitSha: 'abc',
        ...(opts?.source === 'builtin' ? { sourceVersionNo: 5 } : {}),
      })
    if (path.endsWith('/builds/b1/log')) return new Response('log\n')
    if (path.endsWith('/placements')) {
      return j({
        placements: [
          {
            id: 'p1',
            surface: 'USER',
            kind: 'PAGE',
            path: '/l',
            stageRepoId: 'r1',
            status: 'READY',
          },
        ],
      })
    }
    if (path.endsWith('/deploy')) {
      order.push('deploy')
      return j({ id: 'p1', liveBuildId: 'b1' })
    }
    if (path.endsWith('/code/uploads') && method === 'POST') order.push('upload-begin')
    if (path.endsWith('/complete')) order.push('upload-complete')
    return f.fetch(input, init)
  }) as unknown as typeof fetch
  return { fetch: fetchFn, order, f }
}

const failGit: Exec = async () => {
  throw new Error('git 을 부르면 안 됩니다')
}

const base = { exec: failGit, out: () => {}, sleep: async () => {} }

describe('deploy — 내장 저장소', () => {
  it('링크한 레포가 스테이지에 없으면 레포 id 를 넣은 예전 문구로 끝낸다', async () => {
    const p = portal({ source: 'builtin' })
    const s = await project({ 'a.txt': 'A' }, HEAD)
    const fetchFn = (async (input: string | URL | Request, init?: RequestInit) =>
      new URL(String(input)).pathname.endsWith('/repos')
        ? new Response(JSON.stringify({ repos: [] }))
        : p.fetch(input, init)) as typeof fetch
    await expect(
      deployCommand({ yes: true }, { ...s, ...base, fetch: fetchFn }),
    ).rejects.toMatchObject({
      code: 2,
      message: '연결된 레포 r1를 콘솔에서 찾을 수 없습니다. bstage link를 다시 실행하세요.',
    })
    expect(p.order).toEqual([])
  })

  it('확인 표와 빌드 시작 안내에 커밋 SHA 대신 v{번호}를 보여준다', async () => {
    const p = portal({ source: 'builtin' })
    const s = await project({ 'a.txt': 'A' }, HEAD)
    const lines: string[] = []
    const err: string[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((m: string) => void err.push(m))
    try {
      await expect(
        deployCommand(
          {},
          {
            ...s,
            ...base,
            fetch: p.fetch,
            out: (l) => void lines.push(l),
            confirm: async () => false,
          },
        ),
      ).rejects.toMatchObject({ code: 2 })
    } finally {
      spy.mockRestore()
    }
    const text = lines.join('\n')
    expect(text).toContain('빌드 b1 (버전 v5)')
    expect(text).toMatch(/\/l.*v5/)
    expect(err.join('\n')).toContain('빌드 b1 시작 (v5)')
  })

  it('git 사전점검을 건너뛴다(git 을 부르지 않는다)', async () => {
    const p = portal({ source: 'builtin' })
    const s = await project({ 'a.txt': 'A' }, HEAD)
    await deployCommand({ yes: true }, { ...s, ...base, fetch: p.fetch })
    expect(p.order).toEqual(['build', 'deploy'])
  })

  it('올리지 않은 변경 N개를 경고한다(기준과 비교)', async () => {
    const p = portal({ source: 'builtin' })
    const s = await project({ 'a.txt': 'A', 'b.txt': 'B2' }, HEAD)
    await mkdir(join(s.cwd, '.bstage'), { recursive: true })
    await writeFile(
      join(s.cwd, '.bstage/builtin-manifest.json'),
      JSON.stringify({
        repoId: 'r1',
        versionId: HEAD,
        files: { 'a.txt': sha('A'), 'b.txt': sha('B'), 'gone.txt': sha('G') },
      }),
    )
    const out: string[] = []
    await deployCommand(
      { yes: true },
      { ...s, ...base, fetch: p.fetch, out: (l) => void out.push(l) },
    )
    // b.txt 변경 + gone.txt 삭제 = 2
    expect(out.join('\n')).toContain('올리지 않은 변경 2개')
  })

  it('--push 는 올리기를 끝낸 뒤에 빌드한다', async () => {
    const p = portal({ source: 'builtin' })
    const s = await project({ 'a.txt': 'A' }, HEAD)
    await deployCommand({ yes: true, push: true }, { ...s, ...base, fetch: p.fetch })
    expect(p.order).toEqual(['upload-begin', 'upload-complete', 'build', 'deploy'])
  })

  it('--push 가 실패하면 빌드하지 않는다', async () => {
    const p = portal({ source: 'builtin', head: { id: 'c'.repeat(32), number: 3 } })
    const s = await project({ 'a.txt': 'A' }, HEAD)
    await expect(
      deployCommand({ yes: true, push: true }, { ...s, ...base, fetch: p.fetch }),
    ).rejects.toMatchObject({ code: 1 })
    expect(p.order).not.toContain('build')
  })

  it('GitHub 레포에서 --push 는 빌드 전에 PRECONDITION 으로 막는다', async () => {
    const p = portal({})
    const s = await project({ 'a.txt': 'A' })
    await expect(
      deployCommand({ yes: true, push: true }, { ...s, ...base, fetch: p.fetch }),
    ).rejects.toMatchObject({ code: 2 })
    expect(p.order).toEqual([])
  })

  it('source 가 없는 레포는 기존처럼 git 사전점검을 먼저 부른다', async () => {
    const p = portal({})
    const s = await project({ 'a.txt': 'A' })
    const calls: string[] = []
    const dirty: Exec = async (a) => {
      calls.push(a.join(' '))
      return a.join(' ') === 'status --porcelain' ? ' M x\n' : ''
    }
    await expect(
      deployCommand({ yes: true }, { ...s, ...base, exec: dirty, fetch: p.fetch }),
    ).rejects.toMatchObject({ code: 2 })
    expect(calls.length).toBeGreaterThan(0)
    expect(p.order).toEqual([])
  })

  // AWS Security Agent 8차 M, Ruling 26 — 서버 source 만 믿지 않는다.
  it.each([
    ['source 없는 옛 링크 파일', null, 'bstage link'],
    ['GitHub 로 링크한 파일', 'github' as const, 'GitHub 레포였습니다'],
  ])(
    '서버가 builtin 이어도 %s 이면 --push 로 올리지 않고 빌드하지 않는다',
    async (_n, src, msg) => {
      const p = portal({ source: 'builtin' })
      const s = await project({ 'a.txt': 'A' }, HEAD, src)
      await expect(
        deployCommand({ yes: true, push: true }, { ...s, ...base, fetch: p.fetch }),
      ).rejects.toMatchObject({ code: 2, message: expect.stringContaining(msg) })
      expect(p.order).toEqual([])
      expect(p.f.puts).toEqual([])
    },
  )

  it('서버가 builtin 이어도 링크 파일이 builtin 이 아니면 --push 없이도 git 점검을 건너뛰지 않는다(멈춘다)', async () => {
    const p = portal({ source: 'builtin' })
    const s = await project({ 'a.txt': 'A' }, HEAD, null)
    await expect(
      deployCommand({ yes: true }, { ...s, ...base, fetch: p.fetch }),
    ).rejects.toMatchObject({ code: 2 })
    expect(p.order).toEqual([])
  })
})
