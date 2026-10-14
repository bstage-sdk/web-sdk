import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PORTAL_HOSTS } from '../../constants.js'
import { saveLink } from '../../portal/config.js'
import { saveCredential } from '../../portal/credentials.js'
import * as output from '../../portal/output.js'
import { doctorCommand } from '../doctor.js'
import type { DoctorReport } from './report.js'

/** doctor 명령의 배선 — `--json`의 portal 필드와 종료 코드 1의 조건. */

const PORTAL = `https://${PORTAL_HOSTS.sandbox}`

async function linkedCwd() {
  const cwd = await mkdtemp(join(tmpdir(), 'doctor-cmd-'))
  const env = { XDG_CONFIG_HOME: cwd }
  await saveCredential({ portalUrl: PORTAL, token: 'bsc_t', savedAt: '' }, env)
  await saveLink(cwd, {
    portalUrl: PORTAL,
    organizationId: 'org1',
    spaceId: 'sp1',
    repoId: 'r1',
    surface: 'USER',
  })
  return { cwd, env }
}

function fetchWith(severity: 'error' | 'warn') {
  return (async (input: string | URL | Request) => {
    const url = new URL(String(input))
    if (url.pathname.endsWith('/placements')) {
      return new Response(
        JSON.stringify({
          placements: [
            {
              id: 'p1',
              surface: 'USER',
              kind: 'PAGE',
              path: '/me',
              stageRepoId: 'r1',
              status: 'LIVE',
            },
          ],
        }),
        { status: 200 },
      )
    }
    return new Response(
      JSON.stringify({
        placementId: 'p1',
        surface: 'USER',
        kind: 'PAGE',
        checkedAt: '',
        findings: [{ id: 'placement.disabled', severity, title: '게시 꺼짐' }],
      }),
      { status: 200 },
    )
  }) as unknown as typeof fetch
}

describe('doctorCommand', () => {
  afterEach(() => {
    process.exitCode = undefined
    vi.restoreAllMocks()
  })

  it('--json은 printJson으로 portal 필드를 포함한 리포트 하나를 낸다', async () => {
    const { cwd, env } = await linkedCwd()
    const spy = vi.spyOn(output, 'printJson').mockImplementation(() => {})
    await doctorCommand({ json: true }, { cwd, env, fetch: fetchWith('warn') })
    expect(spy).toHaveBeenCalledTimes(1)
    const report = spy.mock.calls[0][0] as DoctorReport
    expect(report.portal?.status).toBe('ok')
    expect(report.portal?.placements[0].findings[0].id).toBe('placement.disabled')
    // 로컬 진단 필드는 그대로다(비파괴 추가)
    expect(report).toHaveProperty('versions')
    expect(process.exitCode).toBeUndefined()
  })

  it('포털 진단에 error 항목이 있으면 종료 코드 1을 남긴다', async () => {
    const { cwd, env } = await linkedCwd()
    vi.spyOn(output, 'printJson').mockImplementation(() => {})
    await doctorCommand({ json: true }, { cwd, env, fetch: fetchWith('error') })
    expect(process.exitCode).toBe(output.ExitCode.FAILURE)
  })

  it('링크가 없으면 portal은 skipped이고 종료 코드는 그대로다', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'doctor-cmd-'))
    const spy = vi.spyOn(output, 'printJson').mockImplementation(() => {})
    await doctorCommand({ json: true }, { cwd, env: { XDG_CONFIG_HOME: cwd } })
    expect((spy.mock.calls[0][0] as DoctorReport).portal?.status).toBe('skipped')
    expect(process.exitCode).toBeUndefined()
  })
})
