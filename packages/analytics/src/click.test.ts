import { describe, expect, it } from 'vitest'
import {
  type ClickNode,
  EVENT_ATTR,
  type EventNode,
  PARAM_PREFIX,
  SECTION_ATTR,
  readClick,
  readEvent,
} from './click.js'
import { ATTR_MAX, PARAM_LIMIT, TEXT_MAX } from './limits.js'

/**
 * `findTarget`은 실제 DOM 이벤트가 필요해 브라우저에서 확인하고, 여기서는 params 이름과
 * 절삭 규칙을 못박는다 — 이름이 하나만 바뀌어도 컨슈머가 못 읽는다.
 */
function node(over: Partial<ClickNode> & { section?: string } = {}): ClickNode {
  const { section, ...rest } = over
  return {
    tagName: 'BUTTON',
    id: '',
    textContent: '구매',
    closest: (selector) =>
      selector === `[${SECTION_ATTR}]` && section ? { getAttribute: () => section } : null,
    ...rest,
  }
}

describe('readClick', () => {
  it('click 고정 params 이름을 그대로 쓴다', () => {
    expect(Object.keys(readClick(node(), 10, 20)).sort()).toEqual([
      'href',
      'id',
      'section',
      'tag',
      'text',
      'x',
      'y',
    ])
  })

  it('tag는 소문자, 좌표는 그대로 싣는다', () => {
    const params = readClick(node(), 10, 20)

    expect(params.tag).toBe('button')
    expect(params.x).toBe(10)
    expect(params.y).toBe(20)
  })

  it('id가 없으면 넣지 않는다 — 빈 문자열을 싣지 않는다', () => {
    expect(readClick(node(), 0, 0).id).toBeUndefined()
    expect(readClick(node({ id: 'buy' }), 0, 0).id).toBe('buy')
  })

  it('href는 앵커일 때만 싣는다', () => {
    expect(readClick(node({ href: 'https://x.test/a' }), 0, 0).href).toBeUndefined()
    expect(readClick(node({ tagName: 'A', href: 'https://x.test/a' }), 0, 0).href).toBe(
      'https://x.test/a',
    )
  })

  it('text의 연속 공백·줄바꿈을 한 칸으로 접는다', () => {
    expect(readClick(node({ textContent: '  연간\n  구독권  ' }), 0, 0).text).toBe('연간 구독권')
  })

  it('text를 상한에서 자른다', () => {
    const long = node({ textContent: '가'.repeat(TEXT_MAX + 10) })

    expect(readClick(long, 0, 0).text).toHaveLength(TEXT_MAX)
  })

  it('텍스트가 없으면 text를 넣지 않는다', () => {
    expect(readClick(node({ textContent: '   ' }), 0, 0).text).toBeUndefined()
    expect(readClick(node({ textContent: null }), 0, 0).text).toBeUndefined()
  })

  it('id·section을 상한에서 자른다 — 고객사 마크업이 통제하는 값이다', () => {
    // 상한이 없으면 이벤트 1건의 크기가 마크업에 따라 무한해져
    // `EVENT_MAX` < `BODY_MAX` 관계가 보증이 아니라 희망이 된다.
    const long = 'x'.repeat(ATTR_MAX + 50)
    const params = readClick(node({ id: long, section: long }), 0, 0)

    expect(params.id).toHaveLength(ATTR_MAX)
    expect(params.section).toHaveLength(ATTR_MAX)
  })

  it('section은 가장 가까운 data-log-section에서 찾고, 없으면 넣지 않는다', () => {
    expect(readClick(node({ section: 'hero' }), 0, 0).section).toBe('hero')
    expect(readClick(node(), 0, 0).section).toBeUndefined()
  })
})

/**
 * `readEvent`는 게스트가 쓴 문자열을 읽는 유일한 지점이다. 이름·params 키 이름이 계약이라
 * 하나만 어긋나도 컨슈머가 못 읽고, 값 마스킹·절삭은 신뢰 못 하는 입력의 유일한 방어선이다.
 *
 * ⚠️ 이름 규칙(`checkName`)과 예약 이름(`isReserved`) 검사는 `readEvent`가 아니라
 * `Tracker.send()` → `record()` 경로에 있다 — 여기서는 그 경로로 넘길 값만 만든다.
 */
function eventNode(
  attrs: Record<string, string> = {},
  ancestor?: Record<string, string>,
): EventNode {
  const self: EventNode = {
    getAttribute: (name) => attrs[name] ?? null,
    getAttributeNames: () => Object.keys(attrs),
    closest: (selector) => {
      if (selector !== `[${EVENT_ATTR}]`) return null
      if (attrs[EVENT_ATTR] !== undefined) return self
      if (!ancestor) return null
      return {
        getAttribute: (name) => ancestor[name] ?? null,
        getAttributeNames: () => Object.keys(ancestor),
        closest: () => null,
      }
    },
  }
  return self
}

