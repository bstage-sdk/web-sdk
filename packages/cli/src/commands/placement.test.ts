import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PORTAL_HOSTS } from '../constants.js'
import { saveLink } from '../portal/config.js'
import { saveCredential } from '../portal/credentials.js'
import type { Exec } from '../portal/git.js'
import type { Build, Placement } from '../portal/types.js'
import { placementCreateCommand } from './placement.js'

/** 링크 파일의 포털 주소는 허용 목록(PORTAL_HOSTS) 안이어야 한다. */
const PORTAL = `https://${PORTAL_HOSTS.sandbox}`

const cleanGit: Exec = async (args) =>
  ({
    'rev-parse --abbrev-ref HEAD': 'main\n',
    'rev-parse HEAD': 'abc\n',
    'status --porcelain': '',
    'rev-parse --abbrev-ref --symbolic-full-name @{u}': 'origin/main\n',
    'rev-list --left-right --count HEAD...@{u}': '0\t0\n',
  })[args.join(' ')] ?? ''

const succeeded = (id: string, artifacts?: Build['artifacts'], at = '2026-09-30T01:00:00Z') => ({
  id,
  surface: 'USER',
  owner: 'a',
  repo: 'w',
  commitSha: 'abc',
  status: 'SUCCEEDED',
  requestedAt: at,
  artifacts,
})

interface PortalOptions {
  builds?: unknown[]
  placements?: Placement[]
  /** 새로 만든 빌드(b-new)가 끝났을 때의 모양. */
  newBuild?: { status: string; artifacts?: Build['artifacts'] }
  createStatus?: number
  createError?: string
}

function portal(opts: PortalOptions = {}) {
  const creates: unknown[] = []
  let buildsCreated = 0
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    const path = url.pathname
    const method = init?.method ?? 'GET'
    const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s })
    if (path.endsWith('/repos'))
      return j({
        repos: [{ id: 'r1', surface: 'USER', owner: 'a', repo: 'w', defaultBranch: 'main' }],
      })
    if (path.endsWith('/builds') && method === 'POST') {
      buildsCreated++
      return j({ id: 'b-new', status: 'QUEUED', surface: 'USER', commitSha: 'def' }, 201)
    }
    if (path.endsWith('/builds')) return j({ builds: opts.builds ?? [] })
    if (path.endsWith('/builds/b-new/log')) return new Response('')
    if (path.endsWith('/builds/b-new')) {
      const nb = opts.newBuild ?? {
        status: 'SUCCEEDED',
        artifacts: [{ name: 'todos', kind: 'sdk' }],
      }
      return j({ ...succeeded('b-new', nb.artifacts), status: nb.status, commitSha: 'def' })
    }
    if (path.endsWith('/placements') && method === 'POST') {
      const body = JSON.parse(String(init?.body))
      creates.push(body)
      const status = opts.createStatus ?? 201
      if (status >= 400) return j({ error: opts.createError ?? 'error' }, status)
      return j(
        {
          id: 'p-new',
          surface: body.surface,
          kind: 'PAGE',
          path: body.path ?? '/todos',
          stageRepoId: body.repoId,
          artifact: body.artifact,
          status: 'READY_TO_DEPLOY',
        },
        201,
      )
    }
    if (path.endsWith('/placements')) return j({ placements: opts.placements ?? [] })
    return j({ error: path }, 404)
  }) as unknown as typeof globalThis.fetch
  return { fetch, creates, buildsCreated: () => buildsCreated }
}

async function setup() {
  const cwd = await mkdtemp(join(tmpdir(), 'plc-'))
  const env = { XDG_CONFIG_HOME: cwd }
  await saveCredential({ portalUrl: PORTAL, token: 'bsc_x', savedAt: '' }, env)
  await saveLink(cwd, {
    portalUrl: PORTAL,
    organizationId: 'o',
    spaceId: 's',
    repoId: 'r1',
    surface: 'USER',
  })
  return { cwd, env, exec: cleanGit, sleep: async () => {}, out: () => {} }
}

