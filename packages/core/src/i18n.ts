/**
 * b.stage 제품이 제공하는 언어 목록과 로케일 코드 타입.
 *
 * **수작업 미러링 — 유지보수 계약**
 *
 * 이 목록은 유저 플랫폼의 `Language` enum(`src/enums/common.ts`)을 손으로 미러링한 것이다.
 * 제품 전체 지원 언어를 주는 API가 없고(Hub는 스페이스별 `space.languages`만 제공),
 * 집합이 작고 거의 바뀌지 않으므로 상수로 직접 둔다.
 *
 * 유저 플랫폼가 로케일을 추가/제거하면 이 상수도 함께 갱신한다.
 *
 * 참고: "스페이스가 켠 언어 목록"(`space.languages`)은 스페이스별 동적 값이며 여기서 다루지 않는다.
 * 플랫폼은 어차피 활성 언어 하나만 렌더하므로, 템플릿에는 현재 언어(`useLocale().current`)만 전달된다.
 */
export const LANGUAGES = ['ko', 'en', 'ja', 'zh-CN', 'zh-TW', 'es', 'vi'] as const

/**
 * b.stage가 지원하는 로케일 코드.
 *
 * `useLocale().current`, `useMessages`의 로케일 키, `bstage i18n` codegen이 모두 이 타입을 공유한다.
 */
export type LanguageCode = (typeof LANGUAGES)[number]

/**
 * 신호가 전혀 없을 때(standalone, SSR 등) 사용하는 기본 로케일.
 */
export const DEFAULT_LANGUAGE: LanguageCode = 'ko'

/**
 * 로케일 신호를 읽는 실행 대상(어느 b.stage 런타임에서 도는지).
 *
 * - `'user'`: 유저 플랫폼(유저단). 언어 변경 시 `<html lang>`을 갱신하므로 이를 1차 신호로 신뢰.
 * - `'admin'`: 어드민 임베드. 어드민은 `<html lang>`을 SSR 기본값으로 고정(런타임 미갱신)하므로
 *   신뢰할 수 없고, 런타임 언어는 `bmf_mybstage_locale` 쿠키가 진실이다.
 *
 * `bstage i18n pull --target user|admin`의 `--target`과 동일 축이다.
 */
export type LocaleTarget = 'user' | 'admin'

/**
 * 대상별 언어 쿠키 이름.
 *
 * - `user`: `bmf_bstage_lang` — 유저 플랫폼(유저) 전용. `<html lang>` 부재 시 보조로만 읽는다.
 * - `admin`: `bmf_mybstage_locale` — 어드민 전용(어드민이 런타임 언어를 저장하는 쿠키).
 *
 * 암묵적 계약이므로 유저 플랫폼/어드민이 쿠키명을 바꾸면 여기도 갱신한다.
 */
const LANGUAGE_COOKIE: Record<LocaleTarget, string> = {
  user: 'bmf_bstage_lang',
  admin: 'bmf_mybstage_locale',
}

/** 대소문자 무시 매칭용 — 정규화된 입력 → 표준 LanguageCode. */
const LANGUAGE_LOOKUP = new Map<string, LanguageCode>(
  LANGUAGES.map((code) => [code.toLowerCase(), code]),
)

/**
 * 임의 문자열을 표준 `LanguageCode`로 정규화. 지원하지 않으면 `undefined`.
 *
 * `<html lang>`/쿠키 값이 `zh-cn`처럼 대소문자가 다를 수 있어 소문자 비교한다.
 */
export function normalizeLanguage(value: string | null | undefined): LanguageCode | undefined {
  if (!value) return undefined
  return LANGUAGE_LOOKUP.get(value.trim().toLowerCase())
}

/** 주어진 대상의 언어 쿠키를 읽는다(보조 신호). */
function readLanguageCookie(target: LocaleTarget): LanguageCode | undefined {
  if (typeof document === 'undefined' || !document.cookie) return undefined
  const cookieName = LANGUAGE_COOKIE[target]
  for (const part of document.cookie.split(';')) {
    const [name, ...rest] = part.split('=')
    if (name?.trim() === cookieName) {
      return normalizeLanguage(decodeURIComponent(rest.join('=')))
    }
  }
  return undefined
}

