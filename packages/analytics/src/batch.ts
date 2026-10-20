import type { Event } from './types.js'

/** 배치 1건의 이벤트 개수 상한 */
export const BATCH_MAX = 20
/** 시간 임계(ms). 조용한 페이지에서도 이 간격으로 흘려보낸다 */
export const FLUSH_WAIT = 5000

/**
 * 메모리 배치 버퍼. 개수, 시간 threshold 에 도달하면 flush 로 전송 콜백에 전달
 * Batch 호출부에서 batch.flush() 를 통해 트리거하기도 한다 (pagehide, 가시성 변화 시)
 */
export class Batch {
  private buffer: Event[] = []
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly ship: (evts: Event[]) => void,
    private readonly size = BATCH_MAX,
    private readonly wait = FLUSH_WAIT,
  ) {}

  add(event: Event): void {
    this.buffer.push(event)
    if (this.buffer.length >= this.size) {
      this.flush()
      return
    }
    if (this.timer === null) this.timer = setTimeout(() => this.flush(), this.wait)
  }

  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.buffer.length === 0) return

    const evts = this.buffer
    this.buffer = []
    this.ship(evts)
  }

  /** 대기 중인 이벤트. 육안 검증용이다 */
  pending(): Event[] {
    return [...this.buffer]
  }
}
