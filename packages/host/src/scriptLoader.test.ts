import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadScript } from './scriptLoader.js'

/**
 * 스크립트 로더의 crossOrigin 옵션. 기본 경로(속성 없음)는 손 검증이 태우지만, 옵션을 켠 분기와
 * 잘못된 값을 무시하는 분기는 여기서만 확인된다.
 */

type FakeScript = {
  src?: string
  async?: boolean
  crossOrigin?: string
  listeners: Map<string, () => void>
  addEventListener(type: string, fn: () => void): void
  removeEventListener(type: string): void
}

function stubDocument() {
  const appended: FakeScript[] = []
  vi.stubGlobal('document', {
    createElement: () => {
      const listeners = new Map<string, () => void>()
      return {
        listeners,
        addEventListener: (type: string, fn: () => void) => listeners.set(type, fn),
        removeEventListener: (type: string) => listeners.delete(type),
      }
    },
    head: {
      appendChild: (n: FakeScript) => {
        appended.push(n)
        queueMicrotask(() => n.listeners.get('load')?.())
      },
    },
  })
  return appended
}

let seq = 0
const nextUrl = () => `https://cdn.example.com/t${(seq += 1)}/template.js`

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('loadScript crossOrigin', () => {
  it('기본값 — crossOrigin 속성을 두지 않는다', async () => {
    const appended = stubDocument()
    await loadScript(nextUrl())
    expect(appended[0]).not.toHaveProperty('crossOrigin')
  })

  it("'anonymous'면 script.crossOrigin을 src보다 먼저 둔다", async () => {
    const appended = stubDocument()
    const url = nextUrl()
    await loadScript(url, 10_000, 'anonymous')
    expect(appended[0]).toMatchObject({ src: url, crossOrigin: 'anonymous' })
    expect(Object.keys(appended[0]).indexOf('crossOrigin')).toBeLessThan(
      Object.keys(appended[0]).indexOf('src'),
    )
  })

  it("'anonymous'가 아닌 값은 무시한다(use-credentials로 쿠키를 싣지 않는다)", async () => {
    const appended = stubDocument()
    await loadScript(nextUrl(), 10_000, 'use-credentials' as never)
    expect(appended[0]).not.toHaveProperty('crossOrigin')
  })
})
