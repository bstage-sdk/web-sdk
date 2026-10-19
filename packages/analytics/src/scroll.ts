export const DEPTHS = [50, 90] as const

export class ScrollDepth {
  private fired = new Set<number>()

  constructor(private readonly emit: (depth: number) => void) {}

  check(ratio: number): void {
    for (const depth of DEPTHS) {
      if (ratio >= depth && !this.fired.has(depth)) {
        this.fired.add(depth)
        this.emit(depth)
      }
    }
  }

  reset(): void {
    this.fired.clear()
  }
}

export function readRatio(top: number, viewport: number, total: number): number {
  const scrollable = total - viewport
  if (scrollable <= 0) return 100
  return Math.min(100, ((top + viewport) / total) * 100)
}
