import { describe, expect, it } from 'vitest'
import { checkConfig, logUrl } from './config.js'

describe('checkConfig', () => {
  it('key가 없으면 코드를 돌려준다', () => {
    expect(checkConfig({ endpoint: 'https://c.example.com' })).toContain('E_KEY_MISSING')
  })

  it('endpoint가 없으면 코드를 돌려준다 — 호스트가 채워야 한다', () => {
    expect(checkConfig({ key: 'k1' })).toContain('E_ENDPOINT_MISSING')
  })

  it('둘 다 있으면 null이다', () => {
    expect(checkConfig({ key: 'k1', endpoint: 'https://c.example.com' })).toBeNull()
  })
})

describe('logUrl', () => {
  it('오리진에 수집 경로를 붙인다', () => {
    expect(logUrl('https://c.example.com')).toBe('https://c.example.com/api/v2/logs/analytics')
  })

  it('끝의 슬래시가 겹치지 않는다', () => {
    expect(logUrl('https://c.example.com//')).toBe('https://c.example.com/api/v2/logs/analytics')
  })
})

describe('endpoint 검증 — 보안 리뷰 대응', () => {
  it('상대 경로와 http(s) 절대 URL을 통과시킨다', () => {
    for (const endpoint of ['/collect', 'https://c.example.com', 'http://localhost:8080']) {
      expect(checkConfig({ key: 'k1', endpoint })).toBeNull()
    }
  })

  it('scheme-relative·javascript· 해석 불가 값을 막는다', () => {
    // `//evil.tld` 는 페이지 기준으로 해석돼 배치가 다른 오리진으로 나간다
    expect(checkConfig({ key: 'k1', endpoint: '//evil.tld' })).toContain('E_ENDPOINT_CROSS_ORIGIN')
    for (const endpoint of ['javascript:alert(1)', 'data:text/plain,x']) {
      expect(checkConfig({ key: 'k1', endpoint })).toContain('E_ENDPOINT_SCHEME')
    }
  })
})

describe('endpoint 우회 — 보안 리뷰 3라운드 대응', () => {
  const BASE = 'https://app.example.com/custom/x'
  const reject = (endpoint: string) => checkConfig({ key: 'k1', endpoint }, BASE)

  it('브라우저 정규화로 다른 오리진이 되는 값을 막는다', () => {
    // WHATWG 파서가 역슬래시를 슬래시로 바꾸고 TAB/LF/CR를 제거한 뒤 해석한다 —
    // 문자열 prefix 검사만 하면 "상대 경로"로 보이는 값이 외부 오리진으로 나간다
    expect(reject('/\\evil.tld')).toBeTruthy()
    expect(reject('/\tevil.tld')).toBeTruthy()
    expect(reject('/\nevil.tld')).toBeTruthy()
  })

  it('scheme-relative는 상대 경로처럼 보이지만 외부 오리진이 된다', () => {
    expect(reject('//evil.tld')).toBeTruthy()
  })

  it('userinfo로 호스트를 바꾸는 값을 막는다', () => {
    expect(reject('https://collector.example.com@evil.tld')).toContain('E_ENDPOINT_USERINFO')
  })

  it('쿼리·프래그먼트로 경로를 밀어내는 값을 막는다', () => {
    expect(reject('https://c.example.com/x?to=')).toContain('E_ENDPOINT_QUERY_OR_FRAGMENT')
    expect(reject('https://c.example.com/x#')).toContain('E_ENDPOINT_QUERY_OR_FRAGMENT')
  })

  it('정상 값은 통과한다', () => {
    for (const endpoint of ['/collect', 'https://c.example.com', 'http://localhost:8080']) {
      expect(checkConfig({ key: 'k1', endpoint }, BASE)).toBeNull()
    }
  })

  it('logUrl은 파싱된 URL로 조립한다', () => {
    expect(logUrl('/collect', BASE)).toBe('https://app.example.com/collect/api/v2/logs/analytics')
  })
})

describe('path override', () => {
  const ENDPOINT = 'https://c.example.com'
  const check = (path: string) => checkConfig({ key: 'k1', endpoint: ENDPOINT, path })

  it('path를 수집 경로 대신 붙인다', () => {
    expect(logUrl(ENDPOINT, undefined, '/collect')).toBe('https://c.example.com/collect')
    expect(logUrl('https://c.example.com/pre', undefined, '/collect')).toBe(
      'https://c.example.com/pre/collect',
    )
  })

  it('빈 path는 endpoint에서 끝 슬래시만 뗀다', () => {
    expect(logUrl(ENDPOINT, undefined, '')).toBe('https://c.example.com/')
    expect(logUrl('https://c.example.com/collect/', undefined, '')).toBe(
      'https://c.example.com/collect',
    )
  })

  it('path로 오리진을 바꿀 수 없다', () => {
    expect(new URL(logUrl(ENDPOINT, undefined, '//evil.tld')).origin).toBe(ENDPOINT)
  })

  it('정상 path는 통과한다', () => {
    expect(check('/collect')).toBeNull()
    expect(check('')).toBeNull()
  })

  it('제어문자·역슬래시를 막는다', () => {
    for (const path of ['/a\\b', '/a\tb']) {
      expect(check(path)).toContain('E_PATH_ILLEGAL_CHAR')
    }
  })

  it('쿼리·프래그먼트를 막는다 — logUrl이 지워 조용히 사라진다', () => {
    for (const path of ['/a?x', '/a#x']) {
      expect(check(path)).toContain('E_PATH_QUERY_OR_FRAGMENT')
    }
  })

  it('/로 시작하지 않는 값을 막는다', () => {
    expect(check('collect')).toContain('E_PATH_NOT_ABSOLUTE')
  })

  it('점 세그먼트를 막는다 — 정규화로 endpoint 접두사를 벗어난다', () => {
    for (const path of ['/a/../b', '/./b', '/a/..', '/%2e%2e/b', '/.%2E/b']) {
      expect(check(path)).toContain('E_PATH_DOT_SEGMENT')
    }
  })

  it('인코딩된 구분자·퍼센트를 막는다 — 디코딩하는 서버에서 접두사를 벗어난다', () => {
    for (const path of ['/%2e%2e%2f%2e%2e%2fcollect', '/a%2Fb', '/a%5cb', '/%252e%252e/x']) {
      expect(check(path)).toContain('E_PATH_ENCODED')
    }
  })

  it('path 오류면 수집을 시작하지 않는다', () => {
    expect(check('collect')).toMatch(/; analytics did not start$/)
  })
})
