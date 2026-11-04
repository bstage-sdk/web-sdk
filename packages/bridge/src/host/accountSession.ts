import { BridgeError } from '../protocol/errors.js'
import {
  ACCOUNT_SESSION_CAPABILITY,
  KNOWN_CAPABILITIES,
  OTP_OPS,
  SESSION_OPS,
} from '../protocol/messages.js'
import type {
  AccountHostQuery,
  AccountSpaceInfo,
  OtpOp,
  OtpPurpose,
  OtpResult,
  ReverificationStatus,
  SessionOp,
  SessionResult,
} from '../protocol/messages.js'
import type { BridgeInitInput, OtpImpl, SessionImpl } from './types.js'
import { validatePath } from './validators.js'

/**
 * 계정 세션 요청(session·otp) 처리. 호스트가 계정 API를 대신 부르고 로그인 쿠키를 호스트에서 설정한다.
 * 이 파일이 지키는 것: 권한 없는 배치에서 닫힘(fail-closed), op·본문 허용 목록, 응답에서 토큰 제거,
 * 가입 직후 로그인의 결속(같은 세션·같은 이메일·1회·60초), 레이트 리밋. 실제 호출은 임베더의 실행기 몫이다.
 */

/** session 분당 상한 — 구현 선택(가입·로그인은 사람이 한 번씩 누르는 동작). */
export const SESSION_PER_MINUTE = 5
/** 프레임 세션(호스트 하나)당 session 총 상한. */
export const SESSION_PER_FRAME = 20
/** otp 발송 분당 상한 — 편의 제한일 뿐 통제가 아니다(리로드로 초기화). 정본은 게이트웨이의 번호·IP 제한. */
export const OTP_SEND_PER_MINUTE = 3
/** otp 확인 분당 상한. */
export const OTP_VERIFY_PER_MINUTE = 10
/** 가입이 LOGIN_REQUIRED를 돌려준 뒤 loginAfterSignup을 허용하는 시간. */
export const LOGIN_BINDING_MS = 60_000

const MAX_STRING = 2048
const MAX_AGREEMENTS = 50
const MAX_STATUS = 64
const MAX_MESSAGE = 500
const MARKETING_TARGETS: readonly string[] = ['push', 'email', 'sms']

type FieldSpec = 'string' | 'agreements' | 'marketing'

/** 가입 공통 필드(이메일·비밀번호 제외). */
const SIGNUP_COMMON: Readonly<Record<string, FieldSpec>> = {
  agreements: 'agreements',
  nickname: 'string',
  avatarImgPath: 'string',
  birthYear: 'string',
  birthMonth: 'string',
  birthDay: 'string',
  marketingNotificationTargets: 'marketing',
  phone: 'string',
  countryCallingCode: 'string',
  name: 'string',
  gender: 'string',
  phoneVerificationToken: 'string',
}

interface OpSpec {
  readonly fields: Readonly<Record<string, FieldSpec>>
  readonly required: readonly string[]
}

/**
 * op별 본문 허용 목록. 프레임 본문을 그대로 넘기지 않고 이 표로 다시 만든다.
 * signupSocial의 `code`·`state`(OAuth)와 phoneReverify의 `reverificationToken`은 표에 없다 —
 * 호스트가 자기 URL·보관소에서 채운다.
 */
const SESSION_SPECS: Readonly<Record<SessionOp, OpSpec>> = {
  signup: {
    fields: { email: 'string', password: 'string', ...SIGNUP_COMMON },
    required: ['email', 'password'],
  },
  signupSocial: { fields: { socialType: 'string', ...SIGNUP_COMMON }, required: ['socialType'] },
  loginAfterSignup: {
    fields: { email: 'string', password: 'string', turnstileToken: 'string' },
    required: ['email', 'password'],
  },
  phoneReverify: {
    fields: { countryCallingCode: 'string', phone: 'string', phoneVerificationToken: 'string' },
    required: ['countryCallingCode', 'phone', 'phoneVerificationToken'],
  },
}

const OTP_SPECS: Readonly<
  Record<OtpOp, { endpoint: 'send' | 'verify'; purpose: OtpPurpose; spec: OpSpec }>
