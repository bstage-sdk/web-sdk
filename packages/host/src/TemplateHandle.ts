import type {
  TemplateEventType,
  TemplateEventMap,
  PlatformEventType,
  PlatformEventMap,
} from '@bstage-sdk/core'
import type { TemplateInfo } from './types.js'

interface BufferedListener {
  type: string
  handler: EventListener
}

/**
 * `loadTemplate()`가 반환하는 핸들.
 * 로드된 템플릿의 생명주기와 이벤트 통신을 관리합니다.
 */
/** @internal 템플릿 ready 이벤트명. 외부 사용 금지. */
const READY_EVENT = 'bstage:__ready__'

export class TemplateHandle {
  readonly info: TemplateInfo

  private element: HTMLElement | null = null
  private container: HTMLElement | null = null
  private bufferedListeners: BufferedListener[] = []
  private activeListeners: Array<{ type: string; handler: EventListener }> = []
  private _templateReady = false
  private _dispatchBuffer: Array<{ type: string; detail: unknown }> = []

  constructor(info: TemplateInfo) {
    this.info = info
  }

  /**
   * 컨테이너 엘리먼트에 템플릿을 마운트합니다.
   * 커스텀 엘리먼트를 생성하고, 버퍼링된 리스너를 연결한 뒤, DOM에 추가합니다.
   */
  mount(container: HTMLElement): void {
    if (this.element) {
      throw new Error(`Template "${this.info.elementName}" is already mounted`)
    }

    this.container = container
    this.element = document.createElement(this.info.elementName)

    // 템플릿 ready 수신 → 버퍼링된 dispatch 리플레이
    this.element.addEventListener(
      READY_EVENT,
      () => {
        this._templateReady = true
        for (const { type, detail } of this._dispatchBuffer) {
          this.element!.dispatchEvent(
            new CustomEvent(type, { bubbles: false, composed: false, detail }),
          )
        }
        this._dispatchBuffer = []
      },
      { once: true },
    )

    // 버퍼링된 리스너를 엘리먼트에 연결
    for (const { type, handler } of this.bufferedListeners) {
      this.element.addEventListener(type, handler)
      this.activeListeners.push({ type, handler })
    }
    this.bufferedListeners = []

    // DOM에 추가 (connectedCallback 트리거)
    container.appendChild(this.element)
  }

  /**
   * 동일한 매니페스트로 독립적인 새 핸들을 생성합니다.
   * 같은 슬롯을 페이지 내 여러 위치에 마운트해야 할 때 사용합니다.
   * 번들 스크립트는 이미 로드된 상태이므로 추가 네트워크 요청이 없습니다.
   */
  fork(): TemplateHandle {
    return new TemplateHandle(this.info)
  }

  /**
   * 템플릿을 언마운트합니다 — 리스너와 엘리먼트를 DOM에서 제거합니다.
   * 멱등성: 여러 번 호출해도 안전합니다.
   */
  unmount(): void {
    if (!this.element) return

    // 모든 활성 리스너 제거
    for (const { type, handler } of this.activeListeners) {
      this.element.removeEventListener(type, handler)
    }
    this.activeListeners = []

    // DOM에서 제거 (disconnectedCallback 트리거)
    this.element.remove()
    this.element = null
    this.container = null
    this._templateReady = false
    this._dispatchBuffer = []
  }

  /**
   * 템플릿 이벤트를 수신합니다 (템플릿 → 플랫폼).
   * mount() 전에 호출할 수 있습니다 — 리스너가 버퍼링되어 마운트 시 연결됩니다.
   * 구독 해제 함수를 반환합니다.
   */
  on<T extends TemplateEventType>(
    type: T,
    handler: (payload: TemplateEventMap[T]) => void,
  ): () => void {
    const eventType = `bstage:${type}`
    const listener: EventListener = (e: Event) => {
      handler((e as CustomEvent).detail)
    }

    if (this.element) {
      // 이미 마운트됨 — 직접 연결
      this.element.addEventListener(eventType, listener)
      this.activeListeners.push({ type: eventType, handler: listener })
    } else {
      // 아직 마운트되지 않음 — 나중을 위해 버퍼링
      this.bufferedListeners.push({ type: eventType, handler: listener })
    }

    return () => {
      if (this.element) {
        this.element.removeEventListener(eventType, listener)
        this.activeListeners = this.activeListeners.filter((l) => l.handler !== listener)
      } else {
        this.bufferedListeners = this.bufferedListeners.filter((l) => l.handler !== listener)
      }
    }
  }

  /**
   * 템플릿으로 플랫폼 이벤트를 디스패치합니다 (플랫폼 → 템플릿).
   * 템플릿이 아직 ready가 아니면 버퍼링 후 ready 시 리플레이합니다.
   */
  dispatch<T extends PlatformEventType>(type: T, payload: PlatformEventMap[T]): void {
    if (!this.element) {
      throw new Error(`Template "${this.info.elementName}" is not mounted`)
    }

    const eventType = `bstage:${type}`

    if (!this._templateReady) {
      this._dispatchBuffer.push({ type: eventType, detail: payload })
      return
    }

    this.element.dispatchEvent(
      new CustomEvent(eventType, {
        bubbles: false,
        composed: false,
        detail: payload,
      }),
    )
  }
}
