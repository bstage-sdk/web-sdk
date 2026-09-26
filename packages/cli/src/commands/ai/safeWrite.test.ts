import {
  chmodSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { chmodNoFollow, writeFileNoFollow } from './safeWrite.js'

/**
 * 경로 검사와 실제 쓰기 사이에 대상이 링크로 바뀌면(같은 사용자 프로세스 경쟁) 검사만으로는 막지 못한다.
 * 쓰기 자체가 링크를 따라가지 않아야 한다.
 */

const dirs: string[] = []

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'bstage-safewrite-'))
  dirs.push(d)
  return d
}

describe('writeFileNoFollow', () => {
  it('일반 파일은 쓴다(없으면 만들고, 있으면 덮는다)', () => {
    const d = tmp()
    writeFileNoFollow(join(d, 'a.txt'), '첫 내용\n')
    writeFileNoFollow(join(d, 'a.txt'), '둘째 내용\n')

    expect(readFileSync(join(d, 'a.txt'), 'utf-8')).toBe('둘째 내용\n')
  })

  it('이미 있던 파일의 느슨한 권한을 바로잡는다 — 남이 가드 본문을 갈아끼울 수 있다', () => {
    const d = tmp()
    const f = join(d, 'guard.mjs')
    writeFileSync(f, '옛 내용\n', 'utf-8')
    chmodSync(f, 0o666)

    writeFileNoFollow(f, '새 내용\n')

    expect(statSync(f).mode & 0o777).toBe(0o644)
  })

  it('내용이 짧아져도 남은 꼬리가 없다', () => {
    const d = tmp()
    writeFileNoFollow(join(d, 'a.txt'), '아주 긴 첫 내용입니다\n')
    writeFileNoFollow(join(d, 'a.txt'), '짧다\n')

    expect(readFileSync(join(d, 'a.txt'), 'utf-8')).toBe('짧다\n')
  })

  it('하드 링크가 걸린 파일은 건드리지 않는다 — 링크된 원본까지 함께 바뀐다', () => {
    const d = tmp()
    writeFileSync(join(d, 'secret'), '비밀\n', 'utf-8')
    linkSync(join(d, 'secret'), join(d, 'hook'))

    expect(() => writeFileNoFollow(join(d, 'hook'), '침입\n')).toThrow(/하드 링크/)
    expect(readFileSync(join(d, 'secret'), 'utf-8')).toBe('비밀\n')
  })

  it('대상이 심볼릭 링크면 따라 쓰지 않고 던진다', () => {
    const d = tmp()
    writeFileSync(join(d, 'real.txt'), '원본\n', 'utf-8')
    symlinkSync(join(d, 'real.txt'), join(d, 'link.txt'))

    expect(() => writeFileNoFollow(join(d, 'link.txt'), '침입\n')).toThrow()
    expect(readFileSync(join(d, 'real.txt'), 'utf-8')).toBe('원본\n')
  })
})

describe('chmodNoFollow', () => {
  it('내용을 건드리지 않고 권한만 바꾼다', () => {
    const d = tmp()
    const f = join(d, 'hook')
    writeFileSync(f, '사용자 훅\n', 'utf-8')
    chmodSync(f, 0o600)

    chmodNoFollow(f, 0o755)

    expect(readFileSync(f, 'utf-8')).toBe('사용자 훅\n')
    expect(statSync(f).mode & 0o777).toBe(0o755)
  })

  it('심볼릭 링크는 따라가지 않는다', () => {
    const d = tmp()
    writeFileSync(join(d, 'real'), 'x\n', 'utf-8')
    chmodSync(join(d, 'real'), 0o600)
    symlinkSync(join(d, 'real'), join(d, 'link'))

    expect(() => chmodNoFollow(join(d, 'link'), 0o777)).toThrow()
    expect(statSync(join(d, 'real')).mode & 0o777).toBe(0o600)
  })
})

describe('chmodNoFollow — 일반 파일만', () => {
  it('하드 링크가 걸린 파일의 권한은 바꾸지 않는다', () => {
    const d = tmp()
    writeFileSync(join(d, 'secret'), '비밀\n', 'utf-8')
    chmodSync(join(d, 'secret'), 0o600)
    linkSync(join(d, 'secret'), join(d, 'hook'))

    expect(() => chmodNoFollow(join(d, 'hook'), 0o755)).toThrow(/하드 링크/)
    expect(statSync(join(d, 'secret')).mode & 0o777).toBe(0o600)
  })

  it('디렉터리는 거부한다', () => {
    const d = tmp()
    mkdirSync(join(d, 'sub'))

    expect(() => chmodNoFollow(join(d, 'sub'), 0o755)).toThrow(/일반 파일/)
  })
})
