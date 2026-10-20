import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SECTION_ATTR } from './click.js'
import {
  IMPRESSION_OPT,
  ITEM_ATTR,
  ITEM_INDEX_ATTR,
  ITEM_NAME_ATTR,
  type ImpressionNode,
  ImpressionGate,
  readImpression,
  resolveOpt,
} from './impression.js'
import { ATTR_MAX, TEXT_MAX } from './limits.js'

/**
 * `Impressions`의 IntersectionObserver·MutationObserver·shadow walk 배선은 브라우저 육안
 * 검증으로 덮고, 여기서는 **params 이름·마스킹 순서·1회 규칙**을 못박는다. 앞의 둘은 계약이라
 * 하나만 어긋나도 컨슈머가 못 읽고, 1회 규칙은 상한 없는 이벤트 소스를 막는 유일한 장치다.
 */
function node(attrs: Record<string, string> = {}, section?: string): ImpressionNode {
  return {
    getAttribute: (name) => attrs[name] ?? null,
    closest: (selector) =>
      selector === `[${SECTION_ATTR}]` && section !== undefined
        ? { getAttribute: () => section }
        : null,
  }
}

describe('readImpression', () => {
  it('대상 표시가 없으면 null이다 — 관찰 대상이 아니다', () => {
    expect(readImpression(node())).toBeNull()
    expect(readImpression(node({ [ITEM_ATTR]: '   ' }))).toBeNull()
  })

  it('params 이름 4개를 그대로 쓴다', () => {
    const params = readImpression(
      node(
        { [ITEM_ATTR]: 'goods-12', [ITEM_NAME_ATTR]: '연간 구독권', [ITEM_INDEX_ATTR]: '3' },
        'artist-feed',
      ),
    )

    expect(params).toEqual({
      section: 'artist-feed',
      itemId: 'goods-12',
      itemName: '연간 구독권',
      itemIndex: 3,
    })
  })

  it('section은 click과 같은 속성에서 읽는다 — 이 키로 조인해 CTR이 나온다', () => {
    const params = readImpression(node({ [ITEM_ATTR]: 'goods-12' }, 'artist-feed'))

    expect(params?.section).toBe('artist-feed')
    // 조상에 섹션이 없으면 없는 채로 둔다. 대상만으로도 노출 수는 성립한다
    expect(readImpression(node({ [ITEM_ATTR]: 'goods-12' }))?.section).toBeUndefined()
  })

  it('itemId는 마스킹하지 않는다 — 조인 키라 값이 바뀌면 지표가 끊긴다', () => {
    const jwtish = 'eyJhbGciOiJIUzI1NiJ9.payload.signature'

    expect(readImpression(node({ [ITEM_ATTR]: jwtish }))?.itemId).toBe(jwtish)
  })

  it('itemId·section은 상한에서 자른다 — 고객사 마크업이 통제하는 값이다', () => {
    // 상한이 없으면 이벤트 1건의 크기가 마크업에 따라 무한해진다.
    const long = 'x'.repeat(ATTR_MAX + 50)
    const params = readImpression(node({ [ITEM_ATTR]: long }, long))

    expect(params?.itemId).toHaveLength(ATTR_MAX)
    expect(params?.section).toHaveLength(ATTR_MAX)
  })

  it('itemName은 마스킹이 먼저, 절삭이 나중이다', () => {
    // 먼저 자르면 JWT의 세 번째 세그먼트가 잘려 매칭이 실패하는데 비밀은 50자 안에 남는다.
    const name = `쿠폰 eyJhbGciOiJIUzI1NiJ9.${'a'.repeat(60)}.sig 받기`

    expect(readImpression(node({ [ITEM_ATTR]: 'x', [ITEM_NAME_ATTR]: name }))?.itemName).toBe(
      '쿠폰 *** 받기',
    )
  })

  it('itemName은 공백을 접고 상한에서 자른다', () => {
    const long = 'a'.repeat(TEXT_MAX + 20)

    expect(
      readImpression(node({ [ITEM_ATTR]: 'x', [ITEM_NAME_ATTR]: long }))?.itemName,
    ).toHaveLength(TEXT_MAX)
    expect(
      readImpression(node({ [ITEM_ATTR]: 'x', [ITEM_NAME_ATTR]: ' 연간\n  구독권 ' }))?.itemName,
    ).toBe('연간 구독권')
  })

  it('itemIndex는 0 이상 정수만 싣는다 — 그 밖은 없는 것으로 둔다', () => {
    const index = (raw: string) =>
      readImpression(node({ [ITEM_ATTR]: 'x', [ITEM_INDEX_ATTR]: raw }))?.itemIndex

    expect(index('0')).toBe(0)
    expect(index('-1')).toBeUndefined()
    expect(index('1.5')).toBeUndefined()
    expect(index('셋')).toBeUndefined()
    expect(index('')).toBeUndefined()
  })
})

