const DEFAULT_WINDOW_MS = 60_000

/** 슬라이딩 윈도 요청 상한. */
export interface RateLimiter {
  /** 이번 요청을 허용하면 true(그리고 기록), 상한이면 false. */
  take(now?: number): boolean
}

/** `windowMs`(기본 1분) 안에 `max`번까지 허용한다. */
export function createRateLimiter(max: number, windowMs = DEFAULT_WINDOW_MS): RateLimiter {
  let stamps: readonly number[] = []
  return {
    take(now = Date.now()) {
      const recent = stamps.filter((t) => now - t < windowMs)
      if (recent.length >= max) {
        stamps = recent
        return false
      }
      stamps = [...recent, now]
      return true
    },
  }
}
