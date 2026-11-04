import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEnvelope } from '../protocol/envelope.js'
import { ACCOUNT_SESSION_CAPABILITY } from '../protocol/messages.js'
import { flush, HOST_ORIGIN, SESSION } from '../testing.js'
import { INIT, request, setup } from './hostTestKit.js'
import type { BridgeInitInput, OtpImpl, SessionImpl } from './types.js'

/**
 * 계정 세션 요청(session·otp)은 호스트가 로그인 쿠키를 설정하는 유일한 경로다. 프레임(템플릿)은
 * 토큰을 받지 않고, 권한(capability)이 없는 배치에서는 닫혀 있어야 한다(fail-closed).
 */

const ACCOUNT_INIT: BridgeInitInput = { ...INIT, capabilities: [ACCOUNT_SESSION_CAPABILITY] }

const SIGNUP_BODY = {
  email: 'a@example.com',
  password: 'pw-1234',
  nickname: 'neo',
  agreements: [{ termsId: 't1', termsVersion: 'v1', termsType: 'SERVICE_AGREEMENT' }],
  marketingNotificationTargets: ['email'],
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  // 기본 상한 저장소(호스트 탭 sessionStorage)를 테스트마다 비운다 — 상한이 리로드를 넘어 이어지는 것이 의도라
  // 비우지 않으면 앞 테스트의 호출이 다음 테스트로 넘어간다.
  ;(globalThis as { sessionStorage?: { clear(): void } }).sessionStorage?.clear()
  vi.unstubAllGlobals()
})

function sessionImplReturning(result: Record<string, unknown>) {
  return vi.fn(async () => result) as unknown as SessionImpl & ReturnType<typeof vi.fn>
}

describe('session — 권한 게이트(fail-closed)', () => {
  it('capability가 없으면 sessionImpl이 있어도 NOT_ALLOWED이고 실행기를 부르지 않는다', async () => {
    const sessionImpl = sessionImplReturning({ ok: true, status: 'SUCCESS' })
    const { link } = setup({ sessionImpl })
    const res = await request(link, 'session', { op: 'signup', body: SIGNUP_BODY })
    expect(res).toMatchObject({ ok: false, error: { code: 'NOT_ALLOWED' } })
    expect(sessionImpl).not.toHaveBeenCalled()
  })

  it('slot 배치에는 capability가 있어도 열지 않는다', async () => {
    const sessionImpl = sessionImplReturning({ ok: true, status: 'SUCCESS' })
    const { link } = setup({
      sessionImpl,
      init: { ...ACCOUNT_INIT, surface: 'slot', slot: { id: 's', context: {} } },
    })
    expect(await request(link, 'session', { op: 'signup', body: SIGNUP_BODY })).toMatchObject({
      ok: false,
      error: { code: 'NOT_ALLOWED' },
    })
    expect(sessionImpl).not.toHaveBeenCalled()
  })

  it('capability는 있지만 실행기가 없으면 UNSUPPORTED', async () => {
    const { link } = setup({ init: ACCOUNT_INIT })
    expect(await request(link, 'session', { op: 'signup', body: SIGNUP_BODY })).toMatchObject({
      ok: false,
      error: { code: 'UNSUPPORTED' },
    })
  })

  it('otp도 capability가 없으면 NOT_ALLOWED', async () => {
    const otpImpl = vi.fn(async () => ({ ok: true, status: 200 })) as unknown as OtpImpl
    const { link } = setup({ otpImpl })
    expect(
      await request(link, 'otp', { op: 'sendSignup', body: { phone: '0123', locale: 'vi' } }),
    ).toMatchObject({ ok: false, error: { code: 'NOT_ALLOWED' } })
    expect(otpImpl).not.toHaveBeenCalled()
  })
})

