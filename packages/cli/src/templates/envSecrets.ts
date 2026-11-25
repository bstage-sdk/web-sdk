/**
 * `bstage push`(내장 저장소로 올리기)가 `.env.{mode}` 류 파일에서 "시크릿 이름 키 = 실제 값"을 찾는 규칙.
 *
 * pre-commit 가드(`checkSecretsScript.ts`, GitHub 흐름의 기존 커밋 훅)는 이 모듈을 쓰지 않고 그대로 둔다 —
 * 가드 동작은 바꾸지 않는다. 키 조각·힌트 표는 가드의 것과 같은 값에서 출발하지만, push 는 그 위에 더 엄격한
 * 규칙을 더 적용한다(상위 집합): 값 검사 대상 이름이 넓고(`env.production`·`foo.env` 등, push.ts
 * `isEnvValueScanTarget`), 로컬 비밀 파일(`id_rsa*`·`*.pem`·`.npmrc` 등)은 올리지 않으며, 서버도 다시 검사한다.
 */

/** 플레이스홀더로 보는 힌트 낱말(토큰 자체에 들어 있을 때만). */
export const PLACEHOLDER_HINTS: readonly string[] = [
  'YOUR',
  'EXAMPLE',
  'PLACEHOLDER',
  'XXXX',
  'CHANGEME',
]

/** `.env.{mode}` 에서 값이 들어 있으면 안 되는 키 이름 조각. APP_KEY 는 브라우저에 노출되는 값이라 제외한다. */
export const ENV_SECRET_KEY_WORDS: readonly string[] = [
  'SECRET',
  'TOKEN',
  'PASSWORD',
  'PASSWD',
  'PRIVATE_KEY',
]

/**
 * push 전용 확장 키 이름 조각(AWS Security Agent 5차 M1). 가드의 `ENV_SECRET_KEY_WORDS` 위에 더한다 —
 * 가드(GitHub 흐름의 기존 훅)는 바꾸지 않는다. 부분 문자열로 본다(대소문자 무관).
 * `APP_KEY` 는 브라우저에 노출되는 값이라 계속 제외한다.
 */
export const PUSH_ENV_SECRET_KEY_WORDS: readonly string[] = [
  ...ENV_SECRET_KEY_WORDS,
  'KEY',
  'CREDENTIAL',
  'CONNECTION_STRING',
  'CONN_STRING',
  'CONNSTR',
  'SIGNING',
  'SESSION',
  'COOKIE',
  'WEBHOOK',
  'CLIENT_SECRET',
  'ACCESS_KEY_ID',
]

/**
 * 짧아서 부분 문자열로 보면 오탐이 큰 조각 — `_`·`-`·`.` 로 나뉜 낱말이 같을 때만(`AUTHOR`·`SASS`·`PASSTHROUGH` 는 아니다).
 * AWS Security Agent 6차 L — 비밀번호 줄임말(`DB_PASS`·`SMTP_PW`·`ADMIN_PWD`)과 `SALT`·`PASSPHRASE`.
 */
const PUSH_ENV_SECRET_KEY_TOKENS: readonly string[] = [
  'AUTH',
  'DSN',
  'CERT',
  'SAS',
  'PASS',
  'PW',
  'PWD',
  'SALT',
  'PASSPHRASE',
]

/** 정확히 이 키(접두사 `VITE_`·`VITE_BSTAGE_` 만 허용)만 비밀 이름 검사에서 뺀다 — 브라우저에 노출되는 앱 키. 부분 일치 아님. */
const PUSH_KEY_EXACT_EXCLUDES = /^(?:VITE_BSTAGE_|VITE_)?APP_KEY$/

/**
 * 값 모양이 알려진 자격 증명 형식이면 이름과 무관하게 비밀로 본다. `.test` 로만 쓰므로 끝이 열린 반복(`{8,}`)은 최소 길이
 * (`{8}`)와 같다 — 고정 길이로 써서 되짚기가 생기지 않게 한다(AWS Security Agent PR #454 ReDoS). JWT 모양은 `.` 뒤를 다시
 * 보는 되짚기가 커서(`eyJeyJ…` 에 제곱 시간) 정규식 대신 jwtShaped 로 본다.
 */
