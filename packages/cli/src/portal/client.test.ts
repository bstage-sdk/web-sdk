import { describe, expect, it, vi } from 'vitest'
import { PortalClient, PortalError } from './client.js'
import { ExitCode, exitCodeFor } from './output.js'

function fakeFetch(handlers: Record<string, (init?: RequestInit) => Response>) {
  const calls: { url: string; init?: RequestInit }[] = []
  const f = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    const key = `${init?.method ?? 'GET'} ${new URL(url).pathname}${new URL(url).search}`
    const h = handlers[key]
    if (!h) return new Response(JSON.stringify({ error: `no handler for ${key}` }), { status: 599 })
    return h(init)
  }) as unknown as typeof fetch
  return { fetch: f, calls }
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })

const client = (
  fetchFn: typeof globalThis.fetch,
  sleep: (ms: number) => Promise<void> = async () => {},
) =>
  new PortalClient({ portalUrl: 'https://portal.example/', token: 'bsc_t', fetch: fetchFn, sleep })

describe('PortalClient', () => {
  it('Bearer 헤더와 /api/v1 경로로 호출한다', async () => {
    const { fetch, calls } = fakeFetch({
      'GET /api/v1/auth/me': () => json({ user: { id: 'u' }, memberships: [] }),
    })
    await client(fetch).me()
    expect(calls[0].url).toBe('https://portal.example/api/v1/auth/me')
    expect(new Headers(calls[0].init?.headers).get('Authorization')).toBe('Bearer bsc_t')
  })

  it('목록 응답의 래퍼 키를 벗긴다', async () => {
    const { fetch } = fakeFetch({
      'GET /api/v1/organizations/o/stages/s/builds?limit=5': () => json({ builds: [{ id: 'b1' }] }),
      'GET /api/v1/organizations/o/stages/s/placements?surface=USER': () =>
        json({ placements: [{ id: 'p1' }] }),
      'GET /api/v1/organizations/o/stages/s/repos': () => json({ repos: [{ id: 'r1' }] }),
    })
    const c = client(fetch)
    const builds = await c.listBuilds('o', 's', 5)
    expect(builds.map((b) => b.id)).toEqual(['b1'])
    expect(builds[0].spaceId).toBe('s') // 조회 스테이지를 새겨 준다(응답에는 spaceId가 없다)
    expect((await c.listPlacements('o', 's', 'USER')).map((p) => p.id)).toEqual(['p1'])
    const repos = await c.listRepos('o', 's')
    expect(repos.map((r) => r.id)).toEqual(['r1'])
    // 레포 응답에도 spaceId가 없다 — 새기지 않으면 buildMatchesRepo의 spaceId 대조가 항상 실패해
    // list/logs/rollback이 빌드를 하나도 못 본다(sandbox 실측 2026-09-10)
    expect(repos[0].spaceId).toBe('s')
  })

  it('createBuild·deployPlacement가 올바른 본문을 보낸다', async () => {
    const { fetch, calls } = fakeFetch({
      'POST /api/v1/organizations/o/stages/s/builds': () =>
        json({ id: 'b2', status: 'QUEUED' }, 201),
      'POST /api/v1/organizations/o/stages/s/placements/p1/deploy': () =>
        json({ id: 'p1', liveBuildId: 'b2' }),
      'PATCH /api/v1/organizations/o/stages/s/placements/p1': () =>
        json({ placement: { id: 'p1', enabled: false } }),
    })
    const c = client(fetch)
    expect((await c.createBuild('o', 's', 'r1')).id).toBe('b2')
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ repoId: 'r1' })
    expect((await c.deployPlacement('o', 's', 'p1', 'b2', 'b1')).liveBuildId).toBe('b2')
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({
      buildId: 'b2',
      expectedLiveBuildId: 'b1',
    })
    expect((await c.setPlacementEnabled('o', 's', 'p1', false)).enabled).toBe(false)
    expect(JSON.parse(String(calls[2].init?.body))).toEqual({ enabled: false })
  })

  it('로그는 텍스트로 받는다', async () => {
    const { fetch } = fakeFetch({
      'GET /api/v1/organizations/o/stages/s/builds/b1/log': () =>
        new Response('line1\nline2', { status: 200 }),
    })
    expect(await client(fetch).getBuildLog('o', 's', 'b1')).toBe('line1\nline2')
  })

  it('실패 응답은 PortalError(status, 서버 메시지)로 던진다', async () => {
    const { fetch } = fakeFetch({
      'GET /api/v1/auth/me': () => json({ error: '토큰이 유효하지 않습니다' }, 401),
    })
    await expect(client(fetch).me()).rejects.toMatchObject({
      status: 401,
      message: '토큰이 유효하지 않습니다',
    } satisfies Partial<PortalError>)
  })

  it('429는 Retry-After만큼 기다려 최대 3회 재시도한다', async () => {
    let n = 0
    const waits: number[] = []
    const { fetch } = fakeFetch({
      'GET /api/v1/auth/me': () =>
        ++n < 3
          ? json({ error: 'busy' }, 429, { 'Retry-After': '2' })
          : json({ user: { id: 'u' }, memberships: [] }),
    })
    await client(fetch, async (ms) => {
      waits.push(ms)
    }).me()
    expect(n).toBe(3)
    expect(waits).toEqual([2000, 2000])
  })

  it('Retry-After 가 터무니없이 크면 60초로 자른다', async () => {
    let n = 0
    const waits: number[] = []
    const { fetch } = fakeFetch({
      'GET /api/v1/auth/me': () =>
        ++n < 2
          ? json({ error: 'busy' }, 429, { 'Retry-After': '99999999' })
          : json({ user: { id: 'u' }, memberships: [] }),
    })
    await client(fetch, async (ms) => {
      waits.push(ms)
    }).me()
    expect(waits).toEqual([60000])
  })

  it.each([['-5'], ['nope'], ['']])(
    'Retry-After 가 %s 면 기본 백오프로 되돌린다',
    async (value) => {
      let n = 0
      const waits: number[] = []
      const { fetch } = fakeFetch({
        'GET /api/v1/auth/me': () =>
          ++n < 2
            ? json({ error: 'busy' }, 429, { 'Retry-After': value })
            : json({ user: { id: 'u' }, memberships: [] }),
      })
      await client(fetch, async (ms) => {
        waits.push(ms)
      }).me()
      expect(waits).toEqual([5000])
    },
  )

  it('요청마다 타임아웃 시그널을 붙인다', async () => {
    const { fetch, calls } = fakeFetch({
      'GET /api/v1/auth/me': () => json({ user: { id: 'u' }, memberships: [] }),
    })
    await client(fetch).me()
    expect(calls[0].init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('타임아웃이면 한국어 메시지의 PortalError 로 끝난다', async () => {
    const timeout = (async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    }) as unknown as typeof fetch
    const err = await new PortalClient({
      portalUrl: 'https://portal.example',
      token: 'bsc_t',
      fetch: timeout,
      timeoutMs: 30_000,
    })
      .me()
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PortalError)
    expect((err as PortalError).message).toContain('30초')
    expect(exitCodeFor(err)).toBe(ExitCode.FAILURE)
  })

  it('429가 4번 연속이면 PortalError(429)로 끝난다', async () => {
    const { fetch } = fakeFetch({ 'GET /api/v1/auth/me': () => json({ error: 'busy' }, 429) })
    await expect(client(fetch).me()).rejects.toMatchObject({ status: 429 })
  })

  describe('네트워크 오류 재시도', () => {
    const netErr = () =>
      Object.assign(new TypeError('fetch failed'), { cause: { code: 'UND_ERR_SOCKET' } })

    it('GET은 fetch failed 한 번을 재시도해 성공한다', async () => {
      let calls = 0
      const c = client(async () => {
        calls++
        if (calls === 1) throw netErr()
        return json({ id: 'u1', email: 'a@b.c', organizations: [] })
      })
      await expect(c.me()).resolves.toBeTruthy()
      expect(calls).toBe(2)
    })

    it('디바이스 토큰 폴링도 한 번 재시도하고, 두 번 연속 실패면 PortalError로 끝낸다', async () => {
      let calls = 0
      const c = client(async () => {
        calls++
        throw netErr()
      })
      await expect(c.pollDeviceToken('d')).rejects.toBeInstanceOf(PortalError)
      expect(calls).toBe(2)
    })

    it('deploy 같은 비멱등 POST는 재시도하지 않는다', async () => {
      let calls = 0
      const c = client(async () => {
        calls++
        throw netErr()
      })
      await expect(c.deployPlacement('o', 's', 'p', 'b', '')).rejects.toBeInstanceOf(PortalError)
      expect(calls).toBe(1)
    })
  })

  describe('디바이스 코드', () => {
    const anon = (fetchFn: typeof globalThis.fetch) =>
      new PortalClient({
        portalUrl: 'https://portal.example',
        token: '',
        fetch: fetchFn,
        sleep: async () => {},
      })

    it('startDeviceAuth 는 Authorization 없이 코드를 받는다', async () => {
      const { fetch, calls } = fakeFetch({
        'POST /api/v1/cli/device/code': () =>
          json(
            {
              deviceCode: 'd',
              userCode: 'ABCD-EFGH',
              verificationUri: 'u',
              verificationUriComplete: 'u?code=ABCD-EFGH',
              expiresIn: 600,
              interval: 5,
            },
            201,
          ),
      })
      const r = await anon(fetch).startDeviceAuth('mbp', '0.60.0')
      expect(r.userCode).toBe('ABCD-EFGH')
      expect(new Headers(calls[0].init?.headers).has('Authorization')).toBe(false)
      expect(JSON.parse(String(calls[0].init?.body))).toEqual({
        deviceName: 'mbp',
        cliVersion: '0.60.0',
      })
    })

    it('pollDeviceToken 은 pending·slow_down 을 결과로, expired·denied 를 에러로 돌려준다', async () => {
      const seq = [
        json({ error: 'authorization_pending' }, 400),
        json({ error: 'slow_down' }, 400),
        json({ error: 'slow_down' }, 400, { 'Retry-After': '17' }),
        json({
          id: 't',
          prefix: 'bsc_ab',
          token: 'bsc_full',
          permission: 'deploy',
          spaceIds: ['sp1'],
          expiresAt: '2026-10-04T00:00:00Z',
        }),
        json({ error: 'expired_token' }, 400),
      ]
      const { fetch } = fakeFetch({ 'POST /api/v1/cli/device/token': () => seq.shift()! })
      const c = anon(fetch)
      expect(await c.pollDeviceToken('d')).toEqual({ status: 'pending' })
      expect(await c.pollDeviceToken('d')).toEqual({ status: 'slow_down' })
      expect(await c.pollDeviceToken('d')).toEqual({ status: 'slow_down', retryAfter: 17 }) // IP 캡 시 Retry-After 전달
      expect(await c.pollDeviceToken('d')).toMatchObject({ status: 'ok', token: 'bsc_full' })
      await expect(c.pollDeviceToken('d')).rejects.toMatchObject({
        status: 400,
        message: 'expired_token',
      })
    })
  })
})
