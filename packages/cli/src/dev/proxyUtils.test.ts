import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { __resetCfAccessCache, addCfAccessHeaders, type ProxyHeaders } from './proxyUtils.js'

/**
 * CF Access 자격증명은 SDK에 심어두지 않고 소비자가 `.env`로 공급한다. 값이 없을 때의 분기는
 * 릴리즈 전 손 검증이 태우지 않는다 — 검증할 땐 값을 넣고 돌리기 때문이다. 그래서 여기서 고정한다.
 *
 * 값이 없으면 업스트림이 302(Cloudflare 로그인)로 응답하는데, 그 응답만 봐서는 원인을 알 수 없다.
 * 경고가 사라지면 소비자가 원인을 못 찾으므로 경고 자체를 검증 대상으로 둔다.
 */
describe('addCfAccessHeaders', () => {
  const CF_ID = 'VITE_CF_ACCESS_CLIENT_ID'
  const CF_SECRET = 'VITE_CF_ACCESS_CLIENT_SECRET'

  let cwd: string
  let prevCwd: string
  const prevEnv: Record<string, string | undefined> = {}

  beforeEach(() => {
    prevEnv[CF_ID] = process.env[CF_ID]
    prevEnv[CF_SECRET] = process.env[CF_SECRET]
    delete process.env[CF_ID]
    delete process.env[CF_SECRET]

    // loadEnv가 `.env`를 읽으므로 빈 임시 디렉토리로 옮겨 레포의 `.env` 영향을 차단한다.
    prevCwd = process.cwd()
    cwd = mkdtempSync(join(tmpdir(), 'bstage-cf-'))
    process.chdir(cwd)
    __resetCfAccessCache()
  })

  afterEach(() => {
    process.chdir(prevCwd)
    rmSync(cwd, { recursive: true, force: true })
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    __resetCfAccessCache()
    vi.restoreAllMocks()
  })

  it('real·sandbox는 게이트가 없어 헤더를 붙이지 않는다', () => {
    process.env[CF_ID] = 'id'
    process.env[CF_SECRET] = 'secret'
    for (const phase of ['real', 'sandbox']) {
      const headers: ProxyHeaders = {}
      addCfAccessHeaders(headers, phase)
      expect(headers).toEqual({})
    }
  })

  it('셸 환경변수에 값이 있으면 헤더를 붙인다', () => {
    process.env[CF_ID] = 'id-from-shell'
    process.env[CF_SECRET] = 'secret-from-shell'
    const headers: ProxyHeaders = {}
    addCfAccessHeaders(headers, 'dev')
    expect(headers['CF-Access-Client-Id']).toBe('id-from-shell')
    expect(headers['CF-Access-Client-Secret']).toBe('secret-from-shell')
  })

  it('셸에 없으면 .env 파일에서 읽는다', () => {
    writeFileSync(join(cwd, '.env'), `${CF_ID}=id-from-file\n${CF_SECRET}=secret-from-file\n`)
    const headers: ProxyHeaders = {}
    addCfAccessHeaders(headers, 'qa')
    expect(headers['CF-Access-Client-Id']).toBe('id-from-file')
    expect(headers['CF-Access-Client-Secret']).toBe('secret-from-file')
  })

  it('값이 없으면 헤더를 붙이지 않고 원인을 한 번만 경고한다', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const first: ProxyHeaders = {}
    addCfAccessHeaders(first, 'dev')
    const second: ProxyHeaders = {}
    addCfAccessHeaders(second, 'dev')

    expect(first).toEqual({})
    expect(second).toEqual({})
    // 프록시 요청마다 부르는 함수라, 경고가 매번 나가면 로그가 묻힌다.
    expect(warn).toHaveBeenCalledTimes(1)
    const message = warn.mock.calls[0]?.[0] as string
    expect(message).toContain(CF_ID)
    expect(message).toContain(CF_SECRET)
  })

  it('id만 있고 secret이 없으면 반쪽 헤더를 붙이지 않는다', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    process.env[CF_ID] = 'id-only'
    const headers: ProxyHeaders = {}
    addCfAccessHeaders(headers, 'dev')
    expect(headers).toEqual({})
  })
})
