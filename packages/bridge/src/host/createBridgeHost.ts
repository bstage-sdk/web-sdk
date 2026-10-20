import { createEnvelope, hasSession, isBridgeEnvelope } from '../protocol/envelope.js'
import type { BridgeEnvelope } from '../protocol/envelope.js'
import { BridgeError, isBridgeErrorLike } from '../protocol/errors.js'
import type { BridgeErrorCode } from '../protocol/errors.js'
import {
  INIT_RESPONSE,
  READY_EVENT,
  isBridgeSurface,
  isHostEventType,
  isRequestType,
} from '../protocol/messages.js'
import type { BridgeRequestType, BridgeResult, FetchResult } from '../protocol/messages.js'
import { createSession, isValidSession } from '../protocol/session.js'
import {
  normalizeExactOrigin,
  normalizePartnerOrigins,
  normalizePinnedHeaders,
  prepareFetch,
  resolvePolicy,
} from './policy.js'
import type { DestinationContext } from './policy.js'
import { createRateLimiter, type RateLimiter } from './rateLimiter.js'
import { applyEvent, buildInit, sanitizeEvent } from './events.js'
import { handleStorage } from './storage.js'
import type {
  BridgeHost,
  BridgeHostHandlers,
  CreateBridgeHostOptions,
  FrameWindow,
  HostFetch,
  HostWindow,
  MessageEventLike,
} from './types.js'
import {
  validateExternalUrl,
  validateHeight,
  validateLog,
  validatePath,
  validateToast,
  validateTrack,
} from './validators.js'

/** sandbox(allow-same-origin 없음) srcdoc 프레임의 origin. */
const OPAQUE_ORIGIN = 'null'

/** 레이트 리밋에서 빼는 요청 — rAF로 합쳐지는 높이 보고. */
const UNLIMITED_REQUESTS: readonly BridgeRequestType[] = ['resize']

const EMPTY = Object.freeze({}) as Record<string, never>

/**
 * 프레임별 동시 진행 fetch 상한 — 프로토콜에 정해지지 않은 값(구현 선택). 분당 상한만으로는
 * 느린 응답 수백 개를 한꺼번에 붙잡아 호스트 메모리를 쓰게 할 수 있어 동시 수를 따로 막는다.
 */
export const MAX_IN_FLIGHT_FETCHES = 16

/** 프레임별 toast 분당 상한 — 구현 선택. 템플릿이 호스트 UI를 토스트로 덮지 못하게 한다. */
export const TOAST_PER_MINUTE = 5
/** ready 응답 초당 상한 — 정상 프레임은 250ms 간격(초당 4회)으로 보내다 init을 받으면 멈춘다. */
export const READY_PER_SECOND = 2
/** resize 초당 상한 — 정상 부트스트랩은 rAF로 합쳐 값이 바뀔 때만 보낸다. */
export const RESIZE_PER_SECOND = 30

/**
 * 파트너·외부 origin 기본 fetch — 쿠키 없음(`credentials: 'omit'`), 인증 헤더 없음, redirect 차단,
 * Referer 없음. 정책이 이미 이 값들과 허용 헤더만으로 init을 만들지만, 호출 시점에도 한 번 더 고정한다.
 */
const defaultUncredentialedFetch: HostFetch = (url, init) =>
  globalThis.fetch(url, {
    ...init,
    credentials: 'omit',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
  })

interface HostContext {
  readonly options: CreateBridgeHostOptions
  readonly handlers: BridgeHostHandlers
  readonly win: HostWindow
  readonly destination: DestinationContext
  readonly storageScope: string
  readonly phase: string
  readonly fetchImpl: HostFetch
  readonly partnerFetchImpl: HostFetch
  readonly externalFetchImpl: HostFetch
  readonly hostOrigin: string
  readonly toastLimiter: RateLimiter
  readonly scheduleResize: (height: number) => void
}

function unsupported(): never {
  throw new BridgeError('UNSUPPORTED', 'not supported by host')
}

const TOO_LARGE = (): BridgeError => new BridgeError('BODY_TOO_LARGE', 'response too large')

/**
 * 응답 본문을 상한까지만 읽는다. content-length가 없는(chunked·스트리밍) 응답도 누적 바이트가
 * 상한을 넘는 순간 스트림을 취소해, 상한보다 큰 본문을 메모리에 올리지 않는다.
 */