/**
 * 현재 렌더 로케일을 읽는다.
 *
 * - `user`(기본): `<html lang>` → 쿠키 `bmf_bstage_lang` → `DEFAULT_LANGUAGE`.
 *   `<html lang>`은 유저 플랫폼가 언어 변경 시 갱신하는 웹 표준 신호라 1차로 신뢰한다.
 * - `admin`: 쿠키 `bmf_mybstage_locale` → `<html lang>` → `DEFAULT_LANGUAGE`.
 *   어드민은 `<html lang>`이 SSR 기본값으로 고정(런타임 미갱신)이라 쿠키를 1차로 신뢰한다.
 *
 * DOM이 없는 환경(SSR 등)에서는 기본값을 돌려준다.
 */
export function readLocale(target: LocaleTarget = 'user'): LanguageCode {
  if (typeof document === 'undefined') return DEFAULT_LANGUAGE
  const htmlLang = normalizeLanguage(document.documentElement.lang)
  if (target === 'admin') {
    return readLanguageCookie('admin') ?? htmlLang ?? DEFAULT_LANGUAGE
  }
  return htmlLang ?? readLanguageCookie('user') ?? DEFAULT_LANGUAGE
}

/**
 * `<html lang>` 변경을 구독한다. 변경 시 새 로케일로 콜백을 호출하고, 해제 함수를 반환한다.
 *
 * 유저 플랫폼는 `i18n.changeLanguage()`(리로드 없는 SPA 전환) 시 `<html lang>`을 갱신하므로,
 * 이 속성을 MutationObserver로 관찰하면 변경을 reactive하게 잡을 수 있다.
 * (쿠키는 change 이벤트가 없어 SPA 전환을 감지하지 못한다.)
 *
 * `admin` 대상의 실제 값은 `bmf_mybstage_locale` 쿠키지만, 리액티브 신호는 동일하게 `<html lang>`을
 * 관찰한다. 어드민의 런타임 언어 전환(디버그 패널)이 `<html lang>`을 함께 갱신(poke)하므로,
 * 그 변경을 감지해 `readLocale('admin')`이 쿠키를 다시 읽는다.
 *
 * DOM/MutationObserver가 없는 환경에서는 아무 동작도 하지 않는 해제 함수를 반환한다.
 */
export function observeLocale(
  onChange: (locale: LanguageCode) => void,
  target: LocaleTarget = 'user',
): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
    return () => {}
  }
  let current = readLocale(target)
  const observer = new MutationObserver(() => {
    const next = readLocale(target)
    if (next !== current) {
      current = next
      onChange(next)
    }
  })
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
  return () => observer.disconnect()
}

/** 플랫폼 번역 사전 — 로케일별 `Bxxxxx` 키 → 문자열(flat). */
export type TranslationDict = Record<string, string>

/** 번역 문자열 보간에 넘기는 파라미터. `{{token}}`을 치환한다. */
export type TranslateParams = Record<string, string | number>

/**
 * `bstage i18n` codegen이 declaration merging으로 번역 키를 좁히는 지점 (escape hatch).
 *
 * 비어있으면 `TranslationKey`는 `string`. codegen이 키를 보강하면 그 키 union으로 좁혀진다.
 * (`SlotContextOverrides`와 동일한 idiom)
 *
 * @example
 * // bstage i18n이 생성하는 파일에서
 * declare module '@bstage-sdk/core' {
 *   interface TranslationKeyRegistry {
 *     B00001: true
 *     B00005: true
 *   }
 * }
 */
export interface TranslationKeyRegistry {}

/**
 * 플랫폼 번역 키 타입.
 *
 * codegen 전: `string`. codegen으로 `TranslationKeyRegistry`가 보강되면 그 키 union.
 */