async function expectCliExit(p: Promise<unknown>): Promise<{ code: number; message: string }> {
  try {
    await p
    throw new Error('placementCreateCommand가 실패했어야 합니다')
  } catch (err) {
    return err as { code: number; message: string }
  }
}

afterEach(() => vi.restoreAllMocks())

describe('placement create', () => {
  it('최신 성공 빌드에 산출물이 있으면 빌드 없이 PAGE 배치를 만든다', async () => {
    const p = portal({ builds: [succeeded('b1', [{ name: 'todos', kind: 'sdk' }])] })
    const s = await setup()
    await placementCreateCommand(
      { template: 'todos', path: '/todos', yes: true },
      { ...s, fetch: p.fetch },
    )
    expect(p.buildsCreated()).toBe(0)
    expect(p.creates).toEqual([
      { kind: 'PAGE', surface: 'USER', repoId: 'r1', artifact: 'todos', path: '/todos' },
    ])
  })

  it('--path 가 없으면 경로를 보내지 않는다(포털이 산출물 이름에서 파생)', async () => {
    const p = portal({ builds: [succeeded('b1', [{ name: 'todos', kind: 'sdk' }])] })
    const s = await setup()
    await placementCreateCommand({ template: 'todos', yes: true }, { ...s, fetch: p.fetch })
    expect(p.creates).toEqual([{ kind: 'PAGE', surface: 'USER', repoId: 'r1', artifact: 'todos' }])
  })

  it('liquid 산출물은 --template hello 를 user/hello 로 풀어 보낸다', async () => {
    const p = portal({ builds: [succeeded('b1', [{ name: 'user/hello', kind: 'liquid' }])] })
    const s = await setup()
    await placementCreateCommand({ template: 'hello', yes: true }, { ...s, fetch: p.fetch })
    expect(p.creates).toEqual([
      { kind: 'PAGE', surface: 'USER', repoId: 'r1', artifact: 'user/hello' },
    ])
  })

  it('성공한 빌드가 하나도 없으면(레포만 연결된 상태) 빌드부터 하고 배치를 만든다', async () => {
    const p = portal({ builds: [] })
    const s = await setup()
    await placementCreateCommand({ template: 'todos', yes: true }, { ...s, fetch: p.fetch })
    expect(p.buildsCreated()).toBe(1)
    expect(p.creates).toHaveLength(1)
  })

  it('최신 성공 빌드에 그 산출물이 없으면(새 페이지를 막 push) 다시 빌드한다', async () => {
    const p = portal({
      builds: [succeeded('b1', [{ name: 'other', kind: 'sdk' }])],
      newBuild: { status: 'SUCCEEDED', artifacts: [{ name: 'todos', kind: 'sdk' }] },
    })
    const s = await setup()
    await placementCreateCommand({ template: 'todos', yes: true }, { ...s, fetch: p.fetch })
    expect(p.buildsCreated()).toBe(1)
    expect(p.creates).toHaveLength(1)
  })

  it('--build 는 성공 빌드가 있어도 새로 빌드한다', async () => {
    const p = portal({ builds: [succeeded('b1', [{ name: 'todos', kind: 'sdk' }])] })
    const s = await setup()
    await placementCreateCommand(
      { template: 'todos', build: true, yes: true },
      { ...s, fetch: p.fetch },
    )
    expect(p.buildsCreated()).toBe(1)
  })

  it('새 빌드에도 산출물이 없으면 가능한 이름을 알려 주고 PRECONDITION', async () => {
    const p = portal({
      builds: [],
      newBuild: {
        status: 'SUCCEEDED',
        artifacts: [
          { name: 'other', kind: 'sdk' },
          { name: 'user.contents-home.curation--after', kind: 'sdk' },
        ],
      },
    })
    const s = await setup()
    const err = await expectCliExit(
      placementCreateCommand({ template: 'todos', yes: true }, { ...s, fetch: p.fetch }),
    )
    expect(err.code).toBe(2)
    expect(err.message).toContain("'todos'")
    expect(err.message).toContain('other')
    expect(err.message).not.toContain('curation')
    expect(p.creates).toEqual([])
  })

  it('빌드가 실패하면 배치를 만들지 않고 FAILURE', async () => {
    const p = portal({ builds: [], newBuild: { status: 'FAILED' } })
    const s = await setup()
    const err = await expectCliExit(
      placementCreateCommand({ template: 'todos', yes: true }, { ...s, fetch: p.fetch }),
    )
    expect(err.code).toBe(1)
    expect(err.message).toContain('bstage logs b-new')
    expect(p.creates).toEqual([])
  })

  it('같은 경로에 이 레포·같은 산출물의 배치가 이미 있으면 만들지 않고 성공(멱등)', async () => {
    const existing: Placement = {
      id: 'p1',
      surface: 'USER',
      kind: 'PAGE',
      path: '/todos',
      stageRepoId: 'r1',
      artifact: 'todos',
      status: 'LIVE',
    }
    const p = portal({
      builds: [succeeded('b1', [{ name: 'todos', kind: 'sdk' }])],
      placements: [existing],
    })
    const s = await setup()
    const lines: string[] = []
    await placementCreateCommand(
      { template: 'todos', yes: true },
      { ...s, fetch: p.fetch, out: (l) => lines.push(l) },
    )
    expect(p.creates).toEqual([])
    expect(lines.join('\n')).toContain('이미')
  })

  it('같은 경로를 다른 레포·산출물이 쓰고 있으면 CONFLICT', async () => {
    const p = portal({
      builds: [succeeded('b1', [{ name: 'todos', kind: 'sdk' }])],
      placements: [
        {
          id: 'p9',
          surface: 'USER',
          kind: 'PAGE',
          path: '/todos',
          stageRepoId: 'r9',
          artifact: 'x',
          status: 'LIVE',
        },
      ],
    })
    const s = await setup()
    const err = await expectCliExit(
      placementCreateCommand({ template: 'todos', yes: true }, { ...s, fetch: p.fetch }),
    )
    expect(err.code).toBe(4)
    expect(err.message).toContain('/todos')
    expect(p.creates).toEqual([])
  })

  it('경로를 다른 레포가 쓰고 있으면 빌드를 만들기 전에 CONFLICT', async () => {
    const p = portal({
      builds: [],
      placements: [
        {
          id: 'p9',
          surface: 'USER',
          kind: 'PAGE',
          path: '/todos',
          stageRepoId: 'r9',
          artifact: 'todos',
          status: 'LIVE',
        },
      ],
    })
    const s = await setup()
    const err = await expectCliExit(
      placementCreateCommand({ template: 'todos', yes: true }, { ...s, fetch: p.fetch }),
    )
    expect(err.code).toBe(4)
    expect(p.buildsCreated()).toBe(0)
  })

  it('--json 이면 포털 오류도 stdout에 요약 하나를 낸다', async () => {
    const p = portal({
      builds: [succeeded('b1', [{ name: 'todos', kind: 'sdk' }])],
      createStatus: 409,
      createError: '이미 같은 대상의 구성이 있습니다',
    })
    const s = await setup()
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const err = await expectCliExit(
      placementCreateCommand(
        { template: 'todos', yes: true, json: true },
        { ...s, fetch: p.fetch },
      ),
    )
    expect(err.code).toBe(4)
    const printed = JSON.parse(String(write.mock.calls[0][0]))
    expect(printed.conflicts).toHaveLength(1)
    expect(printed.changed).toEqual([])
  })

  it('포털 409(경쟁)는 CONFLICT', async () => {
    const p = portal({
      builds: [succeeded('b1', [{ name: 'todos', kind: 'sdk' }])],
      createStatus: 409,
      createError: '이미 같은 대상의 구성이 있습니다',
    })
    const s = await setup()
    const err = await expectCliExit(
      placementCreateCommand({ template: 'todos', yes: true }, { ...s, fetch: p.fetch }),
    )
    expect(err.code).toBe(4)
  })

  it('포털 403(토큰 등급 부족)은 deploy 등급 안내와 함께 AUTH', async () => {
    const p = portal({
      builds: [succeeded('b1', [{ name: 'todos', kind: 'sdk' }])],
      createStatus: 403,
      createError: '토큰 등급으로 허용되지 않는 요청입니다',
    })
    const s = await setup()
    const err = await expectCliExit(
      placementCreateCommand({ template: 'todos', yes: true }, { ...s, fetch: p.fetch }),
    )
    expect(err.code).toBe(3)
    expect(err.message).toContain('deploy')
  })

  it('포털 400(검증 실패)은 서버 문구를 담아 PRECONDITION', async () => {
    const p = portal({
      builds: [succeeded('b1', [{ name: 'todos', kind: 'sdk' }])],
      createStatus: 400,
      createError: '경로가 올바르지 않습니다',
    })
    const s = await setup()
    const err = await expectCliExit(
      placementCreateCommand({ template: 'todos', yes: true }, { ...s, fetch: p.fetch }),
    )
    expect(err.code).toBe(2)
    expect(err.message).toContain('경로가 올바르지 않습니다')
  })

  it('잘못된 --path 는 네트워크 전에 PRECONDITION', async () => {
    const p = portal()
    const s = await setup()
    const err = await expectCliExit(
      placementCreateCommand(
        { template: 'todos', path: 'todos', yes: true },
        { ...s, fetch: p.fetch },
      ),
    )
    expect(err.code).toBe(2)
    expect(p.creates).toEqual([])
    expect(p.buildsCreated()).toBe(0)
  })

  it('--template 이 없으면 PRECONDITION', async () => {
    const s = await setup()
    const err = await expectCliExit(placementCreateCommand({ yes: true }, { ...s }))
    expect(err.code).toBe(2)
    expect(err.message).toContain('--template')
  })

  it('--json 은 --yes 없이 쓸 수 없다', async () => {
    const s = await setup()
    const err = await expectCliExit(
      placementCreateCommand({ template: 'todos', json: true }, { ...s }),
    )
    expect(err.code).toBe(2)
  })

  it('확인을 물을 수 없는 환경이면 빌드를 만들기 전에 PRECONDITION', async () => {
    const p = portal({ builds: [] })
    const s = await setup()
    const err = await expectCliExit(
      placementCreateCommand({ template: 'todos' }, { ...s, fetch: p.fetch, isTTY: () => false }),
    )
    expect(err.code).toBe(2)
    expect(p.buildsCreated()).toBe(0)
  })

  it('확인을 거절하면 배치를 만들지 않는다', async () => {
    const p = portal({ builds: [succeeded('b1', [{ name: 'todos', kind: 'sdk' }])] })
    const s = await setup()
    const err = await expectCliExit(
      placementCreateCommand(
        { template: 'todos' },
        { ...s, fetch: p.fetch, confirm: async () => false },
      ),
    )
    expect(err.code).toBe(2)
    expect(p.creates).toEqual([])
  })

  it('--json 은 배치와 빌드, changed 요약을 한 객체로 낸다', async () => {
    const p = portal({ builds: [succeeded('b1', [{ name: 'todos', kind: 'sdk' }])] })
    const s = await setup()
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await placementCreateCommand(
      { template: 'todos', yes: true, json: true },
      { ...s, fetch: p.fetch },
    )
    const printed = JSON.parse(String(write.mock.calls[0][0]))
    expect(printed.placement.id).toBe('p-new')
    expect(printed.build.id).toBe('b1')
    expect(printed.changed).toEqual([{ id: 'p-new', label: '/todos' }])
    expect(printed.unchanged).toEqual([])
    expect(printed.next).toBe('bstage deploy --placement /todos')
  })
})
