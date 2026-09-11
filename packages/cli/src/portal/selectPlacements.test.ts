import { describe, expect, it } from 'vitest'
import type { Placement } from './types.js'
import { applyPlan, requireTargets, selectPlacements } from './selectPlacements.js'

const ps: Placement[] = [
  {
    id: 'p1',
    surface: 'USER',
    kind: 'PAGE',
    path: '/landing',
    stageRepoId: 'r1',
    liveBuildId: 'b0',
    status: 'LIVE',
  },
  {
    id: 'p2',
    surface: 'USER',
    kind: 'SLOT',
    slotId: 'user.shop-home.section:before',
    stageRepoId: 'r1',
    status: 'READY_TO_DEPLOY',
  },
  { id: 'p3', surface: 'USER', kind: 'PAGE', path: '/x', stageRepoId: 'r2', status: 'LIVE' },
]

describe('selectPlacements', () => {
  it('레포 일치 전부', () =>
    expect(selectPlacements(ps, 'r1').map((p) => p.id)).toEqual(['p1', 'p2']))
  it('id·path·slotId로 하나 고르기', () => {
    expect(selectPlacements(ps, 'r1', 'p2').map((p) => p.id)).toEqual(['p2'])
    expect(selectPlacements(ps, 'r1', '/landing').map((p) => p.id)).toEqual(['p1'])
    expect(selectPlacements(ps, 'r1', 'user.shop-home.section:before').map((p) => p.id)).toEqual([
      'p2',
    ])
    expect(selectPlacements(ps, 'r1', '/x')).toEqual([])
  })
})

describe('applyPlan', () => {
  it('from/to와 변경 없음 여부', () => {
    const plan = applyPlan(selectPlacements(ps, 'r1'), 'b1')
    expect(plan[0]).toMatchObject({ from: 'b0', to: 'b1', unchanged: false })
    expect(plan[1]).toMatchObject({ from: undefined, to: 'b1', unchanged: false })
    expect(applyPlan([ps[0]], 'b0')[0].unchanged).toBe(true)
  })
})

describe('requireTargets', () => {
  it('필터에 맞는 이 레포 배치를 그대로 돌려준다', () => {
    expect(requireTargets(ps, 'r1').map((p) => p.id)).toEqual(['p1', 'p2'])
    expect(requireTargets(ps, 'r1', '/landing').map((p) => p.id)).toEqual(['p1'])
  })

  it('필터가 있는데 0개면 필터를 언급하는 PRECONDITION', () => {
    expect(() => requireTargets(ps, 'r1', '/nope')).toThrowError(/'\/nope'/)
    try {
      requireTargets(ps, 'r1', '/nope')
    } catch (err) {
      expect(err).toMatchObject({ code: 2 })
    }
  })

  it('필터 없이 0개면 배치를 먼저 만들라고 안내한다', () => {
    expect(() => requireTargets(ps, 'r9')).toThrowError(/연결된 배치가 없습니다/)
  })

  it('buildIdHint 가 있으면 빌드가 남아 있다고 알린다', () => {
    expect(() => requireTargets(ps, 'r9', undefined, 'b1')).toThrowError(/빌드 b1/)
  })
})
