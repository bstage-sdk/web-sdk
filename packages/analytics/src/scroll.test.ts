import { beforeEach, describe, expect, it } from 'vitest'
import { DEPTHS, ScrollDepth, readRatio } from './scroll.js'

/**
 * `scroll_depth`의 계약은 임계값별 1회다. 브라우저에서 흔들어 보는 것으로는 재발화 여부를
 * 확신할 수 없다.
 */
describe('ScrollDepth', () => {
  let fired: number[]
  let depth: ScrollDepth

  beforeEach(() => {
    fired = []
    depth = new ScrollDepth((d) => fired.push(d))
  })

  it('임계값을 넘길 때 한 번씩만 발화한다', () => {
    depth.check(30)
    expect(fired).toEqual([])

    depth.check(60)
    expect(fired).toEqual([50])

    depth.check(95)
    expect(fired).toEqual([50, 90])
  })

  it('위아래로 반복 스크롤해도 재발화하지 않는다', () => {
    depth.check(95)
    depth.check(10)
    depth.check(95)

    expect(fired).toEqual([50, 90])
  })

  it('한 번에 최하단까지 가면 임계값 전부를 오름차순으로 발화한다', () => {
    depth.check(100)

    expect(fired).toEqual([...DEPTHS])
  })

  it('reset 후에는 다시 발화할 수 있다 — 라우트 전환 시 쓰인다', () => {
    depth.check(100)
    depth.reset()
    depth.check(60)

    expect(fired).toEqual([50, 90, 50])
  })
})

describe('readRatio', () => {
  it('화면 하단이 문서의 몇 %에 닿았는지 센다', () => {
    expect(readRatio(0, 1000, 2000)).toBe(50)
    expect(readRatio(1000, 1000, 2000)).toBe(100)
  })

  it('문서가 뷰포트보다 짧으면 전체를 본 것이므로 100이다', () => {
    expect(readRatio(0, 1000, 800)).toBe(100)
  })

  it('100을 넘지 않는다 — 바운스 스크롤에서 top이 과도해질 수 있다', () => {
    expect(readRatio(1200, 1000, 2000)).toBe(100)
  })
})