export type TranslationKey = keyof TranslationKeyRegistry extends never
  ? string
  : keyof TranslationKeyRegistry & string

/**
 * 번역 사전을 배포하는 phase.
 *
 * `real-canary`는 hostname으로 구분되지 않는다(canary는 요청 헤더로 갈린다) — 추론 대상이 아니고
 * `configureBstageI18n({ phase: 'real-canary' })`로만 지정한다.
 */
export type TranslationPhase = 'dev' | 'qa' | 'real' | 'real-canary' | 'sandbox'

/** 번역 사전 출처 설정. 전부 선택이며, 미설정 시 아래 기본값으로 동작한다. */
export interface BstageI18nConfig {
  /** CDN origin. 기본 `https://cdn.static.bstage.in` (phase와 무관하게 하나다). */
  origin?: string
  /** 배포 phase. 기본은 dev 서버 주입값 → hostname 추론 → `real`. */
  phase?: TranslationPhase
  /** 번역 시스템. 호출부(Provider `target`)가 넘기면 그쪽이 우선한다. */
  system?: LocaleTarget
  /** 번역 tier. 기본 `inhouse`(경로 세그먼트 없음). */
  tier?: string
  /** 커스텀 fetch. 미지정 시 `globalThis.fetch`(공개 CDN이라 인증 fetch를 쓰지 않는다 — `resolveFetch` 참고). */
  fetch?: typeof fetch
  /** 미번역 로케일에서 대신 볼 사전 순서(현재 로케일 뒤). 기본 `['en', 'ko']`. */
  fallbackChain?: LanguageCode[]
}

/** 번역 CDN origin — phase와 무관하게 하나다(phase는 경로 세그먼트). */
const TRANSLATION_ORIGIN = 'https://cdn.static.bstage.in'
/** CDN 내 번역 베이스 키. */
const TRANSLATION_BASE_KEY = 'static/i18n'
/** `latest.json`의 `cdnPath`에 붙어 오는 버킷 프리픽스 — URL 조립 시 제거한다. */
const TRANSLATION_BUCKET_PREFIX = 'cdn.bstage.in/'
/** 기본 tier. 경로에 세그먼트를 만들지 않는다. */
const DEFAULT_TIER = 'inhouse'
/** `latest.json` 캐시 수명 — 어드민 플랫폼(`get-languages.ts`)과 같은 5분. */
const LATEST_TTL_MS = 5 * 60 * 1000

/** 소비자가 넘긴 설정. `configureBstageI18n`으로만 바뀐다. */
let i18nConfig: BstageI18nConfig = {}

/**
 * 번역 사전 출처를 설정한다. 앱 부팅 시 **한 번** 호출하며, 대부분의 소비자는 호출하지 않는다.
 *
 * 임베드 위젯은 기본값(TMS CDN + phase 추론)으로 그대로 동작한다. 이 함수는 phase를 못 맞히는
 * 환경(테스트·standalone), `inhouse`가 아닌 tier, 또는 향후 테넌트 경로를 가리킬 때 쓴다.
 *
 * @example
 * ```ts
 * configureBstageI18n({ tier: 'mnetplus' })
 * ```
 */
export function configureBstageI18n(config: BstageI18nConfig): void {
  i18nConfig = { ...i18nConfig, ...config }
  // 캐시를 비우지 않는다 — 캐시 키가 출처(origin·phase·system·tier)를 포함하므로 설정을 바꾸면
  // 자동으로 다른 항목을 쓴다. 비우는 코드를 넣어봤지만 어떤 테스트로도 관측되지 않았다.
}

/** @internal 테스트 전용 — 설정과 캐시를 초기 상태로 되돌린다. */
export function __resetBstageI18n__(): void {
  i18nConfig = {}
  translationCache.clear()
  latestCache.clear()
}

const PHASES: readonly TranslationPhase[] = ['dev', 'qa', 'real', 'real-canary', 'sandbox']

function normalizePhase(value: unknown): TranslationPhase | undefined {
  return PHASES.find((p) => p === value)
}

