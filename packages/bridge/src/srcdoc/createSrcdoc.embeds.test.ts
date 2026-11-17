import { describe, expect, it } from 'vitest'
import { createNonce, createSession } from '../protocol/session.js'
import {
  buildFrameCsp,
  createSrcdoc,
  MAX_FRAME_ORIGINS,
  type CreateSrcdocOptions,
} from './createSrcdoc.js'

const NONCE = createNonce()
const ASSET = 'https://cdn.example.com'
const OPTS: CreateSrcdocOptions = {
  nonce: NONCE,
  session: createSession(),
  hostOrigin: 'https://host.example.com',
  assetOrigin: ASSET,
  entryUrl: `${ASSET}/t/template.js`,
  elementName: 'x-tpl',
  title: 't',
}

/** srcdoc 문서의 CSP meta에서 지시어별 값(HTML 이스케이프 해제). */
function cspOf(html: string): Map<string, string> {
  const m = /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)
  const csp = (m?.[1] ?? '').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
  return new Map(csp.split('; ').map((d) => [d.split(' ')[0], d]))
}

describe('외부 이미지 전체 허용(imagesAnyHttps)', () => {
  it('기본은 그대로 — img-src에 맨 https: 없음', () => {
    expect(cspOf(createSrcdoc(OPTS)).get('img-src')).toBe(`img-src ${ASSET} data: blob:`)
  })

  it('켜면 img-src에만 https:가 붙고 media-src·font-src는 그대로', () => {
    const map = cspOf(createSrcdoc({ ...OPTS, imagesAnyHttps: true }))
    expect(map.get('img-src')).toBe(`img-src ${ASSET} https: data: blob:`)
    expect(map.get('media-src')).toBe(`media-src ${ASSET} blob:`)
    expect(map.get('font-src')).toBe(`font-src ${ASSET} data:`)
    expect(map.get('img-src')?.split(' ')).not.toContain('http:')
  })

  it('불리언이 아니면 TypeError', () => {
    expect(() => createSrcdoc({ ...OPTS, imagesAnyHttps: 'true' as never })).toThrow(TypeError)
    expect(() => buildFrameCsp(NONCE, ASSET, [], { imagesAnyHttps: 1 as never })).toThrow(TypeError)
  })
})

describe('임베드 허용 origin(frameOrigins)', () => {
  it('기본은 frame-src none', () => {
    expect(cspOf(createSrcdoc(OPTS)).get('frame-src')).toBe("frame-src 'none'")
  })

  it('정확한 https origin만 frame-src에 실리고 중복은 한 번', () => {
    const map = cspOf(
      createSrcdoc({
        ...OPTS,
        frameOrigins: ['https://open.spotify.com', 'https://open.spotify.com'],
      }),
    )
    expect(map.get('frame-src')).toBe('frame-src https://open.spotify.com')
    // 다른 지시어에는 번지지 않는다.
    expect(map.get('img-src')).toBe(`img-src ${ASSET} data: blob:`)
    expect(map.get('connect-src')).toBe('connect-src https: wss:')
  })

  it('빈 배열이면 none', () => {
    expect(buildFrameCsp(NONCE, ASSET, [], { frameOrigins: [] })).toContain("frame-src 'none'")
  })

  it.each([
    ['http://open.spotify.com'],
    ['https:'],
    ['*'],
    ['https://*.spotify.com'],
    ['https://open.spotify.com/embed'],
    ['https://u:p@open.spotify.com'],
    ['https://open.spotify.com; script-src *'],
    ["https://open.spotify.com 'unsafe-inline'"],
    ['data:'],
    [''],
  ])('frameOrigins %j → TypeError', (bad) => {
    expect(() =>
      createSrcdoc({ ...OPTS, frameOrigins: ['https://open.spotify.com', bad] }),
    ).toThrow(TypeError)
    expect(() => buildFrameCsp(NONCE, ASSET, [], { frameOrigins: [bad] })).toThrow(TypeError)
  })

  it('배열·최대 개수를 검사한다', () => {
    expect(() => createSrcdoc({ ...OPTS, frameOrigins: 'https://a.example' as never })).toThrow(
      TypeError,
    )
    const max = Array.from({ length: MAX_FRAME_ORIGINS }, (_, i) => `https://f${i}.example.net`)
    expect(() => createSrcdoc({ ...OPTS, frameOrigins: max })).not.toThrow()
    expect(() =>
      createSrcdoc({ ...OPTS, frameOrigins: [...max, 'https://extra.example.net'] }),
    ).toThrow(TypeError)
  })
})
