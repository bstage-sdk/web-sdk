/**
 * 번들이 등록한 Custom Element 태그명을 스크립트 URL별로 남기는 전역 통로.
 *
 * manifest.json을 없애면서 필요해졌다. 호스트는 관리도구에서 `templateUrl` 하나만 받는데,
 * 마운트하려면 `document.createElement(태그명)`을 해야 해서 그 번들이 무슨 태그를 등록했는지
 * 알아야 한다. 예전에는 manifest.json이 그 값을 날랐다.
 *
 * `document.currentScript`는 스크립트가 **동기 실행되는 동안에만** 자기 `<script>`를 가리킨다.
 * 템플릿 등록은 IIFE 최상위에서 일어나므로 이 시점에는 유효하다.
 *
 * 전역에 두는 이유: 호스트와 템플릿 번들은 서로 다른 모듈 그래프라 import를 공유하지 않는다.
 * 번들은 자기 안에 core 사본을 들고 있고 호스트도 따로 들고 있으므로, 모듈 스코프 변수로는
 * 서로를 볼 수 없다.
 *
 * URL을 키로 쓰는 이유: 여러 템플릿이 동시에 로드될 때(`loadTemplatesBySlots`가 그렇게 한다)
 * "로드 전후로 늘어난 항목"을 세는 방식은 서로 섞여 어긋난다.
 */

const GLOBAL_KEY = '__bstage_elements__'

interface RegistryHolder {
  [GLOBAL_KEY]?: Record<string, string>
}

function registry(): Record<string, string> {
  const holder = globalThis as RegistryHolder
  return (holder[GLOBAL_KEY] ??= {})
}

/**
 * 지금 실행 중인 번들이 등록한 태그명을 남긴다.
 *
 * `document.currentScript`가 없으면(모듈 스크립트, 테스트, SSR) 조용히 넘어간다 —
 * 그런 환경은 호스트 로더를 거치지 않아 조회할 일도 없다.
 *
 * @internal 등록 함수(`registerTemplate`) 전용. public API 아님.
 */
export function announceElementName(tagName: string): void {
  if (typeof document === 'undefined') return
  const src = (document.currentScript as HTMLScriptElement | null)?.src
  if (!src) return

  const map = registry()
  // 한 번들이 여러 템플릿을 등록하면 먼저 등록된 쪽을 대표로 둔다 —
  // manifest.json도 elementName을 하나만 담았으므로 계약이 달라지지 않는다.
  if (!(src in map)) map[src] = tagName
}

/**
 * 로드한 번들이 등록한 태그명을 찾는다.
 *
 * @internal 호스트 로더(`loadTemplate`) 전용. public API 아님.
 */
export function lookupElementName(url: string): string | undefined {
  const map = registry()
  if (url in map) return map[url]

  // 호출자는 상대 경로를 넘길 수 있지만 `script.src`는 항상 절대 URL로 읽힌다.
  try {
    const absolute = new URL(url, typeof document !== 'undefined' ? document.baseURI : undefined)
      .href
    return map[absolute]
  } catch {
    return undefined
  }
}

/**
 * 등록 기록을 비운다.
 *
 * @internal 테스트 전용. public API 아님.
 */
export function __resetElementRegistry__(): void {
  ;(globalThis as RegistryHolder)[GLOBAL_KEY] = {}
}