> = {
  sendSignup: {
    endpoint: 'send',
    purpose: 'SIGNUP',
    spec: { fields: { phone: 'string', locale: 'string' }, required: ['phone'] },
  },
  sendPhoneChange: {
    endpoint: 'send',
    purpose: 'PHONE_CHANGE',
    spec: { fields: { phone: 'string', locale: 'string' }, required: ['phone'] },
  },
  verifySignup: {
    endpoint: 'verify',
    purpose: 'SIGNUP',
    spec: {
      fields: { phone: 'string', code: 'string', requestId: 'string' },
      required: ['phone', 'code'],
    },
  },
  verifyPhoneChange: {
    endpoint: 'verify',
    purpose: 'PHONE_CHANGE',
    spec: {
      fields: { phone: 'string', code: 'string', requestId: 'string' },
      required: ['phone', 'code'],
    },
  },
}

/** otp 응답 data 허용 필드. verify의 `verificationToken`은 휴대폰 인증 증빙이라 템플릿이 가입·회원정보 수정 본문에 실어야 한다(세션 토큰 아님). */
const OTP_DATA_FIELDS: Readonly<Record<'send' | 'verify', readonly string[]>> = {
  send: ['requestId', 'expiresInSeconds', 'resendAvailableInSeconds', 'maskedPhone'],
  verify: ['verificationToken', 'expiresAtSeconds', 'phone'],
}

function bad(): never {
  throw new BridgeError('BAD_REQUEST', 'invalid account request')
}

function notAllowed(): never {
  throw new BridgeError('NOT_ALLOWED', 'not allowed for this placement')
}

function obj(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function str(value: unknown, max = MAX_STRING): string | undefined {
  return typeof value === 'string' && value.length <= max ? value : undefined
}

function cleanAgreements(value: unknown): readonly Record<string, string>[] {
  if (!Array.isArray(value) || value.length > MAX_AGREEMENTS) bad()
  return value.map((item) => {
    const o = obj(item)
    const termsId = str(o?.termsId)
    if (!o || termsId === undefined) bad()
    const termsVersion = o.termsVersion === undefined ? undefined : str(o.termsVersion)
    const termsType = o.termsType === undefined ? undefined : str(o.termsType)
    if (o.termsVersion !== undefined && termsVersion === undefined) bad()
    if (o.termsType !== undefined && termsType === undefined) bad()
    return {
      termsId,
      ...(termsVersion !== undefined ? { termsVersion } : {}),
      ...(termsType !== undefined ? { termsType } : {}),
    }
  })
}

function cleanMarketing(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.some((v) => !MARKETING_TARGETS.includes(v as string))) bad()
  return [...(value as string[])]
}

/** 허용 필드만으로 본문을 다시 만든다. 형이 틀리거나 필수 필드가 없으면 BAD_REQUEST. */
function cleanBody(raw: unknown, spec: OpSpec): Record<string, unknown> {
  const body = obj(raw)
  if (!body) bad()
  const out: Record<string, unknown> = {}
  for (const [key, kind] of Object.entries(spec.fields)) {
    if (!Object.prototype.hasOwnProperty.call(body, key) || body[key] === undefined) continue
    const value = body[key]
    if (kind === 'string') {
      const s = str(value)
      if (s === undefined) bad()
      out[key] = s
    } else if (kind === 'agreements') out[key] = cleanAgreements(value)
    else out[key] = cleanMarketing(value)
  }
  for (const key of spec.required) {
    if (typeof out[key] !== 'string' || (out[key] as string).length === 0) bad()
  }
  return out
}

/** 이름에 token이 들어간 키를 깊이와 무관하게 지운 사본. 허용 목록이 놓친 새 필드에 대한 2차 방어. */
export function stripTokenKeys(value: unknown, depth = 0): unknown {
  if (depth > 8) return undefined
  if (Array.isArray(value)) return value.map((v) => stripTokenKeys(v, depth + 1))
  const o = obj(value)
  if (!o) return value
  return Object.fromEntries(
    Object.entries(o)
      .filter(([k]) => !/token/i.test(k))
      .map(([k, v]) => [k, stripTokenKeys(v, depth + 1)]),
  )
}

