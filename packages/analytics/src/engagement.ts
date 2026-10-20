/**
 * foreground 체류 시간 측정.
 * 백그라운드 측정 X
 * 세션 wall-clock인 `sessionDuration` 과는 다른 의미.
 */
export class Engagement {
  private total = 0
  private from: number | null = null

  constructor(private readonly now: () => number = Date.now) {}

  show(): void {
    if (this.from === null) this.from = this.now()
  }

  hide(): void {
    if (this.from === null) return
    this.total += this.now() - this.from
    this.from = null
  }

  elapsed(): number {
    return this.from === null ? this.total : this.total + (this.now() - this.from)
  }

  /** 라우트 전환 시점에 누적값을 전달하고 0으로 초기화 */
  take(): number {
    const elapsed = this.elapsed()
    this.total = 0
    this.from = this.from === null ? null : this.now()
    return elapsed
  }
}
