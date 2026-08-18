import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HOST_ENV_KEYS, resolveDevHosts } from './resolveHosts.js'
import { isPublicPhase } from '../constants.js'

/**
 * 사내 전용 phase의 호스트는 SDK에 없고 `.env`에서 온다. 잘못 해석하면 **엉뚱한 서버로
 * 인증 쿠키가 나가거나**, 반대로 아무 안내 없이 dev 서버가 안 뜬다. 릴리즈 전 손 검증은
 * 대개 sandbox 한 조합만 태우므로 나머지 분기를 여기서 고정한다.
 */
describe('resolveDevHosts', () => {
  const KEYS = [HOST_ENV_KEYS.gateway, HOST_ENV_KEYS.auth, HOST_ENV_KEYS.adminAuth]
  let cwd: string
  let prev: Record<string, string | undefined>

  beforeEach(() => {
    prev = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))
    for (const k of KEYS) delete process.env[k]
    cwd = mkdtempSync(join(tmpdir(), 'bstage-hosts-'))
  })

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true })
    for (const k of KEYS) {
      if (prev[k] === undefined) delete process.env[k]
      else process.env[k] = prev[k]
    }
  })

  it('공개 phase는 .env 없이도 호스트를 준다', () => {
    const hosts = resolveDevHosts('sandbox', 'user', cwd)
    expect(hosts.gateway('my-space')).toContain('my-space')
    expect(hosts.auth('my-space')).toContain('my-space')
  })

  it('공개 phase의 호스트는 코드에서 오므로 env를 무시한다', () => {
    process.env[HOST_ENV_KEYS.gateway] = 'attacker.example.com'
    expect(resolveDevHosts('real', 'user', cwd).gateway('my-space')).not.toContain('attacker')
  })

  it('사내 전용 phase는 셸 환경변수에서 읽는다', () => {
    process.env[HOST_ENV_KEYS.gateway] = 'gw.internal.example'
    process.env[HOST_ENV_KEYS.auth] = 'my-space.internal.example'
    const hosts = resolveDevHosts('dev', 'user', cwd)
    expect(hosts.gateway('my-space')).toBe('gw.internal.example')
    expect(hosts.auth('my-space')).toBe('my-space.internal.example')
  })

  /**
   * 이 테스트는 `.env`를 읽는다는 것과 **넘겨받은 cwd에서** 읽는다는 것을 함께 고정한다.
   * `process.cwd()`로 되돌리면(proxyUtils의 옛 방식) 레포 `.env`를 보게 되어 여기서 던진다.
   *
   * 셸 환경변수 우선은 여기서 검증하지 않는다 — vite `loadEnv`가 이미 `process.env`를
   * 우선해 병합하므로 코드의 읽는 순서를 뒤집어도 결과가 같아, 실패하지 않는 테스트가 된다.
   */
  it('넘겨받은 cwd의 .env에서 읽는다', () => {
    writeFileSync(
      join(cwd, '.env'),
      `${HOST_ENV_KEYS.gateway}=gw.internal.example\n${HOST_ENV_KEYS.auth}=my-space.internal.example\n`,
    )
    expect(resolveDevHosts('qa', 'user', cwd).gateway('my-space')).toBe('gw.internal.example')
  })

  it('어드민 모드는 어드민 인증 호스트를 쓴다', () => {
    process.env[HOST_ENV_KEYS.gateway] = 'gw.internal.example'
    process.env[HOST_ENV_KEYS.auth] = 'user.internal.example'
    process.env[HOST_ENV_KEYS.adminAuth] = 'account.internal.example'
    expect(resolveDevHosts('dev', 'admin', cwd).auth('my-space')).toBe('account.internal.example')
  })

  it('값이 없으면 던진다 — 어떤 키가 비었는지와 대안을 알려준다', () => {
    // 호스트가 없으면 요청 자체를 만들 수 없다. 400으로 넘기면 터미널에 아무것도 안 남는다.
    expect(() => resolveDevHosts('dev', 'user', cwd)).toThrow(HOST_ENV_KEYS.gateway)
    expect(() => resolveDevHosts('dev', 'user', cwd)).toThrow(/sandbox/)
  })

  it('반쪽만 설정하면 던진다 — 빠진 키만 짚어준다', () => {
    process.env[HOST_ENV_KEYS.gateway] = 'gw.internal.example'
    expect(() => resolveDevHosts('dev', 'user', cwd)).toThrow(HOST_ENV_KEYS.auth)
  })

  it('어드민 모드는 유저 인증 호스트가 없어도 통과한다', () => {
    // 쓰지 않는 호스트까지 요구하면 사내 개발자가 남의 값을 채우게 된다.
    process.env[HOST_ENV_KEYS.gateway] = 'gw.internal.example'
    process.env[HOST_ENV_KEYS.adminAuth] = 'account.internal.example'
    expect(() => resolveDevHosts('dev', 'admin', cwd)).not.toThrow()
  })

  it('공백만 있는 값은 없는 것으로 본다', () => {
    process.env[HOST_ENV_KEYS.gateway] = '   '
    process.env[HOST_ENV_KEYS.auth] = 'my-space.internal.example'
    expect(() => resolveDevHosts('dev', 'user', cwd)).toThrow(HOST_ENV_KEYS.gateway)
  })
})

describe('isPublicPhase', () => {
  it('사내 전용 phase의 호스트는 코드에 없다', () => {
    // 이 단언이 깨졌다면 내부 호스트가 다시 상수로 들어온 것이다.
    expect(isPublicPhase('dev')).toBe(false)
    expect(isPublicPhase('qa')).toBe(false)
  })

  it('공개 phase는 코드에 있다', () => {
    expect(isPublicPhase('real')).toBe(true)
    expect(isPublicPhase('sandbox')).toBe(true)
  })
})
