import type { CustomSlots, CustomSlotsV2 } from '@bstage-sdk/core'
import type { LoadTemplateOptions } from './types.js'
import { loadTemplate } from './loadTemplate.js'
import { TemplateHandle } from './TemplateHandle.js'

/**
 * 관리도구가 CDN에 업로드한 `config-latest.json`(또는 동일 형태의 객체)을 받아
 * 슬롯별 TemplateHandle 배열을 반환한다.
 *
 * - 런타임에서는 목록에 없는 슬롯 키도 허용(관리도구가 신버전을 선반영한 경우)
 * - 개별 템플릿 로드 실패 시 해당 항목만 건너뛰고 나머지를 반환
 * - 옛 모양(`CustomSlots`, 4-part 키)·새 모양(`CustomSlotsV2`, 3-part 키) 둘 다 받음.
 *   한 객체에 둘이 섞여 있어도 동작한다(키 형식만 다른 같은 모양).
 *
 * @example
 * const slotMap = await loadTemplatesBySlots(await fetchCustomSlots(spaceId))
 * const beforeHandles = slotMap.get('contents.home.contents.before') ?? []
 */
export async function loadTemplatesBySlots(
  customSlots: CustomSlots | CustomSlotsV2,
  options?: LoadTemplateOptions,
): Promise<Map<string, TemplateHandle[]>> {
  const result = new Map<string, TemplateHandle[]>()

  const tasks: Array<{ slot: string; templateUrl: string }> = []
  for (const [slot, entries] of Object.entries(customSlots)) {
    for (const entry of entries) {
      tasks.push({ slot, templateUrl: entry.templateUrl })
    }
  }

  const settled = await Promise.allSettled(
    tasks.map(({ templateUrl }) => loadTemplate(templateUrl, options)),
  )

  for (let i = 0; i < tasks.length; i++) {
    const { slot } = tasks[i]
    const outcome = settled[i]
    if (outcome.status === 'rejected') {
      console.warn(`[bstage-host] Failed to load template for slot "${slot}":`, outcome.reason)
      continue
    }
    const handles = result.get(slot) ?? []
    handles.push(outcome.value)
    result.set(slot, handles)
  }

  return result
}
