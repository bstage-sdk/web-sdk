import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_PHASE, describePhase, resolvePhase } from './resolvePhase.js'

/**
 * phase는 "어느 환경에 붙는가"를 정하므로 잘못 골라도 에러가 아니라 **엉뚱한 서버에 붙는다.**
 * 릴리즈 전 손 검증은 대개 한 조합만 태우고 지나가므로 우선순위와 오타 처리를 여기서 고정한다.
 */
describe('resolvePhase', () => {
  const KEY = 'VITE_BSTAGE_PHASE'
  let cwd: string
  let prev: string | undefined

  beforeEach(() => {
    prev = process.env[KEY]
    delete process.env[KEY]
    cwd = mkdtempSync(join(tmpdir(), 'bstage-phase-'))
  })

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true })
    if (prev === undefined) delete process.env[KEY]
    else process.env[KEY] = prev
  })

  it('플래그가 있으면 .env보다 우선한다', () => {
    writeFileSync(join(cwd, '.env'), `${KEY}=real\n`)
    expect(resolvePhase('dev', cwd)).toEqual({ phase: 'dev', source: 'flag' })
  })

  it('플래그가 없으면 .env를 읽는다', () => {
    writeFileSync(join(cwd, '.env'), `${KEY}=qa\n`)
    expect(resolvePhase(undefined, cwd)).toEqual({ phase: 'qa', source: 'env' })
  })

  it('셸 환경변수가 .env보다 우선한다', () => {
    writeFileSync(join(cwd, '.env'), `${KEY}=qa\n`)
    process.env[KEY] = 'real'
    expect(resolvePhase(undefined, cwd)).toEqual({ phase: 'real', source: 'env' })
  })

  it('아무 데도 없으면 기본값', () => {
    expect(resolvePhase(undefined, cwd)).toEqual({ phase: DEFAULT_PHASE, source: 'default' })
  })

  it('기본값은 CF 게이트가 없는 phase여야 한다', () => {
    // 기본값이 사내 전용(dev·qa)이면 아무 설정 없이 시작한 사람이 게이트에 막힌다.
    expect(['sandbox', 'real']).toContain(DEFAULT_PHASE)
  })

  it('플래그 오타는 던진다 — 조용히 다른 환경에 붙으면 안 된다', () => {
    expect(() => resolvePhase('prod', cwd)).toThrow(/prod/)
  })

  it('.env 오타는 기본값으로 두되 무시한 값을 알린다', () => {
    writeFileSync(join(cwd, '.env'), `${KEY}=staging\n`)
    const result = resolvePhase(undefined, cwd)
    expect(result).toEqual({
      phase: DEFAULT_PHASE,
      source: 'default',
      ignoredEnvValue: 'staging',
    })
    expect(describePhase(result)).toContain('staging')
  })

  it('출처를 사람이 읽을 수 있게 알려준다', () => {
    expect(describePhase({ phase: 'dev', source: 'flag' })).toContain('--phase')
    expect(describePhase({ phase: 'dev', source: 'env' })).toContain(KEY)
    expect(describePhase({ phase: 'dev', source: 'default' })).toContain('기본값')
  })
})