const CREDENTIAL_VALUE_PATTERNS: readonly RegExp[] = [
  /(?:^|[^A-Z0-9])(?:AKIA|ASIA)[0-9A-Z]{16}(?![A-Z0-9])/,
  /-----BEGIN/,
  /(?:^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{8}/,
  /(?:^|[^A-Za-z0-9])(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{8}/,
  /(?:^|[^A-Za-z0-9])gh[pousr]_[A-Za-z0-9]{16}/,
  /(?:^|[^A-Za-z0-9])xox[bapors]-[A-Za-z0-9-]{8}/,
]

const JWT_SEGMENT = /^[A-Za-z0-9_-]*$/

function isJwtChar(c: number): boolean {
  return (
    (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 45 || c === 95
  )
}

/**
 * `eyJ…{5자 이상}.eyJ…{5자 이상}.` 이 어딘가에 있는가 — 옛 정규식 `/eyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}\./` 와
 * 같은 답을 `.` 으로 나눈 조각을 한 번씩만 훑어 낸다(선형 시간).
 */
function jwtShaped(value: string): boolean {
  if (!value.includes('eyJ')) return false
  const segs = value.split('.')
  // 조각 i 의 끝에 붙은 허용 글자 꼬리 안에 `eyJ`+5자 이상이 있고, 조각 i+1 이 통째로 `eyJ`+5자 이상이며, 그 뒤에 `.` 이 있다.
  for (let i = 0; i + 2 < segs.length; i++) {
    const next = segs[i + 1]!
    if (next.length < 8 || !next.startsWith('eyJ') || !JWT_SEGMENT.test(next)) continue
    const seg = segs[i]!
    let start = seg.length
    while (start > 0 && isJwtChar(seg.charCodeAt(start - 1))) start--
    const at = seg.indexOf('eyJ', start)
    if (at >= 0 && seg.length - at >= 8) return true
  }
  return false
}

/** `scheme://user:pass@host` — 비밀번호 자리가 실제 값일 때만. */
// 값 어디에 있어도 잡는다(따옴표·뒤 주석·접두가 남아도) — 길이를 모두 묶어 위치마다 비용이 상수라 전체가 선형이다.
// postgres·mysql·mongodb+srv·redis·amqp·smtp 등 `scheme://` 로 시작하는 DSN 이 모두 이 모양이다.
const URL_CREDENTIALS = /[a-z][a-z0-9+.-]{0,30}:\/\/[^\s/@:]{1,256}:([^\s/@]{1,256})@/i
/** 연결 문자열의 `Password=…`·`Pwd=…`(`Server=x;User Id=a;Password=b;`). 값은 `;`·공백·따옴표 앞에서 끝난다. */
const DSN_PASSWORD = /(?:^|[;\s,])(?:password|pwd)[ \t]{0,8}=[ \t]{0,8}([^;\s'"`]{1,256})/i

function pushKeyMatches(key: string): boolean {
  const upper = key.toUpperCase()
  // 앱 키 자체는 공개 값 — 정확히 일치할 때만 뺀다(`STRIPE_APP_KEY`·`APP_KEY_SECRET` 은 아래 검사를 그대로 받는다).
  if (PUSH_KEY_EXACT_EXCLUDES.test(upper)) return false
  return matchesWords(upper)
}

function matchesWords(upper: string): boolean {
  if (PUSH_ENV_SECRET_KEY_WORDS.some((w) => upper.includes(w))) return true
  const tokens = upper.split(/[^A-Z0-9]+/)
  return PUSH_ENV_SECRET_KEY_TOKENS.some((w) => tokens.includes(w))
}

/**
 * push 용 견본 값 판정(AWS Security Agent 6차 M) — 값 **전체**가 견본 모양일 때만 참이다. 부분 문자열로 보면
 * `sk-live-xxxxQk7f3…`·`changeme-prod-9f2a` 같은 실제 값이 통과한다. 견본 모양: `<…>`, `${VAR}`, 한 글자 반복(`xxxx`·`****`),
 * 또는 `_`·`-`·`.`·공백으로 나뉜 조각이 모두 영문자뿐이고 그중 하나가 힌트 낱말(YOUR·EXAMPLE·PLACEHOLDER·CHANGEME·`XXXX…`)인 값
 * (`YOUR_APP_ID`·`your-api-key-here`). 숫자가 섞인 조각이 있으면 견본이 아니다.
 * pre-commit 가드의 isPlaceholderToken 은 그대로 둔다(가드 동작 불변).
 */
export function isPushPlaceholder(value: string): boolean {
  const v = value.trim()
  if (v === '') return false
  if (/^<[^<>]*>$/.test(v)) return true
  if (/^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$/.test(v)) return true
  if (v.length >= 3 && [...v].every((c) => c === v[0])) return true
  const tokens = v.split(/[_\-. ]+/).filter((t) => t !== '')
  if (tokens.length === 0 || !tokens.every((t) => /^[A-Za-z]+$/.test(t))) return false
  return tokens.some((t) => PLACEHOLDER_HINTS.includes(t.toUpperCase()) || /^X{4,}$/i.test(t))
}

/** 값 모양만으로 자격 증명인가 — 알려진 자격 증명 형식이거나 URL 에 실제 `user:pass@` 가 있다. 이름·견본 판정보다 먼저 본다. */
function credentialShaped(value: string): boolean {
  if (CREDENTIAL_VALUE_PATTERNS.some((re) => re.test(value)) || jwtShaped(value)) return true
  return (
    realPassword(URL_CREDENTIALS.exec(value)?.[1]) || realPassword(DSN_PASSWORD.exec(value)?.[1])
  )
}

/** 비밀번호 자리 값이 실제 값인가 — 변수 치환(`$X`·`${X}`)·견본이 아니어야 한다. */
function realPassword(pass: string | undefined): boolean {
  return (
    pass !== undefined && !pass.startsWith('$') && !pass.startsWith('{') && !isPushPlaceholder(pass)
  )
}

/**
 * push 용 한 줄 검사 — 가드보다 넓다. (1) 이름과 무관하게 알려진 자격 증명 값 모양·URL 의 `user:pass@` 자격 증명(견본 판정으로
 * 덮을 수 없다), (2) 키 이름 조각(PUSH_ENV_SECRET_KEY_WORDS 등)에 견본(isPushPlaceholder)이 아닌 값. 빈 값은 허용한다.
 */
export function pushEnvSecretAssignment(line: string): { key: string; value: string } | null {
  const a = parseAssignment(line)
  if (!a || a.value === '') return null
  if (credentialShaped(a.value)) return a
  if (pushKeyMatches(a.key) && !isPushPlaceholder(a.value)) return a
  return null
}

/** 토큰이 플레이스홀더인가 — 힌트는 **토큰 자체**만 본다(줄 전체를 보면 주석 한 줄로 진짜 키가 통과한다). */
export function isPlaceholderToken(token: string, hints: readonly string[]): boolean {
  const upper = token.toUpperCase()
  if (hints.some((h) => upper.includes(h))) return true
  const body = token.slice(token.indexOf('_') + 1)
  return body.length > 0 && body.split('').every((c) => c === body[0])
}

/** 한 줄을 `KEY=value` 로 나눈다(주석·`=` 없는 줄은 null). 값의 따옴표는 벗기고, 비어 있으면 value 는 ''. */
function parseAssignment(line: string): { key: string; value: string } | null {
  const t = line.trim()
  if (t === '' || t.startsWith('#')) return null
  const eq = t.indexOf('=')
  if (eq <= 0) return null
  let key = t.slice(0, eq).trim()
  if (key.startsWith('export ')) key = key.slice(7).trim()
  let value = t.slice(eq + 1).trim()
  // 같은 따옴표(`"`·`'`·`` ` ``) 한 겹만 벗기고, 안쪽 공백은 다시 다듬는다.
  const q = value[0]
  if (value.length >= 2 && (q === '"' || q === "'" || q === '`') && value.endsWith(q)) {
    value = value.slice(1, -1).trim()
  }
  return { key, value }
}

/** `.env.{mode}` 한 줄에서 "시크릿 이름 키 = 실제 값"을 찾는다. 주석·빈 값·플레이스홀더는 무시한다. */
export function envSecretAssignmentWith(
  line: string,
  keyWords: readonly string[],
  isPlaceholder: (token: string) => boolean,
): { key: string; value: string } | null {
  const a = parseAssignment(line)
  if (!a) return null
  const upper = a.key.toUpperCase()
  if (!keyWords.some((w) => upper.includes(w))) return null
  if (a.value === '' || isPlaceholder(a.value)) return null
  return a
}

/** CLI 용 — 기본 표로 한 줄을 본다. */
export function envSecretAssignment(line: string): { key: string; value: string } | null {
  return envSecretAssignmentWith(line, ENV_SECRET_KEY_WORDS, (t) =>
    isPlaceholderToken(t, PLACEHOLDER_HINTS),
  )
}

/**
 * 한 줄 검사 상한(AWS Security Agent PR #454). 이보다 긴 줄은 정규식에 넣지 않고 고정 문자열 표식(LONG_LINE_MARKERS)과
 * 키 이름만 본다 — 값 모양 판정의 비용이 줄 길이에 묶이지 않게.
 */
export const MAX_SCAN_LINE = 4096

/** 긴 줄에서 찾는 고정 문자열 표식 — CREDENTIAL_VALUE_PATTERNS·JWT·URL 자격 증명의 머리 부분. */
const LONG_LINE_MARKERS: readonly string[] = [
  '-----BEGIN',
  'AKIA',
  'ASIA',
  'sk-',
  '_live_',
  '_test_',
  'ghp_',
  'gho_',
  'ghu_',
  'ghs_',
  'ghr_',
  'xox',
  'eyJ',
]

/** 긴 줄 검사 — 표식이 하나라도 있거나(URL 은 `://` 와 `@` 둘 다), 키 이름이 시크릿 조각이고 값이 비지 않았으면 걸린다. */
function longLineSecret(line: string): { key: string } | null {
  const t = line.trim()
  if (t === '' || t.startsWith('#')) return null
  const eq = t.indexOf('=')
  let key = eq > 0 ? t.slice(0, eq).trim() : ''
  if (key.startsWith('export ')) key = key.slice(7).trim()
  const hasMarker =
    LONG_LINE_MARKERS.some((m) => t.includes(m)) ||
    (t.includes('://') && t.includes('@')) ||
    /(?:password|pwd)\s{0,8}=/i.test(t.slice(Math.max(eq, 0)))
  if (hasMarker) return { key }
  if (key !== '' && pushKeyMatches(key) && t.slice(eq + 1).trim() !== '') return { key }
  return null
}

/** 파일 내용에서 시크릿 값이 든 줄(1부터)과 키 이름. 값은 돌려주지 않는다 — 출력에 실리지 않게. */
export function findEnvSecrets(content: string): { line: number; key: string }[] {
  const found: { line: number; key: string }[] = []
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const a = line.length > MAX_SCAN_LINE ? longLineSecret(line) : pushEnvSecretAssignment(line)
    if (a) found.push({ line: i + 1, key: a.key })
  }
  return found
}

/** env 파일 검사에서 걸린 줄 — 값은 담지 않는다(출력에 실리지 않게). */
export interface EnvFileFinding {
  line: number
  /** 걸린 키 이름. 한 줄 `KEY=값` 이 아니면 ''. */
  key: string
  reason: string
}

// `KEY=값` 한 줄 — 키는 셸 변수 이름 모양, `export ` 접두는 허용.
const ASSIGNMENT_LINE = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/

/** 값이 이 줄에서 끝나는가 — 따옴표로 열었으면 같은 따옴표로 닫혀야 한다(여러 줄 값 금지). */
function singleLineValue(raw: string): boolean {
  const v = raw.trim()
  const q = v[0]
  if (q !== '"' && q !== "'" && q !== '`') return true
  return v.length >= 2 && v.endsWith(q)
}

/**
 * `.env.{mode}` 류 파일 전체 검사(AWS Security Agent 6차, Ruling 24 S2). 빈 줄·`#` 주석이 아닌 줄은 모두 한 줄 `KEY=값` 이어야 한다
 * (여러 줄 값·이어지는 줄은 거부 — 여러 줄 PEM 이 줄 단위 검사를 빠져나가지 않게).
 *  - `mode: 'mode'`(`.env.production` 등): 키는 모두 `VITE_` 로 시작해야 한다(클라이언트 번들에 실리는 공개 값).
 *    `VITE_` 값도 자격 증명 모양·시크릿 이름(pushEnvSecretAssignment)이면 거부한다.
 *  - `mode: 'placeholder'`(`.env.example|sample|template`): 키는 자유. `VITE_` 키는 위와 같고, 그 밖의 키는 값이 비었거나
 *    견본(isPushPlaceholder)이어야 한다. 자격 증명 모양은 언제나 거부한다.
 */
export function checkEnvFile(content: string, mode: 'mode' | 'placeholder'): EnvFileFinding[] {
  const found: EnvFileFinding[] = []
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i]!.trim()
    if (t === '' || t.startsWith('#')) continue
    // 긴 줄은 정규식에 넣지 않고 거부한다 — `.env.{mode}`·견본에 4096자 넘는 한 줄 값은 둘 일이 없다.
    if (t.length > MAX_SCAN_LINE) {
      found.push({ line: i + 1, key: '', reason: `줄이 너무 김(최대 ${MAX_SCAN_LINE}자)` })
      continue
    }
    const m = ASSIGNMENT_LINE.exec(t)
    if (!m || !singleLineValue(m[2]!)) {
      found.push({ line: i + 1, key: '', reason: '한 줄 KEY=값 형식이 아님(여러 줄 값 등)' })
      continue
    }
    const key = m[1]!
    const isVite = key.startsWith('VITE_')
    if (isVite || mode === 'placeholder') {
      if (pushEnvSecretAssignment(t)) {
        found.push({ line: i + 1, key, reason: '시크릿 값' })
        continue
      }
    }
    if (isVite) continue
    if (mode === 'mode') {
      found.push({ line: i + 1, key, reason: 'VITE_ 로 시작하지 않는 키' })
      continue
    }
    const a = parseAssignment(t)
    if (a && a.value !== '' && !isPushPlaceholder(a.value)) {
      found.push({ line: i + 1, key, reason: '견본 파일에 실제 값으로 보이는 값' })
    }
  }
  return found
}

// 개인 키 본문 — 머리글 뒤에 base64 본문이 이어질 때만(문서에 머리글만 적은 것은 아니다). JSON 의 `\n` 이스케이프도 본문으로 본다.
// 암호화된 옛 PEM 은 머리글과 본문 사이에 RFC 1421 머리 줄(`Proc-Type: 4,ENCRYPTED`·`DEK-Info: …`)이 끼므로 그런 줄을
// 몇 개까지 건너뛴다(AWS Security Agent 7차 M). 예전에는 아래 정규식 하나였다:
//   /-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY-----(?:\s|\\n|\\r){0,40}
//    (?:[A-Za-z][A-Za-z0-9-]{0,40}:[^\r\n\\]{0,200}(?:\s|\\n|\\r){1,40}){0,8}[A-Za-z0-9+/=]{40,}/
// 머리 줄 값([^\r\n\\])이 공백도 받아 뒤의 구분자·다음 반복과 겹치므로, 맞지 않는 꼬리에서 되짚기가 지수로 늘었다
// (190바이트 파일로 `bstage push` 가 멈춤 — AWS Security Agent PR #454). 같은 답을 내는 손 스캐너로 바꿨다:
// 머리 줄이 시작될 수 있는 위치를 앞에서부터 한 번씩만 보고, 위치마다 "지금까지 쓴 머리 줄 수"의 최솟값만 기억한다
// (적게 쓴 쪽이 언제나 더 많이 맞출 수 있다). 위치마다 하는 일은 상수(머리 줄 한 줄 ≈ 300자)라 전체가 선형이다.
const PEM_BEGIN = '-----BEGIN '
const PEM_KEY_TAIL = 'PRIVATE KEY-----'
const PEM_MAX_LABEL = 40
const PEM_MAX_SEP = 40
const PEM_MAX_HEADERS = 8
const PEM_HEADER_NAME_MAX = 41
const PEM_HEADER_VALUE_MAX = 200
const PEM_BODY_MIN = 40

/** JS 정규식 `\s` 와 같은 글자 집합. */
function isRegexSpace(c: number): boolean {
  return (
    (c >= 9 && c <= 13) ||
    c === 32 ||
    c === 0xa0 ||
    c === 0x1680 ||
    (c >= 0x2000 && c <= 0x200a) ||
    c === 0x2028 ||
    c === 0x2029 ||
    c === 0x202f ||
    c === 0x205f ||
    c === 0x3000 ||
    c === 0xfeff
  )
}

function isUpperDigitSpace(c: number): boolean {
  return (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 32
}

function isAlpha(c: number): boolean {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122)
}

function isBase64Char(c: number): boolean {
  return isAlpha(c) || (c >= 48 && c <= 57) || c === 43 || c === 47 || c === 61
}

/** i 에서 구분자 한 덩이(`\s` 한 글자, 또는 글자 그대로의 `\n`·`\r`)의 길이. 아니면 0. */
function sepTokenLen(s: string, i: number): number {
  if (i >= s.length) return 0
  const c = s.charCodeAt(i)
  if (isRegexSpace(c)) return 1
  if (c === 92) {
    const d = s.charCodeAt(i + 1)
    if (d === 110 || d === 114) return 2
  }
  return 0
}

/**
 * i 에서 시작하는 구분자 덩이를 끝까지 따라간 끝 위치. 다음 요소(머리 줄 이름·본문)는 구분자 글자로 시작할 수 없으므로
 * 구분자는 언제나 끝까지 먹어야 한다. maxTokens 개를 넘으면 -1.
 */
function sepRunEnd(s: string, i: number, maxTokens: number): number {
  let p = i
  for (let t = 0; ; t++) {
    const n = sepTokenLen(s, p)
    if (n === 0) return p
    if (t >= maxTokens) return -1
    p += n
  }
}

/** `-----BEGIN ` 이 at 에 있을 때, `[A-Z0-9 ]{0,40}PRIVATE KEY-----` 가 맞으면 그 끝 위치. */
function pemKeyHeaderEnd(s: string, at: number): number {
  const p = at + PEM_BEGIN.length
  // "PRIVATE KEY" 뒤의 '-' 는 [A-Z0-9 ] 가 아니므로 꼬리는 그 글자 덩이의 끝에서만 맞을 수 있다.
  const limit = PEM_MAX_LABEL + 'PRIVATE KEY'.length
  let r = 0
  while (r <= limit && p + r < s.length && isUpperDigitSpace(s.charCodeAt(p + r))) r++
  if (r > limit) return -1
  const tailAt = p + r - 'PRIVATE KEY'.length
  if (tailAt < p || !s.startsWith(PEM_KEY_TAIL, tailAt)) return -1
  return tailAt + PEM_KEY_TAIL.length
}

/** pos 에서 본문 `[A-Za-z0-9+/=]{40,}` 이 시작되는가. */
function bodyAt(s: string, pos: number): boolean {
  if (pos + PEM_BODY_MIN > s.length) return false
  for (let i = 0; i < PEM_BODY_MIN; i++) if (!isBase64Char(s.charCodeAt(pos + i))) return false
  return true
}

/**
 * pos 에서 머리 줄 `[A-Za-z][A-Za-z0-9-]{0,40}:[^\r\n\\]{0,200}(?:\s|\\n|\\r){1,40}` 을 맞춰 볼 때 다음 요소가 시작될 수
 * 있는 위치들. 값이 끝나는 자리는 구분자 덩이가 시작되는 곳이고, 같은 덩이 안이면 다음 위치(덩이 끝)는 같으므로 덩이마다
 * 구분자 수가 가장 적게 되는(값을 가장 길게 잡는) 경우 하나만 보면 된다.
 */
function pemHeaderNexts(s: string, pos: number, out: (next: number) => void): void {
  if (!isAlpha(s.charCodeAt(pos))) return
  let i = pos + 1
  while (i - pos < PEM_HEADER_NAME_MAX && i < s.length) {
    const c = s.charCodeAt(i)
    if (!(isAlpha(c) || (c >= 48 && c <= 57) || c === 45)) break
    i++
  }
  if (s.charCodeAt(i) !== 58) return
  const a = i + 1
  // 값이 끝날 수 있는 마지막 자리: 200자 또는 \r·\n·\ 앞.
  let j = a
  while (j - a < PEM_HEADER_VALUE_MAX && j < s.length) {
    const c = s.charCodeAt(j)
    if (c === 13 || c === 10 || c === 92) break
    j++
  }
  let v = a
  while (v <= j) {
    if (sepTokenLen(s, v) === 0) {
      v++
      continue
    }
    // v 에서 시작하는 구분자 덩이를 끝까지 따라간다. 값이 끝날 자리로 고를 수 있는 것은 j 이하의 덩이 경계이고, 가장 뒤의
    // 것을 고르면 남는 구분자 수가 가장 적다 — 남는 수 = (j 뒤에서 시작하는 덩이 수) + 1.
    let p = v
    let afterJ = 0
    for (let n = sepTokenLen(s, p); n > 0; n = sepTokenLen(s, p)) {
      if (p > j && ++afterJ >= PEM_MAX_SEP) return
      p += n
    }
    out(p)
    v = p
  }
}

/** 옛 PRIVATE_KEY_BLOCK 정규식과 같은 답 — 선형 시간. */
function containsPemPrivateKey(s: string): boolean {
  let at = s.indexOf(PEM_BEGIN)
  if (at < 0) return false
  // used[pos] = pos 에서 다음 요소를 볼 때까지 쓴 머리 줄 수의 최솟값 + 1. 0 은 아직 닿지 않음.
  let used: Uint8Array | null = null
  let first = s.length + 1
  let last = -1
  const reach = (pos: number, n: number) => {
    used ??= new Uint8Array(s.length + 1)
    const cur = used[pos]!
    if (cur === 0 || n + 1 < cur) used[pos] = n + 1
    if (pos < first) first = pos
    if (pos > last) last = pos
  }
  // 머리글마다 앞쪽 구분자(0~40개)를 끝까지 먹은 자리가 첫 요소의 시작.
  for (; at >= 0; at = s.indexOf(PEM_BEGIN, at + 1)) {
    const e = pemKeyHeaderEnd(s, at)
    if (e < 0) continue
    const p = sepRunEnd(s, e, PEM_MAX_SEP)
    if (p >= 0) reach(p, 0)
  }
  // 모든 이동은 앞으로만 가므로 위치 순서대로 한 번씩 보면 그때의 값이 확정된 최솟값이다.
  for (let pos = first; pos <= last; pos++) {
    const u = used![pos]!
    if (u === 0) continue
    if (bodyAt(s, pos)) return true
    if (u - 1 < PEM_MAX_HEADERS) pemHeaderNexts(s, pos, (next) => reach(next, u))
  }
  return false
}

// PuTTY 개인 키(`PuTTY-User-Key-File-2|3: …` 뒤 4000자 안에 `Private-Lines:`)와 풀어 쓴 OpenSSH 키 본문의 매직(`openssh-key-v1\0`).
// 예전 정규식 /PuTTY-User-Key-File-[0-9]+:[\s\S]{0,4000}?Private-Lines:/ 은 머리글을 반복하면 머리글마다 4000자를 다시
// 훑었다 — 다음 `Private-Lines:` 위치를 앞으로만 옮기며 같은 답을 낸다.
const PUTTY_HEADER = 'PuTTY-User-Key-File-'
const PUTTY_PRIVATE_LINES = 'Private-Lines:'
const PUTTY_MAX_GAP = 4000
const OPENSSH_KEY_MAGIC = 'openssh-key-v1\u0000'

function containsPuttyPrivateKey(s: string): boolean {
  let pl = -1
  for (let at = s.indexOf(PUTTY_HEADER); at >= 0; at = s.indexOf(PUTTY_HEADER, at + 1)) {
    let i = at + PUTTY_HEADER.length
    const d0 = i
    while (i < s.length && s.charCodeAt(i) >= 48 && s.charCodeAt(i) <= 57) i++
    if (i === d0 || s.charCodeAt(i) !== 58) continue
    const from = i + 1
    if (pl < from) {
      pl = s.indexOf(PUTTY_PRIVATE_LINES, from)
      if (pl < 0) return false
    }
    if (pl - from <= PUTTY_MAX_GAP) return true
  }
  return false
}

/** 파일 내용에 개인 키 본문이 들어 있는가(GCP 서비스 계정 JSON 등 — AWS Security Agent 6차 H). */
export function containsPrivateKey(content: string): boolean {
  return (
    containsPemPrivateKey(content) ||
    containsPuttyPrivateKey(content) ||
    content.includes(OPENSSH_KEY_MAGIC)
  )
}

/**
 * 바이트 그대로 개인 키를 찾는다 — 확장자와 상관없이 모든 파일에 쓴다(이미지·글꼴 확장자 뒤에 숨긴 PEM 도, AWS Security
 * Agent 7차 M). latin1 로 풀어 바이트 하나가 글자 하나가 되게 하므로 표식은 ASCII 그대로 맞고 잘못된 UTF-8 에 막히지 않는다.
 */
export function bufferContainsPrivateKey(buf: Buffer): boolean {
  return containsPrivateKey(buf.toString('latin1'))
}
