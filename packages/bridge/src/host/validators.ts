import { BridgeError } from '../protocol/errors.js'
import { checkPath } from './pathSafety.js'
import {
  REPORT_COUNT_MAX,
  REPORT_FRAME_MAX_LENGTH,
  REPORT_MAX_FRAMES,
  REPORT_MESSAGE_MAX_LENGTH,
  TEMPLATE_REPORT_KINDS,
} from '../protocol/messages.js'
import type { LogLevel, TemplateReport, ToastKind } from '../protocol/messages.js'

/** 앱 내 경로 최대 길이 — 프로토콜에 정해지지 않은 값(구현 선택). */
export const MAX_PATH_LENGTH = 2048
export const TOAST_MAX_LENGTH = 500
export const TRACK_NAME_MAX_LENGTH = 100
export const TRACK_PARAMS_MAX_BYTES = 4096
export const RESIZE_MAX_HEIGHT = 20000
/** log 메시지 상한 — 프로토콜에 정해지지 않은 값(구현 선택). */
export const LOG_MAX_LENGTH = 2000

const UNSAFE_KEYS: readonly string[] = ['__proto__', 'constructor', 'prototype']
const TOAST_KINDS: readonly ToastKind[] = ['info', 'success', 'warning', 'error']
const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error']

function field(payload: unknown, key: string): unknown {
  return typeof payload === 'object' && payload !== null
    ? (payload as Record<string, unknown>)[key]
    : undefined
}

/**
 * 앱 내 경로만 허용한다: `/`로 시작, `//`·`/\` 아님, 공백·제어문자·역슬래시 없음.
 * (브라우저는 `\`를 `/`로, 탭·개행을 제거해 읽으므로 `/\evil`·`/\t/evil`도 프로토콜 상대 URL이 된다.)
 * 그 뒤 `new URL(path, hostOrigin)`으로 풀어 같은 origin이고 정규화된 경로가 `//`로 시작하지 않는지
 * 확인한다(`/..//evil.com`은 `//evil.com`이 되어 라우터가 프로토콜 상대 URL로 다룰 수 있다).
 * 돌려주는 값은 정규화된 `pathname + search + hash`다.
 */
export function validatePath(payload: unknown, hostOrigin: string): string {
  const path = field(payload, 'path')
  if (
    typeof path !== 'string' ||
    path.length === 0 ||
    path.length > MAX_PATH_LENGTH ||
    !path.startsWith('/') ||
    path.startsWith('//') ||
    // eslint-disable-next-line no-control-regex -- 제어문자를 거르는 것이 목적이다
    /[\s\\\u0000-\u001f\u007f]/.test(path)
  ) {
    throw new BridgeError('BAD_REQUEST', 'invalid path')
  }
  let resolved: URL
  try {
    resolved = new URL(path, hostOrigin)
  } catch {
    throw new BridgeError('BAD_REQUEST', 'invalid path')
  }
  if (resolved.origin !== new URL(hostOrigin).origin || resolved.pathname.startsWith('//')) {
    throw new BridgeError('BAD_REQUEST', 'invalid path')
  }
  // 라우터가 경로를 디코딩·정규화한 뒤 이동하면 `/%2f%2fevil.com`·`/x/%252e%252e//evil.com`도
  // `//evil.com`이 된다 — 게이트웨이와 같은 구조 검사에 `//` 금지를 더한다.
  if (!checkPath(resolved.pathname, { forbidDoubleSlash: true }).ok) {
    throw new BridgeError('BAD_REQUEST', 'invalid path')
  }
  return resolved.pathname + resolved.search + resolved.hash
}

/** https 외부 URL만 허용한다. 정규화한 href를 돌려준다. */
export function validateExternalUrl(payload: unknown): string {
  const raw = field(payload, 'url')
  if (typeof raw !== 'string') throw new BridgeError('BAD_REQUEST', 'invalid url')
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new BridgeError('BAD_REQUEST', 'invalid url')
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
    throw new BridgeError('FORBIDDEN_DESTINATION', 'only https urls can be opened')
  }
  return url.href
}

/** 토스트 — 500자 초과분은 잘라낸다. kind는 아는 값만. */
export function validateToast(payload: unknown): { message: string; kind?: ToastKind } {
  const message = field(payload, 'message')
  if (typeof message !== 'string') throw new BridgeError('BAD_REQUEST', 'invalid toast')
  const kind = field(payload, 'kind')
  const known = TOAST_KINDS.find((k) => k === kind)
  return { message: message.slice(0, TOAST_MAX_LENGTH), ...(known ? { kind: known } : {}) }
}

