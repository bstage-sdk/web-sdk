import { DEFAULT_LANGUAGE, type LanguageCode } from '@bstage-sdk/core'
import { useLocale } from './useLocale.js'
import { devWarnOnce } from '../devWarn.js'

/** 로케일별 메시지 사전. 키는 개발자가 명명하고, 값은 문자열(보간 토큰 포함 가능). */
export type Messages = Partial<Record<LanguageCode, Record<string, string>>>

/** `t()`에 넘기는 보간 파라미터. `{{name}}` 토큰을 치환한다. */
export type TranslateParams = Record<string, string | number>

/** union 멤버별로 `keyof`를 분배해, 모든 로케일에 정의된 키의 합집합을 구한다. */
type DistributeKeys<T> = T extends unknown ? keyof T : never

/** 주어진 메시지 사전에서 사용 가능한 키 union (자동완성·타입체크용). */
export type MessageKey<M extends Messages> = Extract<DistributeKeys<M[keyof M]>, string>

/** `{{token}}` 보간. 대응 파라미터가 없으면 토큰을 그대로 둔다. */
function interpolate(template: string, params?: TranslateParams): string {
  if (!params) return template
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const value = params[key]
    return value === undefined ? `{{${key}}}` : String(value)
  })
}

/**
 * 플랫폼 번역 시스템에 없는 템플릿 자체 문구를 로컬 코드로 다국어 등록하는 hook.
 *
 * 로케일별 메시지 객체를 넘기면 `useLocale().current`에 자동 바인딩된 `t()`를 돌려준다.
 * 키 타입은 객체 리터럴에서 TS가 추론하므로 별도 codegen 없이 자동완성·타입체크가 된다.
 *
 * 현재 로케일에 사전이 없으면 `DEFAULT_LANGUAGE` → 첫 사전 순으로 fallback하고,
 * 키가 없으면 키 문자열을 그대로 돌려준다. 완전 로컬이라 네트워크·플랫폼과 무관하게 동작한다.
 *
 * @example
 * ```tsx
 * import { useMessages } from '@bstage-sdk/react'
 *
 * const messages = {
 *   ko: { scanQr: 'QR을 스캔하세요', greet: '안녕 {{name}}' },
 *   en: { scanQr: 'Scan the QR', greet: 'Hi {{name}}' },
 * }
 *
 * const Greeting = () => {
 *   const t = useMessages(messages)
 *   return <p>{t('greet', { name: '쇼' })}</p>
 * }
 * ```
 *
 * 로케일 대상은 `BstageLocaleProvider`(`target` prop)로 결정한다. 어드민 임베드 템플릿은
 * 훅 호출부를 `<BstageLocaleProvider target="admin">`로 감싼다(유저는 생략). Provider 밖이면 throw.
 */
export function useMessages<const M extends Messages>(
  messages: M,
): (key: MessageKey<M>, params?: TranslateParams) => string {
  const { current } = useLocale()

  return (key, params) => {
    // dev 진단: t(key, '문자열') 오용 경고. 프로덕션에선 번들러가 이 블록을 통째로 제거한다.
    if (process.env.NODE_ENV !== 'production' && typeof (params as unknown) === 'string') {
      devWarnOnce(
        `msg-string-param:${String(key)}`,
        `useMessages의 t('${String(key)}', ...) 2번째 인자는 보간 파라미터 객체입니다. ` +
          `fallback 문자열은 무시됩니다.`,
      )
    }
    const dict = messages[current] ?? messages[DEFAULT_LANGUAGE] ?? Object.values(messages)[0] ?? {}
    const template = dict[key as string] ?? (key as string)
    return interpolate(template, params)
  }
}
