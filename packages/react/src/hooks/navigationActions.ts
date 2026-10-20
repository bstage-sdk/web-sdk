import type { FrameBridgeLike, PlatformBridge } from '@bstage-sdk/core'

/** useNavigation이 반환하는 네비게이션 함수 모음. */
export interface NavigationActions {
  /** 앱 내 경로로 이동. */
  navigate: (path: string, params?: Record<string, string>) => void
  /** 이전 화면으로 돌아가기. */
  goBack: () => void
  /** 외부 URL을 새 탭으로 열기. */
  openExternal: (url: string) => void
}

function withQuery(path: string, params?: Record<string, string>): string {
  return path + (params ? '?' + new URLSearchParams(params).toString() : '')
}

/**
 * @internal 실행 환경에 맞는 네비게이션 함수를 만든다. 우선순위:
 *
 * 1. 격리 프레임(`frameBridge`) — 호스트에 navigate·back·openExternal 요청. 호스트가 경로·URL을 검증한다
 *    (앱 내 경로만, https만). 실패는 조용히 무시한다(기존 emit도 결과를 돌려주지 않는다).
 * 2. 플랫폼 임베드(`platformBridge`) — 기존 이벤트 emit.
 * 3. 그 외(로컬 dev 등) — 브라우저 네이티브 API.
 *
 * 브리지가 없으면 2·3은 기존 `useNavigation`과 같은 동작이다.
 */
export function createNavigationActions(
  frameBridge: FrameBridgeLike | undefined,
  platformBridge: PlatformBridge | null | undefined,
): NavigationActions {
  if (frameBridge) {
    const send = (type: string, payload: unknown) => {
      frameBridge.request(type, payload).catch(() => {})
    }
    return {
      navigate: (path, params) => send('navigate', { path: withQuery(path, params) }),
      goBack: () => send('back', {}),
      openExternal: (url) => send('openExternal', { url }),
    }
  }
  return {
    navigate: (path, params) => {
      if (platformBridge) {
        platformBridge.emit('navigate', { path, params })
      } else {
        window.location.href = withQuery(path, params)
      }
    },
    goBack: () => {
      if (platformBridge) {
        platformBridge.emit('go-back', {})
      } else {
        window.history.back()
      }
    },
    openExternal: (url) => {
      if (platformBridge) {
        platformBridge.emit('open-external', { url })
      } else {
        window.open(url, '_blank')
      }
    },
  }
}
