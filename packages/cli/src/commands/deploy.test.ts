import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { PORTAL_HOSTS } from '../constants.js'
import { saveLink } from '../portal/config.js'
import { saveCredential } from '../portal/credentials.js'
import type { Exec } from '../portal/git.js'
import { deployCommand } from './deploy.js'

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

interface PortalOptions {
  deployStatus?: number
  buildStatuses?: string[]
  /** placementId별 배포 응답 상태. 없으면 deployStatus, 그것도 없으면 200. */
  deployOutcomes?: Record<string, number>
  /** 배치 목록에 위젯(SLOT) 자리를 하나 섞는다 — liquid 사전조건 검사용. */
  withSlot?: boolean
}

function portal(opts: PortalOptions = {}) {
  const statuses = opts.buildStatuses ?? ['QUEUED', 'SUCCEEDED']
  let polls = 0
  let getBuildCallCount = 0
  let createBuildCallCount = 0
  const deploys: unknown[] = []
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname
    const method = init?.method ?? 'GET'
    const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s })
    if (path.endsWith('/repos'))
      return j({
        repos: [{ id: 'r1', surface: 'USER', owner: 'a', repo: 'w', defaultBranch: 'main' }],
      })
    if (path.endsWith('/placements'))
      return j({
        placements: [
          ...(opts.withSlot
            ? [
                {
                  id: 'p3',
                  surface: 'USER',
                  kind: 'SLOT',
                  slotId: 'user.contents-home.curation:after',
                  stageRepoId: 'r1',
                  status: 'READY',
                },
              ]
            : []),
          {
            id: 'p1',
            surface: 'USER',
            kind: 'PAGE',
            path: '/l',
            stageRepoId: 'r1',
            liveBuildId: 'b0',
            liveCommit: 'aaa0000',
            status: 'LIVE',
          },
          {
            id: 'p2',
            surface: 'USER',
            kind: 'PAGE',
            path: '/m',
            stageRepoId: 'r1',
            status: 'READY',
          },
        ],
      })
    if (path.endsWith('/builds') && method === 'POST') {
      createBuildCallCount++
      return j({ id: 'b1', status: 'QUEUED', stageRepoId: 'r1', commitSha: 'abc' }, 201)
    }
    if (path.endsWith('/builds/b1')) {
      getBuildCallCount++
      return j({
        id: 'b1',
        status: statuses[Math.min(polls++, statuses.length - 1)],
        stageRepoId: 'r1',
        commitSha: 'abc',
        failureReason: 'BUILD_FAILED',
      })
    }
    if (path.endsWith('/builds/b1/log')) return new Response('log\n')
    if (path.endsWith('/deploy')) {
      const placementId = path.split('/').slice(-2, -1)[0]
      deploys.push(JSON.parse(String(init?.body)))
      const status = opts.deployOutcomes?.[placementId] ?? opts.deployStatus ?? 200
      return j({ id: placementId, liveBuildId: 'b1' }, status)
    }
    return j({ error: path }, 404)
  }) as unknown as typeof globalThis.fetch
  return {
    fetch,
    deploys,
    getBuildCalls: () => getBuildCallCount,
    createBuildCalls: () => createBuildCallCount,
  }
}

async function setup() {
  const cwd = await mkdtemp(join(tmpdir(), 'deploy-'))
  const env = { XDG_CONFIG_HOME: cwd }
  await saveCredential({ portalUrl: PORTAL, token: 'bsc_x', savedAt: '' }, env)
  await saveLink(cwd, {
    portalUrl: PORTAL,
    organizationId: 'o',
    spaceId: 's',
    repoId: 'r1',
    surface: 'USER',
  })
  return { cwd, env, sleep: async () => {} }
}

async function expectCliExit(
  promise: Promise<unknown>,
): Promise<{ code: number; message: string }> {
  try {
    await promise
    throw new Error('deployCommand가 실패했어야 합니다')
  } catch (err) {
    return err as { code: number; message: string }
  }
}