/** 높이 — 숫자만, 0~20000px로 clamp. */
export function validateHeight(payload: unknown): number {
  const height = field(payload, 'height')
  if (typeof height !== 'number' || !Number.isFinite(height)) {
    throw new BridgeError('BAD_REQUEST', 'invalid height')
  }
  return Math.min(RESIZE_MAX_HEIGHT, Math.max(0, Math.round(height)))
}

/** track — 이름 100자, params 직렬화 4KB. 넘으면 거절(잘라낸 이벤트를 남기지 않는다). */
export function validateTrack(payload: unknown): {
  name: string
  params?: Readonly<Record<string, unknown>>
} {
  const name = field(payload, 'name')
  const params = field(payload, 'params')
  if (typeof name !== 'string' || name.length === 0 || name.length > TRACK_NAME_MAX_LENGTH) {
    throw new BridgeError('BAD_REQUEST', 'invalid track name')
  }
  if (params === undefined) return { name }
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    throw new BridgeError('BAD_REQUEST', 'invalid track params')
  }
  let serialized: string
  try {
    serialized = JSON.stringify(params)
  } catch {
    throw new BridgeError('BAD_REQUEST', 'invalid track params')
  }
  if (new TextEncoder().encode(serialized).length > TRACK_PARAMS_MAX_BYTES) {
    throw new BridgeError('BAD_REQUEST', 'track params too large')
  }
  // 직렬화 결과로 다시 만들어, 잰 크기와 넘기는 값이 같게 한다(JSON 밖 값은 여기서 떨어진다).
  // 프로토타입 오염에 쓰이는 키는 깊이와 무관하게 버린다(처리기가 병합·복사할 때를 대비).
  return {
    name,
    params: JSON.parse(serialized, (key, value: unknown) =>
      UNSAFE_KEYS.includes(key) ? undefined : value,
    ) as Record<string, unknown>,
  }
}

export function validateLog(payload: unknown): { level: LogLevel; message: string } {
  const level = field(payload, 'level')
  const message = field(payload, 'message')
  const known = LOG_LEVELS.find((l) => l === level)
  if (!known || typeof message !== 'string') throw new BridgeError('BAD_REQUEST', 'invalid log')
  return { level: known, message: message.slice(0, LOG_MAX_LENGTH) }
}

/**
 * report — 형식을 엄격히 강제한다(잘라 받지 않고 거절). 프레임 수집기가 이미 상한으로 잘라 보내므로
 * 넘는 값은 수집기를 거치지 않은 메시지다. 돌려주는 값은 아는 네 필드만 담은 새 frozen 객체다
 * (프레임이 덧붙인 URL 등은 여기서 떨어진다).
 */
/**
 * frames — 빈 칸 없는 문자열 배열로 복사한다. 형식이 틀리면 null. `every`·`slice`는 구멍 난 배열(structured clone이
 * 그대로 옮긴다)의 빈 칸을 건너뛰거나 남기므로 인덱스로 하나씩 본다.
 */
function framesCopy(frames: unknown): string[] | null {
  if (!Array.isArray(frames) || frames.length > REPORT_MAX_FRAMES) return null
  const out: string[] = []
  for (let i = 0; i < frames.length; i += 1) {
    if (!(i in frames)) return null
    const f: unknown = frames[i]
    if (typeof f !== 'string' || f.length > REPORT_FRAME_MAX_LENGTH) return null
    out.push(f)
  }
  return out
}

export function validateReport(payload: unknown): TemplateReport {
  const kind = TEMPLATE_REPORT_KINDS.find((k) => k === field(payload, 'kind'))
  const message = field(payload, 'message')
  const frames = framesCopy(field(payload, 'frames'))
  const count = field(payload, 'count')
  if (
    !kind ||
    typeof message !== 'string' ||
    message.length > REPORT_MESSAGE_MAX_LENGTH ||
    frames === null ||
    typeof count !== 'number' ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > REPORT_COUNT_MAX
  ) {
    throw new BridgeError('BAD_REQUEST', 'invalid report')
  }
  return Object.freeze({
    kind,
    message,
    frames: Object.freeze(frames),
    count,
  })
}
