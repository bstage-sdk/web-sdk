/** 디코딩 최대 횟수. 이 안에 고정점에 닿지 않으면(과도한 다중 인코딩) 거절한다. */
export const MAX_DECODE_PASSES = 3

export interface PathCheckOptions {
  /** `//`가 경로 어디에든(어느 단계에서든) 있으면 거절 — navigate용(라우터가 프로토콜 상대 URL로 읽는다). */
  readonly forbidDoubleSlash?: boolean
}

export interface PathCheck {
  readonly ok: boolean
  /** 원문과 디코딩 각 단계(ok일 때만 의미). 마지막 항목이 고정점. */
  readonly forms: readonly string[]
}

const REJECT: PathCheck = Object.freeze({ ok: false, forms: Object.freeze([]) })

/**
 * 원문 pathname을 `decodeURIComponent`로 최대 3회 고정점까지 푼 단계 목록. 디코딩이 실패하거나
 * (overlong·잘못된 UTF-8 — `%c0%af`·`%e0%80%af` — 또는 `100%`처럼 다시 풀 수 없는 `%`) 3회 안에
 * 고정점에 닿지 않으면 undefined.
 */
function decodeStages(pathname: string): readonly string[] | undefined {
  const forms = [pathname]
  let current = pathname
  for (let pass = 0; pass <= MAX_DECODE_PASSES; pass += 1) {
    let next: string
    try {
      next = decodeURIComponent(current)
    } catch {
      return undefined
    }
    if (next === current) return forms
    if (pass === MAX_DECODE_PASSES) return undefined
    forms.push(next)
    current = next
  }
  return undefined
}

// eslint-disable-next-line no-control-regex -- 제어문자(NUL 포함)를 거르는 것이 목적이다
const UNSAFE_CHARS_RE = /[\\;\u0000-\u001f\u007f]/

function hasDotSegment(form: string): boolean {
  return form.split('/').some((segment) => segment === '.' || segment === '..')
}

/**
 * 같은 origin 경로(게이트웨이 fetch·navigate 공용)의 구조 검사.
 *
 * 차단 목록 정규식을 늘리는 대신, 앞단(프록시·게이트웨이·라우터)이 몇 번을 더 디코딩하든 그 결과가 될 수
 * 있는 **모든 단계**(원문 + `decodeURIComponent` 고정점까지)를 만들어 각각에 같은 규칙을 적용한다.
 * - 디코딩 실패(overlong·잘못된 UTF-8)·3회 안에 고정점 미도달 → 거절
 * - 역슬래시·`;`·NUL/제어문자 → 거절
 * - 점 세그먼트(`/../`·`/./`·끝의 `/..`·`/.`) → 거절
 * - `forbidDoubleSlash`면 `//` → 거절
 *
 * 세그먼트 안의 정상 인코딩 값(`/gw/x/a%2Fb`)은 풀어도 점 세그먼트가 생기지 않으므로 통과한다.
 */
export function checkPath(pathname: string, options: PathCheckOptions = {}): PathCheck {
  const forms = decodeStages(pathname)
  if (!forms) return REJECT
  const bad = forms.some(
    (form) =>
      UNSAFE_CHARS_RE.test(form) ||
      hasDotSegment(form) ||
      (options.forbidDoubleSlash === true && form.includes('//')),
  )
  return bad ? REJECT : { ok: true, forms: Object.freeze(forms) }
}
