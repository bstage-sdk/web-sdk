import { useContext, useEffect, useRef } from 'react'
import type { PlatformEventType, PlatformEventMap, PlatformEventHandler } from '@bstage-sdk/core'
import { BstageContext } from '../BstageContext.js'

/**
 * 플랫폼 → 템플릿 이벤트를 구독하는 hook.
 *
 * 컴포넌트 마운트 시 구독하고, 언마운트 시 자동 해제한다.
 * BstageContext가 없는 환경(로컬 dev 등)에서는 아무 동작도 하지 않는다.
 *
 * @example
 * ```tsx
 * usePlatformEvent('slot.init', (payload) => {
 *   setResourceId(payload.resourceId)
 * })
 *
 * usePlatformEvent('ticket.create.after', ({ ticketId, productId }) => {
 *   saveCustomField(ticketId)
 * })
 * ```
 */
export function usePlatformEvent<T extends PlatformEventType>(
  type: T,
  handler: PlatformEventHandler<T>,
): void {
  const ctx = useContext(BstageContext)
  const bridge = ctx?.bridge
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => {
    if (!bridge) return
    return bridge.on(type, ((payload: PlatformEventMap[T]) => {
      handlerRef.current(payload)
    }) as PlatformEventHandler<T>)
  }, [bridge, type])
}