describe('session — op·본문 허용 목록', () => {
  it('모르는 op는 BAD_REQUEST', async () => {
    const sessionImpl = sessionImplReturning({ ok: true, status: 'SUCCESS' })
    const { link } = setup({ init: ACCOUNT_INIT, sessionImpl })
    expect(await request(link, 'session', { op: 'refresh', body: {} })).toMatchObject({
      ok: false,
      error: { code: 'BAD_REQUEST' },
    })
    expect(sessionImpl).not.toHaveBeenCalled()
  })

  it('본문은 op별 허용 필드로 다시 만든다 — 여분 키는 버린다', async () => {
    const sessionImpl = sessionImplReturning({ ok: true, status: 'LOGIN_REQUIRED' })
    const { link } = setup({ init: ACCOUNT_INIT, sessionImpl })
    await request(link, 'session', {
      op: 'signup',
      body: { ...SIGNUP_BODY, isAdmin: true, __proto__x: 1, accessToken: 'x' },
    })
    expect(sessionImpl).toHaveBeenCalledWith('signup', SIGNUP_BODY)
  })

  it('signupSocial의 code·state(OAuth)는 프레임 값을 받지 않는다 — 호스트가 채운다', async () => {
    const sessionImpl = sessionImplReturning({ ok: true, status: 'SUCCESS' })
    const { link } = setup({ init: ACCOUNT_INIT, sessionImpl })
    await request(link, 'session', {
      op: 'signupSocial',
      body: { socialType: 'BSTAGE', nickname: 'neo', code: 'evil', state: 'evil' },
    })
    expect(sessionImpl).toHaveBeenCalledWith('signupSocial', {
      socialType: 'BSTAGE',
      nickname: 'neo',
    })
  })

  it('phoneReverify의 reverificationToken은 프레임 값을 받지 않는다 — 호스트 보관소에서 채운다', async () => {
    const sessionImpl = sessionImplReturning({ ok: true, status: 'SUCCESS' })
    const { link } = setup({ init: ACCOUNT_INIT, sessionImpl })
    const body = { countryCallingCode: '84', phone: '912345678', phoneVerificationToken: 'pv' }
    await request(link, 'session', {
      op: 'phoneReverify',
      body: { ...body, reverificationToken: 'stolen' },
    })
    expect(sessionImpl).toHaveBeenCalledWith('phoneReverify', body)
  })

  it('필수 필드가 없거나 형이 틀리면 BAD_REQUEST', async () => {
    const sessionImpl = sessionImplReturning({ ok: true, status: 'SUCCESS' })
    const { link } = setup({ init: ACCOUNT_INIT, sessionImpl })
    for (const body of [
      { password: 'x' },
      { email: 1, password: 'x' },
      { ...SIGNUP_BODY, agreements: 'all' },
      { ...SIGNUP_BODY, marketingNotificationTargets: ['fax'] },
    ]) {
      expect(await request(link, 'session', { op: 'signup', body })).toMatchObject({
        ok: false,
        error: { code: 'BAD_REQUEST' },
      })
    }
    expect(sessionImpl).not.toHaveBeenCalled()
  })
})

