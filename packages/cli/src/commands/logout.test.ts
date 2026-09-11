import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { listCredentialOrgs, saveCredential } from '../portal/credentials.js'
import { logoutCommand } from './logout.js'

const PORTAL = 'https://p.example'

async function home() {
  const dir = await mkdtemp(join(tmpdir(), 'logout-'))
  return { cwd: dir, env: { XDG_CONFIG_HOME: dir } }
}

/** console.log 를 가로채 출력 문자열을 모은다. */
async function capture(fn: () => Promise<void>): Promise<string> {
  const lines: string[] = []
  const log = vi.spyOn(console, 'log').mockImplementation((...a) => void lines.push(a.join(' ')))
  try {
    await fn()
  } finally {
    log.mockRestore()
  }
  return lines.join('\n')
}

async function withTwoOrgs() {
  const h = await home()
  await saveCredential(
    { portalUrl: PORTAL, organizationId: 'org1', token: 'bsc_1', savedAt: '' },
    h.env,
  )
  await saveCredential(
    { portalUrl: PORTAL, organizationId: 'org2', token: 'bsc_2', savedAt: '' },
    h.env,
  )
  return h
}

describe('logout', () => {
  it('기본은 포털의 모든 조직 토큰을 지우고 지운 조직을 출력한다', async () => {
    const h = await withTwoOrgs()
    const out = await capture(() => logoutCommand({ portal: PORTAL }, h))
    expect(out).toContain('org1')
    expect(out).toContain('org2')
    expect(await listCredentialOrgs(PORTAL, h.env)).toEqual([])
  })

  it('--org 를 주면 그 조직만 지운다', async () => {
    const h = await withTwoOrgs()
    const out = await capture(() => logoutCommand({ portal: PORTAL, org: 'org1' }, h))
    expect(out).toContain('org1')
    expect(await listCredentialOrgs(PORTAL, h.env)).toEqual(['org2'])
  })

  it('지울 것이 없으면 그렇다고 알린다', async () => {
    const h = await home()
    const out = await capture(() => logoutCommand({ portal: PORTAL }, h))
    expect(out).toContain('없습니다')
  })

  it('없는 조직을 주면 남은 토큰을 건드리지 않는다', async () => {
    const h = await withTwoOrgs()
    const out = await capture(() => logoutCommand({ portal: PORTAL, org: 'org404' }, h))
    expect(out).toContain('없습니다')
    expect(await listCredentialOrgs(PORTAL, h.env)).toEqual(['org1', 'org2'])
  })
})
