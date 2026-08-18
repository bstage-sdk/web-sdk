import { createElement, useEffect, type ComponentType } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  announceElementName,
  createWebComponent,
  type FrameworkAdapter,
  type PlatformBridge,
} from '@bstage-sdk/core'
import { BstageContext, type BstageContextValue } from './BstageContext.js'
import type { BstageTemplateComponent } from './createTemplate.js'

/** @internal 템플릿 React 트리 mount 완료 후 host 엘리먼트에 ready 신호를 보낸다. */
function ReadySignal({ host }: { host: HTMLElement }) {
  useEffect(() => {
    host.dispatchEvent(new CustomEvent('bstage:__ready__', { bubbles: false, composed: false }))
  }, [])
  return null
}

class ReactAdapter implements FrameworkAdapter<ComponentType> {
  private root: Root | null = null
  private component: ComponentType | null = null
  private contextValue: BstageContextValue | null = null
  private host: HTMLElement | null = null

  constructor(private options: { styles?: string } = {}) {}

  mount(
    component: ComponentType,
    container: ShadowRoot | HTMLElement,
    props: Record<string, unknown>,
    bridge: PlatformBridge,
  ): void {
    this.component = component
    this.contextValue = { bridge }
    this.host = bridge.getHost()

    // Shadow DOM은 바깥 스타일시트를 받지 않으므로 `styles`를 직접 넣어준다.
    // (`import css from './x.css?inline'` → `createTemplate(C, { styles: css })`)
    if (this.options.styles && container instanceof ShadowRoot) {
      const style = document.createElement('style')
      style.textContent = this.options.styles
      container.appendChild(style)
    }

    this.root = createRoot(container)
    this.render(props)
  }

  update(props: Record<string, unknown>): void {
    this.render(props)
  }

  unmount(): void {
    // queueMicrotask으로 미룬다 — 호스트가 템플릿을 자기 React 트리 안에서 언마운트하면
    // disconnectedCallback이 렌더링 도중 동기 호출되고, 그때 root.unmount()를 즉시 부르면
    // "Attempted to synchronously unmount" 에러가 난다.
    const root = this.root
    queueMicrotask(() => root?.unmount())
    this.root = null
    this.component = null
    this.contextValue = null
    this.host = null
  }

  private render(props: Record<string, unknown>): void {
    if (!this.root || !this.component || !this.contextValue || !this.host) return

    this.root.render(
      createElement(
        BstageContext.Provider,
        { value: this.contextValue },
        createElement(this.component, props),
        createElement(ReadySignal, { host: this.host }),
      ),
    )
  }
}

/**
 * @internal 빌드 파이프라인 전용. 직접 사용하지 마세요.
 */
export function registerTemplate(template: BstageTemplateComponent): typeof HTMLElement {
  const meta = template.__bstage_meta__
  const options = template.__bstage_options__
  const Component = template.__bstage_inner__
  const tagName = meta.elementName

  const WebComponent = createWebComponent(
    () => new ReactAdapter({ styles: options.styles }),
    Component,
    { ...options, framework: 'react' },
  )

  if (!customElements.get(tagName)) {
    customElements.define(tagName, WebComponent)
  }

  // 호스트가 manifest.json 없이 태그명을 알아낼 수 있도록 자기 번들 URL과 함께 남긴다.
  // 반드시 IIFE 최상위 실행 중에 불려야 한다 — `document.currentScript`가 그때만 유효하다.
  announceElementName(tagName)

  return WebComponent
}
