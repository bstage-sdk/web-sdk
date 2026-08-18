export type {
  TemplateEventMap,
  TemplateEventType,
  PlatformEventMap,
  PlatformEventType,
  SlotInitPayload,
  SlotContextPayload,
  AdminConnectPayload,
  TemplateOptions,
} from './types.js'

export { ADMIN_EVENT_CATALOG, getAdminEventsByDomain } from './adminEvents.js'
export type {
  AdminDomainEventType,
  AdminDomainEventMap,
  TicketCreateAfterPayload,
} from './adminEvents.js'

export { SLOT_CATALOG, getSlotsByTarget } from './slotCatalog.js'
export type { TemplateSlot, CustomSlots } from './slotCatalog.js'

export {
  SLOT_CATALOG_V2,
  getSlotsByTargetV2,
  slotIdToDirName,
  dirNameToSlotId,
  isSlotIdV2,
} from './slotCatalogV2.js'
export type {
  SlotIdV2,
  SlotCatalogEntryV2,
  SlotContextOf,
  SlotContextMap,
  SlotContextOverrides,
  CustomSlotsV2,
} from './slotCatalogV2.js'

export type { FrameworkAdapter } from './FrameworkAdapter.js'

export { PlatformBridge } from './PlatformBridge.js'
export type { PlatformEventHandler } from './PlatformBridge.js'

export { createWebComponent } from './createWebComponent.js'

export {
  announceElementName,
  lookupElementName,
  __resetElementRegistry__,
} from './elementRegistry.js'
