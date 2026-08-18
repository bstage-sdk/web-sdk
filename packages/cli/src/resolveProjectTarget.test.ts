import { describe, expect, it, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveProjectTarget } from './constants.js'

/**
 * 릴리즈 전 손 검증은 유저 프로젝트 하나를 띄우는 데까지다 — `bstage.target`이 없는 상태의
 * 기본값 한 갈래만 지나간다. 명시 선언·깨진 package.json은 전부 비어 있는 분기다.
 *
 * 어긋나면 에이전트가 어드민 프로젝트에 `bstage-design/user`를 안내해 존재하지 않는 CSS 변수를
 * 쓰게 된다. 빌드도 타입도 막지 않으므로 조용히 틀린다.
 */

const dirs: string[] = []

function project(pkg: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'bstage-target-'))
  dirs.push(dir)
  if (pkg !== undefined) {
    writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg), 'utf-8')
  }
  return dir
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('resolveProjectTarget', () => {
  it('package.json의 bstage.target을 읽는다', () => {
    expect(resolveProjectTarget(project({ bstage: { target: 'admin' } }))).toBe('admin')
    expect(resolveProjectTarget(project({ bstage: { target: 'user' } }))).toBe('user')
  })

  it('선언이 없으면 user', () => {
    expect(resolveProjectTarget(project({ name: 'x' }))).toBe('user')
  })

  it('아는 값이 아니면 user — 오타를 admin으로 삼키지 않는다', () => {
    expect(resolveProjectTarget(project({ bstage: { target: 'Admin' } }))).toBe('user')
  })

  it('package.json이 없거나 깨져도 던지지 않는다', () => {
    expect(resolveProjectTarget(project(undefined))).toBe('user')
    const dir = mkdtempSync(join(tmpdir(), 'bstage-target-'))
    dirs.push(dir)
    writeFileSync(join(dir, 'package.json'), '{ broken', 'utf-8')
    expect(resolveProjectTarget(dir)).toBe('user')
  })
})
