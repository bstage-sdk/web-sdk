import type { BridgeInit } from '../protocol/messages.js'
import type { BridgeClient, BridgeClientConfig, BridgeRequester, RuntimeGlobal } from './types.js'

/**
 * 프레임 브리지 런타임.
 *
 * **자기완결 함수다.** `createSrcdoc`가 `Function.prototype.toString()`으로 이 함수 본문을
 * srcdoc 부트스트랩에 그대로 심는다(템플릿 번들에는 브리지 패키지가 들어 있지 않다). 그래서
 * - 바깥 식별자(import한 값·모듈 상수)를 참조하지 않는다. 타입 import는 지워지므로 괜찮다.
 * - 번들러가 헬퍼를 주입할 수 있는 문법(`?.`·`??`·스프레드·async/await·for-of·class)을 쓰지 않는다.
 *   (optional catch binding `catch {}`은 ES2019라 쓴다.)
 * 프로토콜 상수·봉투 검사를 protocol 모듈과 중복해 두는 이유가 이것이다. 값이 어긋나지 않게
 * `createBridgeClient.test.ts`가 protocol 상수와 대조하고, `createSrcdoc.test.ts`가 빈 vm 컨텍스트
 * (넘긴 전역만 보이는 realm)에서 실행해 자기완결성을 확인한다. 코드를 주입하는 계측(istanbul 등)을
 * 쓰면 직렬화가 깨진다 — 커버리지는 v8로만 잰다.
 *
 * @param g 프레임 전역(`globalThis`)
 * @param makeFetch 클라이언트로 fetch 함수를 만드는 함수(`createBridgeFetch`, 역시 자기완결)
 * @param config srcdoc에 심긴 세션·hostOrigin
 */
