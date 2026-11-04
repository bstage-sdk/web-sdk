import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetAccountState__, createAccountClient } from './index.js'

/**
 * 계정 화면 API — 같은 템플릿 번들이 inline(CDN 서빙, 오늘 동작)과 격리 프레임(호스트가 세션 처리)
 * 양쪽에서 돈다. inline은 오늘 템플릿 동작을 그대로 옮긴 것이어야 하고(동등성), 격리에서는 쿠키를
 * 건드리지 않고 토큰을 받지 않아야 한다.
 */

const g = globalThis as Record<string, unknown>

interface FakeDoc {
  cookieJar: Record<string, string>
  writes: string[]
}

function installDocument(initial: Record<string, string> = {}): FakeDoc {
  const doc: FakeDoc = { cookieJar: { ...initial }, writes: [] }
  g.document = {
    documentElement: { lang: '' },
    get cookie() {
      return Object.entries(doc.cookieJar)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ')
    },
    set cookie(value: string) {
      doc.writes.push(value)
      const [pair] = value.split(';')
      const i = pair.indexOf('=')
      doc.cookieJar[pair.slice(0, i)] = pair.slice(i + 1)
    },
  }
  return doc
}

function installLocation(search = '') {
  const replace = vi.fn()
  g.location = { protocol: 'https:', origin: 'https://space.example', search, replace }
  return replace
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function installBridge(
  init: Record<string, unknown>,
  reply: (type: string, p: unknown) => unknown,
) {
  const request = vi.fn(async (type: string, payload: unknown) => reply(type, payload))
  g.__bstage_bridge__ = {
    hostOrigin: 'https://space.example',
    getInit: () => init,
    request,
    on: () => () => {},
    fetch: vi.fn(),
  }
  return request
}

beforeEach(() => {
  __resetAccountState__()
})

afterEach(() => {
  delete g.document
  delete g.location
  delete g.__bstage_bridge__
  delete g.__bmf_phone_reverification__
  delete g.__NEXT_DATA__
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('격리 프레임', () => {
  const CAP_INIT = {
    capabilities: ['account-session'],
    query: { socialType: 'BSTAGE' },
    country: 'VN',
    space: { title: 'Stage', corporation: { name: 'Corp', country: 'VN' } },
    reverification: { available: true, expiresAt: '2099-01-01T00:00:00Z' },
  }

  it('supported는 init.capabilities로 정한다', () => {
    installBridge({}, () => ({}))
    expect(createAccountClient().supported).toBe(false)
    installBridge(CAP_INIT, () => ({}))
    const client = createAccountClient()
    expect(client.mode).toBe('frame')
    expect(client.supported).toBe(true)
  })

  it('세션 요청은 브리지 session으로 보내고 쿠키·fetch를 건드리지 않는다', async () => {
    const doc = installDocument()
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const request = installBridge(CAP_INIT, () => ({
      ok: true,
      status: 'LOGIN_REQUIRED',
      createdAt: '2026-11-03',
    }))
    const res = await createAccountClient().signup({ email: 'a@x.io', password: 'pw' })
    expect(request).toHaveBeenCalledWith('session', {
      op: 'signup',
      body: { email: 'a@x.io', password: 'pw' },
    })
    expect(res).toEqual({ ok: true, status: 'LOGIN_REQUIRED', createdAt: '2026-11-03' })
    expect(doc.writes).toHaveLength(0)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('브리지 오류는 결과 객체로 돌려준다(bridgeCode)', async () => {
    installBridge(CAP_INIT, () => {
      throw Object.assign(new Error('not allowed'), { code: 'NOT_ALLOWED' })
    })
    expect(await createAccountClient().phoneReverify(REVERIFY_BODY)).toEqual({
      ok: false,
      error: { bridgeCode: 'NOT_ALLOWED', message: 'not allowed' },
    })
  })

  it('completeLogin은 next 경로로 reload 이동을 요청한다', async () => {
    const request = installBridge(CAP_INIT, () => ({}))
    await createAccountClient().completeLogin({
      ok: true,
      status: 'SUCCESS',
      next: { path: '/?x=1' },
    })
    expect(request).toHaveBeenCalledWith('navigate', { path: '/?x=1', replace: true, reload: true })
  })

  it('completeLogin은 실패 결과면 아무것도 하지 않는다', async () => {
    const request = installBridge(CAP_INIT, () => ({}))
    await createAccountClient().completeLogin({ ok: false })
    expect(request).not.toHaveBeenCalled()
  })

  it('otp는 op로 보낸다 — purpose를 싣지 않는다', async () => {
    const request = installBridge(CAP_INIT, () => ({
      ok: true,
      status: 200,
      data: { requestId: 'r' },
    }))
    const client = createAccountClient()
    expect(await client.otpSendPhoneChange({ phone: '0123', locale: 'vi' })).toEqual({
      ok: true,
      status: 200,
      data: { requestId: 'r' },
    })
    expect(request).toHaveBeenCalledWith('otp', {
      op: 'sendPhoneChange',
      body: { phone: '0123', locale: 'vi' },
    })
    await client.otpVerifySignup({ phone: '0123', code: '123456' })
    expect(request).toHaveBeenLastCalledWith('otp', {
      op: 'verifySignup',
      body: { phone: '0123', code: '123456' },
    })
  })

  it('조회 값은 init에서 읽는다', () => {
    installBridge(CAP_INIT, () => ({}))
    const client = createAccountClient()
    expect(client.hostQuery()).toEqual({ socialType: 'BSTAGE' })
    expect(client.hostCountry()).toBe('VN')
    expect(client.spaceInfo()).toEqual({
      title: 'Stage',
      corporation: { name: 'Corp', country: 'VN' },
    })
    expect(client.reverificationStatus()).toEqual({
      available: true,
      expiresAt: '2099-01-01T00:00:00Z',
    })
  })
})

const REVERIFY_BODY = { countryCallingCode: '84', phone: '912345678', phoneVerificationToken: 'pv' }

describe('inline — 오늘 템플릿 동작과 같다', () => {
  it('signup은 /svc 계정 API를 템플릿과 같은 헤더로 부르고 LOGIN_REQUIRED를 돌려준다(쿠키 쓰기 없음)', async () => {
    const doc = installDocument({
      bmf_bstage_space_id: 'sp1',
      bmf_bstage_country: 'VN',
      bmf_bstage_shop_id: 'shop',
      bmf_bstage_shop_currency_code: 'VND',
    })
    installLocation()
    const fetchSpy = vi.fn(async () => jsonResponse({ accessToken: 'AT', createdAt: 'c' }))
    vi.stubGlobal('fetch', fetchSpy)
    const res = await createAccountClient({ language: () => 'vi' }).signup({
      email: 'a@x.io',
      password: 'pw',
    })
    expect(res).toEqual({ ok: true, status: 'LOGIN_REQUIRED', createdAt: 'c' })
    expect(fetchSpy).toHaveBeenCalledWith('/svc/account/api/v1/signup', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
        'x-bmf-sid': 'sp1',
        'X-BMF-LANGUAGE': 'vi',
        'X-BMF-SHOP-ID': 'shop',
        'X-BMF-CURRENCY': 'VND',
        'X-BMF-COUNTRY': 'VN',
      },
      body: JSON.stringify({ email: 'a@x.io', password: 'pw' }),
    })
    expect(doc.writes).toHaveLength(0)
  })

  it('loginAfterSignup은 auth/token 뒤 액세스 토큰·keep 쿠키를 템플릿과 같은 속성으로 쓴다', async () => {
    const doc = installDocument()
    installLocation()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ accessToken: 'AT 1', refreshToken: 'RT' })),
    )
    const res = await createAccountClient({ language: () => 'vi' }).loginAfterSignup({
      email: 'a@x.io',
      password: 'pw',
    })
    expect(res).toEqual({ ok: true, status: 'SUCCESS' })
    expect(doc.writes).toEqual([
      'bmf_bstage_access_token=AT%201; path=/; samesite=lax; secure',
      'bmf_bstage_keep_logged_in=; path=/; samesite=lax; secure',
    ])
  })

  it('signupSocial은 code·state를 호스트 URL에서 채우고 응답 토큰으로 로그인한다', async () => {
    const doc = installDocument()
    installLocation('?socialType=BSTAGE&code=C1&state=S1')
    const fetchSpy = vi.fn(async () => jsonResponse({ accessToken: 'AT', createdAt: 'c' }))
    vi.stubGlobal('fetch', fetchSpy)
    const client = createAccountClient({ language: () => 'vi' })
    expect(client.hostQuery()).toEqual({ socialType: 'BSTAGE' })
    const res = await client.signupSocial({ socialType: 'BSTAGE', nickname: 'neo' })
    expect(res).toEqual({ ok: true, status: 'SUCCESS', createdAt: 'c' })
    const sent = JSON.parse(((fetchSpy.mock.calls[0] as unknown[])[1] as { body: string }).body)
    expect(sent).toEqual({ socialType: 'BSTAGE', nickname: 'neo', code: 'C1', state: 'S1' })
    expect(doc.writes[0]).toBe('bmf_bstage_access_token=AT; path=/; samesite=lax; secure')
  })

  it('API 오류는 code·message·httpStatus로 돌려준다', async () => {
    installDocument()
    installLocation()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ code: -3000101, message: 'no' }, 400)),
    )
    expect(
      await createAccountClient({ language: () => 'vi' }).signup({ email: 'a', password: 'b' }),
    ).toEqual({ ok: false, error: { code: -3000101, message: 'no', httpStatus: 400 } })
  })

  it('completeLogin은 회원 조회로 통합계정 팝업을 판정해 전체 리로드 이동한다', async () => {
    installDocument({ bmf_bstage_access_token: 'AT' })
    const replace = installLocation()
    const fetchSpy = vi.fn(async () => jsonResponse({ isShowIntegratedAccountPopup: true }))
    vi.stubGlobal('fetch', fetchSpy)
    await createAccountClient({ language: () => 'vi' }).completeLogin({
      ok: true,
      status: 'SUCCESS',
    })
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [
      string,
      { headers: Record<string, string> },
    ]
    expect(url).toBe('/svc/account/api/v1/users')
    expect(init.headers.Authorization).toBe('Bearer AT')
    expect(replace).toHaveBeenCalledWith('/?showIntegratedAccountPopup=true')
  })

  it('가입·소셜가입·가입 후 로그인은 남아 있는 옛 액세스 토큰을 Authorization에 싣지 않는다', async () => {
    installDocument({ bmf_bstage_access_token: 'STALE' })
    installLocation('?code=c&state=s')
    const fetchSpy = vi.fn(async () => jsonResponse({ status: 'SUCCESS' }))
    vi.stubGlobal('fetch', fetchSpy)
    const client = createAccountClient()
    await client.signup({ email: 'a@x.io', password: 'pw' })
    await client.signupSocial({ socialType: 'BSTAGE', nickname: 'n' })
    await client.loginAfterSignup({ email: 'a@x.io', password: 'pw' })
    for (const call of fetchSpy.mock.calls as unknown as [
      string,
      { headers: Record<string, string> },
    ][]) {
      expect(call[1].headers).not.toHaveProperty('Authorization')
    }
  })

  it('completeLogin은 같은 origin 앱 경로만 이동한다 — 프로토콜 상대·절대 URL은 홈으로', async () => {
    installDocument()
    const replace = installLocation()
    const client = createAccountClient()
    for (const path of [
      '//evil.example/x',
      'https://evil.example/',
      '/\\evil.example',
      'javascript:alert(1)',
      // 브라우저는 URL 해석 때 탭·개행을 지운다 — "/\t/x"는 "//x"(프로토콜 상대)가 된다
      '/\t/evil.example',
      '/\n/evil.example',
      '/\r//evil.example',
      ' //evil.example',
    ]) {
      replace.mockClear()
      await client.completeLogin({ ok: true, status: 'SUCCESS', next: { path } })
      expect(replace).toHaveBeenCalledWith('/')
    }
    replace.mockClear()
    await client.completeLogin({ ok: true, status: 'SUCCESS', next: { path: '/my/info?x=1' } })
    expect(replace).toHaveBeenCalledWith('/my/info?x=1')
  })

  describe('재인증', () => {
    it('인계는 처음 읽을 때 전역에서 지우고 메모리에만 둔다', () => {
      installDocument()
      installLocation()
      g.__bmf_phone_reverification__ = { token: 'RV', expiresAt: '2099-01-01T00:00:00Z' }
      const client = createAccountClient()
      expect(client.reverificationStatus()).toEqual({
        available: true,
        expiresAt: '2099-01-01T00:00:00Z',
      })
      expect(g.__bmf_phone_reverification__).toBeUndefined()
      // StrictMode의 두 번째 호출도 같은 값을 본다
      expect(client.reverificationStatus().available).toBe(true)
    })

    it('phoneReverify는 Authorization 없이 보관한 토큰을 싣고, 응답을 받으면 토큰을 폐기한다(1회)', async () => {
      const doc = installDocument({ bmf_bstage_access_token: 'STALE' })
      installLocation()
      g.__bmf_phone_reverification__ = { token: 'RV' }
      const fetchSpy = vi.fn(async () => jsonResponse({ status: 'SUCCESS', accessToken: 'AT' }))
      vi.stubGlobal('fetch', fetchSpy)
      const client = createAccountClient({ language: () => 'vi' })
      const res = await client.phoneReverify(REVERIFY_BODY)
      expect(res).toEqual({ ok: true, status: 'SUCCESS', next: { path: '/' } })
      const [url, init] = fetchSpy.mock.calls[0] as unknown as [
        string,
        { headers: Record<string, string>; body: string },
      ]
      expect(url).toBe('/svc/account/api/v1/auth/phone-reverification')
      expect(init.headers).not.toHaveProperty('Authorization')
      expect(JSON.parse(init.body)).toEqual({ ...REVERIFY_BODY, reverificationToken: 'RV' })
      expect(doc.writes[0]).toBe('bmf_bstage_access_token=AT; path=/; samesite=lax; secure')
      expect(client.reverificationStatus().available).toBe(false)
      expect(await client.phoneReverify(REVERIFY_BODY)).toEqual({
        ok: false,
        status: 'REVERIFICATION_UNAVAILABLE',
      })
    })

    it('2xx인데 본문을 해석하지 못해도 서버가 응답했으면 토큰을 폐기한다(1회)', async () => {
      installDocument()
      installLocation()
      g.__bmf_phone_reverification__ = { token: 'RV' }
      const fetchSpy = vi.fn(
        async () =>
          new Response('not-json{', {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      )
      vi.stubGlobal('fetch', fetchSpy)
      const client = createAccountClient()
      expect((await client.phoneReverify(REVERIFY_BODY)).ok).toBe(false)
      expect(client.reverificationStatus().available).toBe(false)
      expect(await client.phoneReverify(REVERIFY_BODY)).toEqual({
        ok: false,
        status: 'REVERIFICATION_UNAVAILABLE',
      })
      expect(fetchSpy).toHaveBeenCalledTimes(1)
    })

    it('만료된 인계는 쓰지 않는다', async () => {
      installDocument()
      installLocation()
      g.__bmf_phone_reverification__ = { token: 'RV', expiresAt: '2000-01-01T00:00:00Z' }
      const fetchSpy = vi.fn()
      vi.stubGlobal('fetch', fetchSpy)
      const client = createAccountClient()
      expect(client.reverificationStatus().available).toBe(false)
      expect(await client.phoneReverify(REVERIFY_BODY)).toEqual({
        ok: false,
        status: 'REVERIFICATION_UNAVAILABLE',
      })
      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })

  describe('otp', () => {
    it('게이트웨이를 쿠키 없이 부르고 purpose를 함수로 고정한다', async () => {
      installDocument()
      installLocation()
      const fetchSpy = vi.fn(async () => jsonResponse({ success: true, data: { requestId: 'r' } }))
      vi.stubGlobal('fetch', fetchSpy)
      const client = createAccountClient({ otpGatewayBaseUrl: 'https://otp.example' })
      expect(await client.otpSendSignup({ phone: '0123', locale: 'vi' })).toEqual({
        ok: true,
        status: 200,
        data: { requestId: 'r' },
      })
      const [url, init] = fetchSpy.mock.calls[0] as unknown as [
        string,
        { credentials: string; body: string },
      ]
      expect(url).toBe('https://otp.example/v1/otp/send')
      expect(init.credentials).toBe('omit')
      expect(JSON.parse(init.body)).toEqual({ phone: '0123', purpose: 'SIGNUP', locale: 'vi' })
    })

    it('응답을 받지 못하면 PROVIDER_UNAVAILABLE(발송됐을 수 있음)', async () => {
      installDocument()
      installLocation()
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => Promise.reject(new TypeError('cors'))),
      )
      const client = createAccountClient({ otpGatewayBaseUrl: 'https://otp.example' })
      expect(await client.otpVerifyPhoneChange({ phone: '0123', code: '1' })).toEqual({
        ok: false,
        status: 0,
        error: { code: 'PROVIDER_UNAVAILABLE' },
      })
    })

    it('게이트웨이 주소가 없으면 NOT_CONFIGURED', async () => {
      installDocument()
      installLocation()
      expect(await createAccountClient().otpSendSignup({ phone: '0' })).toEqual({
        ok: false,
        status: 0,
        error: { code: 'NOT_CONFIGURED' },
      })
    })
  })

  it('조회 값은 호스트 쿠키·__NEXT_DATA__에서 읽는다', () => {
    installDocument({ bmf_bstage_country: 'VN' })
    installLocation('?socialType=KAKAO')
    g.__NEXT_DATA__ = {
      props: {
        pageProps: {
          base: {
            space: {
              seoData: { title: 'Stage' },
              primaryCorporation: { name: 'Corp', country: 'VN' },
            },
          },
        },
      },
    }
    const client = createAccountClient()
    expect(client.mode).toBe('inline')
    expect(client.supported).toBe(true)
    expect(client.hostCountry()).toBe('VN')
    expect(client.hostQuery()).toEqual({ socialType: 'KAKAO' })
    expect(client.spaceInfo()).toEqual({
      title: 'Stage',
      corporation: { name: 'Corp', country: 'VN' },
    })
  })
})
