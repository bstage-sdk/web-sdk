import { describe, expect, it } from 'vitest'
import { createRateLimiter } from './rateLimiter.js'

describe('createRateLimiter', () => {
  it('분당 상한까지 허용하고 넘으면 거절, 창이 지나면 다시 허용', () => {
    const limiter = createRateLimiter(3)
    expect([limiter.take(0), limiter.take(10), limiter.take(20)]).toEqual([true, true, true])
    expect(limiter.take(30)).toBe(false)
    expect(limiter.take(59_999)).toBe(false)
    expect(limiter.take(60_000)).toBe(true)
  })

  it('거절된 요청은 창에 기록하지 않는다', () => {
    const limiter = createRateLimiter(1)
    expect(limiter.take(0)).toBe(true)
    expect(limiter.take(1)).toBe(false)
    expect(limiter.take(60_000)).toBe(true)
  })
})
