export {
  createTemplate,
  type CreateTemplateOptions,
  type BstageMeta,
  type BstageTemplateComponent,
} from './createTemplate.js'

/** @internal 빌드 파이프라인 전용 — 직접 사용하지 마세요. */
export { __bstage_registry__ } from './createTemplate.js'
/** @internal 빌드 파이프라인 전용 — 직접 사용하지 마세요. */
export { registerTemplate } from './registerTemplate.js'
export { BstageContext, useBstageContext, type BstageContextValue } from './BstageContext.js'
export { useNavigation, type NavigationActions } from './hooks/useNavigation.js'
export { usePlatformEvent } from './hooks/usePlatformEvent.js'
export { useSlotContext } from './hooks/useSlotContext.js'
export { useShadowStyle } from './hooks/useShadowStyle.js'
export { useLocale, type LocaleState } from './hooks/useLocale.js'
export { BstageLocaleProvider, type BstageLocaleProviderProps } from './LocaleProvider.js'
export type { LocaleTarget } from '@bstage-sdk/core'
export {
  useMessages,
  type Messages,
  type MessageKey,
  type TranslateParams,
} from './hooks/useMessages.js'
export {
  useBstageTranslations,
  type UseBstageTranslationsResult,
  type TranslateNodeOptions,
} from './hooks/useBstageTranslations.js'