describe('session — 응답 정제', () => {
  it('토큰·회원 식별자는 프레임에 돌려주지 않는다(허용 목록)', async () => {
    const sessionImpl = sessionImplReturning({
      ok: true,
      status: 'SUCCESS',
      accessToken: 'AT',
      refreshToken: 'RT',
      userId: 'u1',
      email: 'a@example.com',
      createdAt: '2026-11-03T00:00:00Z',
      nested: { phoneReverificationToken: 'PRT' },
    })
    const { link } = setup({ init: ACCOUNT_INIT, sessionImpl })
    const res = await request(link, 'session', { op: 'signup', body: SIGNUP_BODY })
    expect(res).toEqual({
      ok: true,
      data: { ok: true, status: 'SUCCESS', createdAt: '2026-11-03T00:00:00Z' },
    })
    expect(JSON.stringify(res)).not.toMatch(/AT|RT|PRT|u1/)
  })

  it('실패 응답도 같은 허용 목록 — code·message·httpStatus만', async () => {
    const sessionImpl = sessionImplReturning({
      ok: false,
      status: 'USER_SLEPT',
      code: -3000101,
      message: '휴면 계정',
      httpStatus: 403,
      userId: 'u1',
      email: 'a@example.com',
    })
    const { link } = setup({ init: ACCOUNT_INIT, sessionImpl })
    expect(await request(link, 'session', { op: 'signup', body: SIGNUP_BODY })).toEqual({
      ok: true,
      data: {
        ok: false,
        status: 'USER_SLEPT',
        code: -3000101,
        message: '휴면 계정',
        httpStatus: 403,
      },
    })
  })

  it('next는 같은 origin 앱 경로만 싣고 reload로 표시한다', async () => {
    const good = sessionImplReturning({ ok: true, status: 'SUCCESS', next: { path: '/?a=1' } })
    const { link } = setup({ init: ACCOUNT_INIT, sessionImpl: good })
    expect(
      await request(link, 'session', { op: 'signupSocial', body: { socialType: 'BSTAGE' } }),
    ).toEqual({
      ok: true,
      data: { ok: true, status: 'SUCCESS', next: { path: '/?a=1', reload: true } },
    })

    const bad = sessionImplReturning({
      ok: true,
      status: 'SUCCESS',
      next: { path: '//evil.example' },
    })
    const second = setup({ init: ACCOUNT_INIT, sessionImpl: bad })
    expect(
      await request(second.link, 'session', { op: 'signupSocial', body: { socialType: 'BSTAGE' } }),
    ).toEqual({ ok: true, data: { ok: true, status: 'SUCCESS' } })
  })

  it('실행기 예외 메시지는 싣지 않는다', async () => {
    const sessionImpl = vi.fn(async () => {
      throw new Error('internal https://inner.example/token=abc')
    }) as unknown as SessionImpl
    const { link } = setup({ init: ACCOUNT_INIT, sessionImpl })
    const res = await request(link, 'session', { op: 'signup', body: SIGNUP_BODY })
    expect(res).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } })
    expect(JSON.stringify(res)).not.toContain('inner.example')
  })
})

describe('session — loginAfterSignup은 직전 가입에만 묶인다', () => {
  it('가입이 LOGIN_REQUIRED를 돌려준 같은 이메일로 60초 안에 한 번만 허용한다', async () => {
    const sessionImpl = vi.fn(async (op: string) =>
      op === 'signup' ? { ok: true, status: 'LOGIN_REQUIRED' } : { ok: true, status: 'SUCCESS' },
    ) as unknown as SessionImpl & ReturnType<typeof vi.fn>
    const { link } = setup({ init: ACCOUNT_INIT, sessionImpl })
    const login = { email: 'a@example.com', password: 'pw-1234', turnstileToken: 'ts' }

    expect(await request(link, 'session', { op: 'loginAfterSignup', body: login })).toMatchObject({
      ok: false,
      error: { code: 'NOT_ALLOWED' },
    })
    await request(link, 'session', { op: 'signup', body: SIGNUP_BODY })
    expect(
      await request(link, 'session', {
        op: 'loginAfterSignup',
        body: { ...login, email: 'other@example.com' },
      }),
    ).toMatchObject({ ok: false, error: { code: 'NOT_ALLOWED' } })
    expect(await request(link, 'session', { op: 'loginAfterSignup', body: login })).toEqual({
      ok: true,
      data: { ok: true, status: 'SUCCESS' },
    })
    expect(sessionImpl).toHaveBeenLastCalledWith('loginAfterSignup', login)
    expect(await request(link, 'session', { op: 'loginAfterSignup', body: login })).toMatchObject({
      ok: false,
      error: { code: 'NOT_ALLOWED' },
    })
  })

  it('60초가 지나면 묶음이 풀린다', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    const sessionImpl = vi.fn(async (op: string) =>
      op === 'signup' ? { ok: true, status: 'LOGIN_REQUIRED' } : { ok: true, status: 'SUCCESS' },
    ) as unknown as SessionImpl
    const { link } = setup({ init: ACCOUNT_INIT, sessionImpl })
    await request(link, 'session', { op: 'signup', body: SIGNUP_BODY })
    now.mockReturnValue(1_000_000 + 60_001)
    expect(
      await request(link, 'session', {
        op: 'loginAfterSignup',
        body: { email: 'a@example.com', password: 'pw-1234' },
      }),
    ).toMatchObject({ ok: false, error: { code: 'NOT_ALLOWED' } })
  })
})

