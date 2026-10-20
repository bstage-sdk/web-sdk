/**
 * @internal 테스트 전용 가짜 창 쌍. 호스트 창 ↔ iframe(contentWindow) ↔ 프레임 전역을
 * 구조화 복제 + 마이크로태스크 배달로 잇는다(실제 postMessage처럼 비동기·사본).
 * tsup entry에 없으므로 번들·배포물에 실리지 않는다.
 */
import { vi } from 'vitest'
import type { HostWindow, IframeLike, MessageEventLike } from './host/types.js'
import type { RuntimeGlobal } from './frame/types.js'

export const HOST_ORIGIN = 'https://space.example.com'
export const SESSION = '0123456789abcdef0123456789abcdef'

type Listener = (ev: MessageEventLike) => void

export interface FakeLink {
  readonly hostWin: HostWindow & { open: ReturnType<typeof vi.fn> }
  readonly iframe: IframeLike
  readonly frameGlobal: RuntimeGlobal
  readonly parent: { postMessage(message: unknown, targetOrigin: string): void }
  readonly toFrame: Array<{ message: unknown; targetOrigin: string }>
  readonly toHost: Array<{ message: unknown; targetOrigin: string }>
  /** 호스트 창에 임의 메시지를 넣는다(위조 발신자 테스트용). */
  dispatchToHost(ev: MessageEventLike): void
  /** 프레임에 임의 메시지를 넣는다. */
  dispatchToFrame(ev: MessageEventLike): void
  hostListenerCount(): number
}

export function createFakeLink(options: { frameOrigin?: string } = {}): FakeLink {
  const hostListeners = new Set<Listener>()
  const frameListeners = new Set<Listener>()
  const toFrame: FakeLink['toFrame'] = []
  const toHost: FakeLink['toHost'] = []
  const frameOrigin = options.frameOrigin ?? 'null'

  const parent = {
    postMessage(message: unknown, targetOrigin: string) {
      toHost.push({ message, targetOrigin })
      const data = structuredClone(message)
      queueMicrotask(() =>
        hostListeners.forEach((fn) => fn({ source: contentWindow, origin: frameOrigin, data })),
      )
    },
  }
  const contentWindow = {
    postMessage(message: unknown, targetOrigin: string) {
      toFrame.push({ message, targetOrigin })
      const data = structuredClone(message)
      queueMicrotask(() =>
        frameListeners.forEach((fn) => fn({ source: parent, origin: HOST_ORIGIN, data })),
      )
    },
  }
  const hostWin = {
    addEventListener: (_t: 'message', fn: Listener) => void hostListeners.add(fn),
    removeEventListener: (_t: 'message', fn: Listener) => void hostListeners.delete(fn),
    open: vi.fn(),
  }
  const frameGlobal: RuntimeGlobal = {
    parent,
    addEventListener: (_t, fn) => void frameListeners.add(fn),
    crypto: globalThis.crypto as RuntimeGlobal['crypto'],
  }
  return {
    hostWin,
    iframe: { contentWindow, ownerDocument: { defaultView: hostWin } },
    frameGlobal,
    parent,
    toFrame,
    toHost,
    dispatchToHost: (ev) => hostListeners.forEach((fn) => fn(ev)),
    dispatchToFrame: (ev) => frameListeners.forEach((fn) => fn(ev)),
    hostListenerCount: () => hostListeners.size,
  }
}

/** 마이크로태스크·짧은 비동기 체인을 흘려보낸다. */
export async function flush(times = 5): Promise<void> {
  for (let i = 0; i < times; i += 1) await new Promise<void>((r) => queueMicrotask(r))
}
