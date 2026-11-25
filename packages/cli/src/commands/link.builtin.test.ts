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
}
const gh = {
  id: 'r1',
  spaceId: 'sp1',
  surface: 'USER',
  owner: 'acme',
  repo: 'web',
  defaultBranch: 'main',
}
const builtin = {
  id: 'r9',
  spaceId: 'sp1',
  surface: 'USER',
  owner: 'builtin',
  repo: 'x',
  defaultBranch: 'main',
  source: 'builtin',
  name: '내 템플릿',
}
const withRepos = (repos: unknown[]) =>
  (async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname
    const body = path.endsWith('/repos') ? { repos } : routes[path]
    return new Response(JSON.stringify(body ?? { error: path }), { status: body ? 200 : 404 })
  }) as unknown as typeof fetch

async function setup() {
  const cwd = await mkdtemp(join(tmpdir(), 'link-'))
  const env = { XDG_CONFIG_HOME: cwd }
  await saveCredential({ portalUrl: 'https://p.example', token: 'bsc_x', savedAt: '' }, env)
  return { cwd, env }
}

describe('link — 내장 저장소', () => {
  it('GitHub 1개 + 내장 1개 스테이지는 질문 없이 GitHub 를 자동 선택한다', async () => {
    const { cwd, env } = await setup()
    const select = vi.fn()
    await linkCommand(
      { portal: 'https://p.example', yes: true },
      { cwd, env, fetch: withRepos([builtin, gh]), select },
    )
    expect(select).not.toHaveBeenCalled()
    expect((await loadLink(cwd, {}))?.repoId).toBe('r1')
  })

  it('내장 레포는 `name (내장)` 으로 보이고 직접 고르면 링크된다', async () => {
    const { cwd, env } = await setup()
    let labels: string[] = []
    await linkCommand(
      { portal: 'https://p.example' },
      {
        cwd,
        env,
        fetch: withRepos([gh, { ...gh, id: 'r2', repo: 'admin' }, builtin]),
        select: async (_m, items) => {
          labels = items.map((i) => i.label)
          return items[2].value
        },
      },
    )
    expect(labels[2]).toContain('내 템플릿 (내장)')
    expect((await loadLink(cwd, {}))?.repoId).toBe('r9')
  })

  it('내장 레포만 있으면 --yes 로는 자동 선택하지 않고 --repo 를 요구한다', async () => {
    const { cwd, env } = await setup()
    await expect(
      linkCommand(
        { portal: 'https://p.example', yes: true },
        { cwd, env, fetch: withRepos([builtin]) },
      ),
    ).rejects.toMatchObject({ code: 2 })
    await linkCommand(
      { portal: 'https://p.example', yes: true, repo: 'r9' },
      { cwd, env, fetch: withRepos([builtin]) },
    )
    expect((await loadLink(cwd, {}))?.repoId).toBe('r9')
  })

  describe('--repo 지정(AWS Security Agent 2차 M2)', () => {
    const named = { ...builtin, name: 'acme/web' }

    it('GitHub acme/web 과 이름이 acme/web 인 내장 저장소가 있으면 --repo acme/web 은 GitHub 를 고른다', async () => {
      for (const order of [
        [gh, named],
        [named, gh],
      ]) {
        const { cwd, env } = await setup()
        await linkCommand(
          { portal: 'https://p.example', yes: true, repo: 'acme/web' },
          { cwd, env, fetch: withRepos(order) },
        )
        expect((await loadLink(cwd, {}))?.repoId).toBe('r1')
      }
    })

    it('--repo builtin:acme/web 은 내장 저장소를 고른다(BSTAGE_REPO 도 같다)', async () => {
      const { cwd, env } = await setup()
      await linkCommand(
        { portal: 'https://p.example', yes: true, repo: 'builtin:acme/web' },
        { cwd, env, fetch: withRepos([gh, named]) },
      )
      expect((await loadLink(cwd, {}))?.repoId).toBe('r9')

      const b = await setup()
      await linkCommand(
        { portal: 'https://p.example', yes: true },
        {
          cwd: b.cwd,
          env: { ...b.env, BSTAGE_REPO: 'builtin:acme/web' },
          fetch: withRepos([gh, named]),
        },
      )
      expect((await loadLink(b.cwd, {}))?.repoId).toBe('r9')
    })

    it('내장 저장소는 맨 이름으로는 고르지 않는다', async () => {
      const { cwd, env } = await setup()
      await expect(
        linkCommand(
          { portal: 'https://p.example', yes: true, repo: '내 템플릿' },
          { cwd, env, fetch: withRepos([builtin]) },
        ),
      ).rejects.toMatchObject({ code: 2 })
    })

    it('지정한 값에 둘 이상이 맞으면 고르지 않고 실패한다', async () => {
      const { cwd, env } = await setup()
      await expect(
        linkCommand(
          { portal: 'https://p.example', yes: true, repo: 'acme/web' },
          { cwd, env, fetch: withRepos([gh, { ...gh, id: 'r2' }]) },
        ),
      ).rejects.toMatchObject({ code: 2, message: expect.stringContaining('여러 개') })
    })

    it('후보 표시에서 서버 값의 이스케이프·제어 문자를 무해한 U+FFFD 로 보인다(L1)', async () => {
      const { cwd, env } = await setup()
      const evil = { ...builtin, name: 'x\x1b[2J\x1b]8;;https://evil\x07y\r' }
      const e = await linkCommand(
        { portal: 'https://p.example', yes: true },
        { cwd, env, fetch: withRepos([evil]) },
      ).catch((x: Error) => x)
      expect((e as Error).message).toContain('x\uFFFD\uFFFDy\uFFFD (내장)')
      // eslint-disable-next-line no-control-regex
      expect((e as Error).message).not.toMatch(/[\x00-\x1f\x7f-\x9f]/)
    })
  })

  // AWS Security Agent 8차 M, Ruling 26 — 내장 레포는 링크 파일에 source 를 남기고, GitHub 레포는 예전 그대로.
  it('내장 레포를 링크하면 source: builtin 을 저장하고, GitHub 레포는 source 를 적지 않는다', async () => {
    const a = await setup()
    await linkCommand(
      { portal: 'https://p.example', yes: true, repo: 'r9' },
      { cwd: a.cwd, env: a.env, fetch: withRepos([builtin]) },
    )
    expect((await loadLink(a.cwd, {}))?.source).toBe('builtin')
    const b = await setup()
    await linkCommand(
      { portal: 'https://p.example', yes: true, repo: 'r1' },
      { cwd: b.cwd, env: b.env, fetch: withRepos([gh]) },
    )
    expect(await loadLink(b.cwd, {})).not.toHaveProperty('source')
  })
})
