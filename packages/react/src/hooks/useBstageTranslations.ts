import { cloneElement, useCallback, useEffect, useRef, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import {
  fetchTranslations,
  interpolateTranslation,
  parseRichText,
  pickTranslation,
  resolveTranslationChain,
  type LanguageCode,
  type TranslationDict,
  type TranslationKey,
  type TranslateParams,
} from '@bstage-sdk/core'
import { useLocale } from './useLocale.js'
import { useLocaleTarget } from '../LocaleProvider.js'
import { devWarnOnce } from '../devWarn.js'

/** `tNode`에 넘기는 옵션. */
export interface TranslateNodeOptions {
  /** `{{token}}` 보간 파라미터. */
  params?: TranslateParams
  /**
   * `<N>…</N>` 조각을 감쌀 엘리먼트. 키가 태그 인덱스다.
   *
   * 넘기지 않은 인덱스는 감싸지 않고 내용만 렌더한다(문구가 사라지지 않는다).
   */
  tags?: Record<number, ReactElement>
}

export interface UseBstageTranslationsResult {
  /** 현재 렌더 로케일 코드. `useLocale().current`와 동일하다(편의상 함께 제공). */
  current: LanguageCode
  /** 현재 로케일의 플랫폼 번역 키를 해석한다. 로드 전(또는 실패 시)엔 키 문자열을 그대로 반환. */
  t: (key: TranslationKey, params?: TranslateParams) => string
  /**
   * `<0>…</0>` 리치텍스트가 있는 문구를 React 노드로 렌더한다.
   *
   * `t`는 문자열을 반환하므로 태그가 글자로 보인다 — 링크·강조가 든 문구는 이쪽을 쓴다.
   * 문자열이 필요한 자리(placeholder·aria-label)는 계속 `t`를 쓴다.
   */
  tNode: (key: TranslationKey, options?: TranslateNodeOptions) => ReactNode
  /** 사전 로드 완료 여부. `false` 동안 `t`는 키 문자열을 반환하므로 필요하면 렌더를 가드한다. */
  ready: boolean
}

/**
 * "이 로케일은 폴백이 필요했다"를 세션 동안 기억한다 — `{target}|{locale}` → 필요했던 단계 수.
 *
 * 미번역 키는 첫 렌더에 키 문자열로 나갔다가 폴백 사전이 도착하면 채워진다(짧은 깜빡임).
 * 한 번 겪은 조합은 처음부터 그 단계까지 함께 받아, 같은 페이지의 다른 위젯과 재마운트에서는
 * 깜빡임이 없다. 어떤 키를 쓸지는 렌더 시점에만 알 수 있어 첫 겪음은 피할 수 없다.
 */
const requiredDepth = new Map<string, number>()

/**
 * 플랫폼의 공용 번역 사전(`Bxxxxx` → 문자열)을 재사용하는 hook.
 *
 * 현재 로케일(`current`)의 사전을 TMS가 배포한 CDN에서 가져와(`fetchTranslations`) `t(key)`로
 * 해석한다. 사전 시스템(`user`/`admin`)은 `BstageLocaleProvider`의 `target`이 정한다. 로케일이
 * 바뀌면 해당 로케일 사전을 다시 가져온다(캐시되어 빠름). `{{token}}` 보간을 지원한다.
 *
 * **미번역 폴백** — 사전에는 키는 있고 값만 빈 문자열인 항목이 있다(어드민은 일부 로케일이 대부분 그렇다).
 * 그런 키를 만나면 폴백 사전(기본 `en` → `ko`)을 **그때 추가로 받아** 값을 채운다. 번역이 다 있는
 * 로케일에서는 추가 요청이 일어나지 않는다.
 *
 * 현재 언어 코드(`current`)도 함께 반환하므로, 플랫폼 문구를 쓰는 위젯은 이 hook 하나로
 * 언어·번역을 모두 얻는다. 언어 코드만 필요하면 fetch가 없는 `useLocale()`을 쓴다.
 *
 * 키가 opaque(`B00001`)이므로 타입 안전은 `bstage i18n` codegen이 채운다(미생성 시 `string`).
 * 템플릿 자체 문구는 `useMessages`를 쓴다 — 이 hook은 플랫폼 문구 재사용 전용이다.
 *
 * @example
 * ```tsx
 * import { useBstageTranslations } from '@bstage-sdk/react'
 *
 * const ApplyButton = () => {
 *   const { t, ready } = useBstageTranslations()
 *   if (!ready) return null
 *   return <button>{t('B00001')}</button>
 * }
 * ```
 *
 * 로케일 대상은 `BstageLocaleProvider`(`target` prop)로 결정한다. 어드민 임베드 템플릿은
 * 훅 호출부를 `<BstageLocaleProvider target="admin">`로 감싼다(유저는 생략). Provider 밖이면 throw.
 */
export function useBstageTranslations(): UseBstageTranslationsResult {
  const { current } = useLocale()
  // Provider의 target이 로케일 신호와 **사전 시스템**(user/admin)을 함께 정한다.
  const target = useLocaleTarget()
  const depthKey = `${target}|${current}`
  /** 조회 순서대로 쌓인 사전들. 첫 항목이 현재 로케일. */
  const [dicts, setDicts] = useState<TranslationDict[]>()
  /** 폴백을 몇 단계까지 받았는지 — 늘어나면 effect가 다음 사전을 받는다. */
  const [depth, setDepth] = useState(() => requiredDepth.get(depthKey) ?? 1)
  /** 같은 렌더에서 폴백 요청이 중복되지 않게 막는다. */
  const pendingRef = useRef(false)

  // 로케일·시스템이 바뀌면 처음부터 다시 쌓는다(이미 겪은 조합이면 그 단계에서 시작).
  useEffect(() => {
    setDicts(undefined)
    setDepth(requiredDepth.get(depthKey) ?? 1)
    pendingRef.current = false
  }, [depthKey])

  useEffect(() => {
    let active = true
    const chain = resolveTranslationChain(current).slice(0, depth)
    Promise.all(chain.map((locale) => fetchTranslations(locale, target).catch(() => ({}))))
      .then((loaded) => {
        if (!active) return
        setDicts(loaded)
        pendingRef.current = false
      })
      .catch(() => {
        if (active) setDicts([])
      })
    return () => {
      active = false
    }
  }, [current, target, depth])

  /**
   * 미번역 키를 만났을 때 다음 폴백 사전을 요청한다.
   *
   * 렌더 중에 setState를 부르면 안 되므로 microtask로 미룬다. 어떤 키를 쓸지는 렌더 시점에만
   * 알 수 있어서(코드에 박힌 리터럴), 미리 폴백을 받아두는 방식은 번역이 다 있는 로케일에도
   * 매번 추가 요청을 만든다 — 그래서 필요할 때만 받는다.
   */
  const requestFallback = useCallback(
    (chainLength: number) => {
      if (pendingRef.current) return
      pendingRef.current = true
      queueMicrotask(() =>
        setDepth((d) => {
          if (d >= chainLength) return d
          const next = d + 1
          // 다음 마운트·다른 위젯은 이 단계에서 시작해 깜빡임을 건너뛴다.
          requiredDepth.set(depthKey, Math.max(requiredDepth.get(depthKey) ?? 1, next))
          return next
        }),
      )
    },
    [depthKey],
  )

  /**
   * 사전에서 원문을 꺼낸다(보간 전). 없으면 폴백을 요청하고 `undefined`.
   *
   * `t`와 `tNode`가 공유한다 — 조회·폴백 규칙이 갈리면 같은 키가 두 API에서 다르게 나온다.
   */
  const resolveRaw = useCallback(
    (key: TranslationKey): string | undefined => {
      const resolved = dicts ? pickTranslation(dicts, key as string) : undefined
      if (resolved !== undefined) return resolved

      if (dicts) {
        const chain = resolveTranslationChain(current)
        if (dicts.length < chain.length) {
          // 이 로케일엔 번역이 없다 — 폴백 사전을 받아 다음 렌더에 채운다.
          requestFallback(chain.length)
        } else if (process.env.NODE_ENV !== 'production') {
          // 체인을 다 뒤졌는데도 없음 — 오탈자이거나 useMessages 대상일 수 있다.
          devWarnOnce(
            `t-missing-key:${String(key)}`,
            `'${String(key)}'는 플랫폼 번역 사전에 없는 키입니다(오탈자이거나 useMessages 대상일 수 있음). ` +
              `키 문자열이 그대로 렌더됩니다.`,
          )
        }
      }
      return undefined
    },
    [dicts, current, requestFallback],
  )

  const t = useCallback(
    (key: TranslationKey, params?: TranslateParams) => {
      // dev 진단: 흔한 오용을 경고한다(반환값은 그대로). 프로덕션에선 번들러가 이 블록을 통째로 제거한다.
      if (process.env.NODE_ENV !== 'production') {
        if (typeof (params as unknown) === 'string') {
          // t(key, '문자열') — 2번째 인자를 fallback으로 오인. 실제로는 보간 파라미터라 무시된다.
          devWarnOnce(
            `t-string-param:${String(key)}`,
            `t('${String(key)}', ...)의 2번째 인자는 보간 파라미터 객체입니다. ` +
              `fallback 문자열은 무시되고 플랫폼 사전 값이 렌더됩니다 — 템플릿 자체 문구는 useMessages를 쓰세요.`,
          )
        }
      }
      const raw = resolveRaw(key)
      if (process.env.NODE_ENV !== 'production' && raw !== undefined && /<\d+>/.test(raw)) {
        // 리치텍스트 문구를 t로 렌더하면 `<0>`이 글자로 보인다.
        devWarnOnce(
          `t-rich-text:${String(key)}`,
          `'${String(key)}'는 리치텍스트(<0>…</0>) 문구입니다. t()는 문자열을 반환하므로 태그가 ` +
            `글자로 보입니다 — tNode('${String(key)}', { tags: { 0: <a href="…" /> } })를 쓰세요.`,
        )
      }
      return interpolateTranslation(raw ?? (key as string), params)
    },
    [resolveRaw],
  )

  const tNode = useCallback(
    (key: TranslationKey, options?: TranslateNodeOptions): ReactNode => {
      const raw = resolveRaw(key) ?? (key as string)
      const tokens = parseRichText(raw, options?.params)
      return tokens.map((token, i) => {
        if (token.type === 'text') return token.value
        const element = options?.tags?.[token.index]
        if (!element) {
          if (process.env.NODE_ENV !== 'production') {
            devWarnOnce(
              `tnode-missing-tag:${String(key)}:${token.index}`,
              `'${String(key)}'의 <${token.index}> 태그에 대응하는 엘리먼트가 없습니다 ` +
                `— tags: { ${token.index}: <a href="…" /> }를 넘기세요. 지금은 내용만 렌더됩니다.`,
            )
          }
          return token.value
        }
        return cloneElement(element, { key: i }, token.value)
      })
    },
    [resolveRaw],
  )

  return { current, t, tNode, ready: dicts !== undefined }
}