describe('session — loginAfterSignup 결속 소비·생성 조건', () => {
  it('레이트 리밋에 걸린 loginAfterSignup은 결속을 소비하지 않는다', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    const sessionImpl = vi.fn(async (op: string) =>
      op === 'signup' ? { ok: true, status: 'LOGIN_REQUIRED' } : { ok: true, status: 'SUCCESS' },
    ) as unknown as SessionImpl
    const { link } = setup({ init: ACCOUNT_INIT, sessionImpl })
    const social = { socialType: 'BSTAGE', nickname: 'neo', agreements: SIGNUP_BODY.agreements }
    for (let i = 0; i < 4; i += 1) {
      await request(link, 'session', { op: 'signupSocial', body: social })
    }
    now.mockReturnValue(1_030_000)
    await request(link, 'session', { op: 'signup', body: SIGNUP_BODY })
    const login = { email: 'a@example.com', password: 'pw-1234' }
    now.mockReturnValue(1_031_000)
    expect(await request(link, 'session', { op: 'loginAfterSignup', body: login })).toMatchObject({
      ok: false,
      error: { code: 'RATE_LIMITED' },
    })
    // 앞선 4건이 창 밖으로 나간 뒤(결속은 아직 유효) — 같은 결속으로 로그인할 수 있어야 한다.
    now.mockReturnValue(1_061_000)
    expect(await request(link, 'session', { op: 'loginAfterSignup', body: login })).toEqual({
      ok: true,
      data: { ok: true, status: 'SUCCESS' },
    })
  })

  it('실패 응답(ok:false)에 LOGIN_REQUIRED가 실려도 결속을 만들지 않는다', async () => {
    const sessionImpl = vi.fn(async (op: string) =>
      op === 'signup' ? { ok: false, status: 'LOGIN_REQUIRED' } : { ok: true, status: 'SUCCESS' },
    ) as unknown as SessionImpl
    const { link } = setup({ init: ACCOUNT_INIT, sessionImpl })
    await request(link, 'session', { op: 'signup', body: SIGNUP_BODY })
    expect(
      await request(link, 'session', {
        op: 'loginAfterSignup',
        body: { email: 'a@example.com', password: 'pw-1234' },
      }),
    ).toMatchObject({ ok: false, error: { code: 'NOT_ALLOWED' } })
  })
})

describe('session·otp — 레이트 리밋', () => {
  it('session은 분당 5회', async () => {
    const sessionImpl = sessionImplReturning({ ok: false, status: 'ERROR' })
    const { link } = setup({ init: ACCOUNT_INIT, sessionImpl })
    const results = []
    for (let i = 0; i < 6; i += 1) {
      results.push(await request(link, 'session', { op: 'signup', body: SIGNUP_BODY }))
    }
    expect(results.slice(0, 5).every((r) => r?.ok === true)).toBe(true)
    expect(results[5]).toMatchObject({ ok: false, error: { code: 'RATE_LIMITED' } })
  })

  it('otp 발송은 분당 3회(편의 제한 — 정본은 게이트웨이)', async () => {
    const otpImpl = vi.fn(async () => ({ ok: true, status: 200 })) as unknown as OtpImpl
    const { link } = setup({ init: ACCOUNT_INIT, otpImpl })
    const results = []
    for (let i = 0; i < 4; i += 1) {
      results.push(
        await request(link, 'otp', { op: 'sendSignup', body: { phone: '0123', locale: 'vi' } }),
      )
    }
    expect(results.slice(0, 3).every((r) => r?.ok === true)).toBe(true)
    expect(results[3]).toMatchObject({ ok: false, error: { code: 'RATE_LIMITED' } })
  })
})