describe('deploy', () => {
  it('빌드 → 대기 → 모든 배치에 CAS 적용', async () => {
    const { fetch, deploys } = portal()
    const s = await setup()
    await deployCommand({ yes: true }, { ...s, fetch, exec: cleanGit })
    expect(deploys).toEqual([
      { buildId: 'b1', expectedLiveBuildId: 'b0' },
      { buildId: 'b1', expectedLiveBuildId: '' },
    ])
  })

  it('더티 트리면 빌드를 만들지 않고 PRECONDITION', async () => {
    const { fetch, deploys } = portal()
    const s = await setup()
    const dirty: Exec = async (a) => (a.join(' ') === 'status --porcelain' ? ' M x\n' : cleanGit(a))
    await expect(deployCommand({ yes: true }, { ...s, fetch, exec: dirty })).rejects.toMatchObject({
      code: 2,
    })
    expect(deploys).toEqual([])
  })

  it('--skip-git-check 는 더티 트리를 건너뛴다', async () => {
    const { fetch, deploys } = portal()
    const s = await setup()
    const dirty: Exec = async (a) => (a.join(' ') === 'status --porcelain' ? ' M x\n' : cleanGit(a))
    await deployCommand({ yes: true, skipGitCheck: true }, { ...s, fetch, exec: dirty })
    expect(deploys).toHaveLength(2)
  })

  it('빌드 실패면 FAILURE, 배치 적용 없음', async () => {
    const { fetch, deploys } = portal({ buildStatuses: ['RUNNING', 'FAILED'] })
    const s = await setup()
    await expect(
      deployCommand({ yes: true }, { ...s, fetch, exec: cleanGit }),
    ).rejects.toMatchObject({
      code: 1,
    })
    expect(deploys).toEqual([])
  })

  it('--no-wait 는 빌드 상태를 조회하지 않고 즉시 끝난다', async () => {
    const { fetch, deploys, getBuildCalls } = portal({ buildStatuses: ['FAILED'] })
    const s = await setup()
    await deployCommand({ yes: true, noWait: true }, { ...s, fetch, exec: cleanGit })
    expect(deploys).toEqual([])
    expect(getBuildCalls()).toBe(0)
  })

  it('확인을 거절하면 적용하지 않는다', async () => {
    const { fetch, deploys } = portal()
    const s = await setup()
    await expect(
      deployCommand({}, { ...s, fetch, exec: cleanGit, confirm: async () => false }),
    ).rejects.toMatchObject({ code: 2 })
    expect(deploys).toEqual([])
  })

  it('TTY가 아니고 --yes도 없으면 빌드를 만들기 전에 즉시 PRECONDITION', async () => {
    const { fetch, deploys, getBuildCalls, createBuildCalls } = portal()
    const s = await setup()
    await expect(
      deployCommand({}, { ...s, fetch, exec: cleanGit, isTTY: () => false }),
    ).rejects.toMatchObject({ code: 2 })
    expect(deploys).toEqual([])
    expect(createBuildCalls()).toBe(0)
    expect(getBuildCalls()).toBe(0)
  })

  it('--json 은 --yes 없이 쓸 수 없다', async () => {
    const err = await expectCliExit(deployCommand({ json: true }))
    expect(err.code).toBe(2)
  })

  it('--json --yes 는 build·changed·unchanged·conflicts·failed 만 담은 JSON 객체 하나만 쓴다', async () => {
    const { fetch } = portal()
    const s = await setup()
    const writes: string[] = []
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      writes.push(String(chunk))
      return true
    })
    try {
      await deployCommand({ yes: true, json: true }, { ...s, fetch, exec: cleanGit })
    } finally {
      spy.mockRestore()
    }
    expect(writes).toHaveLength(1)
    const payload = JSON.parse(writes[0]) as Record<string, unknown>
    expect(Object.keys(payload).sort()).toEqual([
      'build',
      'changed',
      'conflicts',
      'failed',
      'unchanged',
    ])
    expect(payload.changed).toHaveLength(2)
    expect(payload.changed).toContainEqual(
      expect.objectContaining({ id: 'p1', label: '/l', from: 'b0', to: 'b1' }),
    )
    expect(payload.unchanged).toEqual([])
    expect(payload.conflicts).toEqual([])
    expect(payload.failed).toEqual([])
  })

  it('409면 CONFLICT로 끝난다', async () => {
    const { fetch } = portal({ deployStatus: 409 })
    const s = await setup()
    await expect(
      deployCommand({ yes: true }, { ...s, fetch, exec: cleanGit }),
    ).rejects.toMatchObject({
      code: 4,
    })
  })

  it('충돌과 다른 실패가 섞이면 종료코드는 4이고 메시지가 둘 다 언급한다', async () => {
    const { fetch } = portal({ deployOutcomes: { p1: 409, p2: 500 } })
    const s = await setup()
    const err = await expectCliExit(deployCommand({ yes: true }, { ...s, fetch, exec: cleanGit }))
    expect(err.code).toBe(4)
    expect(err.message).toContain('/l')
    expect(err.message).toContain('/m')
  })

  it('--no-wait --json 도 같은 키를 낸다(배치는 건드리지 않아 전부 빈 배열)', async () => {
    const { fetch } = portal()
    const s = await setup()
    const writes: string[] = []
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      writes.push(String(chunk))
      return true
    })
    try {
      await deployCommand({ yes: true, json: true, noWait: true }, { ...s, fetch, exec: cleanGit })
    } finally {
      spy.mockRestore()
    }
    expect(writes).toHaveLength(1)
    const payload = JSON.parse(writes[0]) as Record<string, unknown>
    expect(Object.keys(payload).sort()).toEqual([
      'build',
      'changed',
      'conflicts',
      'failed',
      'unchanged',
    ])
  })

  it('--placement 로 하나만', async () => {
    const { fetch, deploys } = portal()
    const s = await setup()
    await deployCommand({ yes: true, placement: '/m' }, { ...s, fetch, exec: cleanGit })
    expect(deploys).toHaveLength(1)
  })
})

