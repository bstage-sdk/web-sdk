import { useCallback, useSyncExternalStore } from 'react'
import { readLocale, observeLocale, DEFAULT_LANGUAGE, type LanguageCode } from '@bstage-sdk/core'
import { useLocaleTarget } from '../LocaleProvider.js'

export interface LocaleState {
  /** 현재 렌더 로케일. 모드별 신호 우선순위로 판정한다. */
  current: LanguageCode
}

/**
 * 현재 렌더 로케일을 구독하는 hook. 플랫폼이 리로드 없이 언어를 바꿔도(SPA 전환) reactive하게 갱신된다.
 *
 * 리액티브 신호는 `<html lang>`(MutationObserver로 관찰)이며, 대상에 따라 실제 값의 우선순위가 다르다.
 * 대상은 `BstageLocaleProvider`(`target` prop)로 결정한다(생략 시 `'user'`).
 * - `'user'`(기본): `<html lang>` → 쿠키 `bmf_bstage_lang`. 유저 플랫폼가 언어 변경 시 `<html lang>`을
 *   갱신하므로 플랫폼 추가 작업 없이 동작한다.
 * - `'admin'`: 쿠키 `bmf_mybstage_locale` → `<html lang>`. 어드민 임베드 템플릿에서 쓴다.
 *
 * `BstageLocaleProvider` 밖에서 호출하면 throw한다. 신호가 없는 환경에서는 기본 로케일로 fallback한다.
 *
 * @example
 * ```tsx
 * import { useLocale } from '@bstage-sdk/react'
 *
 * const Greeting = () => {
 *   const { current } = useLocale()
 *   return <p>현재 언어: {current}</p>
 * }
 * ```
 */
export function useLocale(): LocaleState {
  const target = useLocaleTarget()
  const subscribe = useCallback((onChange: () => void) => observeLocale(onChange, target), [target])
  const getSnapshot = useCallback(() => readLocale(target), [target])
  const current = useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_LANGUAGE)
  return { current }
}