export function bridgeRuntime(
  g: RuntimeGlobal,
  makeFetch: (client: BridgeRequester) => typeof globalThis.fetch,
  config: BridgeClientConfig,
): BridgeClient {
  const NS = 'bstage-bridge'
  const TIMEOUT_MS = 15000
  const READY_INTERVAL_MS = 250
  const READY_FAST_ATTEMPTS = 40
  const READY_SLOW_INTERVAL_MS = 2000
  const MAX_ID = 64
  const MAX_TYPE = 32

  if (g.__bstage_bridge__) return g.__bstage_bridge__

  const session = config.session
  const hostOrigin = config.hostOrigin
  const parent = g.parent
  const pending = new Map<
    string,
    {
      resolve: (v: unknown) => void
      reject: (e: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  const listeners = new Map<string, Array<(payload: unknown) => void>>()
  let init: BridgeInit | undefined
  let seq = 0

  function randomPrefix(): string {
    const bytes = new Uint8Array(8)
    if (g.crypto && typeof g.crypto.getRandomValues === 'function') {
      g.crypto.getRandomValues(bytes)
    } else {
      for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256)
    }
    let out = ''
    for (let i = 0; i < bytes.length; i += 1) out += (bytes[i] + 256).toString(16).slice(1)
    return out
  }
  const idPrefix = randomPrefix()

  function nextId(): string {
    seq += 1
    return idPrefix + '-' + seq
  }

  function codeError(code: string, message: string): Error {
    const err = new Error(message)
    err.name = 'BridgeError'
    ;(err as Error & { code: string }).code = code
    return err
  }

  function post(kind: string, type: string, id: string, payload: unknown): void {
    if (!parent) return
    const body = Object.assign({}, payload, { session: session })
    parent.postMessage({ v: 1, ns: NS, id: id, kind: kind, type: type, payload: body }, hostOrigin)
  }

  function isEnvelope(m: unknown): m is {
    id: string
    kind: string
    type: string
    payload: unknown
  } {
    if (typeof m !== 'object' || m === null) return false
    const e = m as Record<string, unknown>
    return (
      e.v === 1 &&
      e.ns === NS &&
      typeof e.id === 'string' &&
      e.id.length > 0 &&
      e.id.length <= MAX_ID &&
      (e.kind === 'req' || e.kind === 'res' || e.kind === 'evt') &&
      typeof e.type === 'string' &&
      e.type.length > 0 &&
      e.type.length <= MAX_TYPE &&
      'payload' in e
    )
  }

  let resolveReady: (value: BridgeInit) => void = function () {}
  // ready는 reject하지 않는다 — 호스트가 늦게 붙어도(지연 hydration·lazy mount) init을 받을 때까지 기다린다.
  const ready = new Promise<BridgeInit>(function (resolve) {
    resolveReady = resolve
  })

  function emit(type: string, payload: unknown): void {
    const fns = listeners.get(type)
    if (!fns) return
    fns.slice().forEach(function (fn) {
      try {
        fn(payload)
      } catch {
        // 구독자 예외가 다른 구독자·브리지를 멈추지 않게 한다.
      }
    })
  }

  /** 이벤트를 init 스냅샷에 반영한다(새 객체로 교체). */
  function applyEvent(type: string, payload: unknown): void {
    if (!init || typeof payload !== 'object' || payload === null) return
    const p = payload as Record<string, unknown>
    if (type === 'locale' && typeof p.locale === 'string') {
      init = Object.assign({}, init, { locale: p.locale, translations: p.translations })
    } else if (type === 'member' && typeof p.signedIn === 'boolean') {
      init = Object.assign({}, init, { member: payload })
    } else if (type === 'theme' && typeof p.dark === 'boolean') {
      init = Object.assign({}, init, { theme: payload })
    } else if (type === 'slot.context' && typeof p.id === 'string') {
      init = Object.assign({}, init, { slot: payload })
    }
  }

  function onMessage(ev: { source: unknown; origin: string; data: unknown }): void {
    if (!parent || ev.source !== parent) return
    if (ev.origin !== hostOrigin) return
    const m = ev.data
    if (!isEnvelope(m)) return
    const result = m.payload as {
      ok?: boolean
      data?: unknown
      error?: { code?: string; message?: string }
    } | null

    if (m.kind === 'res' && m.type === 'init') {
      if (!init && result && result.ok === true && result.data) {
        init = result.data as BridgeInit
        clearInterval(readyTimer)
        resolveReady(init)
      }
      return
    }
    if (m.kind === 'res') {
      const entry = pending.get(m.id)
      if (!entry) return
      pending.delete(m.id)
      clearTimeout(entry.timer)
      if (result && result.ok === true) {
        entry.resolve(result.data)
      } else {
        const error = (result && result.error) || {}
        entry.reject(
          codeError(
            typeof error.code === 'string' ? error.code : 'BAD_REQUEST',
            typeof error.message === 'string' ? error.message : 'bridge request failed',
          ),
        )
      }
      return
    }
    if (m.kind === 'evt') {
      applyEvent(m.type, m.payload)
      emit(m.type, m.payload)
    }
  }

  g.addEventListener('message', onMessage)

  let readyAttempts = 0
  function sendReady(): void {
    readyAttempts += 1
    if (readyAttempts === READY_FAST_ATTEMPTS) {
      // 처음 10초는 촘촘히, 그 뒤로는 느리게 계속 보낸다(포기하면 프레임이 영구히 빈 화면이 된다).
      clearInterval(readyTimer)
      readyTimer = setInterval(sendReady, READY_SLOW_INTERVAL_MS)
    }
    post('evt', 'ready', nextId(), {})
  }
  // 호스트 리스너가 아직 없을 때 보낸 ready는 사라지므로 init을 받을 때까지 다시 보낸다.
  // 프레임 수명이 곧 이 런타임의 수명이라 리스너·타이머를 따로 해제하지 않는다(iframe 제거로 함께 사라진다).
  let readyTimer = setInterval(sendReady, READY_INTERVAL_MS)
  sendReady()

  function request(type: string, payload: unknown): Promise<unknown> {
    return new Promise(function (resolve, reject) {
      const id = nextId()
      const timer = setTimeout(function () {
        pending.delete(id)
        reject(codeError('TIMEOUT', 'bridge request timed out: ' + type))
      }, TIMEOUT_MS)
      pending.set(id, { resolve: resolve, reject: reject, timer: timer })
      post('req', type, id, payload || {})
    })
  }

  function on(type: string, fn: (payload: unknown) => void): () => void {
    const current = listeners.get(type) || []
    listeners.set(type, current.concat([fn]))
    return function () {
      const now = listeners.get(type) || []
      listeners.set(
        type,
        now.filter(function (f) {
          return f !== fn
        }),
      )
    }
  }

  const base = {
    version: 1 as const,
    hostOrigin: hostOrigin,
    ready: ready,
    getInit: function () {
      return init
    },
    request: request as BridgeClient['request'],
    on: on as BridgeClient['on'],
  }
  const client: BridgeClient = Object.freeze(Object.assign({}, base, { fetch: makeFetch(base) }))
  // 템플릿 코드가 실수로 덮어쓰지 못하게 쓰기 불가로 설치한다.
  Object.defineProperty(g, '__bstage_bridge__', {
    value: client,
    writable: false,
    configurable: false,
    enumerable: false,
  })
  return client
}
