import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { loadLink } from '../portal/config.js'
import { listCredentialOrgs, saveCredential } from '../portal/credentials.js'
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

describe('link — 토큰 스테이지 스코프', () => {
  // 이 블록만 쓰는 라우트 — 조직에 스테이지가 셋이고, 토큰이 그중 하나로 묶인 상황을 만든다.
  const scopeRoutes: Record<string, unknown> = {
    '/api/v1/auth/me': {
      user: { id: 'u', email: 'a@b' },
      memberships: [{ organizationId: 'org2' }],
    },
    '/api/v1/organizations/org2/spaces': {
      spaces: [
        { spaceId: 'sp1', tier: 'thor' },
        { spaceId: 'sp2', tier: 'thor' },
        { spaceId: 'sp3', tier: 'thor' },
      ],
    },
    '/api/v1/organizations/org2/stages/sp2/repos': {
      repos: [
        {
          id: 'r9',
          spaceId: 'sp2',
          surface: 'USER',
          owner: 'acme',
          repo: 'only',
          defaultBranch: 'main',
        },
      ],
    },
    '/api/v1/organizations/org2/stages/sp1/repos': { repos: [] },
    '/api/v1/organizations/org2/stages/sp3/repos': { repos: [] },
  }
  const scopeFetch = (async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname
    return new Response(JSON.stringify(scopeRoutes[path] ?? { error: path }), {
      status: scopeRoutes[path] ? 200 : 404,
    })
  }) as unknown as typeof fetch

  /**
   * 스테이지 하나로 묶인 토큰인데 조직의 스테이지를 전부 후보로 보여 주면, 쓸 수 있는 곳이
   * 하나뿐인데도 `--space`를 요구한다(실측에서 후보 5개를 늘어놓았다). 고른 뒤에는 권한
   * 오류로 끝나므로 후보로 보여 줄 이유가 없다.
   */
  it('토큰이 스테이지 하나면 --space 없이도 자동 선택한다', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'link-'))
    const env = { XDG_CONFIG_HOME: cwd }
    await saveCredential(
      {
        portalUrl: 'https://p.example',
        token: 'bsc_x',
        savedAt: '',
        organizationId: 'org2',
        spaceIds: ['sp2'],
      },
      env,
    )

    await linkCommand(
      { portal: 'https://p.example', org: 'org2', yes: true },
      { cwd, env, fetch: scopeFetch },
    )

    expect(await loadLink(cwd, {})).toMatchObject({ organizationId: 'org2', spaceId: 'sp2' })
  })

  /** 조직 전체 토큰은 좁힐 근거가 없다 — 예전처럼 후보를 모두 보여 주고 지정을 요구한다. */
  it('조직 전체 토큰이면 좁히지 않는다', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'link-'))
    const env = { XDG_CONFIG_HOME: cwd }
    await saveCredential(
      {
        portalUrl: 'https://p.example',
        token: 'bsc_x',
        savedAt: '',
        organizationId: 'org2',
        allSpaces: true,
      },
      env,
    )

    let seen: string[] = []
    await linkCommand(
      { portal: 'https://p.example', org: 'org2' },
      {
        cwd,
        env,
        fetch: scopeFetch,
        select: async (_m, items) => {
          if (seen.length === 0) seen = items.map((i) => String(i.label))
          return items[1].value
        },
      },
    )

    expect(seen).toHaveLength(3)
  })

  /**
   * `BSTAGE_TOKEN`이 있으면 실제 인증에 쓰는 토큰은 저장된 자격증명과 무관하다. 그 스코프로
   * 좁히면 환경변수 토큰이 쓸 수 없는 스테이지가 후보 하나가 되어 묻지 않고 선택된다 —
   * 링크 파일은 이후 배포 명령이 그대로 읽으므로 사람이 고르지 않은 스테이지가 남는다.
   */
  it('BSTAGE_TOKEN 이 있으면 좁히지 않는다', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'link-'))
    const env = { XDG_CONFIG_HOME: cwd, BSTAGE_TOKEN: 'bsc_env' }
    await saveCredential(
      {
        portalUrl: 'https://p.example',
        token: 'bsc_x',
        savedAt: '',
        organizationId: 'org2',
        spaceIds: ['sp2'],
      },
      env,
    )

    let seen: string[] = []
    await linkCommand(
      { portal: 'https://p.example', org: 'org2' },
      {
        cwd,
        env,
        fetch: scopeFetch,
        select: async (_m, items) => {
          if (seen.length === 0) seen = items.map((i) => String(i.label))
          return items[1].value
        },
      },
    )

    expect(seen).toHaveLength(3)
  })

  /**
   * 조직 미상(`*`) 항목과 조직 키 항목이 한 포털에 **함께 있을 수는 없다** — 조직 키 항목을
   * 저장할 때 `saveCredential`이 그 포털의 `*` 항목을 걷어낸다. 인증은 `*` 토큰으로 하고 좁히기는
   * 조직 키 항목으로 하는 조합이 성립하지 않는다는 뜻이라, 그 불변식을 여기서 고정한다.
   */
  it('조직 키 항목을 저장하면 같은 포털의 조직 미상 항목은 사라진다', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'link-'))
    const env = { XDG_CONFIG_HOME: cwd }
    await saveCredential({ portalUrl: 'https://p.example', token: 'bsc_star', savedAt: '' }, env)
    await saveCredential(
      {
        portalUrl: 'https://p.example',
        token: 'bsc_org2',
        savedAt: '',
        organizationId: 'org2',
        spaceIds: ['sp2'],
      },
      env,
    )

    const orgs = await listCredentialOrgs('https://p.example', env)
    expect(orgs).toEqual(['org2'])
  })

  /** 조직 미상(`*`)으로 저장된 옛 자격증명의 스코프는 이 조직의 것이 아니다. */
  it('조직 미상 자격증명으로는 좁히지 않는다', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'link-'))
    const env = { XDG_CONFIG_HOME: cwd }
    await saveCredential(
      { portalUrl: 'https://p.example', token: 'bsc_x', savedAt: '', spaceIds: ['sp2'] },
      env,
    )

    let seen: string[] = []
    await linkCommand(
      { portal: 'https://p.example', org: 'org2' },
      {
        cwd,
        env,
        fetch: scopeFetch,
        select: async (_m, items) => {
          if (seen.length === 0) seen = items.map((i) => String(i.label))
          return items[1].value
        },
      },
    )

    expect(seen).toHaveLength(3)
  })

  /** 붙여 넣기 경로(`--token`)는 스코프를 모른 채 저장된다 — 그때도 좁히지 않는다. */
  it('스코프 정보가 없으면 좁히지 않는다', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'link-'))
    const env = { XDG_CONFIG_HOME: cwd }
    await saveCredential(
      { portalUrl: 'https://p.example', token: 'bsc_x', savedAt: '', organizationId: 'org2' },
      env,
    )

    let seen: string[] = []
    await linkCommand(
      { portal: 'https://p.example', org: 'org2' },
      {
        cwd,
        env,
        fetch: scopeFetch,
        select: async (_m, items) => {
          if (seen.length === 0) seen = items.map((i) => String(i.label))
          return items[1].value
        },
      },
    )

    expect(seen).toHaveLength(3)
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