describe('otp', () => {
  it('purpose는 op에서 호스트가 고정한다 — 프레임이 보낸 purpose는 무시', async () => {
    const otpImpl = vi.fn(async () => ({ ok: true, status: 200 })) as unknown as OtpImpl &
      ReturnType<typeof vi.fn>
    const { link } = setup({ init: ACCOUNT_INIT, otpImpl })
    await request(link, 'otp', {
      op: 'sendPhoneChange',
      body: { phone: '0123', locale: 'vi', purpose: 'SIGNUP', extra: 1 },
    })
    expect(otpImpl).toHaveBeenCalledWith({
      op: 'sendPhoneChange',
      endpoint: 'send',
      purpose: 'PHONE_CHANGE',
      body: { phone: '0123', locale: 'vi' },
    })
    await request(link, 'otp', { op: 'verifySignup', body: { phone: '0123', code: '123456' } })
    expect(otpImpl).toHaveBeenLastCalledWith({
      op: 'verifySignup',
      endpoint: 'verify',
      purpose: 'SIGNUP',
      body: { phone: '0123', code: '123456' },
    })
  })

  it('verify 응답의 휴대폰 인증 증빙(verificationToken)은 싣고, 그 밖의 필드는 허용 목록으로', async () => {
    const otpImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      data: {
        verificationToken: 'proof',
        expiresAtSeconds: 600,
        phone: '+84123',
        accessToken: 'AT',
        internal: 'x',
      },
    })) as unknown as OtpImpl
    const { link } = setup({ init: ACCOUNT_INIT, otpImpl })
    expect(
      await request(link, 'otp', { op: 'verifyPhoneChange', body: { phone: '0123', code: '1' } }),
    ).toEqual({
      ok: true,
      data: {
        ok: true,
        status: 200,
        data: { verificationToken: 'proof', expiresAtSeconds: 600, phone: '+84123' },
      },
    })
  })

  it('send 오류는 code·message(en·vi)·retryAfterSeconds만', async () => {
    const otpImpl = vi.fn(async () => ({
      ok: false,
      status: 429,
      error: {
        code: 'RESEND_TOO_SOON',
        message: { en: 'wait', vi: 'đợi', ko: 'x' },
        retryAfterSeconds: 30,
        debug: 'stack',
      },
    })) as unknown as OtpImpl
    const { link } = setup({ init: ACCOUNT_INIT, otpImpl })
    expect(
      await request(link, 'otp', { op: 'sendSignup', body: { phone: '0123', locale: 'vi' } }),
    ).toEqual({
      ok: true,
      data: {
        ok: false,
        status: 429,
        error: {
          code: 'RESEND_TOO_SOON',
          message: { en: 'wait', vi: 'đợi' },
          retryAfterSeconds: 30,
        },
      },
    })
  })
})

describe('init — 계정 필드', () => {
  async function initOf(init: BridgeInitInput) {
    const { link } = setup({ init })
    link.parent.postMessage(createEnvelope('evt', 'ready', 'r', { session: SESSION }), HOST_ORIGIN)
    await flush()
    return (link.toFrame[0].message as { payload: { data: Record<string, unknown> } }).payload.data
  }

  it('capability가 있으면 계정 필드를 허용 목록으로 싣는다', async () => {
    const data = await initOf({
      ...ACCOUNT_INIT,
      capabilities: [ACCOUNT_SESSION_CAPABILITY, 'unknown-cap'],
      query: { socialType: 'BSTAGE', code: 'oauth-code', state: 's' } as never,
      country: 'VN',
      space: { title: 'Stage', corporation: { name: 'Corp', country: 'VN', id: 'c1' } as never },
      reverification: { available: true, expiresAt: '2026-11-03T00:10:00Z', token: 't' } as never,
    })
    expect(data.capabilities).toEqual([ACCOUNT_SESSION_CAPABILITY])
    expect(data.query).toEqual({ socialType: 'BSTAGE' })
    expect(data.country).toBe('VN')
    expect(data.space).toEqual({ title: 'Stage', corporation: { name: 'Corp', country: 'VN' } })
    expect(data.reverification).toEqual({ available: true, expiresAt: '2026-11-03T00:10:00Z' })
  })

  it('capability가 없으면 계정 필드를 싣지 않는다', async () => {
    const data = await initOf({
      ...INIT,
      query: { socialType: 'BSTAGE' },
      country: 'VN',
      reverification: { available: true },
    })
    expect(data).not.toHaveProperty('capabilities')
    expect(data).not.toHaveProperty('query')
    expect(data).not.toHaveProperty('country')
    expect(data).not.toHaveProperty('reverification')
  })
})

