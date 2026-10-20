import { beforeEach, describe, expect, it } from 'vitest'
import { Engagement } from './engagement.js'

/**
 * `engagementTime`은 백그라운드 구간을 세지 않는 것이 정의 전부다. 틀린 값도 그럴듯해
 * 보이므로 시계를 고정해 구간 계산을 못박는다.
 */
describe('Engagement', () => {
  let at: number
  let engagement: Engagement

  beforeEach(() => {
    at = 0
    engagement = new Engagement(() => at)
  })

  it('foreground 구간만 누적한다', () => {
    engagement.show()
    at = 1000
    engagement.hide()
    at = 9000 // 백그라운드 8초 — 세지 않는다
    engagement.show()
    at = 9500

    expect(engagement.elapsed()).toBe(1500)
  })

  it('show를 여러 번 불러도 구간이 겹쳐 세지 않는다', () => {
    engagement.show()
    at = 500
    engagement.show()
    at = 1000

    expect(engagement.elapsed()).toBe(1000)
  })

  it('take는 누적값을 확정해 돌려주고 0부터 다시 센다', () => {
    engagement.show()
    at = 2000

    expect(engagement.take()).toBe(2000)

    at = 2300
    expect(engagement.elapsed()).toBe(300)
  })

  it('백그라운드에서 take하면 이후 시간이 세지지 않는다', () => {
    engagement.show()
    at = 1000
    engagement.hide()

    expect(engagement.take()).toBe(1000)

    at = 5000
    expect(engagement.elapsed()).toBe(0)
  })
})
