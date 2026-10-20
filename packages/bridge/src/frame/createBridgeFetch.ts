import type { FetchRequest, FetchResult } from '../protocol/messages.js'
import type { BridgeRequester } from './types.js'

/**
 * 브리지 경유 fetch를 만든다. 요청을 `fetch` 브리지 요청으로 바꾸고, 호스트가 돌려준
 * `{ status, statusText, headers, bodyText }`로 `Response`를 다시 만든다.
 *
 * **자기완결 함수다** — `bridgeRuntime`과 함께 srcdoc에 `toString()`으로 심긴다(runtime.ts 주석 참고).
 *
 * 제약(호스트 fetch 정책과 프레임에서 할 수 있는 일의 경계):
 * - body는 문자열·`URLSearchParams`·null만. FormData·Blob·스트림은 `TypeError`.
 * - `Request` 입력은 url·method·headers만 읽는다(본문은 동기로 읽을 수 없어 `init.body`로 넘긴다).
 * - `credentials`·`mode`·`cache` 등은 무시된다 — 호스트가 `credentials: "same-origin"`으로 보낸다.
 * - `signal`은 프레임 쪽 대기만 끊는다(호스트 요청은 취소되지 않는다).
 * - 응답 헤더는 content-type만 온다.
 */
export function createBridgeFetch(client: BridgeRequester): typeof globalThis.fetch {
  const NULL_BODY_STATUS = [204, 205, 304]

  function toHeaderRecord(h: unknown): Record<string, string> {
    const out: Record<string, string> = {}
    if (!h) return out
    new Headers(h as HeadersInit).forEach(function (value, key) {
      out[key] = value
    })
    return out
  }

  function abortError(signal: AbortSignal): unknown {
    if (signal.reason !== undefined) return signal.reason
    return new DOMException('The operation was aborted.', 'AbortError')
  }

  function bridgeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    return new Promise<Response>(function (resolve, reject) {
      const opts = init || {}
      const isRequest =
        typeof input === 'object' && input !== null && typeof (input as Request).method === 'string'
      const url = isRequest ? (input as Request).url : String(input)
      const method = String(opts.method || (isRequest ? (input as Request).method : 'GET'))
      const headers = toHeaderRecord(
        opts.headers || (isRequest ? (input as Request).headers : null),
      )
      let body: string | null = null

      // Request 본문은 동기로 읽을 수 없다 — 조용히 버리지 않고 거절한다.
      if (isRequest && (input as Request).body !== null && opts.body == null) {
        reject(new TypeError('bridge fetch: pass the body via init.body'))
        return
      }
      const raw = opts.body
      if (raw === undefined || raw === null) {
        // 본문 없음 — body는 null 그대로
      } else if (typeof raw === 'string') {
        body = raw
      } else if (typeof URLSearchParams !== 'undefined' && raw instanceof URLSearchParams) {
        body = raw.toString()
        if (!headers['content-type']) {
          headers['content-type'] = 'application/x-www-form-urlencoded;charset=UTF-8'
        }
      } else {
        reject(new TypeError('bridge fetch: unsupported body type'))
        return
      }

      const signal = opts.signal
      if (signal && signal.aborted) {
        reject(abortError(signal))
        return
      }
      let settled = false
      function onAbort(): void {
        if (settled || !signal) return
        settled = true
        reject(abortError(signal))
      }
      if (signal) signal.addEventListener('abort', onAbort)

      const payload: FetchRequest = { url: url, method: method, headers: headers, body: body }
      client.request('fetch', payload).then(
        function (res: FetchResult) {
          if (signal) signal.removeEventListener('abort', onAbort)
          if (settled) return
          settled = true
          try {
            const nullBody =
              method.toUpperCase() === 'HEAD' || NULL_BODY_STATUS.indexOf(res.status) >= 0
            const responseHeaders: Record<string, string> = {}
            if (res.headers && typeof res.headers['content-type'] === 'string') {
              responseHeaders['content-type'] = res.headers['content-type']
            }
            resolve(
              new Response(nullBody ? null : typeof res.bodyText === 'string' ? res.bodyText : '', {
                status: res.status,
                statusText: res.statusText,
                headers: responseHeaders,
              }),
            )
          } catch {
            reject(new TypeError('bridge fetch: invalid response'))
          }
        },
        function (err: unknown) {
          if (signal) signal.removeEventListener('abort', onAbort)
          if (settled) return
          settled = true
          const code = err && typeof err === 'object' ? (err as { code?: unknown }).code : undefined
          const failure = new TypeError('bridge fetch failed: ' + String(code || 'NETWORK_ERROR'))
          ;(failure as TypeError & { code: unknown }).code = code || 'NETWORK_ERROR'
          reject(failure)
        },
      )
    })
  }

  return bridgeFetch as typeof globalThis.fetch
}