function cleanSessionResult(op: SessionOp, raw: unknown, hostOrigin: string): SessionResult {
  const r = obj(stripTokenKeys(raw)) ?? {}
  const status = str(r.status, MAX_STATUS)
  const message = typeof r.message === 'string' ? r.message.slice(0, MAX_MESSAGE) : undefined
  const createdAt =
    op === 'signup' || op === 'signupSocial' ? str(r.createdAt, MAX_STATUS) : undefined
  let next: SessionResult['next']
  const rawNext = obj(r.next)
  if (r.ok === true && rawNext) {
    try {
      next = { path: validatePath({ path: rawNext.path }, hostOrigin), reload: true }
    } catch {
      // 잘못된 next는 버린다(프레임은 이동하지 않는다) — 실행기 버그가 외부 이동이 되지 않게.
      next = undefined
    }
  }
  return {
    ok: r.ok === true,
    ...(status !== undefined ? { status } : {}),
    ...(typeof r.code === 'number' && Number.isFinite(r.code) ? { code: r.code } : {}),
    ...(message !== undefined ? { message } : {}),
    ...(typeof r.httpStatus === 'number' && Number.isInteger(r.httpStatus)
      ? { httpStatus: r.httpStatus }
      : {}),
    ...(createdAt !== undefined ? { createdAt } : {}),
    ...(next ? { next } : {}),
  }
}

function cleanOtpResult(endpoint: 'send' | 'verify', raw: unknown): OtpResult {
  const r = obj(raw) ?? {}
  const status = typeof r.status === 'number' && Number.isInteger(r.status) ? r.status : 0
  const rawData = obj(r.data)
  let data: Record<string, string | number> | undefined
  if (rawData) {
    data = {}
    for (const key of OTP_DATA_FIELDS[endpoint]) {
      const v = rawData[key]
      if (typeof v === 'string' && v.length <= MAX_STRING) data[key] = v
      else if (typeof v === 'number' && Number.isFinite(v)) data[key] = v
    }
  }
  const rawError = obj(r.error)
  let error: OtpResult['error']
  if (rawError) {
    const code = str(rawError.code, MAX_STATUS)
    const m = obj(rawError.message)
    const en = m ? str(m.en, MAX_MESSAGE) : undefined
    const vi = m ? str(m.vi, MAX_MESSAGE) : undefined
    const retry = rawError.retryAfterSeconds
    error = {
      ...(code !== undefined ? { code } : {}),
      ...(en !== undefined || vi !== undefined
        ? { message: { ...(en !== undefined ? { en } : {}), ...(vi !== undefined ? { vi } : {}) } }
        : {}),
      ...(typeof retry === 'number' && Number.isFinite(retry) ? { retryAfterSeconds: retry } : {}),
    }
  }
  return { ok: r.ok === true, status, ...(data ? { data } : {}), ...(error ? { error } : {}) }
}

/** 이 배치가 계정 세션 요청을 열 수 있는가 — 권한 값과 page 배치를 함께 본다. */
export function hasAccountCapability(init: BridgeInitInput): boolean {
  return (
    init.surface === 'page' &&
    Array.isArray(init.capabilities) &&
    init.capabilities.includes(ACCOUNT_SESSION_CAPABILITY)
  )
}

export interface AccountSessionContext {
  readonly enabled: boolean
  readonly hostOrigin: string
  readonly sessionImpl?: SessionImpl
  readonly otpImpl?: OtpImpl
  /** 상한·카운터를 리로드 너머로 이어 둘 저장소. 생략하면 호스트 탭의 sessionStorage(없으면 메모리). */
  readonly stateStore?: AccountStateStore
  /** 기본 저장소 키를 나누는 배치 범위(스테이지·배치). 같은 탭의 다른 배치와 상한을 나누지 않게 한다. */
  readonly scope?: string
}

/**
 * 계정 상한 상태 저장소 — 호스트 페이지 쪽 문자열 저장소. 리로드(호스트 재생성)로 상한이 초기화되지 않게
 * 같은 탭 안에서 상태를 잇는다. 편의 제한을 단단하게 할 뿐 정본 통제는 서버 쪽 제한이다.
 */
export interface AccountStateStore {
  get(): string | null
  set(value: string): void
}

const STATE_KEY = '__bstage_account_limits__'
/** 로그인 성립 후 리로드 허가가 유효한 시간. */
export const RELOAD_GRANT_MS = 60_000
const WINDOW_MS = 60_000

