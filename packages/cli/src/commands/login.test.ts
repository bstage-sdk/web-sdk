import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { PORTAL_HOSTS } from '../constants.js'
import { saveLink } from '../portal/config.js'
import {
  listCredentialOrgs,
  loadCredential,
  saveCredential,
  UNKNOWN_ORG,
} from '../portal/credentials.js'
import { loginCommand } from './login.js'

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s })
const me = { user: { id: 'u', email: 'a@b' }, memberships: [{ organizationId: 'o' }] }
const issued = {
  id: 't1',
  prefix: 'bsc_ab',
  token: 'bsc_issued',
  permission: 'deploy',
  spaceIds: [],
  allSpaces: true,
  organizationId: 'org1',
  expiresAt: '2026-10-04T00:00:00Z',
}

/** 디바이스 흐름 가짜 포털: code → (pending × n) → ok. */
function devicePortal(
  pendingPolls: number,
  final: 'ok' | 'expired_token' | 'access_denied' = 'ok',
) {
  let polls = 0
  const calls: string[] = []
  const fetchImpl = (async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname
    calls.push(path)
    if (path.endsWith('/cli/device/code'))
      return json(
        {
          deviceCode: 'dev1',
          userCode: 'ABCD-EFGH',
          verificationUri: 'https://p.example/cli/authorize',
          verificationUriComplete: 'https://p.example/cli/authorize?code=ABCD-EFGH',
          expiresIn: 600,
          interval: 5,
        },
        201,
      )
    if (path.endsWith('/cli/device/token')) {
      if (polls++ < pendingPolls) return json({ error: 'authorization_pending' }, 400)
      return final === 'ok' ? json(issued) : json({ error: final }, 400)
    }
    if (path.endsWith('/auth/me')) return json(me)
    return json({ error: path }, 404)
  }) as unknown as typeof fetch
  return { fetch: fetchImpl, calls }
}

async function home() {
  const dir = await mkdtemp(join(tmpdir(), 'login-'))
  return { cwd: dir, env: { XDG_CONFIG_HOME: dir } }
}

