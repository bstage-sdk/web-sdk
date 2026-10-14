import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PORTAL_HOSTS } from '../../constants.js'
import { saveLink } from '../../portal/config.js'
import { saveCredential } from '../../portal/credentials.js'
import { CliExit, ExitCode } from '../../portal/output.js'
import type { DiagnosisFinding, Placement } from '../../portal/types.js'
import {
  DIAGNOSIS_CONCURRENCY,
  MAX_DIAGNOSED_PLACEMENTS,
  diagnosePortal,
  portalHasErrorFinding,
  type PortalReport,
} from './portal.js'

/**
 * doctor의 포털 진단은 손 검증 1회로는 해피패스(링크·로그인·진단 성공)만 지나간다.
 * 건너뜀·구버전 서버·부분 실패·상한 같은 분기는 여기서만 실행된다.
 */

const PORTAL = `https://${PORTAL_HOSTS.sandbox}`
const STAGE = '/api/v1/organizations/org1/stages/sp1'

function placement(id: string, extra: Partial<Placement> = {}): Placement {
  return {
    id,
    surface: 'USER',
    kind: 'PAGE',
    path: `/${id}`,
    stageRepoId: 'r1',
    status: 'LIVE',
    ...extra,
  }
}

const finding = (id: string, severity: DiagnosisFinding['severity']): DiagnosisFinding => ({
  id,
  severity,
  title: `${id} 제목`,
})

async function tmpCwd(): Promise<{ cwd: string; env: NodeJS.ProcessEnv }> {
  const cwd = await mkdtemp(join(tmpdir(), 'doctor-portal-'))
  return { cwd, env: { XDG_CONFIG_HOME: cwd } }
}

async function linked(opts: { login?: boolean } = {}) {
  const { cwd, env } = await tmpCwd()
  if (opts.login !== false) {
    await saveCredential({ portalUrl: PORTAL, token: 'bsc_t', savedAt: '' }, env)
  }
  await saveLink(cwd, {
    portalUrl: PORTAL,
    organizationId: 'org1',
    spaceId: 'sp1',
    repoId: 'r1',
    surface: 'USER',
  })
  return { cwd, env }
}

type Handler = (pathname: string) => Response | Promise<Response>

function fakeFetch(placements: Placement[], diagnosis: Handler) {
  const seen: string[] = []
  const f = (async (input: string | URL | Request) => {
    const url = new URL(String(input))
    seen.push(url.pathname + url.search)
    if (url.pathname === `${STAGE}/placements`) {
      return new Response(JSON.stringify({ placements }), { status: 200 })
    }
    if (url.pathname.endsWith('/diagnosis')) return diagnosis(url.pathname)
    return new Response(JSON.stringify({ error: url.pathname }), { status: 599 })
  }) as unknown as typeof fetch
  return { fetch: f, seen }
}

const ok = (findings: DiagnosisFinding[]) =>
  new Response(
    JSON.stringify({ placementId: 'x', surface: 'USER', kind: 'PAGE', checkedAt: '', findings }),
    { status: 200 },
  )

const idOf = (pathname: string) => decodeURIComponent(pathname.split('/').slice(-2)[0] ?? '')

describe('diagnosePortal — 건너뜀', () => {
  it('링크가 없으면 요청 없이 건너뛰고 bstage link 를 안내한다', async () => {
    const { cwd, env } = await tmpCwd()
    const { fetch, seen } = fakeFetch([], () => ok([]))
    const r = await diagnosePortal({}, { cwd, env, fetch })
    expect(r).toMatchObject({ status: 'skipped', hint: 'bstage link', placements: [] })
    expect(seen).toEqual([])
  })

  it('링크는 있는데 토큰이 없으면 건너뛰고 bstage login 을 안내한다', async () => {
    const { cwd, env } = await linked({ login: false })
    const { fetch, seen } = fakeFetch([], () => ok([]))
    const r = await diagnosePortal({}, { cwd, env, fetch })
    expect(r).toMatchObject({ status: 'skipped', hint: 'bstage login' })
    expect(seen).toEqual([])
  })

  it('--placement 를 줬는데 링크가 없으면 종료 코드 2로 실패한다', async () => {
    const { cwd, env } = await tmpCwd()
    const { fetch } = fakeFetch([], () => ok([]))
    const err = await diagnosePortal({ placement: '/a' }, { cwd, env, fetch }).catch((e) => e)
    expect(err).toBeInstanceOf(CliExit)
    expect((err as CliExit).code).toBe(ExitCode.PRECONDITION)
  })

  it('--placement 를 줬는데 토큰이 없으면 종료 코드 3으로 실패한다', async () => {
    const { cwd, env } = await linked({ login: false })
    const { fetch } = fakeFetch([], () => ok([]))
    const err = await diagnosePortal({ placement: '/a' }, { cwd, env, fetch }).catch((e) => e)
    expect(err).toBeInstanceOf(CliExit)
    expect((err as CliExit).code).toBe(ExitCode.AUTH)
  })
})

