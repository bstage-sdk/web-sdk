import type { TemplateReportKind } from '../protocol/messages.js'
import type { BridgeClient } from './types.js'

/** `installErrorReport` 설정 — srcdoc 부트스트랩이 프로토콜 상한을 상수로 넘긴다. */
export interface ErrorReportConfig {
  /** 세션당 서로 다른 fingerprint 상한. 닿으면 리스너를 해제한다. */
  readonly maxReports: number
  readonly maxMessageLength: number
  readonly maxFrames: number
  readonly maxFrameLength: number
  /** 같은 fingerprint 누적 횟수 상한. */
  readonly maxCount: number
  /** 첫 발생 뒤 보내기까지 기다리는 시간(ms). 그 사이 같은 fingerprint는 count로 묶인다. */
  readonly flushDelayMs: number
}

/** 수집기가 쓰는 전역의 최소 모양 — 테스트에서 가짜 창을 넘길 수 있게 한다. */
export interface ErrorReportGlobal {
  addEventListener?(type: 'error' | 'unhandledrejection', fn: (ev: never) => void): void
  removeEventListener?(type: 'error' | 'unhandledrejection', fn: (ev: never) => void): void
  setTimeout?: (fn: () => void, ms: number) => unknown
}

/** 수집기에 직접 넣는 함수 — 엔트리 스크립트 load 실패처럼 이벤트가 아닌 것을 보고할 때 쓴다. */
export type ErrorReportRecord = (kind: TemplateReportKind, message: unknown, stack: unknown) => void

/**
 * 격리 프레임의 템플릿 에러 수집기를 설치한다(`createSrcdoc` 부트스트랩이 항상 설치한다).
 *
 * - 전역 `error`·`unhandledrejection`을 듣고, 반환 함수로 엔트리 load 실패(kind `load`)도 받는다.
 * - 정규화: message는 문자열로 바꿔 `maxMessageLength`에서 자르고, 스택은 줄로 나눠 프레임 꼴(`at …`·`f@url`·
 *   `…:줄:열`)인 줄만 `maxFrames`개·각 `maxFrameLength`자로 남긴다. ev.error가 없으면(교차 origin "Script error." 등)
 *   ev.message와 `filename:lineno:colno`를 쓴다.
 * - fingerprint(kind + 숫자를 뺀 message + 첫 프레임)마다 한 번만 보낸다. 첫 발생 뒤 `flushDelayMs` 동안 같은
 *   fingerprint는 count로 묶고(`maxCount`까지), 보낸 뒤의 반복은 버린다.
 * - 서로 다른 fingerprint는 세션당 `maxReports`건까지. 닿으면 리스너를 해제한다.
 *
 * URL·placement는 싣지 않는다 — 귀속은 호스트가 자기가 띄운 템플릿으로 한다. 보내기 실패는 삼킨다.
 *
 * **자기완결 함수다** — `bridgeRuntime`과 함께 srcdoc에 `toString()`으로 심긴다(runtime.ts 주석 참고).
 * 템플릿 코드보다 먼저 돌며 `setTimeout`을 이때 잡아 둔다. 템플릿이 다른 전역을 바꿔 보고가 틀어져도
 * 호스트가 형식을 다시 검사하므로(`validateReport`) 이 수집기는 신뢰 경계가 아니다.
 *
 * @param g 프레임 전역(`globalThis`)
 * @param client 프레임 브리지 클라이언트(`bridgeRuntime` 결과)
 * @param config 프로토콜 상한과 묶음 대기 시간
 * @returns 이벤트 밖의 에러를 넣는 함수
 */
