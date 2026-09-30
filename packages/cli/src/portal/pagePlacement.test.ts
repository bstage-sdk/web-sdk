import { describe, expect, it } from 'vitest'
import {
  derivedPagePath,
  findPathOwner,
  normalizePagePath,
  pageArtifactNames,
  resolvePageArtifact,
} from './pagePlacement.js'
import type { Build, Placement } from './types.js'

describe('normalizePagePath', () => {
  it('후행 슬래시를 떼고 "/" 단독은 그대로 둔다', () => {
    expect(normalizePagePath('/todos/')).toBe('/todos')
    expect(normalizePagePath('/todos///')).toBe('/todos')
    expect(normalizePagePath('/a/b')).toBe('/a/b')
    expect(normalizePagePath('/')).toBe('/')
  })

  it.each([
    ['todos', '"/"로 시작'],
    ['/to dos', '공백'],
    ['/a\\b', '공백'],
    ['/items/:id', '동적 세그먼트'],
    ['/items/[id]', '동적 세그먼트'],
    ['//', '빈 세그먼트'],
    ['/a//b', '빈 세그먼트'],
    ['/a/../b', '".."'],
    ['/./a', '"."'],
  ])('%s → PRECONDITION(%s)', (raw, msg) => {
    try {
      normalizePagePath(raw)
      throw new Error('실패했어야 합니다')
    } catch (err) {
      expect((err as { code: number }).code).toBe(2)
      expect((err as Error).message).toContain(msg)
    }
  })
})

const build = (artifacts?: Build['artifacts']): Build => ({
  id: 'b1',
  spaceId: 's',
  surface: 'USER',
  commitSha: 'abc',
  status: 'SUCCEEDED',
  requestedAt: '2026-09-30T00:00:00Z',
  artifacts,
})

describe('pageArtifactNames', () => {
  it('위젯(슬롯) 산출물과 다른 surface의 liquid 항목은 빼고 사람이 쓰는 이름으로 낸다', () => {
    const b = build([
      { name: 'todos', kind: 'sdk' },
      { name: 'user.contents-home.curation--after', kind: 'sdk' },
      { name: 'user/hello', kind: 'liquid' },
      { name: 'admin/report', kind: 'liquid' },
    ])
    expect(pageArtifactNames(b, 'USER')).toEqual(['todos', 'hello'])
    expect(pageArtifactNames(b, 'ADMIN')).toEqual(['todos', 'report'])
  })
})

describe('resolvePageArtifact', () => {
  const b = build([
    { name: 'todos', kind: 'sdk' },
    { name: 'user.contents-home.curation--after', kind: 'sdk' },
    { name: 'user/hello', kind: 'liquid' },
  ])

  it('sdk 산출물은 이름 그대로', () => {
    expect(resolvePageArtifact(b, 'todos', 'USER')).toEqual({ name: 'todos', kind: 'sdk' })
  })

  it('liquid 산출물은 --template hello 로도, user/hello 로도 찾는다', () => {
    expect(resolvePageArtifact(b, 'hello', 'USER')).toEqual({ name: 'user/hello', kind: 'liquid' })
    expect(resolvePageArtifact(b, 'user/hello', 'USER')).toEqual({
      name: 'user/hello',
      kind: 'liquid',
    })
  })

  it('없는 이름·위젯 산출물·다른 surface liquid 항목은 undefined', () => {
    expect(resolvePageArtifact(b, 'nope', 'USER')).toBeUndefined()
    expect(resolvePageArtifact(b, 'user.contents-home.curation--after', 'USER')).toBeUndefined()
    expect(resolvePageArtifact(b, 'hello', 'ADMIN')).toBeUndefined()
  })
})

describe('derivedPagePath', () => {
  it('포털과 같은 규칙으로 기본 경로를 만든다', () => {
    expect(derivedPagePath({ name: 'todos', kind: 'sdk' })).toBe('/todos')
    expect(derivedPagePath({ name: 'shop/list', kind: 'sdk' })).toBe('/shop/list')
    expect(derivedPagePath({ name: 'user/hello', kind: 'liquid' })).toBe('/hello')
  })
})

describe('findPathOwner', () => {
  const ps: Placement[] = [
    { id: 'p1', surface: 'USER', kind: 'PAGE', path: '/todos', stageRepoId: 'r1', status: 'LIVE' },
    {
      id: 'p2',
      surface: 'USER',
      kind: 'SLOT',
      slotId: '/todos',
      stageRepoId: 'r1',
      status: 'LIVE',
    },
  ]
  it('같은 경로의 PAGE 배치만 찾는다', () => {
    expect(findPathOwner(ps, '/todos')?.id).toBe('p1')
    expect(findPathOwner(ps, '/other')).toBeUndefined()
  })
  it('후행 슬래시가 붙어 저장된 옛 배치도 같은 경로로 본다', () => {
    expect(findPathOwner([{ ...ps[0], path: '/todos/' }], '/todos')?.id).toBe('p1')
  })
})
