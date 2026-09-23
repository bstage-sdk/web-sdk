import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { PORTAL_HOSTS } from '../constants.js'
import { saveLink } from '../portal/config.js'
import { saveCredential } from '../portal/credentials.js'
import * as output from '../portal/output.js'
import type { Build, Placement, StageRepo } from '../portal/types.js'
import { listCommand, renderList } from './list.js'

/** 링크 파일의 포털 주소는 허용 목록(PORTAL_HOSTS) 안이어야 한다. */
const PORTAL = `https://${PORTAL_HOSTS.sandbox}`

const repo: StageRepo = {
  id: 'r1',
  spaceId: 's',
  surface: 'USER',
  owner: 'acme',
  repo: 'widgets',
  defaultBranch: 'main',
}

const placements: Placement[] = [
  {
    id: 'p1',
    surface: 'USER',
    kind: 'PAGE',
    path: '/landing',
    stageRepoId: 'r1',
    liveBuildId: 'b1',
    liveCommit: 'abc1234def',
    status: 'LIVE',
    enabled: true,
  },
  {
    id: 'p2',
    surface: 'USER',
    kind: 'SLOT',
    slotId: 'user.shop-home.section:before',
    stageRepoId: 'r1',
    status: 'NEW_COMMIT',
    enabled: false,
  },
  { id: 'p9', surface: 'USER', kind: 'PAGE', path: '/other', stageRepoId: 'r9', status: 'LIVE' },
]
const builds: Build[] = [
  {
    id: 'b2',
    spaceId: 's',
    surface: 'USER',
    stageRepoId: 'r1',
    commitSha: 'fff0000111',
    status: 'FAILED',
    requestedAt: '2026-09-04T01:00:00Z',
  },
  {
    id: 'b1',
    spaceId: 's',
    surface: 'USER',
    stageRepoId: 'r1',
    commitSha: 'abc1234def',
    status: 'SUCCEEDED',
    requestedAt: '2026-09-03T01:00:00Z',
  },
]

describe('renderList', () => {
  const out = renderList(placements, builds, repo)
  it('다른 레포의 배치는 빼고 자리·상태·커밋·게시를 보여준다', () => {
    expect(out).toContain('/landing')
    expect(out).toContain('user.shop-home.section:before')
    expect(out).not.toContain('/other')
    expect(out).toContain('abc1234')
    expect(out).toMatch(/LIVE.*abc1234.*on/)
    expect(out).toMatch(/NEW_COMMIT.*-.*off/)
  })
  it('최근 빌드를 보여준다', () => {
    expect(out).toContain('b2')
    expect(out).toContain('FAILED')
  })
  it('산출물 kind를 종류 열로 보여준다 (없으면 -)', () => {
    // 같은 레포가 sdk에서 liquid로 넘어가면 옛 빌드로 롤백했을 때 화면이 달라진다.
    // 표에 종류가 없으면 그 사실이 어디에도 드러나지 않는다.
    const mixedBuilds: Build[] = [
      { ...builds[0], id: 'b7', artifacts: [{ name: 'home', kind: 'liquid' }] },
      { ...builds[1], id: 'b8', artifacts: [] },
    ]
    const text = renderList(placements, mixedBuilds, repo)
    expect(text).toMatch(/b7.*liquid/)
    expect(text).toMatch(/b8.*-/)
    expect(text).toContain('종류')
  })

  it('배치가 없으면 안내한다', () => {
    expect(renderList([], builds, repo)).toContain('배치가 없습니다')
  })
  it('stageRepoId 없이 owner/repo만 있는 빌드도 이 레포 것으로 보여준다', () => {
    const ownerOnlyBuilds: Build[] = [
      {
        id: 'b5',
        spaceId: 's',
        surface: 'USER',
        owner: 'ACME',
        repo: 'widgets',
        commitSha: '9998887776',
        status: 'SUCCEEDED',
        requestedAt: '2026-09-05T01:00:00Z',
      },
    ]
    const text = renderList(placements, ownerOnlyBuilds, repo)
    expect(text).toContain('b5')
  })
})