/**
 * 현재 phase를 판정한다: config → dev 서버 주입(`__bstage_i18n_phase__`) → hostname → `real`.
 *
 * **빌드 시 심을 수 없다** — 같은 IIFE 번들이 여러 phase에 올라가므로 런타임 판정이어야 한다.
 * hostname 판정은 phase 마커만 본다(스페이스 호스트 표를 복제하지 않는다). phase가 새로 생기면
 * 여기도 함께 늘어난다.
 */
function resolvePhase(): TranslationPhase {
  const fromConfig = normalizePhase(i18nConfig.phase)
  if (fromConfig) return fromConfig

  const injected = normalizePhase(
    (globalThis as { __bstage_i18n_phase__?: string }).__bstage_i18n_phase__,
  )
  if (injected) return injected

  const host = typeof location === 'undefined' ? '' : location.hostname
  if (host.includes('.dev.')) return 'dev'
  if (host.includes('.qa.')) return 'qa'
  if (host.includes('sandstage.in')) return 'sandbox'
  return 'real'
}

/** 사전 출처를 가리키는 좌표. 캐시 키이자 URL 조립 입력. */
interface TranslationSource {
  origin: string
  phase: TranslationPhase
  system: LocaleTarget
  tier: string
}

function resolveSource(system?: LocaleTarget): TranslationSource {
  return {
    origin: i18nConfig.origin ?? TRANSLATION_ORIGIN,
    phase: resolvePhase(),
    system: system ?? i18nConfig.system ?? 'user',
    tier: i18nConfig.tier ?? DEFAULT_TIER,
  }
}

function sourceKey(source: TranslationSource): string {
  return `${source.origin}|${source.phase}|${source.system}|${source.tier}`
}

/**
 * `latest.json` URL. 기본 tier는 세그먼트가 없고, 그 외 tier는 system 뒤에 붙는다.
 * (hub `TranslationService.fetchLatest` · 어드민 플랫폼 `get-languages.ts` · `bstage i18n pull`과 동일 규칙)
 */
function latestUrl(source: TranslationSource): string {
  const segments = [TRANSLATION_BASE_KEY, source.phase, source.system]
  if (source.tier !== DEFAULT_TIER) segments.push(source.tier)
  return `${source.origin}/${segments.join('/')}/latest.json?date=${cacheStamp(new Date())}`
}

/**
 * CDN 캐시를 우회하는 5분 단위 스탬프 (hub `getLegacyStamp` · `bstage i18n pull`과 동일).
 *
 * `latest.json`은 갱신되는 포인터라 CDN 캐시를 그대로 맞으면 새 배포를 못 본다.
 */
