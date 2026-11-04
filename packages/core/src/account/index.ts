import { getFrameBridge } from '../frameBridge.js'
import { createFrameAccountClient } from './frame.js'
import { __resetInlineState__, createInlineAccountClient } from './inline.js'
import type { AccountClient, AccountClientOptions } from './types.js'

/**
 * 계정 화면 전용 클라이언트를 만든다(`@bstage-sdk/core/account`).
 *
 * 격리 프레임이면 세션 작업을 호스트에 맡기고(토큰을 받지 않는다), inline이면 지금까지 템플릿이 하던
 * 동작(계정 API 호출 + 로그인 쿠키 쓰기)을 그대로 한다. 같은 번들이 두 환경에서 돈다.
 *
 * 일반 템플릿은 쓰지 않는다 — 가입·재인증·회원정보 수정 화면용이며, 격리 프레임에서는 배치에
 * `account-session` 권한이 있어야 동작한다(`supported`).
 */
export function createAccountClient(options: AccountClientOptions = {}): AccountClient {
  const bridge = getFrameBridge()
  return bridge ? createFrameAccountClient(bridge) : createInlineAccountClient(options)
}

/** @internal 테스트 전용 — inline 보관 상태를 비운다. */
export function __resetAccountState__(): void {
  __resetInlineState__()
}

export { ACCOUNT_SESSION_CAPABILITY } from './types.js'
export type {
  AccountClient,
  AccountClientOptions,
  AccountOtpError,
  AccountOtpResult,
  AccountSessionError,
  AccountSessionResult,
  AccountSpaceInfo,
  LoginAfterSignupBody,
  OtpSendBody,
  OtpSendData,
  OtpVerifyBody,
  OtpVerifyData,
  PhoneReverifyBody,
  ReverificationState,
  SignupAgreement,
  SignupBody,
  SignupProfile,
  SignupSocialBody,
} from './types.js'
