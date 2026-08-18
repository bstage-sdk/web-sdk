import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_LANGUAGE,
  __resetBstageI18n__,
  configureBstageI18n,
  fetchTranslations,
  interpolateTranslation,
  normalizeLanguage,
  observeLocale,
  parseRichText,
  pickTranslation,
  readLocale,
  resolveTranslationChain,
} from './i18n.js'

/**
 * 입출력이 명확한 순수 함수인데, 릴리즈 전 손 검증은 한국어 해피패스 하나만 태운다 —
 * 대소문자 다른 로케일 코드, 쿠키 폴백, 대응 파라미터 없는 보간 토큰은 실행되지 않는다.
 */

/** DOM 전체 대신 i18n이 실제로 읽는 두 값만 세운다 (happy-dom 도입 없이 충분하다). */
function stubDocument(opts: { lang?: string; cookie?: string }) {
  vi.stubGlobal('document', {
    documentElement: { lang: opts.lang ?? '' },
    cookie: opts.cookie ?? '',
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  // 모듈 레벨 설정·캐시가 케이스 간에 새지 않게 초기화한다.
  __resetBstageI18n__()
})

describe('normalizeLanguage', () => {
  it('지원 로케일을 그대로 돌려준다', () => {
    expect(normalizeLanguage('ko')).toBe('ko')
    expect(normalizeLanguage('vi')).toBe('vi')
  })

  it('대소문자를 무시한다 (`<html lang>`·쿠키가 zh-cn으로 올 수 있다)', () => {
    expect(normalizeLanguage('zh-cn')).toBe('zh-CN')
    expect(normalizeLanguage('ZH-TW')).toBe('zh-TW')
    expect(normalizeLanguage('EN')).toBe('en')
  })

  it('앞뒤 공백을 떼고 본다', () => {
    expect(normalizeLanguage('  ja  ')).toBe('ja')
  })

  it.each([null, undefined, '', '  '])('신호가 없으면 undefined (%s)', (value) => {
    expect(normalizeLanguage(value)).toBeUndefined()
  })

  it('지원하지 않는 코드는 undefined', () => {
    expect(normalizeLanguage('fr')).toBeUndefined()
    expect(normalizeLanguage('zh')).toBeUndefined()
  })
})

describe('readLocale — user', () => {
  it('`<html lang>`을 1차 신호로 쓴다', () => {
    stubDocument({ lang: 'ja', cookie: 'bmf_bstage_lang=en' })
    expect(readLocale()).toBe('ja')
  })

  it('`<html lang>`이 없거나 미지원이면 쿠키로 폴백한다', () => {
    stubDocument({ lang: '', cookie: 'bmf_bstage_lang=en' })
    expect(readLocale('user')).toBe('en')

    stubDocument({ lang: 'fr', cookie: 'bmf_bstage_lang=en' })
    expect(readLocale('user')).toBe('en')
  })

  it('둘 다 없으면 기본 로케일', () => {
    stubDocument({})
    expect(readLocale('user')).toBe(DEFAULT_LANGUAGE)
  })

  it('어드민 쿠키는 user 신호로 쓰지 않는다', () => {
    stubDocument({ cookie: 'bmf_mybstage_locale=ja' })
    expect(readLocale('user')).toBe(DEFAULT_LANGUAGE)
  })
})

describe('readLocale — admin', () => {
  it('`<html lang>`이 SSR 고정값이라 쿠키를 1차로 신뢰한다', () => {
    stubDocument({ lang: 'ko', cookie: 'bmf_mybstage_locale=ja' })
    expect(readLocale('admin')).toBe('ja')
  })

  it('쿠키가 없으면 `<html lang>`으로 폴백한다', () => {
    stubDocument({ lang: 'en', cookie: '' })
    expect(readLocale('admin')).toBe('en')
  })

  it('둘 다 없으면 기본 로케일', () => {
    stubDocument({ lang: 'fr', cookie: 'other=1' })
    expect(readLocale('admin')).toBe(DEFAULT_LANGUAGE)
  })
})

describe('readLocale — 쿠키 파싱', () => {
  it('쿠키가 여러 개여도 해당 이름만 골라 읽는다', () => {
    stubDocument({ cookie: 'foo=1; bmf_bstage_lang=ja; bar=2' })
    expect(readLocale('user')).toBe('ja')
  })

  it('URL 인코딩된 값을 디코딩한다', () => {
    stubDocument({ cookie: `bmf_bstage_lang=${encodeURIComponent('zh-CN')}` })
    expect(readLocale('user')).toBe('zh-CN')
  })

  it('값에 =가 들어 있어도 잘라먹지 않는다', () => {
    stubDocument({ cookie: 'bmf_bstage_lang=ja=extra' })
    // 'ja=extra'는 지원 코드가 아니므로 기본값으로 떨어진다 — 값을 'ja'로 잘라 쓰지 않는다.
    expect(readLocale('user')).toBe(DEFAULT_LANGUAGE)
  })

  it('DOM이 없으면(SSR) 기본 로케일', () => {
    expect(readLocale('user')).toBe(DEFAULT_LANGUAGE)
    expect(readLocale('admin')).toBe(DEFAULT_LANGUAGE)
  })
})

describe('observeLocale', () => {
  it('MutationObserver가 없는 환경에서는 아무 것도 하지 않는 해제 함수를 준다', () => {
    const off = observeLocale(() => {
      throw new Error('호출되면 안 된다')
    })
    expect(() => off()).not.toThrow()
  })
})

describe('interpolateTranslation', () => {
  it('params가 없으면 원문 그대로', () => {
    expect(interpolateTranslation('안녕 {{name}}')).toBe('안녕 {{name}}')
  })

  it('`{{token}}`을 치환한다', () => {
    expect(interpolateTranslation('안녕 {{name}}', { name: '샤우' })).toBe('안녕 샤우')
  })

  // 사전에서 압도적 다수인 형태(`{{str1}}시간 남음` 등). `#{{token}}`만 치환하던 동안
  // 이 키들은 토큰이 그대로 렌더됐다.
  it('플랫폼 사전의 `{{strN}}` 토큰을 치환한다', () => {
    expect(interpolateTranslation('{{str1}}시간 남음', { str1: 3 })).toBe('3시간 남음')
  })

  // `교환 #{{str}}`의 `#`은 주문번호 앞 리터럴이다. `#`까지 먹으면 `교환 123`이 되어 버린다.
  it('토큰 앞 `#`은 리터럴로 남긴다', () => {
    expect(interpolateTranslation('교환 #{{str}}', { str: '123' })).toBe('교환 #123')
  })

  it('숫자도 문자열로 넣는다', () => {
    expect(interpolateTranslation('{{count}}개', { count: 3 })).toBe('3개')
  })

  it('같은 토큰이 여러 번 나와도 모두 치환한다', () => {
    expect(interpolateTranslation('{{a}}-{{a}}', { a: 'x' })).toBe('x-x')
  })

  it('대응 파라미터가 없는 토큰은 그대로 남긴다', () => {
    expect(interpolateTranslation('{{a}}/{{b}}', { a: 'x' })).toBe('x/{{b}}')
  })
})

/**
 * 사전 fetch는 `latest.json`(포인터) → 버전 경로 → `{lang}/translation.json` 2단이다.
 * 손 검증은 해피패스 하나만 태우므로, 경로 조립·phase 판정·캐시 경계를 여기서 덮는다.
 */
const LATEST_BODY = JSON.stringify({
  version: '2026-08-06-10-16-07',
  cdnPath: 'cdn.bstage.in/static/i18n/real/user/2026-08-06-10-16-07',
})

/** latest → dict 순으로 응답하는 fetch 스텁. 호출 URL을 그대로 기록한다. */
function stubFetch(dict = '{"B1":"x"}', latest = LATEST_BODY) {
  const urls: string[] = []
  const spy = vi.fn(async (url: string) => {
    urls.push(url)
    return new Response(url.includes('latest.json') ? latest : dict)
  })
  vi.stubGlobal('fetch', spy)
  return { spy, urls }
}

describe('fetchTranslations — 경로 조립', () => {
  it('latest.json → 버전 경로 → 사전 순으로 받는다', async () => {
    const { urls } = stubFetch()

    await expect(fetchTranslations('ja')).resolves.toEqual({ B1: 'x' })
    expect(urls[0]).toMatch(
      /^https:\/\/cdn\.static\.bstage\.in\/static\/i18n\/real\/user\/latest\.json\?date=/,
    )
    // cdnPath의 버킷 프리픽스(`cdn.bstage.in/`)를 떼고 origin에 붙인다.
    expect(urls[1]).toBe(
      'https://cdn.static.bstage.in/static/i18n/real/user/2026-08-06-10-16-07/ja/translation.json',
    )
  })

  it('system을 경로에 넣는다 (admin 사전)', async () => {
    const { urls } = stubFetch()

    await fetchTranslations('ko', 'admin')
    expect(urls[0]).toContain('/static/i18n/real/admin/latest.json')
  })

  it('기본 tier(inhouse)는 세그먼트를 만들지 않고, 그 외 tier는 system 뒤에 붙는다', async () => {
    configureBstageI18n({ tier: 'inhouse' })
    const a = stubFetch()
    await fetchTranslations('ko')
    expect(a.urls[0]).toContain('/static/i18n/real/user/latest.json')

    configureBstageI18n({ tier: 'mnetplus' })
    const b = stubFetch()
    await fetchTranslations('ko')
    expect(b.urls[0]).toContain('/static/i18n/real/user/mnetplus/latest.json')
  })

  it('origin을 바꿀 수 있다', async () => {
    configureBstageI18n({ origin: 'https://example.test' })
    const { urls } = stubFetch()

    await fetchTranslations('ko')
    expect(urls[0]).toMatch(/^https:\/\/example\.test\/static\/i18n\//)
  })

  it('latest.json에 캐시 우회 스탬프를 5분 단위로 붙인다', async () => {
    const { urls } = stubFetch()
    await fetchTranslations('ko')

    const stamp = new URL(urls[0]).searchParams.get('date')
    expect(stamp).toMatch(/^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}$/)
    // 분은 5의 배수로 내림된다.
    expect(Number(stamp!.slice(-2)) % 5).toBe(0)
  })
})

describe('fetchTranslations — phase 판정', () => {
  it.each([
    // 판정은 phase 마커(`.dev.`·`.qa.`)만 보므로 도메인은 무엇이든 상관없다.
    ['my-space.dev.example.com', 'dev'],
    ['my-space.qa.example.com', 'qa'],
    ['my-space.sandstage.in', 'sandbox'],
    ['my-space.bstage.in', 'real'],
    ['localhost', 'real'],
  ])('hostname %s → %s', async (hostname, phase) => {
    vi.stubGlobal('location', { hostname })
    const { urls } = stubFetch()

    await fetchTranslations('ko')
    expect(urls[0]).toContain(`/static/i18n/${phase}/user/`)
  })

  it('dev 서버 주입(`__bstage_i18n_phase__`)이 hostname보다 우선한다', async () => {
    vi.stubGlobal('location', { hostname: 'localhost' })
    vi.stubGlobal('__bstage_i18n_phase__', 'qa')
    const { urls } = stubFetch()

    await fetchTranslations('ko')
    expect(urls[0]).toContain('/static/i18n/qa/user/')
  })

  it('config가 주입값보다 우선한다 — hostname으로 못 맞히는 real-canary는 config 전용', async () => {
    vi.stubGlobal('location', { hostname: 'my-space.bstage.in' })
    vi.stubGlobal('__bstage_i18n_phase__', 'qa')
    configureBstageI18n({ phase: 'real-canary' })
    const { urls } = stubFetch()

    await fetchTranslations('ko')
    expect(urls[0]).toContain('/static/i18n/real-canary/user/')
  })

  it('알 수 없는 주입값은 무시하고 hostname으로 떨어진다', async () => {
    vi.stubGlobal('location', { hostname: 'my-space.qa.example.com' })
    vi.stubGlobal('__bstage_i18n_phase__', 'nonsense')
    const { urls } = stubFetch()

    await fetchTranslations('ko')
    expect(urls[0]).toContain('/static/i18n/qa/user/')
  })
})

describe('fetchTranslations — 캐시', () => {
  it('같은 출처·로케일은 한 번만 요청한다 (latest 1 + 사전 1)', async () => {
    const { spy } = stubFetch()

    await Promise.all([fetchTranslations('es'), fetchTranslations('es')])
    await fetchTranslations('es')
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('system이 다르면 별도 사전으로 받는다 (같은 로케일이어도)', async () => {
    const { urls } = stubFetch()

    await fetchTranslations('ko', 'user')
    await fetchTranslations('ko', 'admin')
    expect(urls.filter((u) => u.includes('translation.json'))).toHaveLength(2)
    expect(urls.some((u) => u.includes('/real/admin/latest.json'))).toBe(true)
  })

  it('버전 경로는 재사용한다 — 로케일이 달라도 latest는 한 번만 본다', async () => {
    const { urls } = stubFetch()

    await fetchTranslations('ko')
    await fetchTranslations('en')
    expect(urls.filter((u) => u.includes('latest.json'))).toHaveLength(1)
    expect(urls.filter((u) => u.includes('translation.json'))).toHaveLength(2)
  })

  // 캐시 키가 출처를 포함하므로 tier가 바뀌면 이전 사전을 재사용하지 않는다
  // (그래서 설정 변경 시 캐시를 비우는 코드가 필요 없다).
  it('tier가 다르면 같은 로케일이어도 다시 받는다', async () => {
    const { urls } = stubFetch()
    await fetchTranslations('ko')

    configureBstageI18n({ tier: 'hiand' })
    await fetchTranslations('ko')

    expect(urls.filter((u) => u.includes('translation.json'))).toHaveLength(2)
    expect(urls.filter((u) => u.includes('/hiand/latest.json'))).toHaveLength(1)
  })
})

describe('fetchTranslations — 실패', () => {
  it('사전이 실패하면 캐시를 비워 재시도를 허용한다', async () => {
    const spy = vi
      .fn<(url: string) => Promise<Response>>()
      .mockImplementation(async (url: string) => {
        if (url.includes('latest.json')) return new Response(LATEST_BODY)
        return new Response('{"B1":"ok"}')
      })
      .mockResolvedValueOnce(new Response(LATEST_BODY))
      .mockResolvedValueOnce(new Response('nope', { status: 500 }))
    vi.stubGlobal('fetch', spy)

    await expect(fetchTranslations('vi')).rejects.toThrow('translations vi: HTTP 500')
    // 캐시가 남아 있으면 두 번째 호출이 같은 실패 promise를 돌려준다.
    await expect(fetchTranslations('vi')).resolves.toEqual({ B1: 'ok' })
  })

  it('latest.json이 실패하면 캐시를 비워 재시도를 허용한다', async () => {
    const spy = vi
      .fn<(url: string) => Promise<Response>>()
      .mockImplementation(async (url: string) =>
        url.includes('latest.json') ? new Response(LATEST_BODY) : new Response('{"B1":"ok"}'),
      )
      .mockResolvedValueOnce(new Response('nope', { status: 503 }))
    vi.stubGlobal('fetch', spy)

    await expect(fetchTranslations('zh-TW')).rejects.toThrow('i18n latest real/user: HTTP 503')
    await expect(fetchTranslations('zh-TW')).resolves.toEqual({ B1: 'ok' })
  })

  it('latest.json에 cdnPath가 없으면 거절한다', async () => {
    stubFetch('{}', JSON.stringify({ version: 'x' }))
    await expect(fetchTranslations('ko')).rejects.toThrow('cdnPath 없음')
  })

  it('기본 fetch를 쓴다', async () => {
    const spy = vi.fn(async (url: string) =>
      url.includes('latest.json') ? new Response(LATEST_BODY) : new Response('{}'),
    )
    vi.stubGlobal('fetch', spy)

    await fetchTranslations('zh-TW')
    expect(spy).toHaveBeenCalledTimes(2)
  })

  /**
   * 번역 CDN은 공개 호스트인데 플랫폼의 `__bstage_fetch__`는 URL을 가리지 않고 Authorization
   * (+ dev/qa는 CF Access) 헤더를 붙인다. 그러면 크로스 오리진 요청이 preflight 대상이 되고,
   * 이 CDN은 OPTIONS에 403을 주므로 브라우저가 요청을 막는다 → 사전이 안 온다.
   */
  it('`__bstage_fetch__`가 있어도 쓰지 않는다 (공개 CDN · preflight 403)', async () => {
    const authed = vi.fn(async () => new Response('{}'))
    const plain = vi.fn(async (url: string) =>
      url.includes('latest.json') ? new Response(LATEST_BODY) : new Response('{"B1":"x"}'),
    )
    vi.stubGlobal('__bstage_fetch__', authed)
    vi.stubGlobal('fetch', plain)

    await expect(fetchTranslations('ja')).resolves.toEqual({ B1: 'x' })
    expect(authed).not.toHaveBeenCalled()
    expect(plain).toHaveBeenCalledTimes(2)
  })

  it('config.fetch는 기본 fetch보다 우선한다', async () => {
    const custom = vi.fn(async (url: string) =>
      url.includes('latest.json') ? new Response(LATEST_BODY) : new Response('{"B1":"c"}'),
    )
    const plain = vi.fn(async () => new Response('{}'))
    vi.stubGlobal('fetch', plain)
    configureBstageI18n({ fetch: custom as unknown as typeof fetch })

    await expect(fetchTranslations('ja')).resolves.toEqual({ B1: 'c' })
    expect(plain).not.toHaveBeenCalled()
  })

  it('fetch가 아예 없으면 명시적으로 거절한다', async () => {
    vi.stubGlobal('fetch', undefined)
    await expect(fetchTranslations('zh-CN')).rejects.toThrow('fetch unavailable')
  })
})

describe('pickTranslation — 빈 값은 미번역으로 본다', () => {
  it('첫 사전에 값이 있으면 그것을 쓴다', () => {
    expect(pickTranslation([{ A: '값' }, { A: 'fallback' }], 'A')).toBe('값')
  })

  // 어드민 사전은 일부 로케일의 값이 대부분 빈 문자열이다 — "키 없음"만 보면 영원히 빈칸이 렌더된다.
  it('빈 문자열이면 다음 사전으로 넘긴다', () => {
    expect(pickTranslation([{ A: '' }, { A: 'fallback' }], 'A')).toBe('fallback')
  })

  it('공백만 있어도 미번역으로 본다', () => {
    expect(pickTranslation([{ A: '   ' }, { A: 'fallback' }], 'A')).toBe('fallback')
  })

  it('키가 아예 없어도 다음 사전으로 넘긴다', () => {
    expect(pickTranslation([{}, { A: 'fallback' }], 'A')).toBe('fallback')
  })

  it('어디에도 없으면 undefined — 호출자가 키 노출을 결정한다', () => {
    expect(pickTranslation([{ A: '' }, {}], 'A')).toBeUndefined()
    expect(pickTranslation([], 'A')).toBeUndefined()
  })
})

describe('resolveTranslationChain', () => {
  it('현재 로케일이 맨 앞, 그 뒤로 en → ko', () => {
    expect(resolveTranslationChain('zh-CN')).toEqual(['zh-CN', 'en', 'ko'])
  })

  it('현재 로케일이 체인에 있으면 중복을 없앤다', () => {
    expect(resolveTranslationChain('en')).toEqual(['en', 'ko'])
    expect(resolveTranslationChain('ko')).toEqual(['ko', 'en'])
  })

  it('config로 체인을 바꿀 수 있다', () => {
    configureBstageI18n({ fallbackChain: ['ja'] })
    expect(resolveTranslationChain('vi')).toEqual(['vi', 'ja'])
  })
})

/** Cache Storage 스텁 — put/match만 쓰므로 그 둘 + keys/delete만 흉내낸다. */
function stubCaches() {
  const store = new Map<string, Response>()
  const cache = {
    put: async (key: string, res: Response) => void store.set(key, res),
    match: async (key: string) => store.get(key),
    keys: async () => [...store.keys()].map((url) => ({ url })),
    delete: async (req: { url: string } | string) =>
      store.delete(typeof req === 'string' ? req : req.url),
  }
  vi.stubGlobal('caches', { open: async () => cache })
  return store
}

describe('fetchTranslations — 오프라인 폴백 (Cache Storage)', () => {
  it('성공한 응답을 캐시에 남긴다 (latest는 쿼리를 뗀 키로)', async () => {
    const store = stubCaches()
    stubFetch()

    await fetchTranslations('ko')

    const keys = [...store.keys()]
    expect(keys).toContain('https://cdn.static.bstage.in/static/i18n/real/user/latest.json')
    expect(keys.some((k) => k.endsWith('/ko/translation.json'))).toBe(true)
    // 스탬프가 붙은 URL로 저장하면 5분마다 키가 달라져 장애 때 찾지 못한다.
    expect(keys.some((k) => k.includes('?date='))).toBe(false)
  })

  it('네트워크가 죽어도 캐시에서 사전을 되살린다 (코드 대신 문구)', async () => {
    stubCaches()
    stubFetch('{"B00004":"저장하기"}')
    await expect(fetchTranslations('ko')).resolves.toEqual({ B00004: '저장하기' })

    // 런타임 캐시를 비워 네트워크를 다시 타게 만든 뒤, 모든 요청을 실패시킨다.
    __resetBstageI18n__()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 503 })),
    )

    await expect(fetchTranslations('ko')).resolves.toEqual({ B00004: '저장하기' })
  })

  it('캐시도 없으면 그대로 실패한다', async () => {
    stubCaches()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 503 })),
    )
    await expect(fetchTranslations('ko')).rejects.toThrow('HTTP 503')
  })

  it('Cache Storage가 없는 환경에서도 정상 동작한다', async () => {
    vi.stubGlobal('caches', undefined)
    stubFetch('{"B1":"x"}')
    await expect(fetchTranslations('ko')).resolves.toEqual({ B1: 'x' })
  })

  it('옛 버전 사전을 정리하고 latest 항목은 남긴다', async () => {
    const store = stubCaches()
    const latestKey = 'https://cdn.static.bstage.in/static/i18n/real/user/latest.json'
    const oldDict =
      'https://cdn.static.bstage.in/static/i18n/real/user/2020-01-01-00-00-00/ko/translation.json'
    store.set(latestKey, new Response('{}'))
    store.set(oldDict, new Response('{}'))
    stubFetch()

    await fetchTranslations('ko')
    // prune은 백그라운드(void)라 마이크로태스크를 한 번 흘린다.
    await new Promise((r) => setTimeout(r, 0))

    expect([...store.keys()]).toContain(latestKey)
    expect([...store.keys()]).not.toContain(oldDict)
  })
})

