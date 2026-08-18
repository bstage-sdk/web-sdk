import { createContext, useContext } from 'react'
import type { PlatformBridge } from '@bstage-sdk/core'

/** bstage 템플릿 컨텍스트 값. PlatformBridge를 포함. */
export interface BstageContextValue {
  bridge: PlatformBridge
}

/** @internal 프레임워크 어댑터가 Provider로 감싸는 데 사용. */
export const BstageContext = createContext<BstageContextValue | null>(null)

/**
 * PlatformBridge와 BstageClient에 접근하는 hook.
 * createTemplate으로 감싼 컴포넌트 내부에서만 사용 가능.
 *
 * @example
 * ```tsx
 * const { bridge } = useBstageContext()
 * bridge.emit('navigate', { path: '/profile' })
 * ```
 */
export function useBstageContext(): BstageContextValue {
  const ctx = useContext(BstageContext)
  if (!ctx) {
    throw new Error('[bstage] useBstageContext must be used inside a bstage template')
  }
  return ctx
}