describe('resolveOpt', () => {
  it('레거시와 같은 기본값을 쓴다 — 레거시 지표와 비교 가능해야 한다', () => {
    expect(resolveOpt()).toEqual({ threshold: 0.5, duration: 2000, rootMargin: '0px' })
    expect(resolveOpt({})).toEqual(IMPRESSION_OPT)
  })

  it('지정한 키만 덮어쓴다', () => {
    expect(resolveOpt({ duration: 500 })).toEqual({ ...IMPRESSION_OPT, duration: 500 })
  })

  it('쓸 수 없는 값은 기본값으로 되돌린다 — 이 값이 봉투로 그대로 나간다', () => {
    // 봉투의 `impressionOpt`가 실제 발화 기준과 어긋나면 적재 측이 지표를 잘못 읽는다.
    expect(resolveOpt({ threshold: 5, duration: -1, rootMargin: '  ' })).toEqual({
      threshold: 1,
      duration: 0,
      rootMargin: '0px',
    })
    expect(resolveOpt({ threshold: Number.NaN })).toEqual(IMPRESSION_OPT)
  })
})

describe('ImpressionGate', () => {
  let fired: string[]
  let gate: ImpressionGate<string>

  beforeEach(() => {
    vi.useFakeTimers()
    fired = []
    gate = new ImpressionGate(2000, (value) => fired.push(value))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('체류를 채워야 발화한다', () => {
    gate.enter('a', 'a')
    vi.advanceTimersByTime(1999)
    expect(fired).toEqual([])

    vi.advanceTimersByTime(1)
    expect(fired).toEqual(['a'])
  })

  it('체류를 채우기 전에 빠져나가면 발화하지 않는다', () => {
    gate.enter('a', 'a')
    vi.advanceTimersByTime(1000)
    gate.leave('a')
    vi.advanceTimersByTime(5000)

    expect(fired).toEqual([])
  })

  it('같은 대상이 다시 보여도 재발화하지 않는다 — 상한 없는 이벤트 소스를 막는다', () => {
    gate.enter('a', 'a')
    vi.advanceTimersByTime(2000)
    gate.leave('a')
    gate.enter('a', 'a')
    vi.advanceTimersByTime(5000)

    expect(fired).toEqual(['a'])
  })

  it('체류 중 재진입해도 타이머를 다시 시작하지 않는다', () => {
    gate.enter('a', 'a')
    vi.advanceTimersByTime(1500)
    gate.enter('a', 'a')
    vi.advanceTimersByTime(500)

    expect(fired).toEqual(['a'])
  })

  it('reset 후에는 다시 발화한다 — 라우트 전환 시 쓰인다', () => {
    gate.enter('a', 'a')
    vi.advanceTimersByTime(2000)
    gate.reset()
    gate.enter('a', 'a')
    vi.advanceTimersByTime(2000)

    expect(fired).toEqual(['a', 'a'])
  })

  it('reset은 대기 중인 체류도 취소한다 — 전환 전 화면의 노출이 뒤늦게 새지 않는다', () => {
    gate.enter('a', 'a')
    vi.advanceTimersByTime(1000)
    gate.reset()
    vi.advanceTimersByTime(5000)

    expect(fired).toEqual([])
  })

  it('duration이 0이면 즉시 발화한다', () => {
    const now = new ImpressionGate<string>(0, (value) => fired.push(value))
    now.enter('a', 'a')

    expect(fired).toEqual(['a'])
  })
})
