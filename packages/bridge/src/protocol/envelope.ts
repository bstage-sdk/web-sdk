/** 봉투 버전. 형식이 하위 호환되지 않게 바뀔 때만 올린다. */
export const BRIDGE_VERSION = 1

/** 봉투 네임스페이스 — 같은 창에 오가는 다른 postMessage와 구분한다. */
export const BRIDGE_NAMESPACE = 'bstage-bridge'

/** 봉투 id 최대 길이. 프레임이 만든 id를 호스트가 그대로 되돌려 주므로 상한을 둔다. */
export const MAX_ENVELOPE_ID_LENGTH = 64

/** 봉투 type 최대 길이. */
export const MAX_ENVELOPE_TYPE_LENGTH = 32

/** 봉투 종류 — 요청·응답·이벤트. */
export type EnvelopeKind = 'req' | 'res' | 'evt'

const ENVELOPE_KINDS: readonly EnvelopeKind[] = ['req', 'res', 'evt']

/** 브리지 메시지 봉투. */
export interface BridgeEnvelope<P = unknown> {
  readonly v: typeof BRIDGE_VERSION
  readonly ns: typeof BRIDGE_NAMESPACE
  readonly id: string
  readonly kind: EnvelopeKind
  readonly type: string
  readonly payload: P
}

function isNonEmptyString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
}

/**
 * 값이 브리지 봉투인지 검사한다. 모양만 본다 — 발신자 확인(source·session)은 호출자 몫이다.
 */
export function isBridgeEnvelope(value: unknown): value is BridgeEnvelope {
  if (typeof value !== 'object' || value === null) return false
  const env = value as Record<string, unknown>
  return (
    env.v === BRIDGE_VERSION &&
    env.ns === BRIDGE_NAMESPACE &&
    isNonEmptyString(env.id, MAX_ENVELOPE_ID_LENGTH) &&
    ENVELOPE_KINDS.includes(env.kind as EnvelopeKind) &&
    isNonEmptyString(env.type, MAX_ENVELOPE_TYPE_LENGTH) &&
    'payload' in env
  )
}

/** 봉투를 만든다. */
export function createEnvelope<P>(
  kind: EnvelopeKind,
  type: string,
  id: string,
  payload: P,
): BridgeEnvelope<P> {
  return { v: BRIDGE_VERSION, ns: BRIDGE_NAMESPACE, id, kind, type, payload }
}

/** payload가 객체이고 `session`이 기대값과 같은지 검사한다(호스트 측 발신자 확인). */
export function hasSession(payload: unknown, session: string): boolean {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    (payload as { session?: unknown }).session === session
  )
}