/** 기본 저장소 — 호스트 탭의 sessionStorage. 접근이 막혀 있으면(사파리 비공개 등) 메모리로 대체한다. */
export function defaultAccountStateStore(scope = ''): AccountStateStore {
  const key = scope ? `${STATE_KEY}:${scope}` : STATE_KEY
  let memory: string | null = null
  const storage = ():
    | { getItem(k: string): string | null; setItem(k: string, v: string): void }
    | undefined => {
    try {
      const s = (globalThis as { sessionStorage?: unknown }).sessionStorage as
        | { getItem(k: string): string | null; setItem(k: string, v: string): void }
        | undefined
      return s && typeof s.getItem === 'function' ? s : undefined
    } catch {
      return undefined
    }
  }
  return {
    get() {
      try {
        return storage()?.getItem(key) ?? memory
      } catch {
        return memory
      }
    },
    set(value) {
      memory = value
      try {
        storage()?.setItem(key, value)
      } catch {
        // 메모리 값으로 계속 센다
      }
    },
  }
}

interface LimitState {
  readonly session: readonly number[]
  readonly send: readonly number[]
  readonly verify: readonly number[]
}

const EMPTY_STATE: LimitState = { session: [], send: [], verify: [] }

function stamps(value: unknown): readonly number[] {
  return Array.isArray(value)
    ? value.filter((t): t is number => typeof t === 'number' && Number.isFinite(t))
    : []
}

function readState(store: AccountStateStore): LimitState {
  try {
    const raw = store.get()
    if (!raw) return EMPTY_STATE
    const v = JSON.parse(raw) as Record<string, unknown>
    if (typeof v !== 'object' || v === null) return EMPTY_STATE
    return { session: stamps(v.session), send: stamps(v.send), verify: stamps(v.verify) }
  } catch {
    return EMPTY_STATE
  }
}

export interface AccountSessionHandler {
  session(payload: unknown): Promise<SessionResult>
  otp(payload: unknown): Promise<OtpResult>
  /**
   * 전체 리로드 이동 허가를 한 번 쓴다. 이 호스트에서 로그인이 성립한(`ok`·`SUCCESS`) 세션 작업 뒤에만 한 번 true.
   * 리로드는 호스트를 새로 만들어 상한·결속을 초기화하므로, 서버가 인정한 로그인 없이는 그 경로를 열지 않는다.
   */
  takeReload(): boolean
}

/** 호스트 하나(프레임 세션 하나)에 묶인 계정 요청 처리기. 상한·결속은 이 클로저 안에만 있다. */
export function createAccountSessionHandler(ctx: AccountSessionContext): AccountSessionHandler {
  const store = ctx.stateStore ?? defaultAccountStateStore(ctx.scope)

  /** 상한 한 칸을 쓴다 — 저장소에서 읽고 써서 리로드 뒤에도 이어진다. */
  function take(kind: 'session' | 'send' | 'verify', max: number): boolean {
    const now = Date.now()
    const state = readState(store)
    const recent = state[kind].filter((t) => now - t < WINDOW_MS)
    if (recent.length >= max) return false
    const next: LimitState = { ...state, [kind]: [...recent, now] }
    store.set(JSON.stringify(next))
    return true
  }

  /**
   * 프레임 세션당 누적 — 이 호스트(프레임 세션) 하나에만 센다. 탭 단위로 잇지 않는 이유: 창이 없는 누적을
   * 탭 저장소에 두면 같은 탭을 영구히 잠근다. 리로드 반복은 분당 상한(저장소)·reload 허가가 막는다.
   * 허용된 시도는 실행기 결과와 무관하게 센다.
   */
  let sessionCount = 0

  /** 로그인이 성립한 세션 작업 뒤 열리는 리로드 허가의 만료 시각. 1회 쓰면 지운다. */
  let reloadGrantUntil: number | undefined
  /** 가입이 LOGIN_REQUIRED를 돌려준 이메일. 1회 쓰면 지운다. */
  let loginBinding: { email: string; until: number } | undefined

  function gate<T>(impl: T | undefined): T {
    // 권한 판정이 먼저다 — 실행기가 주입돼 있어도 권한 없는 배치에서는 닫는다.
    if (!ctx.enabled) notAllowed()
    if (!impl) throw new BridgeError('UNSUPPORTED', 'not supported by host')
    return impl
  }

  return {
    async session(payload) {
      const impl = gate(ctx.sessionImpl)
      const p = obj(payload) ?? {}
      const op = p.op as SessionOp
      if (!SESSION_OPS.includes(op)) bad()
      const body = cleanBody(p.body, SESSION_SPECS[op])
      if (op === 'loginAfterSignup') {
        const binding = loginBinding
        if (!binding || Date.now() > binding.until || binding.email !== body.email) notAllowed()
      }
      // 상한 검사가 결속 소비보다 먼저다 — 상한에 걸린 요청이 결속을 지워 정상 로그인을 끊지 않게.
      if (sessionCount >= SESSION_PER_FRAME || !take('session', SESSION_PER_MINUTE)) {
        throw new BridgeError('RATE_LIMITED', 'too many session requests')
      }
      if (op === 'loginAfterSignup') loginBinding = undefined
      // 허용된 시도는 결과와 무관하게 센다 — 실패 반복(로그인 시도·계정 열거)도 20회에서 멈춘다. 누적은 이 호스트
      // 메모리라 리로드하면 풀리므로 탭이 영구히 잠기지 않는다.
      sessionCount += 1
      let raw: unknown
      try {
        raw = await impl(op, body)
      } catch {
        // 실행기 예외(내부 URL·토큰이 든 메시지일 수 있다)는 프레임에 싣지 않는다.
        throw new BridgeError('BAD_REQUEST', 'request failed')
      }
      const result = cleanSessionResult(op, raw, ctx.hostOrigin)
      if (result.ok && result.status === 'SUCCESS') reloadGrantUntil = Date.now() + RELOAD_GRANT_MS
      // 성공 응답일 때만 결속을 만든다 — 실패 응답에 실린 status로는 열지 않는다.
      if (op === 'signup' && result.ok && result.status === 'LOGIN_REQUIRED') {
        loginBinding = { email: body.email as string, until: Date.now() + LOGIN_BINDING_MS }
      }
      return result
    },
    takeReload() {
      const until = reloadGrantUntil
      reloadGrantUntil = undefined
      return until !== undefined && Date.now() <= until
    },
    async otp(payload) {
      const impl = gate(ctx.otpImpl)
      const p = obj(payload) ?? {}
      const op = p.op as OtpOp
      if (!OTP_OPS.includes(op)) bad()
      const { endpoint, purpose, spec } = OTP_SPECS[op]
      const body = cleanBody(p.body, spec)
      const allowed =
        endpoint === 'send'
          ? take('send', OTP_SEND_PER_MINUTE)
          : take('verify', OTP_VERIFY_PER_MINUTE)
      if (!allowed) throw new BridgeError('RATE_LIMITED', 'too many otp requests')
      let raw: unknown
      try {
        raw = await impl({ op, endpoint, purpose, body })
      } catch {
        throw new BridgeError('NETWORK_ERROR', 'network error')
      }
      return cleanOtpResult(endpoint, raw)
    },
  }
}

