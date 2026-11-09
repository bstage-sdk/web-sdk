import { PlatformBridge } from './PlatformBridge.js'
import type { TemplateEventMap, TemplateEventType } from './types.js'

/**
 * 이 번들이 마운트한 템플릿 엘리먼트 목록(마운트 순서). React 훅처럼 PlatformBridge를 쥐고 있지 않은
 * core 함수(`navigateExternal` 등)가 inline 이벤트 채널(엘리먼트에서 `bstage:{type}` 디스패치)을 쓰는 데 쓴다.
 *
 * 템플릿 번들마다 core가 따로 실리므로 이 목록은 자기 번들의 엘리먼트만 담는다.
 */
let hosts: readonly HTMLElement[] = []

/** 엘리먼트를 등록한다. 돌려준 함수로 해제한다(disconnectedCallback). */
export function trackTemplateHost(host: HTMLElement): () => void {
  hosts = [...hosts.filter((h) => h !== host), host]
  return () => {
    hosts = hosts.filter((h) => h !== host)
  }
}

/** 아직 문서에 붙어 있는 이 번들의 템플릿 엘리먼트. */
function connectedHosts(): readonly HTMLElement[] {
  return hosts.filter((h) => h.isConnected !== false)
}

/**
 * @internal 템플릿 → 플랫폼 이벤트를 inline 채널로 보낸다(`PlatformBridge.emit`과 같은 `bubbles·composed`) — 호스트의
 * `TemplateHandle.on`이 받는다. 이 번들의 엘리먼트가 **정확히 하나** 붙어 있을 때만 보낸다: 여럿이면 어느 배치의
 * 요청인지 가릴 수 없어(다른 배치 이름으로 처리될 수 있다) 보내지 않고, 없으면 `window`로 흘리지 않는다
 * (페이지의 아무 스크립트나 받는다). 보냈으면 true. 여러 엘리먼트에서 쓰는 템플릿은 React `useNavigation`처럼
 * 자기 엘리먼트의 PlatformBridge를 쥔 경로를 쓴다.
 */
export function emitFromTemplateHost<T extends TemplateEventType>(
  type: T,
  payload: TemplateEventMap[T],
): boolean {
  const connected = connectedHosts()
  if (connected.length !== 1) return false
  new PlatformBridge(connected[0]).emit(type, payload)
  return true
}

/** @internal 테스트 전용. */
export function __resetTemplateHosts__(): void {
  hosts = []
}
