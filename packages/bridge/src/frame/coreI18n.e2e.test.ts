import { existsSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBridgeHost } from '../host/createBridgeHost.js'
import { createFakeLink, flush, HOST_ORIGIN, SESSION } from '../testing.js'
import { createBridgeClient } from './createBridgeClient.js'

/**
 * 종단: 호스트가 init·locale 이벤트에 실은 번역 사전이 실제 프레임 클라이언트를 거쳐 **core i18n**
 * (`fetchTranslations`·`observeTranslations`)까지 닿는지. 양쪽 단위 테스트는 각자 가짜 상대를 쓰므로
 * 필드 이름이나 스냅샷 갱신 순서가 어긋나도 둘 다 초록일 수 있다 — 그 틈을 여기서 막는다.
 *
 * core는 bridge에 의존하지 않는다(구조적으로 `globalThis.__bstage_bridge__`만 읽는다). 패키지 경계를
 * 타입 그래프로 묶지 않으려고 core 소스를 동적 import한다.
 */

interface CoreI18n {
  fetchTranslations(locale: string): Promise<Record<string, string>>
  observeTranslations(onChange: () => void): () => void
  readLocale(): string
  __resetBstageI18n__(): void
}

// core 소스 위치에 묶인다 — core를 옮기면 아래 존재 확인이 경로를 짚어 실패한다.
const CORE_I18N = new URL('../../../core/src/i18n.ts', import.meta.url).href

async function loadCore(): Promise<CoreI18n> {
  return (await import(/* @vite-ignore */ CORE_I18N)) as CoreI18n
}

afterEach(async () => {
  vi.unstubAllGlobals()
  ;(await loadCore()).__resetBstageI18n__()
})

function connect(locale: string, translations?: Record<string, string>) {
  const link = createFakeLink()
  const host = createBridgeHost({
    iframe: link.iframe,
    session: SESSION,
    hostOrigin: HOST_ORIGIN,
    init: {
      placementId: 'page:/landing|https://cdn.example.com/t/template.js',
      surface: 'page',
      phase: 'dev',
      spaceId: 'space-1',
      locale,
      theme: { dark: false },
      member: { signedIn: false },
      partnerOrigins: [],
      ...(translations ? { translations } : {}),
    },
    fetchImpl: vi.fn(),
  })
  const client = createBridgeClient({
    global: link.frameGlobal,
    session: SESSION,
    hostOrigin: HOST_ORIGIN,
  })
  // 실제 프레임에서는 부트스트랩이 프레임 전역에 설치한다 — core는 같은 전역을 읽는다.
  vi.stubGlobal('__bstage_bridge__', client)
  return { host, client }
}

describe('호스트 번역 사전 → core i18n', () => {
  it('core i18n 소스가 이 경로에 있다', () => {
    expect(existsSync(decodeURIComponent(new URL(CORE_I18N).pathname))).toBe(true)
  })

  it('init.translations가 core fetchTranslations로 나온다(CDN 호출 없음)', async () => {
    const native = vi.fn()
    vi.stubGlobal('fetch', native)
    const { client } = connect('en', { 'home.title': 'Home', 'home.cta': 'Go' })
    await client.ready
    const core = await loadCore()
    expect(core.readLocale()).toBe('en')
    expect(await core.fetchTranslations('en')).toEqual({ 'home.title': 'Home', 'home.cta': 'Go' })
    expect(native).not.toHaveBeenCalled()
  })

  it('locale 이벤트의 새 사전이 반영되고 observeTranslations가 알린다', async () => {
    const { host, client } = connect('ko', { greet: '안녕' })
    await client.ready
    const core = await loadCore()
    const changed = vi.fn()
    const stop = core.observeTranslations(changed)
    host.send('locale', { locale: 'ja', translations: { greet: 'こんにちは' } })
    await flush(10)
    expect(changed).toHaveBeenCalledTimes(1)
    expect(core.readLocale()).toBe('ja')
    expect(await core.fetchTranslations('ja')).toEqual({ greet: 'こんにちは' })
    // 다른 locale 사전은 주지 않는다(호스트는 현재 locale 사전만 보낸다).
    expect(await core.fetchTranslations('ko')).toEqual({})
    stop()
  })

  it('호스트가 사전에 문자열이 아닌 값을 섞어도 core에는 문자열만 닿는다', async () => {
    const { client } = connect('en', { ok: 'x', bad: 1 as unknown as string })
    await client.ready
    const core = await loadCore()
    expect(await core.fetchTranslations('en')).toEqual({ ok: 'x' })
  })

  it('사전 없이 locale만 오면 빈 사전', async () => {
    const { client } = connect('en')
    await client.ready
    expect(await (await loadCore()).fetchTranslations('en')).toEqual({})
  })
})
