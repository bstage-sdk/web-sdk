import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { PORTAL_HOSTS } from '../constants.js'
import { saveLink } from './config.js'
import { saveCredential } from './credentials.js'
import { ExitCode } from './output.js'
import { resolveContext } from './resolveContext.js'

const link = {
  portalUrl: `https://${PORTAL_HOSTS.sandbox}`,
  organizationId: 'o',
  spaceId: 's',
  repoId: 'r',
  surface: 'USER' as const,
}

describe('resolveContext', () => {
  it('링크 없으면 PRECONDITION', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ctx-'))
    await expect(resolveContext({ cwd, env: { XDG_CONFIG_HOME: cwd } })).rejects.toMatchObject({
      code: ExitCode.PRECONDITION,
    })
  })
  it('토큰 없으면 AUTH', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ctx-'))
    await saveLink(cwd, link)
    await expect(resolveContext({ cwd, env: { XDG_CONFIG_HOME: cwd } })).rejects.toMatchObject({
      code: ExitCode.AUTH,
    })
  })
  it('링크 파일의 포털이 허용 목록 밖이면 요청 없이 PRECONDITION', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ctx-'))
    await saveLink(cwd, { ...link, portalUrl: 'https://evil.example' })
    await saveCredential(
      { portalUrl: 'https://evil.example', token: 'bsc_x', savedAt: '' },
      { XDG_CONFIG_HOME: cwd },
    )
    const fetchSpy = vi.fn()
    await expect(
      resolveContext({
        cwd,
        env: { XDG_CONFIG_HOME: cwd },
        fetch: fetchSpy as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: ExitCode.PRECONDITION })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('BSTAGE_TOKEN 이 있으면 링크 파일 포털로는 토큰을 보내지 않는다', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ctx-'))
    await saveLink(cwd, link)
    const fetchSpy = vi.fn()
    await expect(
      resolveContext({
        cwd,
        env: { XDG_CONFIG_HOME: cwd, BSTAGE_TOKEN: 'bsc_ci' },
        fetch: fetchSpy as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: ExitCode.PRECONDITION })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('둘 다 있으면 클라이언트와 링크를 돌려준다', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ctx-'))
    await saveLink(cwd, link)
    await saveCredential(
      { portalUrl: link.portalUrl, token: 'bsc_x', savedAt: '' },
      { XDG_CONFIG_HOME: cwd },
    )
    const ctx = await resolveContext({ cwd, env: { XDG_CONFIG_HOME: cwd } })
    expect(ctx.link).toEqual(link)
    expect(ctx.client).toBeDefined()
  })
  it('링크 파일의 조직에 해당하는 토큰을 고른다', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ctx-'))
    const env = { XDG_CONFIG_HOME: cwd }
    await saveLink(cwd, { ...link, organizationId: 'org2' })
    await saveCredential(
      { portalUrl: link.portalUrl, organizationId: 'org1', token: 'bsc_1', savedAt: '' },
      env,
    )
    await saveCredential(
      { portalUrl: link.portalUrl, organizationId: 'org2', token: 'bsc_2', savedAt: '' },
      env,
    )
    const seen: string[] = []
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      seen.push(String((init?.headers as Record<string, string>)?.Authorization))
      return new Response(JSON.stringify({ user: { id: 'u', email: 'a@b' }, memberships: [] }))
    }) as unknown as typeof fetch
    const ctx = await resolveContext({ cwd, env, fetch: fetchImpl })
    await ctx.client.me()
    expect(seen).toEqual(['Bearer bsc_2'])
    expect(ctx.organizationId).toBe('org2')
  })

  it('링크 조직 토큰이 없고 여러 조직이 저장돼 있으면 AUTH — 조직 목록을 안내한다', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ctx-'))
    const env = { XDG_CONFIG_HOME: cwd }
    await saveLink(cwd, { ...link, organizationId: 'org3' })
    await saveCredential(
      { portalUrl: link.portalUrl, organizationId: 'org1', token: 'bsc_1', savedAt: '' },
      env,
    )
    await saveCredential(
      { portalUrl: link.portalUrl, organizationId: 'org2', token: 'bsc_2', savedAt: '' },
      env,
    )
    await expect(resolveContext({ cwd, env })).rejects.toMatchObject({
      code: ExitCode.AUTH,
      message: expect.stringContaining('org1, org2'),
    })
    await expect(resolveContext({ cwd, env })).rejects.toMatchObject({
      message: expect.stringContaining('bstage login'),
    })
  })
  it('링크 조직 토큰이 없으면 다른 조직 토큰으로 대신하지 않는다', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ctx-'))
    const env = { XDG_CONFIG_HOME: cwd }
    await saveLink(cwd, { ...link, organizationId: 'org3' })
    await saveCredential(
      { portalUrl: link.portalUrl, organizationId: 'org1', token: 'bsc_1', savedAt: '' },
      env,
    )
    await expect(resolveContext({ cwd, env })).rejects.toMatchObject({
      code: ExitCode.AUTH,
      message: expect.stringContaining('저장된 조직: org1'),
    })
  })

  it('v1 에서 마이그레이션된 레거시 토큰 하나뿐이면 링크 조직으로도 그것을 쓴다', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ctx-'))
    const env = { XDG_CONFIG_HOME: cwd }
    await saveLink(cwd, { ...link, organizationId: 'org1' })
    await saveCredential({ portalUrl: link.portalUrl, token: 'bsc_old', savedAt: '' }, env)
    const seen: string[] = []
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      seen.push(String((init?.headers as Record<string, string>)?.Authorization))
      return new Response(JSON.stringify({ user: { id: 'u', email: 'a@b' }, memberships: [] }))
    }) as unknown as typeof fetch
    const ctx = await resolveContext({ cwd, env, fetch: fetchImpl })
    await ctx.client.me()
    expect(seen).toEqual(['Bearer bsc_old'])
  })
})
