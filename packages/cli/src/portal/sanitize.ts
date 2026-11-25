/**
 * 터미널 주입 방지용 문자열 정리 — 포털(서버)이 준 문자열은 어떤 경로로든 터미널에 찍히기 전에 여기를 지난다.
 * client.ts 가 응답 JSON 을 통째로 `deepClean` 하고, 확인 프롬프트·표·오류 출력도 각자 다시 정리한다(이중 방어).
 * output.ts ↔ client.ts 순환 import 를 피하려고 따로 둔다 — 이 모듈은 아무것도 import 하지 않는다.
 */

// 보이지 않는 문자 — 제어 문자(Cc: C0·DEL·C1), 서식 문자(Cf: 양방향 재배열·폭 없는 문자·태그 문자 등), 사용자 영역(Co),
// 짝 없는 대리 문자(Cs), 줄·문단 구분자(Zl·Zp), 변이 선택자, 소프트 하이픈·몽골어 모음 구분자.
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Zl}\p{Zp}\p{Variation_Selector}\u00ad\u180e]/gu
const INVISIBLE_KEEP_LF =
  /(?!\n)[\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Zl}\p{Zp}\p{Variation_Selector}\u00ad\u180e]/gu
// 터미널 이스케이프 시퀀스 — CSI(ESC [ · C1 0x9b), OSC(ESC ] · 0x9d, BEL/ST 로 끝남), DCS·SOS·PM·APC(ESC P/X/^/_ · ST 로 끝남),
// 그 밖의 ESC + 한 글자. 시퀀스째 지운다 — ESC 만 지우면 `[2J` 같은 찌꺼기가 남는다.
const ESCAPE_SEQ =
  // eslint-disable-next-line no-control-regex
  /(?:\x1b\[|\x9b)[0-?]*[ -/]*[@-~]?|(?:\x1b\]|\x9d)[^\x07\x1b\x9c\n]*(?:\x07|\x1b\\|\x9c)?|(?:\x1b[PX^_]|[\x90\x98\x9e\x9f])[^\x1b\x9c\n]*(?:\x1b\\|\x9c)?|\x1b[@-_]?/g

/**
 * 서버(또는 남)가 준 문자열을 터미널에 찍기 전에 보이지 않는 문자를 지운다. ESC·CR 로 앞줄을 덮어쓰거나 글자 순서를
 * 뒤집어 진짜 오류 항목을 숨기거나 깨끗한 결과를 꾸미지 못하게 한다. 목록을 손으로 늘리는 대신 유니코드 속성으로 막는다.
 * 탭은 먼저 공백으로 바꾼다. (doctor 의 포털 진단 절이 쓰던 것 — 시퀀스는 지우지 않고 글자만 지운다.)
 */
export function stripInvisible(s: string | undefined): string {
  return (s ?? '').replace(/\t/g, ' ').replace(INVISIBLE, '')
}

/** 값 하나를 출력용으로 — 이스케이프 시퀀스째 지우고 보이지 않는 문자를 지운 뒤 max 글자에서 자른다. */
export function cleanText(s: unknown, max = 200): string {
  const t = stripInvisible(String(s ?? '').replace(ESCAPE_SEQ, ''))
  const chars = Array.from(t)
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : t
}

/**
 * 에러 메시지에 토큰이 섞여 나가지 않게 bsc_ 토큰 모양은 가린다. 여러 줄 안내는 줄바꿈만 남기고
 * 이스케이프 시퀀스·보이지 않는 문자를 지운다(서버 문구가 그대로 실릴 수 있다).
 */
export function scrub(message: string): string {
  return message
    .replace(ESCAPE_SEQ, '')
    .replace(/\t/g, ' ')
    .replace(INVISIBLE_KEEP_LF, '')
    .replace(/bsc_[0-9a-f]{6,}/g, 'bsc_****')
}

/**
 * 여러 줄 출력용 — 줄바꿈(LF)만 남기고 이스케이프 시퀀스째·보이지 않는 문자(CR 포함)를 지운다. 탭은 공백으로.
 * 자르지 않는다(빌드 로그·확인 문구처럼 길이가 의미 있는 값).
 */