describe('login — 디바이스 코드', () => {
  it('코드를 받고 브라우저를 열고 폴링해 토큰을 저장한다', async () => {
    const h = await home()
    const { fetch, calls } = devicePortal(2)
    const opened: string[] = []
    const waits: number[] = []
    await loginCommand(
      { portal: 'https://p.example' },
      {
        ...h,
        fetch,
        openBrowser: async (u) => {
          opened.push(u)
          return true
        },
        sleep: async (ms) => {
          waits.push(ms)
        },
        hostname: () => 'mbp',
      },
    )
    expect(opened).toEqual(['https://p.example/cli/authorize?code=ABCD-EFGH'])
    expect(waits).toEqual([5000, 5000, 5000])
    expect(calls.filter((c) => c.endsWith('/token'))).toHaveLength(3)
    expect((await loadCredential('https://p.example', undefined, h.env))?.token).toBe('bsc_issued')
  })

  it('--no-browser 면 열지 않는다', async () => {
    const h = await home()
    const { fetch } = devicePortal(0)
    const openBrowser = vi.fn(async () => true)
    await loginCommand(
      { portal: 'https://p.example', noBrowser: true },
      { ...h, fetch, openBrowser, sleep: async () => {} },
    )
    expect(openBrowser).not.toHaveBeenCalled()
  })

  it('slow_down 이면 간격을 5초 늘린다', async () => {
    const h = await home()
    let n = 0
    const fetchImpl = (async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname
      if (path.endsWith('/code'))
        return json(
          {
            deviceCode: 'd',
            userCode: 'X',
            verificationUri: 'u',
            verificationUriComplete: 'u',
            expiresIn: 600,
            interval: 5,
          },
          201,
        )
      return n++ === 0 ? json({ error: 'slow_down' }, 400) : json(issued)
    }) as unknown as typeof fetch
    const waits: number[] = []
    await loginCommand(
      { portal: 'https://p.example', noBrowser: true },
      {
        ...h,
        fetch: fetchImpl,
        sleep: async (ms) => {
          waits.push(ms)
        },
      },
    )
    expect(waits).toEqual([5000, 10000])
  })

  it('거부되면 AUTH, 만료되면 PRECONDITION — 저장 없음', async () => {
    const h = await home()
    await expect(
      loginCommand(
        { portal: 'https://p.example', noBrowser: true },
        { ...h, fetch: devicePortal(0, 'access_denied').fetch, sleep: async () => {} },
      ),
    ).rejects.toMatchObject({ code: 3 })
    await expect(
      loginCommand(
        { portal: 'https://p.example', noBrowser: true },
        { ...h, fetch: devicePortal(0, 'expired_token').fetch, sleep: async () => {} },
      ),
    ).rejects.toMatchObject({ code: 2 })
    expect(await loadCredential('https://p.example', undefined, h.env)).toBeNull()
  })

  it('클라이언트 시한(expiresIn)을 넘기면 폴링을 멈추고 PRECONDITION', async () => {
    const h = await home()
    let clock = 0
    const calls: string[] = []
    const fetchImpl = (async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname
      calls.push(path)
      if (path.endsWith('/cli/device/code'))
        return json(
          {
            deviceCode: 'd',
            userCode: 'X',
            verificationUri: 'u',
            verificationUriComplete: 'u',
            expiresIn: 20,
            interval: 5,
          },
          201,
        )
      return json({ error: 'authorization_pending' }, 400)
    }) as unknown as typeof fetch
    await expect(
      loginCommand(
        { portal: 'https://p.example', noBrowser: true },
        {
          ...h,
          fetch: fetchImpl,
          sleep: async (ms) => {
            clock += ms
          },
          now: () => clock,
        },
      ),
    ).rejects.toMatchObject({ code: 2 })
    expect(calls.length).toBeLessThanOrEqual(5)
    expect(await loadCredential('https://p.example', undefined, h.env)).toBeNull()
  })

  it('브라우저는 포털과 같은 오리진일 때만 연다', async () => {
    const h = await home()
    const fetchImpl = (async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname
      if (path.endsWith('/cli/device/code'))
        return json(
          {
            deviceCode: 'd',
            userCode: 'X',
            verificationUri: 'https://evil.example/cli/authorize',
            verificationUriComplete: 'https://evil.example/cli/authorize?code=X',
            expiresIn: 600,
            interval: 5,
          },
          201,
        )
      return json(issued)
    }) as unknown as typeof fetch
    const openBrowser = vi.fn(async () => true)
    await loginCommand(
      { portal: 'https://p.example' },
      { ...h, fetch: fetchImpl, openBrowser, sleep: async () => {} },
    )
    expect(openBrowser).not.toHaveBeenCalled()
  })

  it('링크 파일의 포털 주소는 무시하고 phase 매핑을 쓴다', async () => {
    const h = await home()
    await saveLink(h.cwd, {
      portalUrl: 'https://evil.example',
      organizationId: 'o',
      spaceId: 's',
      repoId: 'r',
      surface: 'USER',
    })
    await loginCommand(
      { noBrowser: true },
      { ...h, fetch: devicePortal(0).fetch, sleep: async () => {} },
    )
    expect((await loadCredential(`https://${PORTAL_HOSTS.sandbox}`, undefined, h.env))?.token).toBe(
      'bsc_issued',
    )
    expect(await loadCredential('https://evil.example', undefined, h.env)).toBeNull()
  })

  it('--portal 없이 --phase 만 주면 그 phase 포털에 저장한다', async () => {
    const h = await home()
    await loginCommand(
      { phase: 'real', noBrowser: true },
      { ...h, fetch: devicePortal(0).fetch, sleep: async () => {} },
    )
    expect((await loadCredential(`https://${PORTAL_HOSTS.real}`, undefined, h.env))?.token).toBe(
      'bsc_issued',
    )
  })
})

describe('login — 붙여 넣기(CI)', () => {
  it('--token 은 auth/me 로 검증 후 저장하고 디바이스 흐름을 타지 않는다', async () => {
    const h = await home()
    const { fetch, calls } = devicePortal(0)
    await loginCommand(
      { portal: 'https://p.example', token: 'bsc_good', org: 'org1' },
      { ...h, fetch },
    )
    expect(calls).toEqual(['/api/v1/auth/me'])
    expect((await loadCredential('https://p.example', undefined, h.env))?.token).toBe('bsc_good')
  })
  it('검증 실패면 저장하지 않고 AUTH', async () => {
    const h = await home()
    const bad = (async () => json({ error: 'nope' }, 401)) as unknown as typeof fetch
    await expect(
      loginCommand(
        { portal: 'https://p.example', token: 'bsc_bad', org: 'org1' },
        {
          ...h,
          fetch: bad,
        },
      ),
    ).rejects.toMatchObject({ code: 3 })
    expect(await loadCredential('https://p.example', undefined, h.env)).toBeNull()
  })
  it('bsc_ 로 시작하지 않으면 PRECONDITION', async () => {
    const h = await home()
    await expect(
      loginCommand(
        { portal: 'https://p.example', token: 'ghp_x', org: 'org1' },
        { ...h, fetch: devicePortal(0).fetch },
      ),
    ).rejects.toMatchObject({ code: 2 })
  })
  it('BSTAGE_TOKEN 환경변수도 붙여 넣기 경로다', async () => {
    const h = await home()
    const { fetch, calls } = devicePortal(0)
    await loginCommand(
      { portal: 'https://p.example' },
      { cwd: h.cwd, env: { ...h.env, BSTAGE_TOKEN: 'bsc_env', BSTAGE_ORG: 'org1' }, fetch },
    )
    expect(calls).toEqual(['/api/v1/auth/me'])
    expect((await loadCredential('https://p.example', 'org1', h.env))?.token).toBe('bsc_env')
  })
})