/** init 계정 필드 정제 — 권한이 있을 때만 싣는다. 허용 키·형만 남긴다. */
export function buildAccountInit(init: BridgeInitInput): {
  capabilities?: readonly string[]
  query?: AccountHostQuery
  country?: string
  space?: AccountSpaceInfo
  reverification?: ReverificationStatus
} {
  const capabilities = Array.isArray(init.capabilities)
    ? init.capabilities.filter((c) => KNOWN_CAPABILITIES.includes(c))
    : []
  if (!hasAccountCapability(init)) {
    return capabilities.length > 0 ? { capabilities: Object.freeze(capabilities) } : {}
  }
  const q = obj(init.query)
  const socialType = q ? str(q.socialType, MAX_STATUS) : undefined
  const country =
    typeof init.country === 'string' && /^[A-Za-z]{2,3}$/.test(init.country)
      ? init.country
      : undefined
  const s = obj(init.space)
  const title = s ? str(s.title, 200) : undefined
  const corp = s ? obj(s.corporation) : undefined
  const corpName = corp ? str(corp.name, 200) : undefined
  const corpCountry = corp ? str(corp.country, 8) : undefined
  const r = obj(init.reverification)
  const expiresAt = r ? str(r.expiresAt, MAX_STATUS) : undefined
  return {
    capabilities: Object.freeze(capabilities),
    query: socialType !== undefined ? { socialType } : {},
    ...(country !== undefined ? { country } : {}),
    ...(s
      ? {
          space: {
            ...(title !== undefined ? { title } : {}),
            ...(corp
              ? {
                  corporation: {
                    ...(corpName !== undefined ? { name: corpName } : {}),
                    ...(corpCountry !== undefined ? { country: corpCountry } : {}),
                  },
                }
              : {}),
          },
        }
      : {}),
    ...(r
      ? {
          reverification: {
            available: r.available === true,
            ...(expiresAt !== undefined ? { expiresAt } : {}),
          },
        }
      : {}),
  }
}