export function installErrorReport(
  g: ErrorReportGlobal,
  client: Pick<BridgeClient, 'request'>,
  config: ErrorReportConfig,
): ErrorReportRecord {
  const schedule = typeof g.setTimeout === 'function' ? g.setTimeout : undefined
  const entries = new Map<
    string,
    {
      readonly kind: TemplateReportKind
      readonly message: string
      readonly frames: string[]
      readonly count: number
      readonly sent: boolean
    }
  >()
  let admitted = 0

  function toText(value: unknown): string {
    if (typeof value === 'string') return value
    try {
      return String(value)
    } catch {
      return ''
    }
  }

  function framesOf(stack: unknown): string[] {
    const out: string[] = []
    if (typeof stack !== 'string') return out
    const lines = stack.split('\n')
    for (let i = 0; i < lines.length && out.length < config.maxFrames; i += 1) {
      const line = lines[i].trim()
      // 프레임 형식에만 맞춘다 — V8 `at f (url:1:2)`, Firefox·Safari `f@url:1:2`(`global code@url` 포함),
      // URL만 있는 줄. 메시지 줄("Error: a@b.com …:1:2", 여러 줄 메시지)은 @나 :줄:열이 있어도 프레임이 아니다 —
      // 프레임으로 새면 메시지 300자 상한을 우회하고 fingerprint(첫 프레임)가 흔들린다.
      if (
        /^at\s/.test(line) ||
        /^[^@]*@(?:[a-z][\w+.-]*:\/\/|\/)\S*:\d+:\d+$/i.test(line) ||
        /^(?:[a-z][\w+.-]*:\/\/|\/)\S*:\d+:\d+$/i.test(line)
      )
        out.push(line.slice(0, config.maxFrameLength))
    }
    return out
  }

  function send(key: string): void {
    const entry = entries.get(key)
    if (!entry || entry.sent) return
    entries.set(key, {
      kind: entry.kind,
      message: entry.message,
      frames: entry.frames,
      count: entry.count,
      sent: true,
    })
    try {
      client
        .request('report', {
          kind: entry.kind,
          message: entry.message,
          frames: entry.frames,
          count: entry.count,
        })
        .catch(function () {})
    } catch {
      // 브리지가 닫혔거나 클라이언트가 망가졌다 — 보고는 버린다.
    }
  }

  function record(kind: TemplateReportKind, message: unknown, stack: unknown): void {
    try {
      const text = toText(message).slice(0, config.maxMessageLength)
      const frames = framesOf(stack)
      const key = kind + '|' + text.replace(/\d+/g, '') + '|' + (frames[0] || '')
      const entry = entries.get(key)
      if (entry) {
        if (!entry.sent && entry.count < config.maxCount) {
          entries.set(key, {
            kind: entry.kind,
            message: entry.message,
            frames: entry.frames,
            count: entry.count + 1,
            sent: false,
          })
        }
        return
      }
      if (admitted >= config.maxReports) return
      admitted += 1
      entries.set(key, { kind: kind, message: text, frames: frames, count: 1, sent: false })
      if (admitted >= config.maxReports) stop()
      if (schedule) {
        schedule(function () {
          send(key)
        }, config.flushDelayMs)
      } else {
        send(key)
      }
    } catch {
      // 수집기의 실패가 템플릿 에러 처리를 더 깨지 않게 한다.
    }
  }

  function onError(ev: {
    message?: unknown
    error?: { message?: unknown; stack?: unknown } | null
    filename?: unknown
    lineno?: unknown
    colno?: unknown
  }): void {
    const err = ev && ev.error
    if (err && typeof err === 'object') {
      record('error', typeof err.message === 'string' ? err.message : ev.message, err.stack)
      return
    }
    const where =
      ev && typeof ev.filename === 'string' && ev.filename !== ''
        ? 'at ' + ev.filename + ':' + toText(ev.lineno) + ':' + toText(ev.colno)
        : ''
    record('error', ev ? ev.message : '', where)
  }

  function onRejection(ev: { reason?: unknown }): void {
    const reason = ev ? ev.reason : undefined
    if (reason && typeof reason === 'object' && typeof (reason as Error).message === 'string') {
      record('rejection', (reason as Error).message, (reason as Error).stack)
      return
    }
    record('rejection', reason, '')
  }

  function stop(): void {
    if (typeof g.removeEventListener !== 'function') return
    g.removeEventListener('error', onError as (ev: never) => void)
    g.removeEventListener('unhandledrejection', onRejection as (ev: never) => void)
  }

  if (typeof g.addEventListener === 'function') {
    g.addEventListener('error', onError as (ev: never) => void)
    g.addEventListener('unhandledrejection', onRejection as (ev: never) => void)
  }
  return record
}
