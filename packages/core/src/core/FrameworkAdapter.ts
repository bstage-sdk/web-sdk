import type { PlatformBridge } from './PlatformBridge.js'

/**
 * 프레임워크에 독립적인 어댑터 인터페이스.
 * 각 프레임워크(React, Vue, Svelte 등)가 자체 구현을 제공합니다.
 */
export interface FrameworkAdapter<Component = unknown> {
  mount(
    component: Component,
    container: ShadowRoot | HTMLElement,
    props: Record<string, unknown>,
    bridge: PlatformBridge,
  ): void
  update(props: Record<string, unknown>): void
  unmount(): void
}
