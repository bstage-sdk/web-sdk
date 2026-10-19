import { describe, expect, it, vi } from 'vitest'
import {
  PARAM_LIMIT,
  RESERVED,
  checkName,
  checkParams,
  clip,
  isReserved,
  sizeOf,
} from './limits.js'

/**
 * 자유 스키마라 SDK는 값을 바꾸지 않는다 — 이 검사들의 계약은 위반을 알려주되 원본을
 * 건드리지 않는 것이다.
 */
describe('checkName', () => {
  it('snake_case 소문자만 통과한다', () => {
    expect(checkName('purchase_complete')).toBe(true)
    expect(checkName('page_view2')).toBe(true)
  })

  it('대문자·하이픈·숫자 시작은 거부한다', () => {
    expect(checkName('purchaseComplete')).toBe(false)
    expect(checkName('purchase-complete')).toBe(false)
    expect(checkName('2nd_click')).toBe(false)
    expect(checkName('')).toBe(false)
  })

  it('길이 상한을 넘기면 거부한다', () => {
    expect(checkName('a'.repeat(41))).toBe(false)
  })
})

describe('checkParams', () => {
  it('제한을 지키면 위반이 없다', () => {
    expect(checkParams({ label: '연간 구독권', amount: 49000 })).toEqual([])
  })

  it('키 개수 초과를 알린다', () => {
    const params = Object.fromEntries(
      Array.from({ length: PARAM_LIMIT.keys + 1 }, (_, i) => [`k${i}`, i]),
    )

    expect(checkParams(params)).toHaveLength(1)
  })

  it('키 길이와 값 길이 초과를 각각 알린다', () => {
    const issues = checkParams({
      ['k'.repeat(PARAM_LIMIT.keyLength + 1)]: 'ok',
      long: 'v'.repeat(PARAM_LIMIT.valueLength + 1),
    })

    expect(issues).toHaveLength(2)
  })

  it('문자열이 아닌 값의 길이는 보지 않는다 — 중첩 객체를 깨뜨리지 않기 위해', () => {
    expect(checkParams({ position: { x: 1, y: 2 } })).toEqual([])
  })
})

describe('sizeOf', () => {
  it('UTF-8 바이트 길이를 센다 — 한글은 1자 3바이트다', () => {
    expect(sizeOf({ a: '가' })).toBe(JSON.stringify({ a: '가' }).length + 2)
  })

  it('직렬화할 수 없으면 null이다', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic

    expect(sizeOf(cyclic)).toBeNull()
  })
})

describe('예약 이름 — 보안 리뷰 대응', () => {
  it('예약 이름은 이름 규칙 자체는 만족한다 — 거부는 record()가 한다', () => {
    // 권위 있는 예약 거부는 단일 관문 `record()`에 있고 여기서는 이름 모양만 본다
    for (const name of RESERVED) {
      expect(checkName(name)).toBe(true)
      expect(isReserved(name)).toBe(true)
    }
  })

  it('예약 목록이 계약과 일치한다 — 발화부가 사라진 `runtime_error`도 예약으로 남는다', () => {
    expect([...RESERVED].sort()).toEqual([
      'click',
      'impression',
      'page_view',
      'runtime_error',
      'scroll_depth',
    ])
  })

  it('`impression`이 예약이라 고객사가 같은 이름에 다른 모양을 넣을 수 없다', () => {
    // 자동 발화가 생긴 이름을 열어 두면 한 이름에 두 종류가 섞인다 —
    // `page_view`·`click`을 예약한 것과 정확히 같은 이유다.
    expect(isReserved('impression')).toBe(true)
  })

  it('예약 이름을 포함하는 다른 이름은 막지 않는다', () => {
    expect(checkName('page_view2')).toBe(true)
    expect(checkName('my_click')).toBe(true)
  })
})

describe('타입 강제 우회 — 보안 리뷰 3라운드 대응', () => {
  it('박싱된 String은 이름 검사를 통과하지 못한다', () => {
    // 박싱 객체는 동일성 비교를 빠져나가면서 규칙 검사는 통과해 위조가 성립한다
    const boxed = new String('page_view') as unknown as string
    expect(checkName(boxed)).toBe(false)
    expect(isReserved(boxed)).toBe(false)
  })

  it('문자열이 아닌 값을 거부한다', () => {
    for (const bad of [null, undefined, 42, {}, ['click']]) {
      expect(checkName(bad as unknown as string)).toBe(false)
    }
  })

  it('isReserved는 원시 예약 문자열만 인정한다', () => {
    for (const name of RESERVED) expect(isReserved(name)).toBe(true)
    expect(isReserved('my_click')).toBe(false)
  })
})

/**
 * `clip`은 자동 계측이 DOM·URL에서 **원문으로** 읽는 필드의 유일한 상한이다. 이게 없으면
 * 이벤트 1건의 크기가 고객사 마크업에 따라 무한해져 `EVENT_MAX` < `BODY_MAX` 관계가
 * 보증이 아니라 희망이 된다.
 */
describe('clip', () => {
  it('상한 이하는 그대로 둔다', () => {
    expect(clip('goods-12', 200, 'clip.pass')).toBe('goods-12')
    expect(clip('a'.repeat(200), 200, 'clip.exact')).toHaveLength(200)
  })

  it('상한을 넘으면 자른다', () => {
    expect(clip('a'.repeat(500), 200, 'clip.over')).toHaveLength(200)
  })

  it('같은 필드의 경고를 반복하지 않는다 — 자동 계측은 고빈도다', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    clip('a'.repeat(500), 200, 'clip.once')
    clip('a'.repeat(500), 200, 'clip.once')
    clip('a'.repeat(500), 200, 'clip.once')

    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})