describe('readEvent', () => {
  it('이름 속성이 없으면 null이다 — 커스텀 이벤트가 아니다', () => {
    expect(readEvent(eventNode())).toBeNull()
    expect(readEvent(eventNode({ [EVENT_ATTR]: '   ' }))).toBeNull()
  })

  it('지정한 이름을 그대로 쓴다', () => {
    expect(readEvent(eventNode({ [EVENT_ATTR]: 'purchase' }))?.name).toBe('purchase')
  })

  it('이름은 조상에서도 찾는다 — 카드 전체에 붙이고 안쪽 버튼을 눌러도 발화한다', () => {
    // `findTarget`이 composedPath의 첫 매칭을 주므로 안쪽 button이 잡힌다.
    // closest로 올라가지 않으면 카드에 붙인 이름을 읽지 못한다.
    const inner = eventNode({}, { [EVENT_ATTR]: 'card_open' })

    expect(readEvent(inner)?.name).toBe('card_open')
  })

  it('params가 없으면 넣지 않는다 — 이름만으로 성립한다', () => {
    expect(readEvent(eventNode({ [EVENT_ATTR]: 'purchase' }))?.params).toBeUndefined()
  })

  it('param 속성을 키로 모으고 kebab을 camel로 바꾼다', () => {
    const params = readEvent(
      eventNode({
        [EVENT_ATTR]: 'purchase',
        [`${PARAM_PREFIX}amount`]: '32000',
        [`${PARAM_PREFIX}item-id`]: 'goods-12',
        [`${PARAM_PREFIX}coupon-code-type`]: 'welcome',
      }),
    )?.params

    expect(params).toEqual({ amount: '32000', itemId: 'goods-12', couponCodeType: 'welcome' })
  })

  it('이름과 무관한 data 속성은 섞이지 않는다', () => {
    const params = readEvent(
      eventNode({
        [EVENT_ATTR]: 'purchase',
        'data-log-section': 'hero',
        'data-testid': 'buy',
        [`${PARAM_PREFIX}plan`]: 'annual',
      }),
    )?.params

    expect(params).toEqual({ plan: 'annual' })
  })

  it('접두어만 있고 키가 없는 속성은 버린다', () => {
    const params = readEvent(
      eventNode({ [EVENT_ATTR]: 'purchase', [PARAM_PREFIX.slice(0, -1)]: 'x' }),
    )?.params

    expect(params).toBeUndefined()
  })

  it('param 값을 마스킹한다 — 게스트가 쓴 값이라 신뢰할 수 없다', () => {
    const params = readEvent(
      eventNode({
        [EVENT_ATTR]: 'purchase',
        [`${PARAM_PREFIX}token`]: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJqYW5lIn0.SIG',
        [`${PARAM_PREFIX}auth`]: 'Bearer abc.def-123',
        [`${PARAM_PREFIX}back`]: 'https://x.test/cb?access_token=SECRET',
      }),
    )?.params

    expect(params?.token).toBe('***')
    expect(params?.auth).toBe('Bearer ***')
    expect(params?.back).toBe('https://x.test/cb?access_token=***')
  })

  it('⚠️ 이메일은 마스킹되지 않는다 — `mask()`가 걸러내지 않는다(협의 3 미확정)', () => {
    // `click.text`·`impression.itemName`도 같다. 자동 계측과 같은 수준을 적용한 결과이며,
    // 협의 항목 3(custom event PII)의 결론이 오면 그 필터를 `send()` 한 지점에 넣는다.
    const params = readEvent(
      eventNode({ [EVENT_ATTR]: 'purchase', [`${PARAM_PREFIX}buyer`]: 'jane.doe@acme.com' }),
    )?.params

    expect(params?.buyer).toBe('jane.doe@acme.com')
  })

  it('param 값을 상한에서 자른다 — 고객사 마크업이 크기를 통제하지 못하게 한다', () => {
    const long = 'x'.repeat(ATTR_MAX + 50)
    const params = readEvent(
      eventNode({ [EVENT_ATTR]: 'purchase', [`${PARAM_PREFIX}memo`]: long }),
    )?.params

    expect(params?.memo).toHaveLength(ATTR_MAX)
  })

  it('빈 param 값은 넣지 않는다', () => {
    const params = readEvent(
      eventNode({
        [EVENT_ATTR]: 'purchase',
        [`${PARAM_PREFIX}plan`]: '  ',
        [`${PARAM_PREFIX}amount`]: '0',
      }),
    )?.params

    expect(params).toEqual({ amount: '0' })
  })

  it('키 이름 규칙에 맞지 않으면 버린다 — 게스트 마크업이 필드명을 통제한다', () => {
    // 키는 그대로 JSON 필드명이 되어 적재까지 간다. 값처럼 자르는 것으로는 안 되고
    // 규칙에 맞지 않는 키는 버려야 한다 — 데이터셋 스키마가 마크업에 좌우된다.
    const params = readEvent(
      eventNode({
        [EVENT_ATTR]: 'purchase',
        [`${PARAM_PREFIX}a.b.c`]: 'x',
        [`${PARAM_PREFIX}1st`]: 'x',
        [`${PARAM_PREFIX}has space`]: 'x',
        [`${PARAM_PREFIX}plan`]: 'annual',
      }),
    )?.params

    expect(params).toEqual({ plan: 'annual' })
  })

  it('프로토타입 오염에 쓰이는 키를 버린다', () => {
    // 로컬 대입은 computed key라 SDK 프로토타입을 오염시키지 않지만, 이 키가 payload에
    // 실려 나가면 params를 객체에 merge하는 소비자 쪽에서 오염된다.
    const params = readEvent(
      eventNode({
        [EVENT_ATTR]: 'purchase',
        [`${PARAM_PREFIX}__proto__`]: 'x',
        [`${PARAM_PREFIX}constructor`]: 'x',
        [`${PARAM_PREFIX}prototype`]: 'x',
      }),
    )?.params

    expect(params).toBeUndefined()
  })

  it('하이픈 트릭으로 오염 키를 만들 수 없다 — 키는 소문자로 시작해야 한다', () => {
    // `toCamel`이 선행 하이픈까지 소비해 `-constructor` → `Constructor`가 된다.
    // 대소문자 구분 검사만으로는 통과하므로 소문자 시작 자체를 규칙으로 둔다.
    const params = readEvent(
      eventNode({
        [EVENT_ATTR]: 'purchase',
        [`${PARAM_PREFIX}-constructor`]: 'x',
        [`${PARAM_PREFIX}-proto__`]: 'x',
      }),
    )?.params

    expect(params).toBeUndefined()
  })

  it('키를 소문자로 정규화하는 소비자에게도 오염 키가 가지 않는다', () => {
    // `con-structor` → `conStructor`. 소비자가 소문자로 정규화하면 `constructor`가 된다.
    const params = readEvent(
      eventNode({
        [EVENT_ATTR]: 'purchase',
        [`${PARAM_PREFIX}con-structor`]: 'x',
        [`${PARAM_PREFIX}proto-type`]: 'x',
      }),
    )?.params

    expect(params).toBeUndefined()
  })

  it('키 길이 상한을 넘으면 버린다', () => {
    const long = 'k'.repeat(PARAM_LIMIT.keyLength + 1)
    const params = readEvent(
      eventNode({ [EVENT_ATTR]: 'purchase', [`${PARAM_PREFIX}${long}`]: 'x' }),
    )?.params

    expect(params).toBeUndefined()
  })

  it('키 개수 상한에서 멈춘다 — 이벤트 1건의 크기를 마크업이 결정하지 못하게 한다', () => {
    const attrs: Record<string, string> = { [EVENT_ATTR]: 'purchase' }
    for (let at = 0; at < PARAM_LIMIT.keys + 10; at++) attrs[`${PARAM_PREFIX}k${at}`] = 'v'
    const params = readEvent(eventNode(attrs))?.params

    expect(Object.keys(params ?? {})).toHaveLength(PARAM_LIMIT.keys)
  })

  it('params는 조상의 이름 요소에서 읽는다 — 이름과 값이 같은 요소에 있다', () => {
    const inner = eventNode({}, { [EVENT_ATTR]: 'card_open', [`${PARAM_PREFIX}rank`]: '3' })
    const read = readEvent(inner)

    expect(read?.name).toBe('card_open')
    expect(read?.params).toEqual({ rank: '3' })
  })
})

describe('라벨 절삭 경계 — 보안 리뷰 5라운드 대응', () => {
  it('JWT 라벨이 50자에서 잘려도 payload가 남지 않는다', () => {
    // 자르고 마스킹하면 세 번째 세그먼트가 사라져 매칭이 실패하는데 접두부는 남는다
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJqYW5lLmRvZUBhY21lLmNvbSJ9.SIG'
    const node = { tagName: 'SPAN', id: '', textContent: jwt, closest: () => null } as never
    const text = readClick(node, 0, 0).text ?? ''
    expect(text).not.toContain('eyJzdWIiOiJqYW5l')
  })

  it('userinfo 라벨의 @ 가 50자 밖이어도 비밀번호가 남지 않는다', () => {
    const label = 'https://admin:S3cretPassw0rdLong@internal.example.com/x'
    const node = { tagName: 'SPAN', id: '', textContent: label, closest: () => null } as never
    expect(readClick(node, 0, 0).text ?? '').not.toContain('S3cretPassw0rdLong')
  })
})