function cacheStamp(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}`
  const min = now.getMinutes()
  return `${date}-${pad(min - (min % 5))}`
}

/** `latest.json` 응답 — 실제 번역이 놓인 버전 경로(`cdnPath`)를 가리킨다. */
interface LatestManifest {
  version: string
  cdnPath: string
}

/** 버전 경로 promise 캐시 — 포인터라 TTL을 둔다. */
const latestCache = new Map<string, { at: number; promise: Promise<string> }>()

/** 사전 promise 캐시 — 버전 경로가 immutable이라 TTL 없이 들고 있는다. */
const translationCache = new Map<string, Promise<TranslationDict>>()

/**
 * 번역 fetch를 해석한다: `config.fetch` → `globalThis.fetch`.
 *
 * **`__bstage_fetch__`를 쓰지 않는다.** 번역 CDN은 인증이 필요 없는 공개 호스트이고, 플랫폼이
 * 주입하는 `__bstage_fetch__`는 URL을 가리지 않고 `Authorization`(+ dev/qa는 CF Access) 헤더를
 * 붙인다. 그러면 크로스 오리진 요청이 CORS **preflight** 대상이 되는데 이 CDN은 `OPTIONS`에
 * 403을 준다 → 브라우저가 요청을 막아 사전이 안 온다. 인증 토큰을 다른 오리진으로 보낼 이유도 없다.
 *
 * (`BstageClient`는 게이트웨이를 호출하므로 그쪽은 계속 `__bstage_fetch__`를 쓴다.)
 */
function resolveFetch(): typeof fetch | undefined {
  const fn = i18nConfig.fetch ?? globalThis.fetch
  return typeof fn === 'function' ? fn : undefined
}

/**
 * 오프라인 폴백용 Cache Storage 이름.
 *
 * **번들에 들어가지 않는다** — 사용자 브라우저에 마지막으로 성공한 응답을 남겨, CDN 장애 시
 * 코드(`B00004`) 대신 문구가 렌더되게 한다. localStorage를 쓰지 않는 이유는 ① 5MB 상한을
 * **플랫폼 앱과 공유**해서 우리가 수백 KB를 차지하면 플랫폼 쓰기를 밀어낼 수 있고 ② 동기 API라
 * 큰 문자열 쓰기가 메인 스레드를 멈추기 때문이다. Cache Storage는 오리진 전체 예산을 쓰고 비동기다.
 */
const TRANSLATION_CACHE_NAME = 'bstage-i18n-v1'

/** Cache Storage 핸들. 없는 환경(비보안 컨텍스트 등)에서는 `undefined` — 폴백 없이 동작한다. */
async function openTranslationCache(): Promise<Cache | undefined> {
  try {
    if (typeof caches === 'undefined') return undefined
    return await caches.open(TRANSLATION_CACHE_NAME)
  } catch {
    return undefined
  }
}

/**
 * 네트워크 우선 → 실패 시 캐시. 성공하면 캐시를 갱신한다(stale-while-error).
 *
 * `cacheKey`를 따로 받는 이유: `latest.json`은 캐시 우회 스탬프(`?date=`)가 5분마다 바뀌므로
 * 쿼리를 뗀 안정된 키로 저장해야 장애 때 찾을 수 있다.
 */
async function fetchJsonWithCache<T>(
  url: string,
  cacheKey: string,
  fetchFn: typeof fetch,
  label: string,
): Promise<T> {
  const cache = await openTranslationCache()
  try {
    const res = await fetchFn(url)
    if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`)
    if (cache) {
      // 응답 본문은 한 번만 읽을 수 있으므로 복제해 저장한다. 저장 실패는 폴백 부재일 뿐이라 무시.
      await cache.put(cacheKey, res.clone()).catch(() => {})
    }
    return (await res.json()) as T
  } catch (err) {
    const hit = await cache?.match(cacheKey).catch(() => undefined)
    if (hit) return (await hit.json()) as T
    throw err
  }
}

/**
 * 같은 출처의 옛 버전 사전을 캐시에서 지운다.
 *
 * 버전 경로가 배포마다 바뀌므로 정리하지 않으면 배포 횟수 × 로케일 수만큼 쌓인다.
 * `latest.json` 항목은 남긴다(그게 장애 때 버전 경로를 알려주는 유일한 단서다).
 */
async function pruneOldVersions(source: TranslationSource, keepBase: string): Promise<void> {
  const cache = await openTranslationCache()
  if (!cache) return
  const prefix = `${source.origin}/${TRANSLATION_BASE_KEY}/${source.phase}/${source.system}/`
  try {
    const keys = await cache.keys()
    await Promise.all(
      keys.map(async (req) => {
        if (!req.url.startsWith(prefix)) return
        if (req.url.endsWith('latest.json')) return
        if (req.url.startsWith(keepBase)) return
        await cache.delete(req).catch(() => {})
      }),
    )
  } catch {
    // 정리는 실패해도 기능에 영향이 없다.
  }
}

/**
 * 사전이 실제로 놓인 버전 경로 base를 얻는다(`latest.json` → `cdnPath`).
 *
 * 결과는 5분간 캐시한다. 실패 시 캐시를 비워 재시도를 허용한다.
 */
