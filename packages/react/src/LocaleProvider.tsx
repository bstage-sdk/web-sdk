import { createContext, createElement, useContext, type ReactElement, type ReactNode } from 'react'
import { type LocaleTarget } from '@bstage-sdk/core'

/**
 * @internal 로케일 대상 컨텍스트. `BstageLocaleProvider`가 값을 주입하고, 로케일 훅이 읽는다.
 *
 * 기본값 `null`은 "Provider 없음"을 뜻한다 — 로케일 훅은 이 경우 throw해 Provider 누락을 알린다.
 */
const LocaleTargetContext = createContext<LocaleTarget | null>(null)

/**
 * @internal 현재 로케일 대상을 읽는다. 로케일 훅 내부 전용.
 *
 * `BstageLocaleProvider` 밖에서 호출하면 throw한다(일관성을 위해 Provider를 강제).
 */
export function useLocaleTarget(): LocaleTarget {
  const target = useContext(LocaleTargetContext)
  if (target === null) {
    throw new Error(
      '[bstage] 로케일 훅(useLocale/useMessages/useBstageTranslations)은 <BstageLocaleProvider> 안에서 호출해야 합니다.',
    )
  }
  return target
}

export interface BstageLocaleProviderProps {
  /**
   * 하위 트리의 로케일 신호 대상. 생략하면 `'user'`.
   *
   * - `'user'`(기본): 유저 플랫폼. `<html lang>` → `bmf_bstage_lang` 쿠키.
   * - `'admin'`: 어드민 임베드. `bmf_mybstage_locale` 쿠키 → `<html lang>`.
   */
  target?: LocaleTarget
  children?: ReactNode
}

/**
 * 하위 트리의 로케일 훅(`useLocale`/`useMessages`/`useBstageTranslations`)이 어떤 대상으로
 * 현재 로케일을 읽을지 결정하는 Provider. **모든 템플릿이 감싸야 한다**(훅은 Provider 밖에서 throw).
 *
 * 어드민 임베드 템플릿은 `<html lang>`이 SSR 기본값으로 고정(런타임 미갱신)이라 신뢰할 수 없고,
 * 런타임 로케일의 진실은 `bmf_mybstage_locale` 쿠키다. 어드민은 `target="admin"`을 넘기고,
 * 유저단은 생략(`'user'`)한다.
 *
 * 훅은 **이 Provider의 하위에서** 호출해야 적용된다(같은 컴포넌트의 return에서 감싸는 경우,
 * 훅을 쓰는 부분을 자식 컴포넌트로 분리한다).
 *
 * @example
 * ```tsx
 * import { BstageLocaleProvider, useBstageTranslations } from '@bstage-sdk/react'
 *
 * const Body = () => {
 *   const { t } = useBstageTranslations()
 *   return <button>{t('A00001')}</button>
 * }
 *
 * // 어드민 템플릿
 * const AdminWidget = () => (
 *   <BstageLocaleProvider target="admin">
 *     <Body />
 *   </BstageLocaleProvider>
 * )
 *
 * // 유저 템플릿 — target 생략
 * const UserWidget = () => (
 *   <BstageLocaleProvider>
 *     <Body />
 *   </BstageLocaleProvider>
 * )
 * ```
 */
export function BstageLocaleProvider({
  target = 'user',
  children,
}: BstageLocaleProviderProps): ReactElement {
  return createElement(LocaleTargetContext.Provider, { value: target }, children)
}

/** @internal 타입 단언 헬퍼 — 조건이 거짓이면 제약 위반으로 컴파일이 막힌다. */
type Assert<T extends true> = T

/**
 * 반환 타입은 `ReactElement`여야 한다. `ReactNode`로 넓히면 `@types/react` 18.2.5 이하에서
 * `<BstageLocaleProvider>`를 JSX로 쓸 수 없다(TS2786) — 함수 컴포넌트의 `ReactNode` 반환은
 * `@types/react` 18.2.8 이상·React 19 타입부터 허용된다.
 *
 * 이 자리는 패키지 자체 typecheck가 못 잡는다. devDependency가 `@types/react ^18`이라 실제로는
 * 18.3이 설치되고, 패키지 안에서 이 Provider를 JSX로 쓰는 곳이 없어 사용 시점 에러가 안 난다.
 * 그래서 반환 타입을 다시 넓히는 변경을 이 단언으로 막는다.
 */
type _JsxCompatibleReturn = Assert<
  ReturnType<typeof BstageLocaleProvider> extends ReactElement | null ? true : false
>
