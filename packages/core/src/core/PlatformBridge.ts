import type {
  TemplateEventType,
  TemplateEventMap,
  PlatformEventType,
  PlatformEventMap,
} from './types.js'

export type PlatformEventHandler<T extends PlatformEventType = PlatformEventType> = (
  payload: PlatformEventMap[T],
) => void

/**
 * 템플릿과 플랫폼 간의 양방향 통신 브릿지.
 *
 * 템플릿 → 플랫폼: emit()이 호스트 엘리먼트에서 CustomEvent('bstage:{type}')를 디스패치합니다.
 * 플랫폼 → 템플릿: on()이 호스트 엘리먼트에서 디스패치된 'bstage:{type}' 이벤트를 수신합니다.
 */
export class PlatformBridge {
  private host: HTMLElement
  private listeners: Array<{ type: string; handler: EventListener }> = []

  constructor(host: HTMLElement) {
    this.host = host
  }

  /** @internal 프레임워크 어댑터가 host 엘리먼트에 접근하기 위한 내부 메서드. */
  getHost(): HTMLElement {
    return this.host
  }

  /**
   * 플랫폼으로 템플릿 이벤트를 디스패치합니다.
   *
   * @example
   * bridge.emit('navigate', { path: '/lounge/123' })
   * bridge.emit('toast', { message: 'Saved!', variant: 'success' })
   */
  emit<T extends TemplateEventType>(type: T, payload: TemplateEventMap[T]): void {
    this.host.dispatchEvent(
      new CustomEvent(`bstage:${type}`, {
        bubbles: true,
        composed: true,
        detail: payload,
      }),
    )
  }

  /**
   * 호스트 엘리먼트에서 디스패치된 플랫폼 이벤트를 수신합니다.
   * 구독 해제 함수를 반환합니다.
   *
   * @example
   * const off = bridge.on('some-event', (payload) => { ... })
   * off() // 구독 해제
   */
  on<T extends PlatformEventType>(type: T, handler: PlatformEventHandler<T>): () => void {
    const eventType = `bstage:${type}`
    const listener: EventListener = (e: Event) => {
      handler((e as CustomEvent).detail)
    }
    this.host.addEventListener(eventType, listener)
    this.listeners.push({ type: eventType, handler: listener })

    return () => {
      this.host.removeEventListener(eventType, listener)
      this.listeners = this.listeners.filter((l) => l.handler !== listener)
    }
  }

  /**
   * 등록된 모든 리스너를 제거합니다. disconnectedCallback에서 호출됩니다.
   */
  destroy(): void {
    for (const { type, handler } of this.listeners) {
      this.host.removeEventListener(type, handler)
    }
    this.listeners = []
  }
}