async function readBodyCapped(res: Response, max: number): Promise<string> {
  const stream = res.body
  // 본문이 없는(null) 응답만 text()로 읽는다 — 빈 문자열이라 버퍼링할 것이 없다.
  if (stream === null) {
    try {
      return await res.text()
    } catch {
      throw new BridgeError('NETWORK_ERROR', 'network error')
    }
  }
  // 스트림을 읽을 수 없는 비표준 Response는 상한을 지키며 읽을 방법이 없어 거절한다(전체 버퍼링 금지).
  if (typeof stream?.getReader !== 'function') {
    throw new BridgeError('NETWORK_ERROR', 'network error')
  }
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let received = 0
  let text = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > max) {
        void reader.cancel().catch(() => {})
        throw TOO_LARGE()
      }
      text += decoder.decode(value, { stream: true })
    }
  } catch (err) {
    if (err instanceof BridgeError) throw err
    throw new BridgeError('NETWORK_ERROR', 'network error')
  }
  return text + decoder.decode()
}

async function runFetch(ctx: HostContext, payload: unknown): Promise<FetchResult> {
  const prepared = prepareFetch(payload, ctx.destination)
  let res: Response
  try {
    // 갈래마다 다른 fetch — 플랫폼 인증 fetch(fetchImpl)는 같은 origin /gw에만 쓴다. 파트너는 호스트가
    // 고른 partnerFetchImpl, 그 밖의 https는 무인증 externalFetchImpl.
    const send =
      prepared.kind === 'gateway'
        ? ctx.fetchImpl
        : prepared.kind === 'partner'
          ? ctx.partnerFetchImpl
          : ctx.externalFetchImpl
    res = await send(prepared.url, {
      ...prepared.init,
      headers: { ...prepared.init.headers },
    })
  } catch {
    // 주입 fetch의 예외 메시지(내부 URL·정책 사유)는 프레임에 싣지 않는다.
    throw new BridgeError('NETWORK_ERROR', 'network error')
  }
  const max = ctx.destination.policy.maxResponseBytes
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > max) {
    void res.body?.cancel().catch(() => {})
    throw TOO_LARGE()
  }
  if (prepared.init.method === 'HEAD') {
    // HEAD에 본문을 붙여 보내는 목적지도 있다 — 읽지 않고 취소해 연결·버퍼를 붙잡지 않는다.
    void res.body?.cancel().catch(() => {})
  }
  const bodyText = prepared.init.method === 'HEAD' ? '' : await readBodyCapped(res, max)
  const contentType = res.headers.get('content-type')
  return {
    status: res.status,
    statusText: res.statusText,
    headers: contentType !== null ? { 'content-type': contentType } : {},
    bodyText,
  }
}

function writeConsole(level: 'debug' | 'info' | 'warn' | 'error', message: string): void {
  const write = globalThis.console?.[level]
  if (typeof write === 'function') write.call(globalThis.console, `[bstage-bridge] ${message}`)
}

/** 요청 type별 처리. 반환값이 res의 data가 된다. */
async function dispatch(
  ctx: HostContext,
  type: BridgeRequestType,
  payload: unknown,
): Promise<unknown> {
  const h = ctx.handlers
  switch (type) {
    case 'fetch':
      return runFetch(ctx, payload)
    case 'navigate': {
      const path = validatePath(payload, ctx.hostOrigin)
      if (!h.navigate) unsupported()
      h.navigate(path)
      return EMPTY
    }
    case 'back':
      if (!h.back) unsupported()
      h.back()
      return EMPTY
    case 'openExternal': {
      const url = validateExternalUrl(payload)
      if (h.openExternal) h.openExternal(url)
      else if (typeof ctx.win.open === 'function')
        ctx.win.open(url, '_blank', 'noopener,noreferrer')
      else unsupported()
      return EMPTY
    }
    case 'toast': {
      const { message, kind } = validateToast(payload)
      if (!h.toast) unsupported()
      if (!ctx.toastLimiter.take()) throw new BridgeError('RATE_LIMITED', 'too many toasts')
      h.toast(message, kind)
      return EMPTY
    }
    case 'resize':
      ctx.scheduleResize(validateHeight(payload))
      return EMPTY
    case 'track': {
      const { name, params } = validateTrack(payload)
      if (!h.track) unsupported()
      h.track(name, params)
      return EMPTY
    }
    case 'storage':
      return handleStorage(ctx.storageScope, (payload ?? {}) as Record<string, unknown>)
    case 'log': {
      const { level, message } = validateLog(payload)
      if (ctx.phase === 'real') return EMPTY
      if (h.log) h.log(level, message)
      else writeConsole(level, message)
      return EMPTY
    }
  }
}

function failure(code: BridgeErrorCode, message: string): BridgeResult<never> {
  return { ok: false, error: { code, message } }
}