describe('diagnosePortal — 진단', () => {
  it('이 레포의 배치만 진단하고 findings를 그대로 싣는다', async () => {
    const { cwd, env } = await linked()
    const all = [
      placement('p1'),
      placement('p2', { kind: 'SLOT', path: undefined, slotId: 'user.home:after' }),
      placement('other', { stageRepoId: 'r9' }),
    ]
    const { fetch, seen } = fakeFetch(all, (p) =>
      idOf(p) === 'p1' ? ok([finding('appkey.expired', 'error')]) : ok([]),
    )
    const r = await diagnosePortal({}, { cwd, env, fetch })
    expect(seen).toContain(`${STAGE}/placements?surface=USER`)
    expect(seen.some((u) => u.includes('/other/'))).toBe(false)
    expect(r.status).toBe('ok')
    expect(r.placements).toEqual([
      {
        placementId: 'p1',
        path: '/p1',
        slotId: '',
        surface: 'USER',
        findings: [finding('appkey.expired', 'error')],
      },
      { placementId: 'p2', path: '', slotId: 'user.home:after', surface: 'USER', findings: [] },
    ])
  })

  it('--placement 는 id·path·slotId 정확 일치로 하나만 고른다', async () => {
    const { cwd, env } = await linked()
    const all = [placement('p1'), placement('p2')]
    const { fetch, seen } = fakeFetch(all, () => ok([]))
    const r = await diagnosePortal({ placement: '/p2' }, { cwd, env, fetch })
    expect(r.placements.map((p) => p.placementId)).toEqual(['p2'])
    expect(seen.filter((u) => u.endsWith('/diagnosis'))).toEqual([
      `${STAGE}/placements/p2/diagnosis`,
    ])
  })

  it('--placement 가 어느 배치와도 맞지 않으면 종료 코드 2로 실패한다', async () => {
    const { cwd, env } = await linked()
    const { fetch } = fakeFetch([placement('p1')], () => ok([]))
    const err = await diagnosePortal({ placement: 'nope' }, { cwd, env, fetch }).catch((e) => e)
    expect((err as CliExit).code).toBe(ExitCode.PRECONDITION)
  })

  it('배치가 0건이면 ok + 빈 목록이고 배치 만들기를 안내한다', async () => {
    const { cwd, env } = await linked()
    const { fetch } = fakeFetch([placement('other', { stageRepoId: 'r9' })], () => ok([]))
    const r = await diagnosePortal({}, { cwd, env, fetch })
    expect(r).toMatchObject({ status: 'ok', placements: [] })
    expect(r.hint).toContain('bstage placement create')
  })

  it(`배치는 ${MAX_DIAGNOSED_PLACEMENTS}개까지만, 동시에 ${DIAGNOSIS_CONCURRENCY}개까지만 진단한다`, async () => {
    const { cwd, env } = await linked()
    const all = Array.from({ length: MAX_DIAGNOSED_PLACEMENTS + 5 }, (_, i) => placement(`p${i}`))
    let inFlight = 0
    let peak = 0
    const { fetch, seen } = fakeFetch(all, async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 2))
      inFlight--
      return ok([])
    })
    const r = await diagnosePortal({}, { cwd, env, fetch })
    expect(seen.filter((u) => u.endsWith('/diagnosis'))).toHaveLength(MAX_DIAGNOSED_PLACEMENTS)
    expect(r.placements).toHaveLength(MAX_DIAGNOSED_PLACEMENTS)
    expect(r.omitted).toBe(5)
    expect(peak).toBeLessThanOrEqual(DIAGNOSIS_CONCURRENCY)
    expect(peak).toBeGreaterThan(1)
  })
})

