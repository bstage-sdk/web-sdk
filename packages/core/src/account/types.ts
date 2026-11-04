/**
 * 계정 화면(가입·소셜 가입·재인증·회원정보 수정) 전용 API의 공개 타입.
 *
 * 같은 템플릿 번들이 inline(플랫폼 페이지에 직접 마운트)과 격리 프레임 양쪽에서 돈다.
 * - 격리 프레임: 세션 발급(로그인 쿠키 설정)은 호스트가 한다. 템플릿은 토큰을 받지 않는다.
 * - inline: 지금까지 템플릿이 하던 동작(계정 API 호출 + 로그인 쿠키 쓰기)을 SDK가 대신 한다.
 */

/** 이 권한이 있는 배치에서만 격리 프레임의 세션 요청이 열린다. */
export const ACCOUNT_SESSION_CAPABILITY = 'account-session'

export interface AccountClientOptions {
  /** inline 전용 — 계정 API base 경로. 기본 `/svc`(스페이스 origin). 격리 프레임에서는 무시한다. */
  readonly apiBase?: string
  /** inline 전용 — SMS OTP 게이트웨이 origin. 없으면 OTP는 `NOT_CONFIGURED`. 격리 프레임에서는 호스트가 정한다. */
  readonly otpGatewayBaseUrl?: string
  /** inline 전용 — 스페이스 id 쿠키가 없을 때 `x-bmf-sid`로 보낼 값. 기본 `bstage`. */
  readonly spaceIdFallback?: string
  /** inline 전용 — `X-BMF-LANGUAGE` 값. 기본은 SDK `readLocale()`. */
  readonly language?: () => string | undefined
}

export interface AccountSessionError {
  /** 계정 API 오류 코드(본문의 `code`). */
  readonly code?: number
  readonly message?: string
  readonly httpStatus?: number
  /** 브리지가 거절한 경우의 코드(`NOT_ALLOWED`·`UNSUPPORTED`·`RATE_LIMITED` 등). */
  readonly bridgeCode?: string
}

/**
 * 세션 작업 결과. 토큰은 담지 않는다.
 * - `status`: `SUCCESS`, `LOGIN_REQUIRED`(가입은 됐고 `loginAfterSignup`이 필요), `PHONE_REVERIFICATION_REQUIRED`,
 *   `REVERIFICATION_UNAVAILABLE`(재인증 임시토큰이 없거나 만료) 등.
 * - `next`: 로그인 뒤 이동할 같은 origin 경로. `completeLogin`이 쓴다.
 */
export interface AccountSessionResult {
  readonly ok: boolean
  readonly status?: string
  readonly createdAt?: string
  readonly error?: AccountSessionError
  readonly next?: { readonly path: string }
}

export interface SignupAgreement {
  readonly termsId: string
  readonly termsVersion?: string
  readonly termsType?: string
}

/** 가입 공통 필드. */
export interface SignupProfile {
  readonly agreements?: readonly SignupAgreement[]
  readonly nickname?: string
  readonly avatarImgPath?: string
  readonly birthYear?: string
  readonly birthMonth?: string
  readonly birthDay?: string
  readonly marketingNotificationTargets?: readonly ('push' | 'email' | 'sms')[]
  readonly phone?: string
  readonly countryCallingCode?: string
  readonly name?: string
  readonly gender?: string
  /** SMS 인증 증빙(`otpVerify*` 결과의 `verificationToken`). */
  readonly phoneVerificationToken?: string
}

export interface SignupBody extends SignupProfile {
  readonly email: string
  readonly password: string
}

/** OAuth `code`·`state`는 넣지 않는다 — inline이면 SDK가 페이지 URL에서, 격리면 호스트가 채운다. */
export interface SignupSocialBody extends SignupProfile {
  readonly socialType: string
}

export interface LoginAfterSignupBody {
  readonly email: string
  readonly password: string
  readonly turnstileToken?: string
}

