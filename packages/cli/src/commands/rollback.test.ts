import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { PORTAL_HOSTS } from '../constants.js'
import { saveLink } from '../portal/config.js'
import { saveCredential } from '../portal/credentials.js'
import type { Build, Placement, StageRepo } from '../portal/types.js'
import { pickRollbackTarget, rollbackCommand } from './rollback.js'

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
const repo9: StageRepo = { ...repo, id: 'r9', owner: 'other-org', repo: 'other' }

const b = (id: string, status: Build['status'], at: string, repoId = 'r1'): Build =>
  ({
    id,
    status,
    requestedAt: at,
    stageRepoId: repoId,
    spaceId: 's',
    surface: 'USER',
    commitSha: id + 'sha',
  }) as Build

/** stageRepoId 없이 owner/repo만 담은 빌드 — 실제 API 응답 모양. */
const bOwnerOnly = (id: string, status: Build['status'], at: string, r: StageRepo): Build =>
  ({
    id,
    status,
    requestedAt: at,
    owner: r.owner.toUpperCase(),
    repo: r.repo,
    spaceId: 's',
    surface: 'USER',
    commitSha: id + 'sha',
  }) as Build

const builds = [
  b('b4', 'FAILED', '2026-09-04'),
  b('b3', 'SUCCEEDED', '2026-09-03'),
  b('b2', 'SUCCEEDED', '2026-09-02'),
  b('b1', 'SUCCEEDED', '2026-09-01'),
  b('x1', 'SUCCEEDED', '2026-09-05', 'r9'),
]

describe('pickRollbackTarget', () => {
  it('라이브 직전의 성공 빌드', () => expect(pickRollbackTarget(builds, repo, 'b3')?.id).toBe('b2'))
  it('라이브가 목록에 없으면 가장 최근 성공', () =>
    expect(pickRollbackTarget(builds, repo, 'zzz')?.id).toBe('b3'))
  it('라이브가 없으면 가장 최근 성공', () =>
    expect(pickRollbackTarget(builds, repo, undefined)?.id).toBe('b3'))
  it('라이브가 가장 오래된 성공이면 null', () =>
    expect(pickRollbackTarget(builds, repo, 'b1')).toBeNull())
  it('다른 레포 빌드는 무시', () =>
    expect(pickRollbackTarget(builds, repo9, undefined)?.id).toBe('x1'))
  it('stageRepoId 없이 owner/repo만 있어도 매칭한다', () => {
    const ownerOnlyBuilds = [
      bOwnerOnly('c2', 'SUCCEEDED', '2026-09-02', repo),
      bOwnerOnly('c1', 'SUCCEEDED', '2026-09-01', repo),
    ]
    expect(pickRollbackTarget(ownerOnlyBuilds, repo, undefined)?.id).toBe('c2')
  })
})

interface PortalOptions {
  placements?: Placement[]
  builds?: Build[]
  deployStatus?: number
  deployOutcomes?: Record<string, number>
}

const defaultPlacements: Placement[] = [
  {
    id: 'p1',
    surface: 'USER',
    kind: 'PAGE',
    path: '/l',
    stageRepoId: 'r1',
    liveBuildId: 'b2',
    liveCommit: 'b2sha',
    status: 'LIVE',
  },
]

const defaultBuilds: Build[] = [
  b('b3', 'SUCCEEDED', '2026-09-03'),
  b('b2', 'SUCCEEDED', '2026-09-02'),
  b('b1', 'SUCCEEDED', '2026-09-01'),
]

function portal(opts: PortalOptions = {}) {
  const placements = opts.placements ?? defaultPlacements
  const allBuilds = opts.builds ?? defaultBuilds
  const deploys: unknown[] = []
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname
    const method = init?.method ?? 'GET'
    const j = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
    if (path.endsWith('/placements')) return j({ placements })
    if (path.endsWith('/repos')) return j({ repos: [repo] })
    if (/\/builds\/[^/]+$/.test(path) && method === 'GET') {
      const id = path.split('/').pop()
      const found = allBuilds.find((x) => x.id === id)
      return found ? j(found) : j({ error: 'not found' }, 404)
    }
    if (path.endsWith('/builds') && method === 'GET') return j({ builds: allBuilds })
    if (path.endsWith('/deploy')) {
      const placementId = path.split('/').slice(-2, -1)[0]
      deploys.push(JSON.parse(String(init?.body)))
      const status = opts.deployOutcomes?.[placementId] ?? opts.deployStatus ?? 200
      return j({ id: placementId, liveBuildId: 'x' }, status)
    }
    return j({ error: path }, 404)
  }) as unknown as typeof globalThis.fetch
  return { fetch, deploys }
}

