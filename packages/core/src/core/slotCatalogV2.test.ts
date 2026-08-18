import { describe, expect, it } from 'vitest'
import {
  SLOT_CATALOG_V2,
  dirNameToSlotId,
  isSlotIdV2,
  slotIdToDirName,
  type SlotIdV2,
} from './slotCatalogV2.js'

/**
 * 슬롯 id ↔ 디렉토리 이름 변환은 SDK와 관리도구가 나눠 쓰는 규칙이다. SDK가 `dist/{이름}/`을
 * 내보내고 관리도구가 그 이름을 슬롯 id로 되돌려 어느 자리인지 판단하므로, 되돌리기가 깨지면
 * **엉뚱한 자리에 위젯이 붙는다**.
 *
 * 릴리즈 전 손 검증은 위젯 하나를 빌드해 폴더 이름을 눈으로 보는 데서 끝난다 — 카탈로그
 * 전체가 규칙을 지키는지는 태우지 않는다. 명명 규칙에서 벗어난 자리(콜론 2개, anchor에 대시 2개)가
 * 새로 들어와도 그 자리를 직접 빌드해보기 전에는 아무도 모른다.
 */
describe('슬롯 id ↔ 디렉토리 이름', () => {
  it('콜론을 대시 2개로 바꾼다', () => {
    expect(slotIdToDirName('user.contents-home.curation:after')).toBe(
      'user.contents-home.curation--after',
    )
  })

  it('디렉토리 이름에서 슬롯 id를 복원한다', () => {
    expect(dirNameToSlotId('user.contents-home.curation--after')).toBe(
      'user.contents-home.curation:after',
    )
  })

  it('카탈로그의 모든 자리가 왕복해도 그대로다', () => {
    const ids = Object.keys(SLOT_CATALOG_V2) as SlotIdV2[]
    // 카탈로그가 비면 이 테스트는 아무것도 검사하지 않은 채 통과한다.
    expect(ids.length).toBeGreaterThan(0)

    for (const id of ids) {
      const dirName = slotIdToDirName(id)
      expect(
        dirName,
        `${id} — 디렉토리 이름에 콜론이 남으면 윈도우에서 빌드가 깨진다`,
      ).not.toContain(':')
      expect(dirNameToSlotId(dirName), `${id} — 왕복이 어긋나면 엉뚱한 자리에 붙는다`).toBe(id)
    }
  })

  it('구분자가 없는 이름은 그대로 둔다 — 풀페이지 경로를 넘겨도 예외를 내지 않는다', () => {
    expect(dirNameToSlotId('landing')).toBe('landing')
  })
})

describe('isSlotIdV2', () => {
  it('카탈로그에 있는 id면 참', () => {
    expect(isSlotIdV2('user.contents-home.curation:after')).toBe(true)
  })

  it('오타 난 id는 거짓 — 빌드에서 잡으려는 지점이다', () => {
    expect(isSlotIdV2('user.contents-home.curation:afterr')).toBe(false)
    expect(isSlotIdV2('user.contents-home.curation--after')).toBe(false)
  })

  it('Object.prototype의 속성 이름에 속지 않는다', () => {
    expect(isSlotIdV2('toString')).toBe(false)
    expect(isSlotIdV2('constructor')).toBe(false)
  })
})
