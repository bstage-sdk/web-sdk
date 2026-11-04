import type { FrameBridgeLike } from '../frameBridge.js'
import { ACCOUNT_SESSION_CAPABILITY } from './types.js'
import type {
  AccountClient,
  AccountOtpResult,
  AccountSessionResult,
  AccountSpaceInfo,
  ReverificationState,
} from './types.js'

/**
 * 격리 프레임 구현 — 세션 작업은 브리지 `session`·`otp` 요청으로 호스트에 맡긴다.
 * 이 경로는 쿠키·전역·fetch를 직접 건드리지 않는다. 토큰은 호스트가 설정하고 프레임에는 오지 않는다.
 */

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function bridgeCode(err: unknown): { bridgeCode?: string; message?: string } {
  const e = asObject(err)
  return {
    ...(typeof e.code === 'string' ? { bridgeCode: e.code } : {}),
    ...(err instanceof Error ? { message: err.message } : {}),
  }
}

function toSessionResult(raw: unknown): AccountSessionResult {
  const r = asObject(raw)
  const ok = r.ok === true
  const next = asObject(r.next)
  const error = {
    ...(typeof r.code === 'number' ? { code: r.code } : {}),
    ...(typeof r.message === 'string' ? { message: r.message } : {}),
    ...(typeof r.httpStatus === 'number' ? { httpStatus: r.httpStatus } : {}),
  }
  return {
    ok,
    ...(typeof r.status === 'string' ? { status: r.status } : {}),
    ...(typeof r.createdAt === 'string' ? { createdAt: r.createdAt } : {}),
    ...(!ok && Object.keys(error).length > 0 ? { error } : {}),
    ...(typeof next.path === 'string' ? { next: { path: next.path } } : {}),
  }
}

export function createFrameAccountClient(bridge: FrameBridgeLike): AccountClient {
  const init = () => bridge.getInit() ?? {}

  async function session(op: string, body: unknown): Promise<AccountSessionResult> {
    try {
      return toSessionResult(await bridge.request('session', { op, body }))
    } catch (err) {
      return { ok: false, error: bridgeCode(err) }
    }
  }

  async function otp<T>(op: string, body: unknown): Promise<AccountOtpResult<T>> {
    try {
      const r = asObject(await bridge.request('otp', { op, body }))
      return {
        ok: r.ok === true,
        status: typeof r.status === 'number' ? r.status : 0,
        ...(r.data !== undefined ? { data: r.data as T } : {}),
        ...(r.error !== undefined
          ? { error: asObject(r.error) as AccountOtpResult<T>['error'] }
          : {}),
      }
    } catch (err) {
      const code = bridgeCode(err).bridgeCode
      return { ok: false, status: 0, error: code ? { code } : {} }
    }
  }

  return {
    mode: 'frame',
    get supported() {
      return (init().capabilities ?? []).includes(ACCOUNT_SESSION_CAPABILITY)
    },
    signup: (body) => session('signup', body),
    signupSocial: (body) => session('signupSocial', body),
    loginAfterSignup: (body) => session('loginAfterSignup', body),
    phoneReverify: (body) => session('phoneReverify', body),

    async completeLogin(result) {
      if (!result.ok) return
      // 호스트가 새 로그인 상태로 페이지를 다시 그리도록 전체 리로드 이동을 요청한다.
      await bridge.request('navigate', {
        path: result.next?.path ?? '/',
        replace: true,
        reload: true,
      })
    },

    otpSendSignup: (body) => otp('sendSignup', body),
    otpSendPhoneChange: (body) => otp('sendPhoneChange', body),
    otpVerifySignup: (body) => otp('verifySignup', body),
    otpVerifyPhoneChange: (body) => otp('verifyPhoneChange', body),

    hostQuery() {
      const socialType = init().query?.socialType
      return typeof socialType === 'string' ? { socialType } : {}
    },
    hostCountry() {
      return init().country
    },
    spaceInfo(): AccountSpaceInfo {
      return init().space ?? {}
    },
    reverificationStatus(): ReverificationState {
      const r = init().reverification
      return r
        ? { available: r.available === true, ...(r.expiresAt ? { expiresAt: r.expiresAt } : {}) }
        : { available: false }
    },
    releaseReverification() {
      // 격리 프레임에는 토큰이 없다 — 호스트가 프레임 종료 때 폐기한다.
    },
  }
}