describe('listCommand', () => {
  async function setup() {
    const cwd = await mkdtemp(join(tmpdir(), 'list-'))
    const env = { XDG_CONFIG_HOME: cwd }
    await saveCredential({ portalUrl: PORTAL, token: 'bsc_x', savedAt: '' }, env)
    await saveLink(cwd, {
      portalUrl: PORTAL,
      organizationId: 'org1',
      spaceId: 'sp1',
      repoId: 'r1',
      surface: 'USER',
    })
    return { cwd, env }
  }

  function fetchImplWith(seenUrls: string[], buildsOverride: Build[] = builds) {
    return (async (input: string | URL | Request) => {
      const url = new URL(String(input))
      seenUrls.push(url.pathname + url.search)
      if (url.pathname.endsWith('/placements')) {
        return new Response(JSON.stringify({ placements }), { status: 200 })
      }
      if (url.pathname.endsWith('/repos')) {
        return new Response(JSON.stringify({ repos: [repo] }), { status: 200 })
      }
      if (url.pathname.endsWith('/builds')) {
        return new Response(JSON.stringify({ builds: buildsOverride }), { status: 200 })
      }
      return new Response(JSON.stringify({ error: url.pathname }), { status: 404 })
    }) as unknown as typeof fetch
  }

  it('--json은 이 레포로 필터링한 배치·빌드만 JSON으로 출력한다 (사람이 읽는 안내문 없이)', async () => {
    const { cwd, env } = await setup()
    const seenUrls: string[] = []
    const printJsonSpy = vi.spyOn(output, 'printJson').mockImplementation(() => {})
    const out = vi.fn()
    await listCommand({ json: true }, { cwd, env, fetch: fetchImplWith(seenUrls), out })
    // 단언까지 끝난 뒤에 복원한다 — mockRestore()는 mockClear()도 겸해 mock.calls를 비운다.
    expect(out).not.toHaveBeenCalled()
    expect(printJsonSpy).toHaveBeenCalledTimes(1)
    const payload = printJsonSpy.mock.calls[0][0] as { placements: Placement[]; builds: Build[] }
    expect(payload.placements.map((p) => p.id)).toEqual(['p1', 'p2'])
    expect(payload.builds.map((b) => b.id)).toEqual(['b2', 'b1'])
    printJsonSpy.mockRestore()
  })

  it('빌드 응답에 stageRepoId가 없어도 owner/repo로 매칭해 출력한다', async () => {
    const { cwd, env } = await setup()
    const seenUrls: string[] = []
    const ownerOnlyBuilds: Build[] = [
      {
        id: 'b5',
        spaceId: 's',
        surface: 'USER',
        owner: 'ACME',
        repo: 'widgets',
        commitSha: '9998887776',
        status: 'SUCCEEDED',
        requestedAt: '2026-09-05T01:00:00Z',
      },
    ]
    const printJsonSpy = vi.spyOn(output, 'printJson').mockImplementation(() => {})
    await listCommand(
      { json: true },
      { cwd, env, fetch: fetchImplWith(seenUrls, ownerOnlyBuilds), out: () => {} },
    )
    const payload = printJsonSpy.mock.calls[0][0] as { builds: Build[] }
    expect(payload.builds.map((b) => b.id)).toEqual(['b5'])
    printJsonSpy.mockRestore()
  })

  it('--builds 로 요청 빌드 개수를 지정한다 (기본 5)', async () => {
    const { cwd, env } = await setup()
    const seenUrls: string[] = []
    await listCommand({ builds: '3' }, { cwd, env, fetch: fetchImplWith(seenUrls), out: () => {} })
    expect(seenUrls.some((u) => u.includes('/builds') && u.includes('limit=3'))).toBe(true)
  })

  it('기본 출력은 사람이 읽는 표 형태다', async () => {
    const { cwd, env } = await setup()
    const seenUrls: string[] = []
    const lines: string[] = []
    await listCommand({}, { cwd, env, fetch: fetchImplWith(seenUrls), out: (s) => lines.push(s) })
    const text = lines.join('\n')
    expect(text).toContain('org1')
    expect(text).toContain('/landing')
    expect(() => JSON.parse(text)).toThrow()
  })
})
