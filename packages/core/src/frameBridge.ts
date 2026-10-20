import type { FetchFunction } from './http/index.js'

/**
 * 격리 프레임 브리지의 init 중 core가 읽는 부분.
 * 전체 모양은 `@bstage-sdk/bridge`의 `BridgeInit`이다 — core는 그 패키지에 의존하지 않고
 * 필요한 필드만 구조적으로 읽는다.
 */
export interface FrameBridgeInit {
  readonly gatewayBase?: string
  readonly locale?: string
  readonly translations?: Readonly<Record<string, string>>
}

/**
 * 격리 프레임 안에서 브리지 클라이언트가 설치하는 `globalThis.__bstage_bridge__`의 최소 모양.
 *
 * 템플릿이 sandbox iframe에서 돌 때만 존재한다. 없으면 모든 어댑터는 기존 경로(inline)로 동작한다.
 */
export interface FrameBridgeLike {
  readonly hostOrigin: string
  getInit(): FrameBridgeInit | undefined
  request(type: string, payload: unknown): Promise<unknown>
  on(type: string, fn: (payload: unknown) => void): () => void
  readonly fetch: FetchFunction
}

/**
 * @internal 현재 실행 환경의 프레임 브리지를 돌려준다. 격리 프레임이 아니면 `undefined`.
 *
 * 모양이 맞을 때만 인정한다 — 템플릿이나 다른 스크립트가 같은 이름에 다른 값을 둬도
 * 기존 경로가 깨지지 않게 한다. 요청마다 호출해 늦은 설치도 반영한다.
 */
export function getFrameBridge(): FrameBridgeLike | undefined {
  const candidate = (globalThis as { __bstage_bridge__?: unknown }).__bstage_bridge__
  if (typeof candidate !== 'object' || candidate === null) return undefined
  const b = candidate as Partial<Record<keyof FrameBridgeLike, unknown>>
  if (
    typeof b.hostOrigin !== 'string' ||
    typeof b.getInit !== 'function' ||
    typeof b.request !== 'function' ||
    typeof b.on !== 'function' ||
    typeof b.fetch !== 'function'
  ) {
    return undefined
  }
  return candidate as FrameBridgeLike
}
