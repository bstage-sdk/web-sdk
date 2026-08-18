export { loadTemplate } from './loadTemplate.js'
export { loadTemplatesBySlots } from './loadTemplatesBySlots.js'
export { TemplateHandle } from './TemplateHandle.js'
export type { TemplateInfo, LoadTemplateOptions } from './types.js'

/**
 * 슬롯 목록 및 관련 타입을 host 패키지에서도 재노출한다.
 * 플랫폼/관리도구가 host 또는 core 중 어느 패키지를 쓰더라도 동일한 인터페이스를 참조할 수 있다.
 */
export {
  SLOT_CATALOG,
  getSlotsByTarget,
  type TemplateSlot,
  type CustomSlots,
} from '@bstage-sdk/core'