function fetchVersionBase(source: TranslationSource, fetchFn: typeof fetch): Promise<string> {
  const key = sourceKey(source)
  const cached = latestCache.get(key)
  if (cached && Date.now() - cached.at < LATEST_TTL_MS) return cached.promise

  const url = latestUrl(source)
  const promise = fetchJsonWithCache<LatestManifest>(
    url,
    url.split('?')[0],
    fetchFn,
    `i18n latest ${source.phase}/${source.system}`,
  )
    .then((latest) => {
      if (!latest?.cdnPath) throw new Error('i18n latest: cdnPath 없음')
      const base = `${source.origin}/${latest.cdnPath.replace(TRANSLATION_BUCKET_PREFIX, '')}`
      void pruneOldVersions(source, base)
      return base
    })
    .catch((err: unknown) => {
      latestCache.delete(key)
      throw err
    })

  latestCache.set(key, { at: Date.now(), promise })
  return promise
}

/**
 * 주어진 로케일의 플랫폼 번역 사전을 TMS가 배포한 CDN에서 가져온다.
 *
 * `latest.json`(포인터, 5분 캐시) → 버전 경로 → `{lang}/translation.json`(영구 캐시) 순으로 받는다.
 * 출처는 **플랫폼 앱이 런타임에 무엇을 읽는지와 독립**이다(`configureBstageI18n` 참고) — TMS가
 * 테넌트를 지원하면 갈라지므로 플랫폼 경로에 묶지 않는다.
 *
 * fetch는 `config.fetch` → `globalThis.fetch` 순으로 해석한다(공개 CDN이라 인증 fetch를 쓰지 않는다).
 * 실패 시 캐시를 비워 재시도를 허용한다.
 *
 * @param locale 받아올 로케일
 * @param system 번역 시스템(`user`\|`admin`). React에서는 `BstageLocaleProvider`의 `target`이 넘긴다.
 */
export function fetchTranslations(
  locale: LanguageCode,
  system?: LocaleTarget,
): Promise<TranslationDict> {
  const source = resolveSource(system)
  const key = `${sourceKey(source)}|${locale}`

  const cached = translationCache.get(key)
  if (cached) return cached

  const fetchFn = resolveFetch()
  if (!fetchFn) return Promise.reject(new Error('fetch unavailable'))

  const promise = fetchVersionBase(source, fetchFn)
    .then((base) => {
      const url = `${base}/${locale}/translation.json`
      return fetchJsonWithCache<TranslationDict>(url, url, fetchFn, `translations ${locale}`)
    })
    .catch((err: unknown) => {
      translationCache.delete(key)
      throw err
    })

  translationCache.set(key, promise)
  return promise
}

/**
 * 미번역 로케일에서 대신 볼 사전 순서 (현재 로케일 뒤에 붙는다).
 *
 * 사전에는 **키는 있고 값만 빈 문자열**인 항목이 있다(미번역). 어드민 사전은 일부 로케일이
 * 대부분 그 상태다. 그래서 "키가 없을 때"만 폴백하면 이 항목들은 영원히 빈칸으로 렌더된다.
 */
const DEFAULT_FALLBACK_CHAIN: readonly LanguageCode[] = ['en', 'ko']

/**
 * 현재 로케일부터 시작하는 조회 순서를 만든다. 중복은 제거한다.
 *
 * @example
 * resolveTranslationChain('zh-CN') // ['zh-CN', 'en', 'ko']
 * resolveTranslationChain('en')    // ['en', 'ko']
 */
export function resolveTranslationChain(current: LanguageCode): LanguageCode[] {
  const tail = i18nConfig.fallbackChain ?? DEFAULT_FALLBACK_CHAIN
  return [current, ...tail].filter((locale, i, all) => all.indexOf(locale) === i)
}

/**
 * 사전 목록에서 값을 고른다. **빈 문자열·공백은 "미번역"으로 보고 다음 사전으로 넘긴다.**
 *
 * 없으면 `undefined` — 호출자가 키 문자열을 그대로 쓸지 결정한다.
 */
