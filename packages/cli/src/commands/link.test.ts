import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { loadLink } from '../portal/config.js'
import { saveCredential } from '../portal/credentials.js'
import { linkCommand } from './link.js'

const routes: Record<string, unknown> = {
  '/api/v1/auth/me': { user: { id: 'u', email: 'a@b' }, memberships: [{ organizationId: 'org1' }] },
  '/api/v1/organizations/org1/spaces': { spaces: [{ spaceId: 'sp1', tier: 'thor' }] },
  '/api/v1/organizations/org1/stages/sp1/repos': {
    repos: [
      {
        id: 'r1',
        spaceId: 'sp1',
        surface: 'USER',
        owner: 'acme',
        repo: 'web',
        defaultBranch: 'main',
      },
      {
        id: 'r2',
        spaceId: 'sp1',
        surface: 'ADMIN',
        owner: 'acme',
        repo: 'admin',
        defaultBranch: 'main',
      },
    ],
  },
}
const fetchImpl = (async (input: string | URL | Request) => {
  const path = new URL(String(input)).pathname
  return new Response(JSON.stringify(routes[path] ?? { error: path }), {
    status: routes[path] ? 200 : 404,
  })
}) as unknown as typeof fetch

async function setup() {
  const cwd = await mkdtemp(join(tmpdir(), 'link-'))
  const env = { XDG_CONFIG_HOME: cwd }
  await saveCredential({ portalUrl: 'https://p.example', token: 'bsc_x', savedAt: '' }, env)
  return { cwd, env }
}

describe('link', () => {
  it('유일한 조직·스테이지는 자동 선택하고 레포는 select로 고른다', async () => {
    const { cwd, env } = await setup()
    await linkCommand(
      { portal: 'https://p.example' },
      { cwd, env, fetch: fetchImpl, select: async (_m, items) => items[1].value },
    )
    expect(await loadLink(cwd, {})).toEqual({
      portalUrl: 'https://p.example',
      organizationId: 'org1',
      spaceId: 'sp1',
      repoId: 'r2',
      surface: 'ADMIN',
    })
  })

  it('--repo 로 지정하면 프롬프트 없이 저장한다', async () => {
    const { cwd, env } = await setup()
    await linkCommand(
      { portal: 'https://p.example', repo: 'r1', yes: true },
      { cwd, env, fetch: fetchImpl },
    )
    expect((await loadLink(cwd, {}))?.repoId).toBe('r1')
  })

  it('--yes 인데 레포가 여러 개고 지정도 없으면 PRECONDITION', async () => {
    const { cwd, env } = await setup()
    await expect(
      linkCommand({ portal: 'https://p.example', yes: true }, { cwd, env, fetch: fetchImpl }),
    ).rejects.toMatchObject({ code: 2 })
  })

  it('--repo 가 owner/repo 형식이면 그 레포를 찾는다', async () => {
    const { cwd, env } = await setup()
    await linkCommand(
      { portal: 'https://p.example', repo: 'acme/admin', yes: true },
      { cwd, env, fetch: fetchImpl },
    )
    expect((await loadLink(cwd, {}))?.repoId).toBe('r2')
  })
})

describe('link — --json 게이트', () => {
  it('--json 은 --yes 없이 쓸 수 없다(피커가 stdout을 더럽히지 않게)', async () => {
    const { cwd, env } = await setup()
    let selectCalled = false
    await expect(
      linkCommand(
        { portal: 'https://p.example', json: true },
        {
          cwd,
          env,
          fetch: fetchImpl,
          select: async (_m, items) => ((selectCalled = true), items[0].value),
        },
      ),
    ).rejects.toMatchObject({ code: 2 })
    expect(selectCalled).toBe(false)
    expect(await loadLink(cwd, {})).toBeNull()
  })

  it('--json --yes 는 링크 객체만 stdout에 쓴다', async () => {
    const { cwd, env } = await setup()
    const writes: string[] = []
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      writes.push(String(chunk))
      return true
    })
    try {
      await linkCommand(
        { portal: 'https://p.example', repo: 'r1', yes: true, json: true },
        { cwd, env, fetch: fetchImpl },
      )
    } finally {
      spy.mockRestore()
    }
    expect(writes).toHaveLength(1)
    expect((JSON.parse(writes[0]) as { repoId: string }).repoId).toBe('r1')
  })
})

describe('link — git origin 기본값', () => {
  it('origin이 레포와 유일하게 일치하면 --yes로도 자동 선택된다', async () => {
    const { cwd, env } = await setup()
    const exec = async () => 'git@github.com:acme/admin.git'
    await linkCommand(
      { portal: 'https://p.example', yes: true },
      { cwd, env, fetch: fetchImpl, exec },
    )
    expect((await loadLink(cwd, {}))?.repoId).toBe('r2')
  })

  it('origin이 없으면 --yes 인데 레포가 여러 개면 여전히 PRECONDITION', async () => {
    const { cwd, env } = await setup()
    const exec = async () => {
      throw new Error('fatal: No such remote')
    }
    await expect(
      linkCommand({ portal: 'https://p.example', yes: true }, { cwd, env, fetch: fetchImpl, exec }),
    ).rejects.toMatchObject({ code: 2 })
  })

  it.each([['git@github.com:acme/web.git'], ['https://github.com/acme/web']])(
    'origin(%s) 형식과 무관하게 owner/repo로 매칭된다',
    async (originUrl) => {
      const { cwd, env } = await setup()
      const exec = async () => originUrl
      await linkCommand(
        { portal: 'https://p.example', yes: true },
        { cwd, env, fetch: fetchImpl, exec },
      )
      expect((await loadLink(cwd, {}))?.repoId).toBe('r1')
    },
  )
  it('--org 로 지정한 조직의 토큰으로 포털에 묻는다', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'link-'))
    const env = { XDG_CONFIG_HOME: cwd }
    await saveCredential(
      { portalUrl: 'https://p.example', organizationId: 'org1', token: 'bsc_1', savedAt: '' },
      env,
    )
    await saveCredential(
      { portalUrl: 'https://p.example', organizationId: 'org2', token: 'bsc_2', savedAt: '' },
      env,
    )
    const seen: string[] = []
    const spyFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      seen.push(String((init?.headers as Record<string, string>)?.Authorization))
      return fetchImpl(input, init)
    }) as unknown as typeof fetch
    await linkCommand(
      { portal: 'https://p.example', org: 'org1', repo: 'r1', yes: true },
      { cwd, env, fetch: spyFetch },
    )
    expect(new Set(seen)).toEqual(new Set(['Bearer bsc_1']))
  })

  it('조직이 여러 개인데 --org 가 없으면 AUTH — 조직 목록을 안내한다', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'link-'))
    const env = { XDG_CONFIG_HOME: cwd }
    await saveCredential(
      { portalUrl: 'https://p.example', organizationId: 'org1', token: 'bsc_1', savedAt: '' },
      env,
    )
    await saveCredential(
      { portalUrl: 'https://p.example', organizationId: 'org2', token: 'bsc_2', savedAt: '' },
      env,
    )
    await expect(
      linkCommand(
        { portal: 'https://p.example', repo: 'r1', yes: true },
        { cwd, env, fetch: fetchImpl },
      ),
    ).rejects.toMatchObject({ code: 3, message: expect.stringContaining('--org') })
  })
})
