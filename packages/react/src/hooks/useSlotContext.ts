import { useState } from 'react'
import type { SlotContextOf, SlotIdV2 } from '@bstage-sdk/core'
import { usePlatformEvent } from './usePlatformEvent.js'

/**
 * 호스트가 마운트 시점에 한 번 dispatch한 슬롯 context를 받는 hook.
 *
 * 위젯이 ready 신호를 보내기 전에 호스트가 dispatch했어도 `TemplateHandle`의 버퍼링이
 * ready 시점까지 잡고 있다가 자동 replay하므로, 위젯 입장에서는 마운트 후 자연스럽게 한 번 받는다.
 *
 * 호스트 → 위젯 단방향 read-only (결정-016·022). 마운트 이후 호스트가 데이터 변경해도
 * 위젯에 다시 보내지 않으니, 위젯은 받은 값으로 자기 lifecycle을 산다.
 *
 * 처음 받기 전(또는 호스트가 안 보낸 경우) `undefined`. 위젯 측에서 가드 필요.
 *
 * @example
 * ```tsx
 * import { createTemplate, useSlotContext } from '@bstage-sdk/react'
 *
 * const MyQrWidget = () => {
 *   const context = useSlotContext<'admin.digital-ticket-detail.form:after'>()
 *   if (!context) return null
 *   return <QrPanel ticket={context.ticket} />
 * }
 *
 * export default createTemplate(MyQrWidget, { name: 'my-qr-widget' })
 * ```
 */
export function useSlotContext<Id extends SlotIdV2>(): SlotContextOf<Id> | undefined {
  const [context, setContext] = useState<SlotContextOf<Id>>()

  usePlatformEvent('slot.context', (payload) => {
    setContext(payload as SlotContextOf<Id>)
  })

  return context
}
