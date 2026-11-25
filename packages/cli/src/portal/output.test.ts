import { describe, expect, it } from 'vitest'
import { PortalError } from './client.js'
import {
  CliExit,
  ExitCode,
  buildSourceLabel,
  buildSourceRef,
  cleanText,
  exitCodeFor,
  scrub,
  shortSha,
  table,
} from './output.js'

describe('exitCodeFor', () => {
  it('PortalError 상태를 규약대로 매핑한다', () => {
    expect(exitCodeFor(new PortalError(401, 'x'))).toBe(ExitCode.AUTH)
    expect(exitCodeFor(new PortalError(403, 'x'))).toBe(ExitCode.AUTH)
    expect(exitCodeFor(new PortalError(409, 'x'))).toBe(ExitCode.CONFLICT)
    expect(exitCodeFor(new PortalError(429, 'x'))).toBe(ExitCode.RATE_LIMIT)
    expect(exitCodeFor(new PortalError(500, 'x'))).toBe(ExitCode.FAILURE)
  })
  it('CliExit은 자기 코드, 그 외는 1', () => {
    expect(exitCodeFor(new CliExit(ExitCode.PRECONDITION, 'x'))).toBe(2)
    expect(exitCodeFor(new Error('boom'))).toBe(1)
  })
})

describe('table', () => {
  it('열 폭을 맞춘다', () => {
    expect(
      table([
        ['a', 'bbb'],
        ['cc', 'd'],
      ]),
    ).toBe('a   bbb\ncc  d')
  })
})

describe('shortSha', () => {
  it('7자, 없으면 대시', () => {
    expect(shortSha('0123456789abcdef')).toBe('0123456')
    expect(shortSha(undefined)).toBe('-')
  })
})

describe('buildSourceRef · buildSourceLabel', () => {
  it('내장 저장소 빌드는 v{번호}, GitHub 빌드는 커밋 SHA 7자', () => {
    const builtin = { commitSha: 'f'.repeat(32), sourceVersionNo: 12 }
    const gh = { commitSha: '0123456789abcdef' }
    expect(buildSourceRef(builtin)).toBe('v12')
    expect(buildSourceLabel(builtin)).toBe('버전 v12')
    expect(buildSourceRef(gh)).toBe('0123456')
    expect(buildSourceLabel(gh)).toBe('커밋 0123456')
    expect(buildSourceRef({ commitSha: '' })).toBe('-')
  })

  // AWS Security Agent 7차 L — 숫자로 바뀌는 문자열(`"\r12"`)·소수·음수는 번호로 찍지 않는다.
  it('버전 번호는 양의 정수만, 아니면 커밋 SHA·대시로 돌아간다', () => {
    const bad = [' 12', '\r12', '12\n', 1.5, -3, 0, Number.NaN, 2 ** 60] as unknown as number[]
    for (const n of bad) {
      expect(buildSourceRef({ commitSha: '0123456789', sourceVersionNo: n })).toBe('0123456')
      expect(buildSourceLabel({ sourceVersionNo: n })).toBe('커밋 -')
    }
  })
  it('커밋 SHA 의 제어 문자도 지운다', () => {
    expect(buildSourceRef({ commitSha: '\r\x1b[2Jabcdef12345' })).toBe('abcdef1')
    expect(shortSha('\r\n')).toBe('-')
  })
})

describe('table 칸 정리(AWS Security Agent 7차 L)', () => {
  it('서버 값의 CR·이스케이프를 지워 앞줄을 덮거나 열을 어긋나게 하지 못한다', () => {
    const t = table([
      ['자리', '현재'],
      ['/a\r/evil', '\x1b[2Jv12'],
    ])
    // eslint-disable-next-line no-control-regex
    expect(t).not.toMatch(/[\r\x1b]/)
    expect(t).toBe('자리       현재\n/a/evil  v12')
  })
  it('clean:false 면 그대로(색을 입힌 로컬 표)', () => {
    expect(table([['a', '\x1b[2mb\x1b[22m']], { clean: false })).toBe('a  \x1b[2mb\x1b[22m')
  })
})

// AWS Security Agent 2차 L1 — 서버 값을 터미널에 찍기 전에 시퀀스째 지운다.
describe('cleanText · scrub', () => {
  // eslint-disable-next-line no-control-regex
  const CONTROL = /[\x00-\x1f\x7f-\x9f]/
  it('CSI·OSC(BEL/ST)·C1 CSI·DCS 시퀀스를 찌꺼기 없이 지우고 남은 제어 문자도 지운다', () => {
    const evil =
      'a\x1b[2J\x1b[1;31mb\x1b]8;;https://evil\x07c\x1b]0;title\x1b\\d\u009b2Ke\x1bPq#0\x1b\\f\r\x00g\u202eh'
    expect(cleanText(evil)).toBe('abcdefgh')
    expect(cleanText(evil)).not.toMatch(CONTROL)
  })
  it('긴 값은 자르고 표시한다(대리 쌍을 쪼개지 않는다)', () => {
    expect(cleanText('z'.repeat(500))).toBe(`${'z'.repeat(200)}…`)
    expect(cleanText('😀'.repeat(5), 3)).toBe('😀😀😀…')
    expect(cleanText(undefined)).toBe('')
  })
  it('scrub 은 줄바꿈은 남기고 시퀀스·제어 문자를 지운 뒤 토큰을 가린다', () => {
    const out = scrub(`실패:\n  - a\x1b[2Kb\r\n  - bsc_${'0'.repeat(64)}\x07`)
    expect(out).toBe('실패:\n  - ab\n  - bsc_****')
  })
})