async function setup() {
  const cwd = await mkdtemp(join(tmpdir(), 'rollback-'))
  const env = { XDG_CONFIG_HOME: cwd }
  await saveCredential({ portalUrl: PORTAL, token: 'bsc_x', savedAt: '' }, env)
  await saveLink(cwd, {
    portalUrl: PORTAL,
    organizationId: 'o',
    spaceId: 's',
    repoId: 'r1',
    surface: 'USER',
  })
  return { cwd, env }
}

async function expectCliExit(
  promise: Promise<unknown>,
): Promise<{ code: number; message: string }> {
  try {
    await promise
    throw new Error('rollbackCommand가 실패했어야 합니다')
  } catch (err) {
    return err as { code: number; message: string }
  }
}

describe('rollbackCommand', () => {
  it('빌드 id 없이 라이브 직전 성공 빌드로 되돌린다', async () => {
    const { fetch, deploys } = portal()
    const s = await setup()
    await rollbackCommand(undefined, { yes: true }, { ...s, fetch })
    expect(deploys).toEqual([{ buildId: 'b1', expectedLiveBuildId: 'b2' }])
  })

  it('빌드 응답에 stageRepoId가 없어도 owner/repo로 매칭해 되돌린다 (--to 포함)', async () => {
    const ownerOnlyBuilds = [
      bOwnerOnly('b3', 'SUCCEEDED', '2026-09-03', repo),
      bOwnerOnly('b2', 'SUCCEEDED', '2026-09-02', repo),
      bOwnerOnly('b1', 'SUCCEEDED', '2026-09-01', repo),
    ]
    const { fetch, deploys } = portal({ builds: ownerOnlyBuilds })
    const s = await setup()
    await rollbackCommand('b3', { yes: true }, { ...s, fetch })
    expect(deploys).toEqual([{ buildId: 'b3', expectedLiveBuildId: 'b2' }])
  })

  it('--to 로 명시한 빌드로 되돌린다', async () => {
    const { fetch, deploys } = portal()
    const s = await setup()
    await rollbackCommand('b3', { yes: true }, { ...s, fetch })
    expect(deploys).toEqual([{ buildId: 'b3', expectedLiveBuildId: 'b2' }])
  })

  it('지정 빌드가 SUCCEEDED 아니면 PRECONDITION', async () => {
    const { fetch, deploys } = portal({
      builds: [...defaultBuilds, b('b4', 'FAILED', '2026-09-04')],
    })
    const s = await setup()
    await expect(rollbackCommand('b4', { yes: true }, { ...s, fetch })).rejects.toMatchObject({
      code: 2,
    })
    expect(deploys).toEqual([])
  })

  it('존재하지 않는 빌드 id면 PRECONDITION(원본 API 에러가 아니라)', async () => {
    const { fetch, deploys } = portal()
    const s = await setup()
    const err = await expectCliExit(rollbackCommand('nope', { yes: true }, { ...s, fetch }))
    expect(err.code).toBe(2)
    expect(err.message).toContain('nope')
    expect(deploys).toEqual([])
  })

  it('지정 빌드가 다른 레포면 PRECONDITION', async () => {
    const { fetch, deploys } = portal({
      builds: [...defaultBuilds, b('x1', 'SUCCEEDED', '2026-09-05', 'r9')],
    })
    const s = await setup()
    await expect(rollbackCommand('x1', { yes: true }, { ...s, fetch })).rejects.toMatchObject({
      code: 2,
    })
    expect(deploys).toEqual([])
  })

  it('되돌릴 이전 성공 빌드가 없으면 PRECONDITION', async () => {
    const { fetch, deploys } = portal({
      placements: [{ ...defaultPlacements[0], liveBuildId: 'b1' }],
    })
    const s = await setup()
    await expect(rollbackCommand(undefined, { yes: true }, { ...s, fetch })).rejects.toMatchObject({
      code: 2,
    })
    expect(deploys).toEqual([])
  })

  it('이미 해당 빌드가 라이브면 PRECONDITION', async () => {
    const { fetch, deploys } = portal()
    const s = await setup()
    await expect(rollbackCommand('b2', { yes: true }, { ...s, fetch })).rejects.toMatchObject({
      code: 2,
    })
    expect(deploys).toEqual([])
  })

  it('확인 표에 되돌릴 빌드 id와 커밋을 보여준다', async () => {
    const { fetch } = portal()
    const s = await setup()
    const lines: string[] = []
    await expect(
      rollbackCommand(
        undefined,
        {},
        { ...s, fetch, out: (l) => lines.push(l), confirm: async () => false },
      ),
    ).rejects.toMatchObject({ code: 2 })
    const text = lines.join('\n')
    expect(text).toContain('빌드 b1')
    expect(text).toContain('b1sha')
    expect(text).toContain('/l')
  })

  it('확인을 거절하면 적용하지 않는다', async () => {
    const { fetch, deploys } = portal()
    const s = await setup()
    await expect(
      rollbackCommand(undefined, {}, { ...s, fetch, confirm: async () => false }),
    ).rejects.toMatchObject({ code: 2 })
    expect(deploys).toEqual([])
  })

  it('TTY가 아니고 --yes도 없으면 즉시 PRECONDITION', async () => {
    const { fetch, deploys } = portal()
    const s = await setup()
    await expect(
      rollbackCommand(undefined, {}, { ...s, fetch, isTTY: () => false }),
    ).rejects.toMatchObject({ code: 2 })
    expect(deploys).toEqual([])
  })

  it('--json 은 --yes 없이 쓸 수 없다', async () => {
    const err = await expectCliExit(rollbackCommand(undefined, { json: true }))
    expect(err.code).toBe(2)
  })

  it('--json --yes 는 changed·unchanged·conflicts·failed 만 담은 JSON 객체 하나만 stdout에 쓴다', async () => {
    const { fetch } = portal()
    const s = await setup()
    const writes: string[] = []
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      writes.push(String(chunk))
      return true
    })
    try {
      await rollbackCommand(undefined, { yes: true, json: true }, { ...s, fetch })
    } finally {
      spy.mockRestore()
    }
    expect(writes).toHaveLength(1)
    const payload = JSON.parse(writes[0]) as Record<string, unknown>
    expect(Object.keys(payload).sort()).toEqual(['changed', 'conflicts', 'failed', 'unchanged'])
    expect(payload.changed).toHaveLength(1)
    expect(payload.changed).toContainEqual(
      expect.objectContaining({ id: 'p1', label: '/l', from: 'b2', to: 'b1' }),
    )
    expect(payload.unchanged).toEqual([])
  })

  it('이미 대상 빌드인 배치는 패치하지 않고 unchanged 로 보고한다', async () => {
    const { fetch, deploys } = portal({
      placements: [
        ...defaultPlacements,
        {
          id: 'p2',
          surface: 'USER',
          kind: 'PAGE',
          path: '/m',
          stageRepoId: 'r1',
          liveBuildId: 'b1',
          liveCommit: 'b1sha',
          status: 'LIVE',
        },
      ],
    })
    const s = await setup()
    const writes: string[] = []
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      writes.push(String(chunk))
      return true
    })
    try {
      await rollbackCommand('b1', { yes: true, json: true }, { ...s, fetch })
    } finally {
      spy.mockRestore()
    }
    expect(deploys).toEqual([{ buildId: 'b1', expectedLiveBuildId: 'b2' }])
    const payload = JSON.parse(writes[0]) as Record<string, { id: string }[]>
    expect(payload.changed.map((r) => r.id)).toEqual(['p1'])
    expect(payload.unchanged.map((r) => r.id)).toEqual(['p2'])
  })

  it('409면 CONFLICT로 끝난다', async () => {
    const { fetch } = portal({ deployStatus: 409 })
    const s = await setup()
    await expect(rollbackCommand(undefined, { yes: true }, { ...s, fetch })).rejects.toMatchObject({
      code: 4,
    })
  })

  it('--placement 로 하나만', async () => {
    const { fetch, deploys } = portal({
      placements: [
        ...defaultPlacements,
        {
          id: 'p2',
          surface: 'USER',
          kind: 'PAGE',
          path: '/m',
          stageRepoId: 'r1',
          liveBuildId: 'b3',
          liveCommit: 'b3sha',
          status: 'LIVE',
        },
      ],
    })
    const s = await setup()
    await rollbackCommand(undefined, { yes: true, placement: '/l' }, { ...s, fetch })
    expect(deploys).toEqual([{ buildId: 'b1', expectedLiveBuildId: 'b2' }])
  })
})
