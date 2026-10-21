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
  // 부트스트랩 시점(템플릿 코드보다 먼저)에 묶어 둔다. 이후 템플릿이 전역·프로토타입을 바꿔도
  // 프레임 → 호스트 전송 경로는 이 참조만 쓴다.
  const sendToHost = parent ? parent.postMessage.bind(parent) : undefined
  // 언로드 경로가 쓰는 전역도 부트스트랩 때 잡아 둔다 — 템플릿이 나중에 전역을 바꿔(던지게 해) 전송을 막지 못하게.
  const stopInterval = clearInterval
  const stopTimeout = clearTimeout
  // PageTransitionEvent.prototype.persisted 접근자도 원본을 잡아 둔다(템플릿이 재정의해 항상 true로 만들거나 던지게 못 하게).
  // Function.prototype.call.bind로 묶어 이후 call/apply 교체의 영향도 받지 않는다.
  let readPersisted: ((ev: unknown) => unknown) | undefined
  // 접근자를 못 잡은 환경의 대체 경로용 — 이벤트의 자기 데이터 속성만 본다(프로토타입 체인 미경유).
  const ownDescriptor = Object.getOwnPropertyDescriptor
  const hasOwn = Function.prototype.call.bind(Object.prototype.hasOwnProperty) as (
    o: unknown,
    k: string,
  ) => boolean
  try {
    const pte = g.PageTransitionEvent
    const desc = pte ? Object.getOwnPropertyDescriptor(pte.prototype, 'persisted') : undefined
    if (desc && typeof desc.get === 'function')
      readPersisted = Function.prototype.call.bind(desc.get)
  } catch {
    readPersisted = undefined
  }
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

  /** CSPRNG로만 만든 128비트 hex. getRandomValues가 없으면 빈 문자열(Math.random 폴백 금지 — 예측 가능). */
  function secureToken(): string {
    if (!g.crypto || typeof g.crypto.getRandomValues !== 'function') return ''
    const bytes = new Uint8Array(16)
    g.crypto.getRandomValues(bytes)
    let out = ''
    for (let i = 0; i < bytes.length; i += 1) out += (bytes[i] + 256).toString(16).slice(1)
    return out
  }
  // 이 문서 인스턴스의 프레임 토큰(128비트). 클로저 밖으로 내보내지 않고, 봉투 최상위에 객체 리터럴로만
  // 싣는다(리터럴 생성은 Object.prototype setter를 부르지 않는다). 호스트는 처음 본 토큰에 세션을 묶고
  // 다른 토큰(= 새 문서)이 오면 세션을 끊는다 — 내비게이션된 새 문서는 세션을 URL로 받아도 이 값은 모른다.
  // idPrefix(봉투 id로 공개)와 따로 뽑는다. CSPRNG가 없으면 브리지를 열지 않는다(아무것도 보내지 않는다).
  const frameToken = secureToken()
  let closed = frameToken === ''
  let unloaded = false

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
    if (!sendToHost || closed) return
    const body = Object.assign({}, payload, { session: session })
    sendToHost(
      { v: 1, ns: NS, id: id, kind: kind, type: type, payload: body, frame: frameToken },
      hostOrigin,
    )
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

  /** bfcache 진입 여부. 잡아 둔 원본 접근자로 읽고, 읽기가 실패하면 진입이 아닌 것으로 본다(보내는 쪽으로 실패). */
  function isPersisted(ev: unknown): boolean {
    try {
      if (readPersisted) return readPersisted(ev) === true
      // 템플릿이 Object.prototype.persisted 등을 심어도 속지 않게 자기 데이터 속성만 인정한다.
      if (typeof ev !== 'object' || ev === null) return false
      const desc = ownDescriptor(ev, 'persisted')
      return !!desc && hasOwn(desc, 'value') && desc.value === true
    } catch {
      return false
    }
  }

  /**
   * 문서가 내려갈 때(자기 내비게이션·iframe 제거) 호스트에 `frame-unload`를 동기로 보낸다. 호스트는 받는 즉시
   * 세션을 끊는다. 템플릿 코드보다 먼저 capture로 등록하고, **전송을 가장 먼저** 하며 전송 경로는 리터럴과
   * 부트스트랩 때 잡아 둔 참조(postMessage·persisted 접근자)만 쓴다 — 템플릿이 전역·프로토타입을 바꿔도
   * 전송을 막지 못한다. 정리(타이머·대기 요청)는 전송 뒤에 각각 따로 try로 감싼다.
   * bfcache로 들어가는 경우(`persisted: true`)는 보내지 않는다 — 복원되면 같은 문서가 계속 쓴다.
   */
  function onPageHide(ev: unknown): void {
    // closed(브리지를 열지 못함)여도 보낸다 — 토큰이 빈 frame-unload도 호스트는 받으면 dispose한다.
    if (unloaded || isPersisted(ev)) return
    unloaded = true
    closed = true
    if (sendToHost) {
      try {
        sendToHost(
          {
            v: 1,
            ns: NS,
            id: idPrefix + '-unload',
            kind: 'evt',
            type: 'frame-unload',
            payload: { session: session },
            frame: frameToken,
          },
          hostOrigin,
        )
      } catch {
        // 내려가는 중인 문서에서 전송이 실패해도 할 수 있는 것이 없다.
      }
    }
    try {
      stopInterval(readyTimer)
    } catch {
      // 정리 실패는 무시한다(전송은 이미 끝났다).
    }
    try {
      pending.forEach(function (entry) {
        try {
          stopTimeout(entry.timer)
          entry.reject(codeError('UNSUPPORTED', 'bridge closed'))
        } catch {
          // 한 항목의 실패가 나머지 정리를 멈추지 않게 한다.
        }
      })
      pending.clear()
    } catch {
      // 템플릿이 Map 프로토타입을 바꿨어도 전송은 이미 끝났다.
    }
  }
  g.addEventListener('pagehide', onPageHide, true)

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
      if (closed) {
        reject(codeError('UNSUPPORTED', 'bridge closed'))
        return
      }
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