function toFailure(err: unknown): BridgeResult<never> {
  if (err instanceof BridgeError || isBridgeErrorLike(err)) return failure(err.code, err.message)
  // 처리기(호스트 코드)의 예외 메시지는 싣지 않는다.
  return failure('BAD_REQUEST', 'request failed')
}

function assertOptions(options: CreateBridgeHostOptions): string {
  if (!options || typeof options !== 'object') {
    throw new TypeError('[bstage-bridge] createBridgeHost 옵션이 필요합니다')
  }
  if (!isValidSession(options.session)) {
    throw new TypeError('[bstage-bridge] session 형식이 잘못됐습니다(createSession() 사용)')
  }
  const hostOrigin = normalizeExactOrigin(options.hostOrigin, ['https:', 'http:'])
  if (!hostOrigin) throw new TypeError('[bstage-bridge] hostOrigin은 정확한 origin이어야 합니다')
  if (typeof options.fetchImpl !== 'function') {
    throw new TypeError('[bstage-bridge] fetchImpl이 필요합니다')
  }
  if (options.partnerFetchImpl !== undefined && typeof options.partnerFetchImpl !== 'function') {
    throw new TypeError('[bstage-bridge] partnerFetchImpl은 함수여야 합니다')
  }
  if (options.externalFetchImpl !== undefined && typeof options.externalFetchImpl !== 'function') {
    throw new TypeError('[bstage-bridge] externalFetchImpl은 함수여야 합니다')
  }
  // 흔한 오설정 — 인증 fetch(게이트웨이용·파트너용)를 외부 갈래에 그대로 넘기면 임의 https로 토큰이 나간다.
  if (options.externalFetchImpl !== undefined && options.externalFetchImpl === options.fetchImpl) {
    throw new TypeError(
      '[bstage-bridge] externalFetchImpl에 fetchImpl(인증 fetch)을 쓸 수 없습니다',
    )
  }
  // 게이트웨이 인증 fetch를 파트너 갈래에 넘기면 호스트 자격증명이 파트너 origin으로 나가고, 파트너 갈래는
  // 경로 거절 규칙을 적용하지 않으므로 프레임이 고른 인증 요청이 그대로 나간다.
  if (options.partnerFetchImpl !== undefined && options.partnerFetchImpl === options.fetchImpl) {
    throw new TypeError('[bstage-bridge] partnerFetchImpl에 fetchImpl(인증 fetch)을 쓸 수 없습니다')
  }
  if (
    options.externalFetchImpl !== undefined &&
    options.externalFetchImpl === options.partnerFetchImpl
  ) {
    throw new TypeError(
      '[bstage-bridge] externalFetchImpl에 partnerFetchImpl(팬 토큰 fetch)을 쓸 수 없습니다',
    )
  }
  if (!options.iframe || !options.init) {
    throw new TypeError('[bstage-bridge] iframe·init이 필요합니다')
  }
  if (!isBridgeSurface(options.init.surface)) {
    throw new TypeError('[bstage-bridge] init.surface는 "page" 또는 "slot"이어야 합니다')
  }
  return hostOrigin
}

/**
 * 플랫폼 측 브리지 호스트.
 *
 * - 발신자 확인: `ev.source === iframe.contentWindow`, origin `"null"`(sandbox 프레임), 봉투 형식,
 *   `payload.session === session`이 모두 맞는 메시지만 처리한다.
 * - `evt:ready`에 `res:init`으로 답한다(프레임이 재전송하면 매번 최신 init으로).
 * - 요청은 fetch 정책(policy.ts)·요청별 상한(validators.ts)을 적용해 처리기 또는 주입 `fetchImpl`로 넘긴다.
 *
 * 토큰은 이 함수가 다루지 않는다 — 인증은 `fetchImpl`(플랫폼의 인증 fetch)이 호스트 쪽에서 붙이고,
 * 프레임에는 응답 본문·상태·content-type만 돌아간다.
 */