describe('parseRichText — 리치텍스트 조각 나누기', () => {
  it('태그가 없으면 텍스트 하나', () => {
    expect(parseRichText('저장하기')).toEqual([{ type: 'text', value: '저장하기' }])
  })

  it('`<0>…</0>`를 태그 조각으로 뽑는다', () => {
    expect(parseRichText('앞 <0>가운데</0> 뒤')).toEqual([
      { type: 'text', value: '앞 ' },
      { type: 'tag', index: 0, value: '가운데' },
      { type: 'text', value: ' 뒤' },
    ])
  })

  // 실 사전 S00739 — 태그가 보간 토큰을 감싼다.
  it('태그 안의 `{{token}}`도 치환한다', () => {
    expect(parseRichText('<0>{{str}}</0>님, 안녕하세요', { str: '쇼' })).toEqual([
      { type: 'tag', index: 0, value: '쇼' },
      { type: 'text', value: '님, 안녕하세요' },
    ])
  })

  // 조각별로 보간한다 — 앞·뒤 텍스트와 태그 안을 각각 태워야 한쪽만 빠진 걸 잡는다.
  it('태그 앞뒤 텍스트의 `{{token}}`도 각각 치환한다', () => {
    expect(
      parseRichText('{{who}}님 <0>{{what}}</0> 확인 {{when}}', {
        who: '쇼',
        what: '주문',
        when: '오늘',
      }),
    ).toEqual([
      { type: 'text', value: '쇼님 ' },
      { type: 'tag', index: 0, value: '주문' },
      { type: 'text', value: ' 확인 오늘' },
    ])
  })

  // 실 사전 S00745·S02732·S02872 — 한 문구에 인덱스 두 개.
  it('인덱스가 여러 개여도 각각 뽑는다', () => {
    expect(parseRichText('<0>a</0>와 <1>b</1>')).toEqual([
      { type: 'tag', index: 0, value: 'a' },
      { type: 'text', value: '와 ' },
      { type: 'tag', index: 1, value: 'b' },
    ])
  })

  /**
   * 실 사전 S00417 — 본문에 리터럴 꺾쇠가 있다(꺾쇠 개수가 안 맞는 문구가 있다).
   * `<`/`>`를 마크업으로 보는 파서는 이 문구를 깨뜨린다.
   */
  it('본문의 리터럴 꺾쇠를 건드리지 않는다', () => {
    expect(parseRichText('<0>‘MY > 고객센터’</0>를 통해 문의')).toEqual([
      { type: 'tag', index: 0, value: '‘MY > 고객센터’' },
      { type: 'text', value: '를 통해 문의' },
    ])
  })

  it('짝이 맞지 않는 태그는 글자로 남긴다', () => {
    expect(parseRichText('열기만 <0>했다')).toEqual([{ type: 'text', value: '열기만 <0>했다' }])
    // 여는 태그와 닫는 태그의 인덱스가 다르면 쌍이 아니다.
    expect(parseRichText('<0>어긋남</1>')).toEqual([{ type: 'text', value: '<0>어긋남</1>' }])
  })

  /**
   * 보간을 먼저 하면 파라미터 값 안의 `<0>`이 태그로 해석된다 — 소비자가 넘긴 값이 마크업이 된다.
   * 그래서 조각을 나눈 뒤에 보간한다.
   */
  it('파라미터 값에 든 태그는 마크업으로 해석하지 않는다', () => {
    expect(parseRichText('값: {{v}}', { v: '<0>주입</0>' })).toEqual([
      { type: 'text', value: '값: <0>주입</0>' },
    ])
  })
})
