import { describe, expect, it } from 'vitest'
import { PortalError } from './client.js'
import { CliExit, ExitCode, exitCodeFor, shortSha, table } from './output.js'

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