describe('상한·카운터는 리로드(호스트 재생성)를 넘어 유지된다', () => {
  function memoryStore() {
    let value: string | null = null
    return {
      get: () => value,
      set: (v: string) => {
        value = v
      },
    }
  }

  it('otp 발송 상한은 같은 저장소를 쓰는 새 호스트에서도 이어진다', async () => {
    const accountStateStore = memoryStore()
    const otpImpl = vi.fn(async () => ({ ok: true, status: 200 })) as unknown as OtpImpl
    const body = { countryCallingCode: '84', phone: '912345678' }
    const first = setup({ init: ACCOUNT_INIT, otpImpl, accountStateStore })
    for (let i = 0; i < 3; i += 1) {
      await request(first.link, 'otp', { op: 'sendSignup', body })
    }
    // 리로드 = 호스트 재생성
    const second = setup({ init: ACCOUNT_INIT, otpImpl, accountStateStore })
    expect(await request(second.link, 'otp', { op: 'sendSignup', body })).toMatchObject({
      ok: false,
      error: { code: 'RATE_LIMITED' },
    })
  })

  it('세션 분당 상한은 이어진다', async () => {
    const accountStateStore = memoryStore()
    const sessionImpl = sessionImplReturning({ ok: false, status: 'ERROR' })
    const first = setup({ init: ACCOUNT_INIT, sessionImpl, accountStateStore })
    for (let i = 0; i < 5; i += 1) {
      await request(first.link, 'session', { op: 'signup', body: SIGNUP_BODY })
    }
    const second = setup({ init: ACCOUNT_INIT, sessionImpl, accountStateStore })
    expect(
      await request(second.link, 'session', { op: 'signup', body: SIGNUP_BODY }),
    ).toMatchObject({
      ok: false,
      error: { code: 'RATE_LIMITED' },
    })
  })

  it('분당 상한은 창이 지나면 풀린다 — 탭을 영구히 잠그지 않는다', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(3_000_000)
    const accountStateStore = memoryStore()
    const sessionImpl = sessionImplReturning({ ok: false, status: 'ERROR' })
    const first = setup({ init: ACCOUNT_INIT, sessionImpl, accountStateStore })
    for (let i = 0; i < 5; i += 1) {
      await request(first.link, 'session', { op: 'signup', body: SIGNUP_BODY })
    }
    now.mockReturnValue(3_000_000 + 60_001)
    const second = setup({ init: ACCOUNT_INIT, sessionImpl, accountStateStore })
    expect(
      await request(second.link, 'session', { op: 'signup', body: SIGNUP_BODY }),
    ).toMatchObject({ ok: true })
  })

  it('허용된 시도는 결과와 무관하게 프레임당 누적(20회)에 넣는다 — 실패 반복(계정 열거)도 20회에서 멈춘다', async () => {
    const accountStateStore = memoryStore()
    let t = 4_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => t)
    const sessionImpl = vi.fn(async () => {
      throw new Error('network')
    }) as unknown as SessionImpl
    const { link } = setup({ init: ACCOUNT_INIT, sessionImpl, accountStateStore })
    // 분당 상한을 피하려 61초씩 띄운다
    for (let i = 0; i < 20; i += 1) {
      t += 61_000
      await request(link, 'session', { op: 'signup', body: SIGNUP_BODY })
    }
    t += 61_000
    expect(await request(link, 'session', { op: 'signup', body: SIGNUP_BODY })).toMatchObject({
      ok: false,
      error: { code: 'RATE_LIMITED' },
    })
    expect(sessionImpl).toHaveBeenCalledTimes(20)
  })

  /** 탭 sessionStorage 흉내 — 런타임마다 전역 유무가 달라(Node 22 없음·26 있음) 테스트가 직접 넣는다. */
  function stubSessionStorage() {
    const data = new Map<string, string>()
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => {
        data.set(k, v)
      },
      clear: () => data.clear(),
    })
    return data
  }

  it('기본 저장소의 상한은 배치마다 따로 센다 — 한 배치가 같은 탭의 다른 배치를 막지 않는다', async () => {
    const data = stubSessionStorage()
    const otpImpl = vi.fn(async () => ({ ok: true, status: 200 })) as unknown as OtpImpl
    const body = { countryCallingCode: '84', phone: '912345678' }
    const a = setup({ init: ACCOUNT_INIT, otpImpl })
    for (let i = 0; i < 3; i += 1) {
      await request(a.link, 'otp', { op: 'sendSignup', body })
    }
    expect(await request(a.link, 'otp', { op: 'sendSignup', body })).toMatchObject({
      ok: false,
      error: { code: 'RATE_LIMITED' },
    })
    const b = setup({ init: { ...ACCOUNT_INIT, placementId: 'pl-2' }, otpImpl })
    expect(await request(b.link, 'otp', { op: 'sendSignup', body })).toMatchObject({ ok: true })
    // 같은 배치의 새 호스트(리로드)는 이어서 막힌다
    const a2 = setup({ init: ACCOUNT_INIT, otpImpl })
    expect(await request(a2.link, 'otp', { op: 'sendSignup', body })).toMatchObject({
      ok: false,
      error: { code: 'RATE_LIMITED' },
    })
    // 키는 배치 범위가 붙은 두 개
    expect([...data.keys()].sort()).toEqual([
      '__bstage_account_limits__:space-1\u0000pl-1',
      '__bstage_account_limits__:space-1\u0000pl-2',
    ])
  })

  it('sessionStorage가 없으면 메모리로 센다(같은 호스트 안에서는 상한이 그대로 걸린다)', async () => {
    vi.stubGlobal('sessionStorage', undefined)
    const otpImpl = vi.fn(async () => ({ ok: true, status: 200 })) as unknown as OtpImpl
    const body = { countryCallingCode: '84', phone: '912345678' }
    const { link } = setup({ init: ACCOUNT_INIT, otpImpl })
    for (let i = 0; i < 3; i += 1) {
      await request(link, 'otp', { op: 'sendSignup', body })
    }
    expect(await request(link, 'otp', { op: 'sendSignup', body })).toMatchObject({
      ok: false,
      error: { code: 'RATE_LIMITED' },
    })
  })

  it('프레임당 누적은 호스트마다 새로 센다 — 탭 저장소에 쌓지 않는다', async () => {
    const accountStateStore = memoryStore()
    let t = 5_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => t)
    const sessionImpl = sessionImplReturning({ ok: false, status: 'ERROR' })
    const first = setup({ init: ACCOUNT_INIT, sessionImpl, accountStateStore })
    for (let i = 0; i < 20; i += 1) {
      t += 61_000
      await request(first.link, 'session', { op: 'signup', body: SIGNUP_BODY })
    }
    t += 61_000
    expect(await request(first.link, 'session', { op: 'signup', body: SIGNUP_BODY })).toMatchObject(
      { ok: false, error: { code: 'RATE_LIMITED' } },
    )
    const second = setup({ init: ACCOUNT_INIT, sessionImpl, accountStateStore })
    expect(
      await request(second.link, 'session', { op: 'signup', body: SIGNUP_BODY }),
    ).toMatchObject({ ok: true })
  })

  it('저장소 값이 깨져 있으면 무시하고 새로 센다', async () => {
    const accountStateStore = memoryStore()
    accountStateStore.set('{not json')
    const otpImpl = vi.fn(async () => ({ ok: true, status: 200 })) as unknown as OtpImpl
    const { link } = setup({ init: ACCOUNT_INIT, otpImpl, accountStateStore })
    expect(
      await request(link, 'otp', {
        op: 'sendSignup',
        body: { countryCallingCode: '84', phone: '912345678' },
      }),
    ).toMatchObject({ ok: true })
  })

  it('리로드 허가는 60초가 지나면 사라진다', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(2_000_000)
    const navigate = vi.fn()
    const sessionImpl = sessionImplReturning({ ok: true, status: 'SUCCESS' })
    const { link } = setup({ init: ACCOUNT_INIT, sessionImpl }, { navigate })
    await request(link, 'session', {
      op: 'signupSocial',
      body: { socialType: 'BSTAGE', nickname: 'neo' },
    })
    now.mockReturnValue(2_000_000 + 60_001)
    expect(await request(link, 'navigate', { path: '/', reload: true })).toMatchObject({
      ok: false,
      error: { code: 'NOT_ALLOWED' },
    })
  })
})

