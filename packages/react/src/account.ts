import { useMemo } from 'react'
import { createAccountClient } from '@bstage-sdk/core/account'
import type { AccountClient, AccountClientOptions } from '@bstage-sdk/core/account'

/**
 * 계정 화면(가입·소셜 가입·재인증·회원정보 수정)용 클라이언트 hook (`@bstage-sdk/react/account`).
 *
 * 격리 프레임이면 세션 작업을 호스트에 맡기고, inline이면 지금까지 템플릿이 하던 동작을 SDK가 한다.
 * 옵션(inline 전용)은 첫 렌더 값으로 고정한다 — 렌더마다 새 클라이언트를 만들지 않게.
 *
 * @example
 * ```tsx
 * const account = useAccountSession({ otpGatewayBaseUrl })
 * if (!account.supported) return <Unsupported />
 * const result = await account.signup({ email, password, ...profile })
 * const login = result.status === 'LOGIN_REQUIRED'
 *   ? await account.loginAfterSignup({ email, password })
 *   : result
 * await account.completeLogin(login)
 * ```
 */
export function useAccountSession(options: AccountClientOptions = {}): AccountClient {
  return useMemo(() => createAccountClient(options), [])
}

export { ACCOUNT_SESSION_CAPABILITY, createAccountClient } from '@bstage-sdk/core/account'
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
} from '@bstage-sdk/core/account'
