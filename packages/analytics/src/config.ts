/**
 * | 코드 | 조건 |
 * | --- | --- |
 * | `E_KEY_MISSING` | `init({ key })`가 없다 |
 * | `E_ENDPOINT_MISSING` | `init({ endpoint })`가 없다 |
 * | `E_ENDPOINT_EMPTY` | endpoint가 빈 값이다 |
 * | `E_ENDPOINT_ILLEGAL_CHAR` | 제어문자 또는 역슬래시가 있다 |
 * | `E_ENDPOINT_QUERY_OR_FRAGMENT` | 쿼리 또는 프래그먼트가 들어 있다 |
 * | `E_ENDPOINT_UNPARSABLE` | URL로 해석할 수 없다 |
 * | `E_ENDPOINT_SCHEME` | http(s)가 아닌 스킴이다 |
 * | `E_ENDPOINT_USERINFO` | userinfo(사용자·비밀번호)가 들어 있다 |
 * | `E_ENDPOINT_CROSS_ORIGIN` | 상대 경로가 다른 오리진으로 해석된다 |
 * | `E_PATH_ILLEGAL_CHAR` | path에 제어문자 또는 역슬래시가 있다 |
 * | `E_PATH_QUERY_OR_FRAGMENT` | path에 쿼리 또는 프래그먼트가 들어 있다 |
 * | `E_PATH_NOT_ABSOLUTE` | 빈 값이 아닌 path가 `/`로 시작하지 않는다 |
 * | `E_PATH_ENCODED` | path에 인코딩된 구분자·퍼센트(`%2F`·`%5C`·`%25`)가 있다 |
 * | `E_PATH_DOT_SEGMENT` | path에 `.`·`..` 세그먼트(퍼센트 인코딩 포함)가 있다 |
 *
 * @module
 */
import type { InitConfig } from './types.js'

export const LOG_PATH = '/api/v2/logs/analytics'
const HALTED = '; analytics did not start'

export function checkConfig(config: Partial<InitConfig>, base = pageBase()): string | null {
  if (!config.key) return `E_KEY_MISSING: init({ key }) is missing${HALTED}`
  if (!config.endpoint) return `E_ENDPOINT_MISSING: init({ endpoint }) is missing${HALTED}`
  const issue =
    endpointIssue(config.endpoint, base) ??
    (config.path === undefined ? null : pathIssue(config.path))
  return issue && `${issue}${HALTED}`
}

function pathIssue(path: string): string | null {
  if (path === '') return null
  if (path.includes('\\') || [...path].some(isControl)) {
    return 'E_PATH_ILLEGAL_CHAR: path contains a control character or a backslash'
  }
  if (/[?#]/.test(path)) return 'E_PATH_QUERY_OR_FRAGMENT: path contains a query or a fragment'
  if (!path.startsWith('/')) return 'E_PATH_NOT_ABSOLUTE: path does not start with "/"'
  // `new URL()`은 `%2f`·`%5c`를 풀지 않지만 경로를 디코딩하는 서버에서는 구분자가 되고,
  // `%25`는 이중 인코딩으로 아래 점 세그먼트 검사를 지난다
  if (/%(2f|5c|25)/i.test(path)) {
    return 'E_PATH_ENCODED: path contains an encoded separator or percent (%2F, %5C, %25)'
  }
  // URL 파서가 `%2e`도 점으로 보고 정규화한다 — 놓치면 endpoint 접두사를 벗어난다
  const dots = path.split('/').map((seg) => seg.toLowerCase().replace(/%2e/g, '.'))
  if (dots.some((seg) => seg === '.' || seg === '..')) {
    return 'E_PATH_DOT_SEGMENT: path contains a "." or ".." segment'
  }
  return null
}

function endpointIssue(endpoint: string, base: string): string | null {
  if (endpoint.trim() === '') return 'E_ENDPOINT_EMPTY: endpoint is empty'
  if (endpoint.includes('\\') || [...endpoint].some(isControl)) {
    return 'E_ENDPOINT_ILLEGAL_CHAR: endpoint contains a control character or a backslash'
  }
  if (/[?#]/.test(endpoint)) {
    return 'E_ENDPOINT_QUERY_OR_FRAGMENT: endpoint contains a query or a fragment'
  }

  let url: URL
  try {
    url = new URL(endpoint, base)
  } catch {
    return 'E_ENDPOINT_UNPARSABLE: endpoint cannot be parsed as a URL'
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return `E_ENDPOINT_SCHEME: endpoint scheme is not allowed: ${url.protocol}`
  }
  if (url.username || url.password) {
    return 'E_ENDPOINT_USERINFO: endpoint contains userinfo (username or password)'
  }

  // 스킴이 없는 값은 페이지와 같은 오리진이어야 한다 — `//host`는 상대 경로처럼 보이지만
  // 외부 오리진이 된다. 다른 오리진으로 보내려면 스킴을 직접 적어 의도를 드러낸다.
  if (!/^https?:\/\//i.test(endpoint) && url.origin !== new URL(base).origin) {
    return 'E_ENDPOINT_CROSS_ORIGIN: relative endpoint resolves to a different origin'
  }
  return null
}

export function logUrl(endpoint: string, base = pageBase(), path = LOG_PATH): string {
  const url = new URL(endpoint, base)
  url.pathname = `${url.pathname.replace(/\/+$/, '')}${path}`
  url.search = ''
  url.hash = ''
  return url.href
}

function isControl(ch: string): boolean {
  return ch < ' ' || ch === '\u007F'
}

/** 상대 경로 해석 기준. 문서가 없는 환경(테스트)에서는 호출부가 `base`를 넘긴다 */
function pageBase(): string {
  return typeof location === 'undefined' ? 'https://localhost' : location.href
}