describe('navigate — replace·reload', () => {
  it('reload는 계정 권한이 있는 배치에서만 받는다(리로드로 호스트 상한을 초기화하지 못하게)', async () => {
    const navigate = vi.fn()
    const { link } = setup({}, { navigate })
    expect(await request(link, 'navigate', { path: '/b', reload: true })).toMatchObject({
      ok: false,
      error: { code: 'NOT_ALLOWED' },
    })
    expect(navigate).not.toHaveBeenCalled()
    await request(link, 'navigate', { path: '/c', replace: true })
    expect(navigate).toHaveBeenLastCalledWith('/c', { replace: true })
  })

  it('계정 권한 배치도 로그인이 성립하기 전에는 reload를 받지 않는다(리로드로 상한·결속을 초기화하는 루프 차단)', async () => {
    const navigate = vi.fn()
    const sessionImpl = vi.fn(async (op: string) =>
      op === 'signup' ? { ok: true, status: 'LOGIN_REQUIRED' } : { ok: false, status: 'ERROR' },
    ) as unknown as SessionImpl
    const { link } = setup({ init: ACCOUNT_INIT, sessionImpl }, { navigate })
    expect(await request(link, 'navigate', { path: '/', reload: true })).toMatchObject({
      ok: false,
      error: { code: 'NOT_ALLOWED' },
    })
    // 로그인 미성립(LOGIN_REQUIRED)·실패 응답으로는 열리지 않는다
    await request(link, 'session', { op: 'signup', body: SIGNUP_BODY })
    await request(link, 'session', {
      op: 'signupSocial',
      body: { socialType: 'BSTAGE', nickname: 'neo' },
    })
    expect(await request(link, 'navigate', { path: '/', reload: true })).toMatchObject({
      ok: false,
      error: { code: 'NOT_ALLOWED' },
    })
    expect(navigate).not.toHaveBeenCalled()
  })

  it('로그인이 성립한 뒤 reload는 한 번만 받는다', async () => {
    const navigate = vi.fn()
    const sessionImpl = sessionImplReturning({ ok: true, status: 'SUCCESS' })
    const { link } = setup({ init: ACCOUNT_INIT, sessionImpl }, { navigate })
    await request(link, 'session', {
      op: 'signupSocial',
      body: { socialType: 'BSTAGE', nickname: 'neo' },
    })
    await request(link, 'navigate', { path: '/b', replace: true, reload: true })
    expect(navigate).toHaveBeenLastCalledWith('/b', { replace: true, reload: true })
    expect(await request(link, 'navigate', { path: '/b', reload: true })).toMatchObject({
      ok: false,
      error: { code: 'NOT_ALLOWED' },
    })
  })

  it('옵션이 있으면 처리기에 넘기고, 없으면 기존처럼 경로만', async () => {
    const navigate = vi.fn()
    const { link } = setup({ init: ACCOUNT_INIT }, { navigate })
    await request(link, 'navigate', { path: '/a' })
    expect(navigate).toHaveBeenLastCalledWith('/a')
    await request(link, 'navigate', { path: '/b', replace: true })
    expect(navigate).toHaveBeenLastCalledWith('/b', { replace: true })
    expect(
      await request(link, 'navigate', { path: '/c', reload: 'yes' as unknown as boolean }),
    ).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } })
  })
})
