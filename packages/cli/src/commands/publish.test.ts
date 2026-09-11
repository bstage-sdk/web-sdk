import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { PORTAL_HOSTS } from '../constants.js'
import { saveLink } from '../portal/config.js'
import { saveCredential } from '../portal/credentials.js'
import type { Placement } from '../portal/types.js'
import { parseOnOff, publishCommand } from './publish.js'

/** 링크 파일의 포털 주소는 허용 목록(PORTAL_HOSTS) 안이어야 한다. */
const PORTAL = `https://${PORTAL_HOSTS.sandbox}`

describe('parseOnOff', () => {
  it('on/off', () => {
    expect(parseOnOff('on')).toBe(true)
    expect(parseOnOff('OFF')).toBe(false)
  })
  it('그 외는 PRECONDITION', () => expect(() => parseOnOff('maybe')).toThrow(/on 또는 off/))
})

const defaultPlacements: Placement[] = [
  { id: 'p1', surface: 'USER', kind: 'PAGE', path: '/a', stageRepoId: 'r1', status: 'LIVE' },
  { id: 'p2', surface: 'USER', kind: 'PAGE', path: '/b', stageRepoId: 'r1', status: 'LIVE' },
]

interface PortalOptions {
  placements?: Placement[]
  patchStatus?: number
  patchOutcomes?: Record<string, number>
}

function portal(opts: PortalOptions = {}) {
  const placements = opts.placements ?? defaultPlacements
  const patches: { path: string; body: unknown }[] = []
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname
    const method = init?.method ?? 'GET'
    const j = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
    if (path.endsWith('/placements')) return j({ placements })
    if (method === 'PATCH') {
      const placementId = path.split('/').pop() as string
      const body = JSON.parse(String(init?.body))
      patches.push({ path, body })
      const status = opts.patchOutcomes?.[placementId] ?? opts.patchStatus ?? 200
      if (status >= 400) return j({ error: 'conflict' }, status)
      return j({ placement: { id: placementId, enabled: body.enabled } }, status)
    }
    return j({ error: path }, 404)
  }) as unknown as typeof globalThis.fetch
  return { fetch, patches }
}

async function setup() {
  const cwd = await mkdtemp(join(tmpdir(), 'pub-'))
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
    throw new Error('publishCommand가 실패했어야 합니다')
  } catch (err) {
    return err as { code: number; message: string }
  }
}