describe('login — 조직별 저장', () => {
  it('응답의 organizationId 로 저장하고 조직·전체 스코프를 표시한다', async () => {
    const h = await home()
    const lines: string[] = []
    const log = vi.spyOn(console, 'log').mockImplementation((...a) => void lines.push(a.join(' ')))
    await loginCommand(
      { portal: 'https://p.example', noBrowser: true },
      { ...h, fetch: devicePortal(0).fetch, sleep: async () => {} },
    )
    log.mockRestore()
    expect((await loadCredential('https://p.example', 'org1', h.env))?.token).toBe('bsc_issued')
    const out = lines.join('\n')
    expect(out).toContain('org1')
    expect(out).toContain('이 조직의 모든 스테이지')
    expect(out).not.toContain('bsc_issued')
  })

  it('allSpaces 가 아니면 스테이지 개수를 표시한다', async () => {
    const h = await home()
    const fetchImpl = (async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname
      if (path.endsWith('/cli/device/code'))
        return json(
          {
            deviceCode: 'd',
            userCode: 'X',
            verificationUri: 'u',
            verificationUriComplete: 'u',
            expiresIn: 600,
            interval: 5,
          },
          201,
        )
      return json({ ...issued, allSpaces: false, spaceIds: ['sp1', 'sp2'] })
    }) as unknown as typeof fetch
    const lines: string[] = []
    const log = vi.spyOn(console, 'log').mockImplementation((...a) => void lines.push(a.join(' ')))
    await loginCommand(
      { portal: 'https://p.example', noBrowser: true },
      { ...h, fetch: fetchImpl, sleep: async () => {} },
    )
    log.mockRestore()
    expect(lines.join('\n')).toContain('스테이지 2개')
  })

  it('응답에 organizationId 가 없으면 조직 미상으로 저장한다', async () => {
    const h = await home()
    const fetchImpl = (async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname
      if (path.endsWith('/cli/device/code'))
        return json(
          {
            deviceCode: 'd',
            userCode: 'X',
            verificationUri: 'u',
            verificationUriComplete: 'u',
            expiresIn: 600,
            interval: 5,
          },
          201,
        )
      return json({ ...issued, organizationId: undefined, allSpaces: undefined })
    }) as unknown as typeof fetch
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await loginCommand(
      { portal: 'https://p.example', noBrowser: true, json: true },
      { ...h, fetch: fetchImpl, sleep: async () => {} },
    )
    out.mockRestore()
    const c = await loadCredential('https://p.example', undefined, h.env)
    expect(c?.organizationId).toBe(UNKNOWN_ORG)
  })

  it('--token 경로는 조직을 요구한다 — 없으면 PRECONDITION, 저장도 요청도 하지 않는다', async () => {
    const h = await home()
    const fetchSpy = vi.fn()
    await expect(
      loginCommand(
        { portal: 'https://p.example', token: 'bsc_good' },
        { ...h, fetch: fetchSpy as unknown as typeof fetch },
      ),
    ).rejects.toMatchObject({ code: 2, message: expect.stringContaining('--org') })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(await loadCredential('https://p.example', undefined, h.env)).toBeNull()
  })
  it('조직을 알고 저장하면 그 포털의 레거시 미상 항목을 지운다', async () => {
    const h = await home()
    await saveCredential({ portalUrl: 'https://p.example', token: 'bsc_old', savedAt: '' }, h.env)
    await loginCommand(
      { portal: 'https://p.example', noBrowser: true },
      { ...h, fetch: devicePortal(0).fetch, sleep: async () => {} },
    )
    expect(await listCredentialOrgs('https://p.example', h.env)).toEqual(['org1'])
  })
})
