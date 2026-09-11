import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { PORTAL_HOSTS } from '../constants.js'
import { saveLink } from '../portal/config.js'
import { saveCredential } from '../portal/credentials.js'
import { logsCommand } from './logs.js'

/** 링크 파일의 포털 주소는 허용 목록(PORTAL_HOSTS) 안이어야 한다. */
const PORTAL = `https://${PORTAL_HOSTS.sandbox}`

interface PortalOptions {
  /** getBuild 호출 순서대로 돌려줄 상태. 마지막 값이 이후 호출에 반복 적용된다. */
  statuses?: string[]
  /** 로그 조회 순서대로 돌려줄 누적 로그(waitForBuild가 길이 차이로 델타를 뽑는다). */
  logs?: string[]
  /** true면 빌드 응답에 stageRepoId 없이 owner/repo만 담는다(실제 API 응답 모양). */
  ownerOnly?: boolean
}

const REPO = {
  id: 'r1',
  spaceId: 's',
  surface: 'USER',
  owner: 'acme',
  repo: 'w',
  defaultBranch: 'main',
}

function portal(opts: PortalOptions = {}) {
  const statuses = opts.statuses ?? ['SUCCEEDED']
  const logs = opts.logs ?? ['첫 줄\n']
  let polls = 0
  let logReads = 0
  const build = (status: string) => ({
    id: 'b1',
    status,
    ...(opts.ownerOnly ? { owner: 'ACME', repo: 'w' } : { stageRepoId: 'r1' }),
    spaceId: 's',
    surface: 'USER',
    commitSha: 'abc1234',
    requestedAt: '2026-09-01T00:00:00Z',
    failureReason: status === 'FAILED' ? 'BUILD_FAILED' : undefined,
  })
  const fetch = (async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname
    const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s })
    if (path.endsWith('/repos')) return j({ repos: [REPO] })
    if (path.endsWith('/builds/b1/log')) {
      return new Response(logs[Math.min(logReads++, logs.length - 1)])
    }
    if (path.endsWith('/builds/b1'))
      return j(build(statuses[Math.min(polls++, statuses.length - 1)]))
    if (path.endsWith('/builds')) return j({ builds: [build(statuses[0])] })
    return j({ error: path }, 404)
  }) as unknown as typeof globalThis.fetch
  return { fetch, getBuildCalls: () => polls }
}

async function setup() {
  const cwd = await mkdtemp(join(tmpdir(), 'logs-'))
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

/** process.exitCode는 프로세스 전역이라 테스트가 vitest 종료코드를 오염시키지 않게 되돌린다. */
async function withExitCode(fn: () => Promise<void>): Promise<typeof process.exitCode> {
  const before = process.exitCode
  try {
    await fn()
    return process.exitCode
  } finally {
    process.exitCode = before
  }
}

/** stdout·stderr 캡처. 상태 줄은 console.error로 나가므로 그것도 stderr로 모은다. */
function captureStd() {
  const stdout: string[] = []
  const stderr: string[] = []
  const o = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation((c) => (stdout.push(String(c)), true))
  const e = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation((c) => (stderr.push(String(c)), true))
  const c = vi.spyOn(console, 'error').mockImplementation((...args) => {
    stderr.push(args.map(String).join(' '))
  })
  return { stdout, stderr, restore: () => (o.mockRestore(), e.mockRestore(), c.mockRestore()) }
}

describe('logs', () => {
  it('buildId 없이 이 레포의 최근 빌드 로그를 출력한다', async () => {
    const { fetch } = portal()
    const s = await setup()
    const lines: string[] = []
    await logsCommand(undefined, {}, { ...s, fetch, out: (l) => lines.push(l) })
    expect(lines.join('')).toContain('첫 줄')
  })

  it('빌드 응답에 stageRepoId가 없어도 owner/repo로 매칭해 최근 빌드를 찾는다', async () => {
    const { fetch } = portal({ ownerOnly: true })
    const s = await setup()
    const lines: string[] = []
    await logsCommand(undefined, {}, { ...s, fetch, out: (l) => lines.push(l) })
    expect(lines.join('')).toContain('첫 줄')
  })

  it('--follow 는 로그 델타를 흘리고 마지막 상태 줄은 stderr로 보낸다', async () => {
    const { fetch } = portal({
      statuses: ['RUNNING', 'RUNNING', 'SUCCEEDED'],
      logs: ['a\n', 'a\nb\n'],
    })
    const s = await setup()
    const std = captureStd()
    try {
      await logsCommand('b1', { follow: true }, { ...s, fetch })
    } finally {
      std.restore()
    }
    expect(std.stdout.join('')).toContain('b\n')
    expect(std.stderr.join('')).toContain('SUCCEEDED')
  })

  it('--json --follow 는 델타를 stderr로 보내고 stdout에는 JSON 객체 하나만 쓴다', async () => {
    const { fetch } = portal({
      statuses: ['RUNNING', 'RUNNING', 'SUCCEEDED'],
      logs: ['a\n', 'a\nb\n'],
    })
    const s = await setup()
    const std = captureStd()
    try {
      await logsCommand('b1', { follow: true, json: true }, { ...s, fetch })
    } finally {
      std.restore()
    }
    expect(std.stdout).toHaveLength(1)
    const payload = JSON.parse(std.stdout[0]) as { build: { id: string }; log: string }
    expect(payload.build.id).toBe('b1')
    expect(payload.log).toBe('a\nb\n')
    expect(std.stderr.join('')).toContain('b')
  })

  it('--json 은 비-follow에서도 stdout에 JSON 객체 하나만 쓴다', async () => {
    const { fetch } = portal()
    const s = await setup()
    const std = captureStd()
    try {
      await logsCommand('b1', { json: true }, { ...s, fetch })
    } finally {
      std.restore()
    }
    expect(std.stdout).toHaveLength(1)
    expect(Object.keys(JSON.parse(std.stdout[0]) as object).sort()).toEqual(['build', 'log'])
  })

  it('실패한 빌드면 종료코드 1', async () => {
    const { fetch } = portal({ statuses: ['FAILED'] })
    const s = await setup()
    const code = await withExitCode(async () => {
      await logsCommand('b1', {}, { ...s, fetch, out: () => {} })
    })
    expect(code).toBe(1)
  })

  it('아직 진행 중인 빌드를 --follow 없이 보면 종료코드는 0', async () => {
    const { fetch } = portal({ statuses: ['RUNNING'] })
    const s = await setup()
    const code = await withExitCode(async () => {
      await logsCommand('b1', {}, { ...s, fetch, out: () => {} })
    })
    expect(code).toBeUndefined()
  })
})