describe('diagnosePortal — 서버 지원·실패', () => {
  it('진단 경로가 404면 구버전 서버로 보고 unsupported 로 건너뛴다', async () => {
    const { cwd, env } = await linked()
    const { fetch } = fakeFetch(
      [placement('p1'), placement('p2')],
      () => new Response('404 page not found', { status: 404 }),
    )
    const r = await diagnosePortal({}, { cwd, env, fetch })
    expect(r.status).toBe('unsupported')
    expect(r.placements).toEqual([])
  })

  it('배치가 사라진 404(서버의 JSON 문구)는 지원 안 함이 아니라 그 배치의 오류다', async () => {
    const { cwd, env } = await linked()
    const { fetch } = fakeFetch(
      [placement('p1')],
      () => new Response(JSON.stringify({ error: '배치를 찾을 수 없습니다' }), { status: 404 }),
    )
    const r = await diagnosePortal({}, { cwd, env, fetch })
    expect(r.status).toBe('error')
    expect(r.placements[0].error).toContain('배치를 찾을 수 없습니다')
  })

  it('CLI 토큰 등급 허용 목록 403도 unsupported 로 본다', async () => {
    const { cwd, env } = await linked()
    const { fetch } = fakeFetch(
      [placement('p1')],
      () =>
        new Response(JSON.stringify({ error: '토큰 등급으로 허용되지 않는 요청입니다' }), {
          status: 403,
        }),
    )
    expect((await diagnosePortal({}, { cwd, env, fetch })).status).toBe('unsupported')
  })

  it('권한 403은 unsupported 가 아니라 error 이고 서버 메시지를 남긴다', async () => {
    const { cwd, env } = await linked()
    const { fetch } = fakeFetch(
      [placement('p1')],
      () => new Response(JSON.stringify({ error: '권한이 없습니다' }), { status: 403 }),
    )
    const r = await diagnosePortal({}, { cwd, env, fetch })
    expect(r.status).toBe('error')
    expect(r.placements[0].error).toContain('권한이 없습니다')
    expect(r.placements[0].findings).toEqual([])
  })

  it('배치 하나가 실패해도 나머지 결과는 남기고, 메시지의 토큰 모양은 가린다', async () => {
    const { cwd, env } = await linked()
    const { fetch } = fakeFetch([placement('p1'), placement('p2')], (p) =>
      idOf(p) === 'p1'
        ? new Response(JSON.stringify({ error: 'boom bsc_0a1b2c3d' }), { status: 500 })
        : ok([finding('build.update_pending', 'warn')]),
    )
    const r = await diagnosePortal({}, { cwd, env, fetch })
    expect(r.status).toBe('error')
    const [p1, p2] = r.placements
    expect(p1.error).toContain('boom')
    expect(p1.error).not.toContain('0a1b2c3d')
    expect(p2.error).toBeUndefined()
    expect(p2.findings.map((f) => f.id)).toEqual(['build.update_pending'])
  })

  it('배치 목록 조회가 실패하면 error 와 이유를 남긴다', async () => {
    const { cwd, env } = await linked()
    const f = (async () =>
      new Response(JSON.stringify({ error: '만료된 토큰' }), {
        status: 401,
      })) as unknown as typeof fetch
    const r = await diagnosePortal({}, { cwd, env, fetch: f })
    expect(r.status).toBe('error')
    expect(r.reason).toContain('만료된 토큰')
  })
})

describe('portalHasErrorFinding', () => {
  const base: PortalReport = { status: 'ok', placements: [] }
  const row = (findings: DiagnosisFinding[]) => ({
    placementId: 'p',
    path: '/p',
    slotId: '',
    surface: 'USER' as const,
    findings,
  })

  it('error 심각도가 하나라도 있으면 true', () => {
    expect(
      portalHasErrorFinding({
        ...base,
        placements: [row([finding('a', 'warn')]), row([finding('b', 'error')])],
      }),
    ).toBe(true)
  })

  it('warn·info 뿐이거나 진단 자체가 실패·건너뜀이면 false', () => {
    expect(
      portalHasErrorFinding({
        ...base,
        placements: [row([finding('a', 'warn'), finding('b', 'info')])],
      }),
    ).toBe(false)
    expect(portalHasErrorFinding({ status: 'error', reason: 'x', placements: [] })).toBe(false)
    expect(portalHasErrorFinding(undefined)).toBe(false)
  })
})