export function cleanLines(s: unknown): string {
  return String(s ?? '')
    .replace(ESCAPE_SEQ, '')
    .replace(/\t/g, ' ')
    .replace(INVISIBLE_KEEP_LF, '')
}

/** 경계 정리에서 지운 자리에 남기는 표시 — 보이는 글자라 숨겨지지 않고, 식별자는 다른 값이 되지 않아 검증에 걸린다. */
export const REPLACEMENT = '\uFFFD'

/**
 * 응답 값 하나를 무해하게 — 이스케이프 시퀀스는 시퀀스째, 보이지 않는 문자(CR·탭 포함)는 글자마다 U+FFFD 로 바꾼다.
 * 지우지 않고 바꾸는 까닭: `b1\r\x1b[2K` 를 지우면 멀쩡한 `b1` 이 되어 다른 빌드·경로를 가리킬 수 있다.
 * 줄바꿈(LF)만 남긴다(여러 줄 안내 문구). 자르지 않는다.
 */
export function neutralize(s: string): string {
  return s.replace(ESCAPE_SEQ, REPLACEMENT).replace(INVISIBLE_KEEP_LF, REPLACEMENT)
}

/**
 * 파싱한 JSON 응답의 모든 문자열(객체 키 포함)을 `neutralize` 한 사본. 숫자·불리언·null 은 그대로.
 * `opaqueKeys` 의 값은 건드리지 않는다 — 서명 URL·서명 헤더처럼 출력하지 않고 바이트 그대로 써야 하는 값이다
 * (바뀌면 서명이 깨진다). 그 값들은 쓰는 곳(blobTransfer 의 assertBlobUrl)에서 따로 검증한다.
 */
export function deepClean<T>(v: T, opaqueKeys: ReadonlySet<string> = new Set()): T {
  return walk(v, opaqueKeys, 0) as T
}

/**
 * 응답 중첩 상한(AWS Security Agent 24차 L) — 포털 응답은 몇 단계뿐이다. 깊게 중첩된 본문으로 재귀가 스택을 넘겨
 * RangeError 로 죽지 않게, 상한을 넘으면 이 오류를 던지고 호출자가 PortalError 로 바꾼다.
 */
export const MAX_RESPONSE_DEPTH = 64
export class ResponseTooDeepError extends Error {
  constructor() {
    super(`응답 중첩이 ${MAX_RESPONSE_DEPTH}단계를 넘습니다`)
    this.name = 'ResponseTooDeepError'
  }
}

const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype'])

function walk(v: unknown, opaque: ReadonlySet<string>, depth: number): unknown {
  if (depth > MAX_RESPONSE_DEPTH) throw new ResponseTooDeepError()
  if (typeof v === 'string') return neutralize(v)
  if (Array.isArray(v)) return v.map((x) => walk(x, opaque, depth + 1))
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      const key = neutralize(k)
      // AWS Security Agent 22차 M — `__proto__`·`constructor`·`prototype` 키는 버린다. 대입하면 `__proto__` 세터가 사본의
      // 프로토타입을 서버 값으로 바꿔, 검증하지 않은 필드(예: repo.source)가 상속으로 보이게 된다. 포털 응답에 이런 키는 없다.
      if (FORBIDDEN_KEYS.has(key)) continue
      out[key] = opaque.has(k) ? x : walk(x, opaque, depth + 1)
    }
    return out
  }
  return v
}

/**
 * 오류 문구에 넣을 이름 목록 — 각 이름을 cleanText 로 한 줄·짧게 만들고 최대 max 개만 쓴다(나머지는 "외 N개").
 * fail() 의 scrub 은 여러 줄 안내를 위해 줄바꿈을 남기므로, 포털 값(배치 이름)은 여기서 먼저 한 줄로 만든다(AWS Security Agent 21차 L).
 */
export function labelList(items: ReadonlyArray<{ label: unknown }>, max = 10): string {
  const shown = items.slice(0, max).map((r) => cleanText(r.label, 80))
  const rest = items.length - shown.length
  return shown.join(', ') + (rest > 0 ? ` 외 ${rest}개` : '')
}