export function createBridgeHost(options: CreateBridgeHostOptions): BridgeHost {
  const hostOrigin = assertOptions(options)
  const policy = resolvePolicy(options.policy)
  const partnerOrigins = normalizePartnerOrigins(options.init.partnerOrigins, hostOrigin)
  const pinnedHeaders = normalizePinnedHeaders(options.pinnedHeaders)
  const { iframe, session } = options
  const win: HostWindow = iframe.ownerDocument?.defaultView ?? (globalThis as unknown as HostWindow)
  const handlers = options.handlers ?? {}
  const limiter = createRateLimiter(policy.maxRequestsPerMinute)
  const readyLimiter = createRateLimiter(READY_PER_SECOND, 1000)
  const resizeLimiter = createRateLimiter(RESIZE_PER_SECOND, 1000)

  let current = buildInit(options.init, hostOrigin, partnerOrigins, policy)
  let inFlightFetches = 0
  let disposed = false
  let resizeHandle: number | undefined
  let pendingHeight: number | undefined

  const raf =
    typeof win.requestAnimationFrame === 'function'
      ? (cb: () => void) => win.requestAnimationFrame!(cb)
      : (cb: () => void) => setTimeout(cb, 16) as unknown as number
  const cancelRaf =
    typeof win.cancelAnimationFrame === 'function'
      ? (id: number) => win.cancelAnimationFrame!(id)
      : (id: number) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>)

  function scheduleResize(height: number): void {
    pendingHeight = height
    if (resizeHandle !== undefined || !handlers.resize) return
    resizeHandle = raf(() => {
      resizeHandle = undefined
      const h = pendingHeight
      pendingHeight = undefined
      if (!disposed && h !== undefined) handlers.resize?.(h)
    })
  }

  const ctx: HostContext = {
    options,
    handlers,
    win,
    destination: { hostOrigin, partnerOrigins, policy, pinnedHeaders },
    storageScope: `${options.init.spaceId}\u0000${options.init.placementId}`,
    phase: options.init.phase,
    fetchImpl: options.fetchImpl,
    partnerFetchImpl: options.partnerFetchImpl ?? defaultUncredentialedFetch,
    externalFetchImpl: options.externalFetchImpl ?? defaultUncredentialedFetch,
    hostOrigin,
    toastLimiter: createRateLimiter(TOAST_PER_MINUTE),
    scheduleResize,
  }

  function post(target: FrameWindow, envelope: BridgeEnvelope): void {
    if (disposed) return
    // 프레임은 opaque origin이라 targetOrigin을 특정할 수 없다. 수신자는 source로 확인한다.
    target.postMessage(envelope, '*')
  }

  async function handleRequest(target: FrameWindow, env: BridgeEnvelope): Promise<void> {
    let result: BridgeResult<unknown>
    if (env.type === 'resize' && !resizeLimiter.take()) {
      // resize는 rAF로 합쳐 보내므로 이 상한에 걸리면 비정상 — 응답 없이 버린다(응답 자체가 비용).
      return
    }
    if (!isRequestType(env.type)) {
      result = failure('UNSUPPORTED', 'unknown request type')
    } else if (env.type === 'fetch' && inFlightFetches >= MAX_IN_FLIGHT_FETCHES) {
      result = failure('RATE_LIMITED', 'too many concurrent requests')
    } else if (!UNLIMITED_REQUESTS.includes(env.type) && !limiter.take()) {
      result = failure('RATE_LIMITED', 'too many requests')
    } else {
      if (env.type === 'fetch') inFlightFetches += 1
      try {
        result = { ok: true, data: await dispatch(ctx, env.type, env.payload) }
      } catch (err) {
        result = toFailure(err)
      } finally {
        if (env.type === 'fetch') inFlightFetches -= 1
      }
    }
    post(target, createEnvelope('res', env.type, env.id, result))
  }

  function onMessage(ev: MessageEventLike): void {
    if (disposed) return
    const frame = iframe.contentWindow
    if (!frame || ev.source !== frame) return
    if (ev.origin !== OPAQUE_ORIGIN) return
    const env = ev.data
    if (!isBridgeEnvelope(env)) return
    if (!hasSession(env.payload, session)) return

    if (env.kind === 'evt' && env.type === READY_EVENT) {
      if (!readyLimiter.take()) return
      post(frame, createEnvelope('res', INIT_RESPONSE, env.id, { ok: true, data: current }))
      return
    }
    if (env.kind === 'req') void handleRequest(frame, env)
  }

  win.addEventListener('message', onMessage)

  return {
    send(type, payload) {
      if (disposed) return
      if (!isHostEventType(type)) throw new TypeError(`[bstage-bridge] 알 수 없는 이벤트: ${type}`)
      if (typeof payload !== 'object' || payload === null) {
        throw new TypeError('[bstage-bridge] 이벤트 payload는 객체여야 합니다')
      }
      const clean = sanitizeEvent(type, payload)
      current = applyEvent(current, type, clean)
      const frame = iframe.contentWindow
      if (frame) post(frame, createEnvelope('evt', type, createSession(), clean))
    },
    dispose() {
      if (disposed) return
      disposed = true
      win.removeEventListener('message', onMessage)
      if (resizeHandle !== undefined) cancelRaf(resizeHandle)
      resizeHandle = undefined
    },
  }
}
