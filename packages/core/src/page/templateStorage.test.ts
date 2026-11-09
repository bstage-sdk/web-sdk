import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FrameBridgeLike } from '../frameBridge.js'
import {
  __resetInlineStorageFallback__,
  INLINE_STORAGE_PREFIX,
  templateStorage,
} from './templateStorage.js'

/**
 * 템플릿 storage의 두 경로(격리 프레임 브리지·inline localStorage)와 입력 검사·localStorage 실패 대체 분기.
 */

afterEach(() => {
  vi.unstubAllGlobals()
  __resetInlineStorageFallback__()
})

function fakeBridge(request: FrameBridgeLike['request']): FrameBridgeLike {
  return {
    hostOrigin: 'https://host.example',
    getInit: () => ({}),
    request,
    on: () => () => undefined,
    fetch: vi.fn(),
  }
}

function memoryLocalStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (k: string) => data.get(k) ?? null,
    key: (i: number) => [...data.keys()][i] ?? null,
    removeItem: (k: string) => void data.delete(k),
    setItem: (k: string, v: string) => void data.set(k, v),
  }
}

describe('격리 프레임', () => {
  it('get·set·remove를 브리지 storage 요청으로 보낸다', async () => {
    const request = vi.fn(async (_type: string, payload: unknown) =>
      (payload as { op: string }).op === 'get' ? { value: 'v1' } : { value: null },
    )
    vi.stubGlobal('__bstage_bridge__', fakeBridge(request))
    await templateStorage.set('cart', 'v1')
    expect(await templateStorage.get('cart')).toBe('v1')
    await templateStorage.remove('cart')
    expect(request.mock.calls).toEqual([
      ['storage', { op: 'set', key: 'cart', value: 'v1' }],
      ['storage', { op: 'get', key: 'cart' }],
      ['storage', { op: 'remove', key: 'cart' }],
    ])
  })

  it('응답에 문자열 value가 없으면 null', async () => {
    vi.stubGlobal('__bstage_bridge__', fakeBridge(vi.fn(async () => ({ value: 3 }))))
    expect(await templateStorage.get('k')).toBeNull()
  })

  it('호스트 거절은 그대로 reject', async () => {
    const err = Object.assign(new Error('unavailable'), { code: 'STORAGE_UNAVAILABLE' })
    vi.stubGlobal('__bstage_bridge__', fakeBridge(vi.fn(async () => Promise.reject(err))))
    await expect(templateStorage.set('k', 'v')).rejects.toMatchObject({
      code: 'STORAGE_UNAVAILABLE',
    })
  })
})

describe('inline', () => {
  it('localStorage의 bstage:tpl:inline: 아래에 읽고 쓴다', async () => {
    const ls = memoryLocalStorage()
    vi.stubGlobal('window', { localStorage: ls })
    await templateStorage.set('cart', '{"a":1}')
    expect(ls.getItem(`${INLINE_STORAGE_PREFIX}cart`)).toBe('{"a":1}')
    expect(await templateStorage.get('cart')).toBe('{"a":1}')
    await templateStorage.remove('cart')
    expect(await templateStorage.get('cart')).toBeNull()
  })

  it('localStorage 쓰기가 실패하면 메모리에 둔다', async () => {
    const ls = memoryLocalStorage()
    vi.spyOn(ls, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    vi.stubGlobal('window', { localStorage: ls })
    await templateStorage.set('k', 'v')
    expect(ls.getItem(`${INLINE_STORAGE_PREFIX}k`)).toBeNull()
  })

  it('localStorage 접근 자체가 막히면 메모리로 동작', async () => {
    vi.stubGlobal('window', {
      get localStorage(): Storage {
        throw new Error('SecurityError')
      },
    })
    await templateStorage.set('k', 'v')
    expect(await templateStorage.get('k')).toBe('v')
    await templateStorage.remove('k')
    expect(await templateStorage.get('k')).toBeNull()
  })
})

describe('입력 검사', () => {
  it('빈 키·200자 초과 키·4096자 초과 값은 TypeError', async () => {
    vi.stubGlobal('window', { localStorage: memoryLocalStorage() })
    await expect(templateStorage.get('')).rejects.toBeInstanceOf(TypeError)
    await expect(templateStorage.set('a'.repeat(201), 'v')).rejects.toBeInstanceOf(TypeError)
    await expect(templateStorage.set('k', 'v'.repeat(4097))).rejects.toBeInstanceOf(TypeError)
  })
})
