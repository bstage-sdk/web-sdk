import type { FrameBridgeLike } from '@bstage-sdk/core'

/**
 * 격리 프레임의 슬롯 context 경로.
 *
 * inline 위젯은 템플릿 엘리먼트의 `slot.context` 이벤트로 context 객체를 그대로 받는다. 격리 프레임은 다르다:
 * - 첫 값은 브리지 init의 `slot`(`{ id, context }`)에 실려 온다(엔트리가 init 뒤에 로드되므로 마운트 때 이미 있다).
 * - 이후 호스트가 context를 바꾸면 `slot.context` 브리지 이벤트로 같은 `{ id, context }` 모양이 온다.
 * 두 경로 모두 위젯에는 inline과 같은 모양(context 객체)만 넘긴다.
 */

function contextOf(slot: unknown): Record<string, unknown> | undefined {
  if (typeof slot !== 'object' || slot === null) return undefined
  const context = (slot as { context?: unknown }).context
  return typeof context === 'object' && context !== null
    ? (context as Record<string, unknown>)
    : undefined
}

/** init에 실린 슬롯 context. 슬롯 배치가 아니거나 init 전이면 undefined. */
export function readFrameSlotContext(bridge: FrameBridgeLike): Record<string, unknown> | undefined {
  const init = bridge.getInit() as { slot?: unknown } | undefined
  return contextOf(init?.slot)
}

/** `slot.context` 브리지 이벤트를 구독해 context 객체만 넘긴다. 모양이 틀린 payload는 버린다. 해제 함수를 돌려준다. */
export function subscribeFrameSlotContext(
  bridge: FrameBridgeLike,
  fn: (context: Record<string, unknown>) => void,
): () => void {
  return bridge.on('slot.context', (payload) => {
    const context = contextOf(payload)
    if (context) fn(context)
  })
}