/**
 * liquid 레포는 포털이 `public/`을 그대로 패키징한다 — 로컬 빌드가 없고, SLOT 배치는 포털이
 * 400으로 막는다. 빌드를 만들고 기다린 뒤 400을 보는 대신 사전조건으로 끊어야 한다.
 * 손 검증은 sdk 레포로만 해 왔으므로 이 분기는 테스트로만 덮인다.
 */
describe('deploy — 레포 종류', () => {
  function write(cwd: string, files: Record<string, string>): void {
    for (const [path, content] of Object.entries(files)) {
      const full = join(cwd, path)
      mkdirSync(dirname(full), { recursive: true })
      writeFileSync(full, content, 'utf-8')
    }
  }

  it('liquid + SLOT 배치는 빌드를 만들기 전에 사전조건 오류', async () => {
    const { fetch, createBuildCalls } = portal({ withSlot: true })
    const s = await setup()
    write(s.cwd, { 'public/user/home/template.liquid': '<h1>x</h1>\n' })
    const err = await expectCliExit(
      deployCommand({ yes: true }, { ...s, fetch, exec: cleanGit, out: () => {} }),
    )
    expect(err.code).toBe(2)
    expect(err.message).toContain('user.contents-home.curation:after')
    expect(createBuildCalls()).toBe(0)
  })

  it('liquid + PAGE 배치만이면 안내 한 줄을 내고 그대로 진행한다', async () => {
    const { fetch, deploys } = portal()
    const s = await setup()
    write(s.cwd, { 'public/user/home/template.liquid': '<h1>x</h1>\n' })
    const notices: string[] = []
    await deployCommand(
      { yes: true },
      { ...s, fetch, exec: cleanGit, out: (l) => void notices.push(l) },
    )
    expect(deploys).toHaveLength(2)
    expect(notices.join('\n')).toContain('로컬 빌드 없이')
  })

  it('liquid + --json이면 안내를 내지 않는다 — stdout은 JSON 하나뿐이어야 한다', async () => {
    const { fetch } = portal()
    const s = await setup()
    write(s.cwd, { 'public/user/home/template.liquid': '<h1>x</h1>\n' })
    const notices: string[] = []
    const writes: string[] = []
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string) => {
      writes.push(String(chunk))
      return true
    }) as never)
    try {
      await deployCommand(
        { yes: true, json: true },
        { ...s, fetch, exec: cleanGit, out: (l) => void notices.push(l) },
      )
    } finally {
      spy.mockRestore()
    }
    expect(notices).toEqual([])
    expect(writes).toHaveLength(1)
    expect(() => JSON.parse(writes[0])).not.toThrow()
  })

  it('mixed 레포는 네트워크를 타기 전에 사전조건 오류', async () => {
    const { fetch, createBuildCalls } = portal()
    const s = await setup()
    write(s.cwd, {
      'public/user/home/template.liquid': '<h1>x</h1>\n',
      'src/pages/home/template.tsx': 'export default null\n',
    })
    const err = await expectCliExit(
      deployCommand({ yes: true }, { ...s, fetch, exec: cleanGit, out: () => {} }),
    )
    expect(err.code).toBe(2)
    expect(err.message).toContain('섞여')
    expect(createBuildCalls()).toBe(0)
  })

  it('sdk 레포는 안내를 내지 않는다', async () => {
    const { fetch, deploys } = portal()
    const s = await setup()
    write(s.cwd, { 'src/pages/home/template.tsx': 'export default null\n' })
    const notices: string[] = []
    await deployCommand(
      { yes: true },
      { ...s, fetch, exec: cleanGit, out: (l) => void notices.push(l) },
    )
    expect(deploys).toHaveLength(2)
    expect(notices.join('\n')).not.toContain('로컬 빌드 없이')
  })
})
