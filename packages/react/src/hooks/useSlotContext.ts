import { useEffect, useState } from 'react'
import { getFrameBridge, type SlotContextOf, type SlotIdV2 } from '@bstage-sdk/core'
import { readFrameSlotContext, subscribeFrameSlotContext } from './slotContextSource.js'
import { usePlatformEvent } from './usePlatformEvent.js'

/**
 * 호스트가 마운트 시점에 한 번 dispatch한 슬롯 context를 받는 hook.
 *
 * 위젯이 ready 신호를 보내기 전에 호스트가 dispatch했어도 `TemplateHandle`의 버퍼링이
 * ready 시점까지 잡고 있다가 자동 replay하므로, 위젯 입장에서는 마운트 후 자연스럽게 한 번 받는다.
 *
 * 호스트 → 위젯 단방향 read-only. 마운트 이후 호스트가 데이터 변경해도
 * 위젯에 다시 보내지 않으니, 위젯은 받은 값으로 자기 lifecycle을 산다.
 *
 * 처음 받기 전(또는 호스트가 안 보낸 경우) `undefined`. 위젯 측에서 가드 필요.
 *
 * 격리 프레임(`__bstage_bridge__` 있음)에서는 브리지 init의 슬롯 context를 첫 렌더부터 돌려주고,
 * 이후 `slot.context` 브리지 이벤트로 바뀐 값을 반영한다. 두 경우 모두 반환 모양은 inline과 같다(context 객체).
 *
 * @example
 * ```tsx
 * import { createTemplate, useSlotContext } from '@bstage-sdk/react'
 *
 * // src/slots/my-qr-widget/template.tsx
 * export default function MyQrWidget() {
 *   const context = useSlotContext<'admin.digital-ticket-detail.form:after'>()
 *   if (!context) return null
 *   return <QrPanel ticket={context.ticket} />
 * }
 *
 * createTemplate(MyQrWidget, {
 *   name: 'my-qr-widget',
 *   slot: 'admin.digital-ticket-detail.form:after', // useSlotContext의 id와 같은 값
 * })
 * ```
 */
export function useSlotContext<Id extends SlotIdV2>(): SlotContextOf<Id> | undefined {
  const frameBridge = getFrameBridge()
  const [context, setContext] = useState<SlotContextOf<Id> | undefined>(() =>
    frameBridge ? (readFrameSlotContext(frameBridge) as SlotContextOf<Id> | undefined) : undefined,
  )

  // inline 경로 — 템플릿 엘리먼트의 이벤트. 격리 프레임에는 이 채널이 없다.
  usePlatformEvent('slot.context', (payload) => {
    if (!frameBridge) setContext(payload as SlotContextOf<Id>)
  })

  // 격리 경로 — 브리지 이벤트(`{ id, context }`)에서 context만 꺼낸다.
  useEffect(() => {
    if (!frameBridge) return
    return subscribeFrameSlotContext(frameBridge, (next) => setContext(next as SlotContextOf<Id>))
  }, [frameBridge])

  return context
}
