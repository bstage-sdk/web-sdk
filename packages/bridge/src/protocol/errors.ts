/** 브리지 오류 코드. */
export const BRIDGE_ERROR_CODES = [
  'FORBIDDEN_DESTINATION',
  'FORBIDDEN_METHOD',
  'BODY_TOO_LARGE',
  'RATE_LIMITED',
  'BAD_REQUEST',
  'TIMEOUT',
  'NETWORK_ERROR',
  'UNSUPPORTED',
] as const

export type BridgeErrorCode = (typeof BRIDGE_ERROR_CODES)[number]

/** 코드가 붙은 브리지 오류. 호스트는 이 코드만 프레임에 돌려준다(내부 예외 메시지는 싣지 않는다). */
export class BridgeError extends Error {
  readonly code: BridgeErrorCode

  constructor(code: BridgeErrorCode, message: string) {
    super(message)
    this.name = 'BridgeError'
    this.code = code
  }
}

export function isBridgeErrorCode(value: unknown): value is BridgeErrorCode {
  return BRIDGE_ERROR_CODES.includes(value as BridgeErrorCode)
}

/**
 * 프레임 쪽에서 요청이 거절됐을 때 받는 오류의 모양. 프레임 런타임은 자기완결 함수라
 * `BridgeError` 클래스를 쓰지 못하므로 `Error`에 `code`를 붙여 던진다.
 */
export interface BridgeErrorLike extends Error {
  readonly code: BridgeErrorCode
}

export function isBridgeErrorLike(value: unknown): value is BridgeErrorLike {
  return value instanceof Error && isBridgeErrorCode((value as { code?: unknown }).code)
}