describe('publish', () => {
  it('선택한 배치에 PATCH {enabled}', async () => {
    const { fetch, patches } = portal()
    const s = await setup()
    await publishCommand('off', { placement: '/b', yes: true }, { ...s, fetch })
    expect(patches).toEqual([
      { path: '/api/v1/organizations/o/stages/s/placements/p2', body: { enabled: false } },
    ])
  })

  it('--placement 없으면 이 레포의 배치 전부에 적용', async () => {
    const { fetch, patches } = portal()
    const s = await setup()
    await publishCommand('off', { yes: true }, { ...s, fetch })
    expect(patches.map((p) => p.path)).toEqual([
      '/api/v1/organizations/o/stages/s/placements/p1',
      '/api/v1/organizations/o/stages/s/placements/p2',
    ])
  })

  it('다른 레포의 배치는 대상에서 제외', async () => {
    const { fetch, patches } = portal({
      placements: [...defaultPlacements, { ...defaultPlacements[0], id: 'p9', stageRepoId: 'r9' }],
    })
    const s = await setup()
    await publishCommand('off', { yes: true }, { ...s, fetch })
    expect(patches.map((p) => p.body)).toEqual([{ enabled: false }, { enabled: false }])
    expect(patches.length).toBe(2)
  })

  it('대상 배치가 없으면 PRECONDITION', async () => {
    const { fetch, patches } = portal({ placements: [] })
    const s = await setup()
    const err = await expectCliExit(publishCommand('on', { yes: true }, { ...s, fetch }))
    expect(err.code).toBe(2)
    expect(patches).toEqual([])
  })

  it('이미 목표 상태인 배치는 패치하지 않고 변경 없음으로 보고', async () => {
    const { fetch, patches } = portal({
      placements: [{ ...defaultPlacements[0], enabled: false }],
    })
    const lines: string[] = []
    const s = await setup()
    await publishCommand('off', { yes: true }, { ...s, fetch, out: (l) => lines.push(l) })
    expect(patches).toEqual([])
    expect(lines.join('\n')).toContain('변경 없음')
  })

  it('enabled 미지정은 게시 중(on)으로 취급 — off 요청 시 패치된다', async () => {
    const { fetch, patches } = portal({ placements: [defaultPlacements[0]] })
    const s = await setup()
    await publishCommand('off', { yes: true }, { ...s, fetch })
    expect(patches).toEqual([
      { path: '/api/v1/organizations/o/stages/s/placements/p1', body: { enabled: false } },
    ])
  })

  it('여러 배치 대상이고 --yes 없으면 확인 후 진행', async () => {
    const { fetch, patches } = portal()
    const s = await setup()
    let asked = ''
    await publishCommand('off', {}, { ...s, fetch, confirm: async (m) => ((asked = m), true) })
    expect(patches.length).toBe(2)
    expect(asked).toMatch(/끕니다/)
  })

  it('확인을 거절하면 적용하지 않는다', async () => {
    const { fetch, patches } = portal()
    const s = await setup()
    const err = await expectCliExit(
      publishCommand('off', {}, { ...s, fetch, confirm: async () => false }),
    )
    expect(err.code).toBe(2)
    expect(patches).toEqual([])
  })

  it('--placement 로 하나만 특정해도 --yes 없으면 확인을 묻는다', async () => {
    const { fetch, patches } = portal()
    const s = await setup()
    let confirmCalled = false
    await publishCommand(
      'off',
      { placement: '/b' },
      { ...s, fetch, confirm: async () => ((confirmCalled = true), true) },
    )
    expect(confirmCalled).toBe(true)
    expect(patches.length).toBe(1)
  })

  it('--placement 하나여도 확인을 거절하면 적용하지 않는다', async () => {
    const { fetch, patches } = portal()
    const s = await setup()
    const err = await expectCliExit(
      publishCommand('off', { placement: '/b' }, { ...s, fetch, confirm: async () => false }),
    )
    expect(err.code).toBe(2)
    expect(patches).toEqual([])
  })

  it('TTY가 아니고 --yes도 없으면 즉시 PRECONDITION', async () => {
    const { fetch, patches } = portal()
    const s = await setup()
    const err = await expectCliExit(publishCommand('off', {}, { ...s, fetch, isTTY: () => false }))
    expect(err.code).toBe(2)
    expect(patches).toEqual([])
  })

  it('--json 은 --yes 없이 쓸 수 없다', async () => {
    const err = await expectCliExit(publishCommand('off', { json: true }))
    expect(err.code).toBe(2)
  })

  it('409 충돌은 그 배치만 conflict로 남기고 나머지는 진행, 종료코드 4', async () => {
    const { fetch, patches } = portal({ patchOutcomes: { p1: 409 } })
    const s = await setup()
    const err = await expectCliExit(publishCommand('off', { yes: true }, { ...s, fetch }))
    expect(err.code).toBe(4)
    expect(patches.length).toBe(2)
  })

  it('그 외 실패는 종료코드 1', async () => {
    const { fetch } = portal({ patchOutcomes: { p1: 500 } })
    const s = await setup()
    const err = await expectCliExit(publishCommand('off', { yes: true }, { ...s, fetch }))
    expect(err.code).toBe(1)
  })

  it('--json 은 changed·unchanged·conflicts·failed 만 담은 요약 하나만 출력', async () => {
    const { fetch } = portal({
      placements: [defaultPlacements[0], { ...defaultPlacements[1], enabled: false }],
    })
    const s = await setup()
    const lines: string[] = []
    const writes: string[] = []
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      writes.push(String(chunk))
      return true
    })
    try {
      await publishCommand(
        'off',
        { yes: true, json: true },
        { ...s, fetch, out: (l) => lines.push(l) },
      )
    } finally {
      spy.mockRestore()
    }
    // 사람이 읽는 out()에는 아무 것도 쓰지 않는다 — JSON은 stdout(printJson)로만 나간다.
    expect(lines).toEqual([])
    expect(writes).toHaveLength(1)
    const payload = JSON.parse(writes[0]) as Record<string, { id: string }[]>
    expect(Object.keys(payload).sort()).toEqual(['changed', 'conflicts', 'failed', 'unchanged'])
    expect(payload.changed.map((r) => r.id)).toEqual(['p1'])
    expect(payload.unchanged.map((r) => r.id)).toEqual(['p2'])
    expect(payload.conflicts).toEqual([])
    expect(payload.failed).toEqual([])
  })

  it('off일 때 라이브 포인터 유지 안내를 보여준다', async () => {
    const { fetch } = portal()
    const s = await setup()
    const lines: string[] = []
    await publishCommand('off', { yes: true }, { ...s, fetch, out: (l) => lines.push(l) })
    expect(lines.join('\n')).toContain('라이브')
  })
})
