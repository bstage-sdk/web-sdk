import { describe, expect, it } from 'vitest'
import { liquidDataJson } from './dataJson.js'

/**
 * 이 샘플은 **로컬 프리뷰에서만** 쓰이지만, 키 이름이 플랫폼 계약과 어긋나면 "로컬에서는 보이는데
 * 배포하면 비는" 템플릿이 만들어진다. 그 차이는 화면에 오류로 드러나지 않아 찾기 어렵다 —
 * 릴리즈 전 손 검증(init 1회 + 프리뷰 확인)도 이 어긋남을 통과시킨다. 그래서 여기서 고정한다.
 */
const CONTRACT_KEYS = [
  'lounges',
  'stories',
  'contentSections',
  'latestContents',
  'shopCategories',
] as const

describe('liquid 스캐폴드 data.json', () => {
  it('플랫폼이 유저 화면에 넣는 다섯 키를 그대로 쓴다', () => {
    const parsed = JSON.parse(liquidDataJson({ name: 'welcome', target: 'user' })) as Record<
      string,
      unknown
    >
    expect(Object.keys(parsed).sort()).toEqual([...CONTRACT_KEYS].sort())
  })

  it('계약 밖 이름을 담지 않는다', () => {
    const parsed = JSON.parse(liquidDataJson({ name: 'welcome', target: 'user' })) as Record<
      string,
      unknown
    >
    for (const stale of ['title', 'heading', 'description']) {
      expect(parsed).not.toHaveProperty(stale)
    }
  })

  it('각 값은 배열이라 빈 목록 분기를 그대로 시험해 볼 수 있다', () => {
    const parsed = JSON.parse(liquidDataJson({ name: 'welcome', target: 'user' })) as Record<
      string,
      unknown
    >
    for (const key of CONTRACT_KEYS) {
      expect(Array.isArray(parsed[key])).toBe(true)
    }
  })

  /**
   * 어드민이 받는 값은 확인되지 않았다. 유저 계약을 그대로 넣으면 **확인되지 않은 모양을
   * 사실처럼 가르치는** 샘플이 된다 — 빈 객체로 두고 템플릿 주석이 확인을 안내한다.
   */
  it('어드민 대상은 빈 객체다 — 확인되지 않은 계약을 샘플로 가르치지 않는다', () => {
    const parsed = JSON.parse(liquidDataJson({ name: 'notice', target: 'admin' })) as Record<
      string,
      unknown
    >
    expect(Object.keys(parsed)).toEqual([])
  })

  it('유효한 JSON이고 줄바꿈으로 끝난다', () => {
    const raw = liquidDataJson({ name: 'a-b-1', target: 'user' })
    expect(() => JSON.parse(raw)).not.toThrow()
    expect(raw.endsWith('\n')).toBe(true)
  })
})
