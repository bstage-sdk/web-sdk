import type { FrameworkAdapter } from './FrameworkAdapter.js'
import type { TemplateOptions } from './types.js'
import { PlatformBridge } from './PlatformBridge.js'

/**
 * 주어진 프레임워크 어댑터와 컴포넌트로 웹 컴포넌트 클래스를 생성하는 팩토리 함수.
 *
 * 커스텀 엘리먼트를 등록하지 않습니다 — 등록은 프레임워크 바인딩의 책임입니다
 * (예: @bstage-sdk/react의 createTemplate이 customElements.define을 호출).
 */
export function createWebComponent<C>(
  createAdapter: () => FrameworkAdapter<C>,
  component: C,
  options: TemplateOptions,
): typeof HTMLElement {
  const { shadow = true } = options

  class BstageElement extends HTMLElement {
    private _adapter: FrameworkAdapter<C> | null = null
    private _bridge: PlatformBridge | null = null
    private _shadowRoot: ShadowRoot | null = null
    private _mounted = false

    constructor() {
      super()
      if (shadow) {
        this._shadowRoot = this.attachShadow({ mode: 'open' })
      }
    }

    connectedCallback(): void {
      if (!this._mounted) {
        this._mount()
      }
    }

    disconnectedCallback(): void {
      if (this._mounted) {
        this._adapter!.unmount()
        this._bridge!.destroy()
        this._adapter = null
        this._bridge = null
        this._mounted = false
      }
    }

    private _mount(): void {
      const container = this._shadowRoot ?? this
      this._adapter = createAdapter()
      this._bridge = new PlatformBridge(this)
      this._adapter.mount(component, container, {}, this._bridge)
      this._mounted = true
    }
  }

  return BstageElement as unknown as typeof HTMLElement
}