export function pickTranslation(
  dicts: readonly TranslationDict[],
  key: string,
): string | undefined {
  for (const dict of dicts) {
    const value = dict[key]
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return undefined
}

/**
 * 리치텍스트 조각.
 *
 * - `text`: 그대로 렌더할 문자열
 * - `tag`: 소비자가 넘긴 엘리먼트로 감싸 렌더할 조각(`index`가 `<0>`의 0)
 */
export type RichTextToken =
  | { type: 'text'; value: string }
  | { type: 'tag'; index: number; value: string }

/**
 * `<N>…</N>` **쌍만** 매칭한다.
 *
 * 사전 본문에는 리터럴 꺾쇠가 있다 — `‘MY > 고객센터’`처럼 꺾쇠 개수가 맞지 않는 문구가 있어서,
 * `<`/`>`를 마크업으로 보는 파서는 그 문구를 깨뜨린다.
 */
const RICH_TAG_RE = /<(\d+)>([\s\S]*?)<\/\1>/g

/**
 * 플랫폼 번역 문자열을 리치텍스트 조각으로 나눈다. `{{token}}` 보간도 함께 처리한다.
 *
 * 사전에 **중첩과 짝이 안 맞는 태그가 없어** 평면 구조로 둔다 — 중첩을 미리 지원하면 검증할
 * 데이터가 없는 분기가 생긴다. 한 문구에 인덱스가 둘 이상 나오는 경우는 있다.
 *
 * **보간은 조각을 나눈 뒤에 한다.** 먼저 보간하면 파라미터 값에 들어 있는 `<0>`이 태그로 해석돼,
 * 소비자가 넘긴 값이 마크업이 되어 버린다.
 *
 * @example
 * parseRichText('<0>{{str}}</0>님, 안녕하세요', { str: '쇼' })
 * // [{ type: 'tag', index: 0, value: '쇼' }, { type: 'text', value: '님, 안녕하세요' }]
 */
export function parseRichText(template: string, params?: TranslateParams): RichTextToken[] {
  const tokens: RichTextToken[] = []
  let cursor = 0

  // `matchAll`을 쓴다 — 공유 정규식의 `lastIndex`를 건드리지 않아 호출 간 상태가 새지 않는다.
  // (`exec` 루프 + 중간 `break` 조합이면 다음 호출이 중간부터 매칭되는 버그가 생긴다.)
  for (const match of template.matchAll(RICH_TAG_RE)) {
    const at = match.index ?? 0
    if (at > cursor) {
      tokens.push({
        type: 'text',
        value: interpolateTranslation(template.slice(cursor, at), params),
      })
    }
    tokens.push({
      type: 'tag',
      index: Number(match[1]),
      value: interpolateTranslation(match[2], params),
    })
    cursor = at + match[0].length
  }

  if (cursor < template.length) {
    tokens.push({ type: 'text', value: interpolateTranslation(template.slice(cursor), params) })
  }
  return tokens
}

/**
 * 플랫폼 번역 문자열의 `{{token}}` 보간. 대응 파라미터가 없으면 토큰을 그대로 둔다.
 *
 * 플랫폼 사전은 i18next 표준 문법(`{{str}}`·`{{str1}}`)을 쓴다. `교환 #{{str}}`처럼 토큰 앞에
 * `#`이 붙는 항목이 있는데 그 `#`은 **주문번호 앞에 찍히는 리터럴**이므로 치환에서 건드리지 않는다
 * (`교환 #{{str}}` + `{ str: '123' }` → `교환 #123`).
 *
 * 로컬 메시지(`useMessages`)도 같은 `{{token}}` 문법을 쓴다 — 지금은 react 쪽에 같은 로직이
 * 따로 있다(원래 두 형식이 달라 분리했던 것). 한쪽만 고치면 다시 어긋나므로 함께 본다.
 */
export function interpolateTranslation(template: string, params?: TranslateParams): string {
  if (!params) return template
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const value = params[key]
    return value === undefined ? `{{${key}}}` : String(value)
  })
}