/** 재인증 임시토큰은 넣지 않는다 — SDK(inline)·호스트(격리)가 보관한 값을 쓴다. */
export interface PhoneReverifyBody {
  readonly countryCallingCode: string
  readonly phone: string
  readonly phoneVerificationToken: string
}

export interface OtpSendBody {
  readonly phone: string
  readonly locale?: string
}

export interface OtpVerifyBody {
  readonly phone: string
  readonly code: string
  readonly requestId?: string
}

export interface OtpSendData {
  readonly requestId?: string
  readonly expiresInSeconds?: number
  readonly resendAvailableInSeconds?: number
  readonly maskedPhone?: string
}

export interface OtpVerifyData {
  /** 휴대폰 인증 증빙 — 가입·재인증·회원정보 수정 본문의 `phoneVerificationToken`으로 싣는다. */
  readonly verificationToken?: string
  readonly expiresAtSeconds?: number
  readonly phone?: string
}

export interface AccountOtpError {
  /** 게이트웨이 오류 코드. 응답을 받지 못했으면 `PROVIDER_UNAVAILABLE`(발송은 됐을 수 있다). */
  readonly code?: string
  readonly message?: { readonly en?: string; readonly vi?: string }
  readonly retryAfterSeconds?: number
}

export interface AccountOtpResult<T> {
  readonly ok: boolean
  /** 게이트웨이 HTTP 상태. 응답을 받지 못했으면 0. */
  readonly status: number
  readonly data?: T
  readonly error?: AccountOtpError
}

export interface AccountSpaceInfo {
  readonly title?: string
  readonly corporation?: { readonly name?: string; readonly country?: string }
}

export interface ReverificationState {
  readonly available: boolean
  readonly expiresAt?: string
}

export interface AccountClient {
  /** `frame`(격리 프레임) 또는 `inline`. */
  readonly mode: 'frame' | 'inline'
  /** 세션 작업을 쓸 수 있는가. 격리 프레임이면 배치 권한이 있을 때만 true. */
  readonly supported: boolean
  signup(body: SignupBody): Promise<AccountSessionResult>
  signupSocial(body: SignupSocialBody): Promise<AccountSessionResult>
  /** `signup`이 `LOGIN_REQUIRED`를 돌려준 직후, 같은 이메일로 한 번만. */
  loginAfterSignup(body: LoginAfterSignupBody): Promise<AccountSessionResult>
  phoneReverify(body: PhoneReverifyBody): Promise<AccountSessionResult>
  /**
   * 로그인된 결과를 받아 전체 리로드로 이동한다(새 로그인 상태로 페이지를 다시 그린다).
   * 실패 결과면 아무것도 하지 않는다. 템플릿은 안내 토스트·전환 추적을 끝낸 뒤 부른다.
   */
  completeLogin(result: AccountSessionResult): Promise<void>
  otpSendSignup(body: OtpSendBody): Promise<AccountOtpResult<OtpSendData>>
  otpSendPhoneChange(body: OtpSendBody): Promise<AccountOtpResult<OtpSendData>>
  otpVerifySignup(body: OtpVerifyBody): Promise<AccountOtpResult<OtpVerifyData>>
  otpVerifyPhoneChange(body: OtpVerifyBody): Promise<AccountOtpResult<OtpVerifyData>>
  /** 호스트 URL 쿼리 중 허용된 키. */
  hostQuery(): { readonly socialType?: string }
  /** 호스트의 국가 코드(가입 폼 기본 국가). */
  hostCountry(): string | undefined
  spaceInfo(): AccountSpaceInfo
  /** 재인증 임시토큰을 쓸 수 있는가(값은 노출하지 않는다). inline이면 처음 부를 때 인계를 가져온다. */
  reverificationStatus(): ReverificationState
  /** 재인증 화면을 떠날 때 부른다 — 보관한 임시토큰을 버린다. */
  releaseReverification(): void
}
