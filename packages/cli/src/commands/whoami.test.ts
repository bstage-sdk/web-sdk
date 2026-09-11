import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { saveCredential } from '../portal/credentials.js'
import { whoamiCommand } from './whoami.js'

const PORTAL = 'https://p.example'
const me = {
  user: { id: 'u', email: 'a@b' },
  memberships: [{ organizationId: 'org1', organizationRole: 'OWNER' }],
}

async function home() {
  const dir = await mkdtemp(join(tmpdir(), 'whoami-'))
  return { cwd: dir, env: { XDG_CONFIG_HOME: dir } }
}

const meFetch = (async () =>
  new Response(JSON.stringify(me), { status: 200 })) as unknown as typeof fetch

/** stdout(`--json`)과 console.log(사람용)를 함께 모은다. */
async function capture(fn: () => Promise<void>): Promise<string> {
  const lines: string[] = []
  const log = vi.spyOn(console, 'log').mockImplementation((...a) => void lines.push(a.join(' ')))
  const out = vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
    lines.push(String(c))
    return true
  })
  try {
    await fn()
  } finally {
    log.mockRestore()
    out.mockRestore()
  }
  return lines.join('\n')
}

async function withOrg(organizationId: string, token: string, extra = {}) {
  const h = await home()
  await saveCredential({ portalUrl: PORTAL, organizationId, token, savedAt: '', ...extra }, h.env)
  return h
}

describe('whoami', () => {
  it('저장된 조직별 토큰을 등급·스코프·만료와 함께 보여준다 — 토큰 값은 찍지 않는다', async () => {
    const h = await withOrg('org1', 'bsc_secret', {
      permission: 'deploy',
      allSpaces: true,
      expiresAt: '2026-10-04T00:00:00Z',
    })
    const out = await capture(() => whoamiCommand({ portal: PORTAL }, { ...h, fetch: meFetch }))
    expect(out).toContain('a@b')
    expect(out).toContain('org1')
    expect(out).toContain('deploy')
    expect(out).toContain('이 조직의 모든 스테이지')
    expect(out).toContain('2026-10-04')
    expect(out).not.toContain('bsc_secret')
  })

  it('BSTAGE_TOKEN 이 있으면 그 토큰으로 조회하고 저장 항목을 사용 중으로 표시하지 않는다', async () => {
    const h = await withOrg('org1', 'bsc_stored', { permission: 'read', spaceIds: ['sp1'] })
    const env = { ...h.env, BSTAGE_TOKEN: 'bsc_envtoken' }
    const out = await capture(() =>
      whoamiCommand({ portal: PORTAL, json: true }, { ...h, env, fetch: meFetch }),
    )
    const j = JSON.parse(out)
    expect(j.tokenSource).toBe('env')
    expect(j.organizationId).toBeNull()
    expect(j.credentials.every((c: { active: boolean }) => c.active === false)).toBe(true)
    expect(out).not.toContain('bsc_envtoken')
    expect(out).not.toContain('bsc_stored')
  })

  it('BSTAGE_TOKEN 이 빈 문자열이면 다른 명령과 같이 저장 토큰을 쓰고 저장 항목을 활성으로 표시한다', async () => {
    const h = await withOrg('org1', 'bsc_stored', { permission: 'read', spaceIds: ['sp1'] })
    const env = { ...h.env, BSTAGE_TOKEN: '' }
    const seen: string[] = []
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      seen.push(String((init?.headers as Record<string, string>)?.Authorization))
      return new Response(JSON.stringify(me), { status: 200 })
    }) as unknown as typeof fetch
    const out = await capture(() =>
      whoamiCommand({ portal: PORTAL, json: true }, { ...h, env, fetch: fetchImpl }),
    )
    expect(seen).toEqual(['Bearer bsc_stored'])
    const j = JSON.parse(out)
    expect(j.tokenSource).toBe('stored')
    expect(j.credentials[0].active).toBe(true)
  })

  it('--json 에도 토큰 값은 담지 않는다', async () => {
    const h = await withOrg('org1', 'bsc_secret', { permission: 'read', spaceIds: ['sp1'] })
    const out = await capture(() =>
      whoamiCommand({ portal: PORTAL, json: true }, { ...h, fetch: meFetch }),
    )
    const parsed = JSON.parse(out)
    expect(parsed.portalUrl).toBe(PORTAL)
    expect(parsed.user.email).toBe('a@b')
    expect(parsed.credentials).toEqual([
      {
        organizationId: 'org1',
        permission: 'read',
        allSpaces: false,
        spaceIds: ['sp1'],
        expiresAt: null,
        savedAt: '',
        active: true,
      },
    ])
    expect(out).not.toContain('bsc_secret')
  })

  it('조직이 여러 개고 조직을 특정할 수 없으면 목록만 보여주고 포털에 묻지 않는다', async () => {
    const h = await withOrg('org1', 'bsc_1')
    await saveCredential(
      { portalUrl: PORTAL, organizationId: 'org2', token: 'bsc_2', savedAt: '' },
      h.env,
    )
    const fetchSpy = vi.fn()
    const out = await capture(() =>
      whoamiCommand({ portal: PORTAL }, { ...h, fetch: fetchSpy as unknown as typeof fetch }),
    )
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(out).toContain('org1')
    expect(out).toContain('org2')
    expect(out).toContain('--org')
  })

  it('--org 로 조직을 고르면 그 토큰으로 조회한다', async () => {
    const h = await withOrg('org1', 'bsc_1')
    await saveCredential(
      { portalUrl: PORTAL, organizationId: 'org2', token: 'bsc_2', savedAt: '' },
      h.env,
    )
    const seen: string[] = []
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      seen.push(String((init?.headers as Record<string, string>)?.Authorization))
      return new Response(JSON.stringify(me), { status: 200 })
    }) as unknown as typeof fetch
    await capture(() => whoamiCommand({ portal: PORTAL, org: 'org2' }, { ...h, fetch: fetchImpl }))
    expect(seen).toEqual(['Bearer bsc_2'])
  })

  it('저장된 자격증명이 없으면 AUTH', async () => {
    const h = await home()
    await expect(whoamiCommand({ portal: PORTAL }, { ...h, fetch: meFetch })).rejects.toMatchObject(
      { code: 3 },
    )
  })
})
