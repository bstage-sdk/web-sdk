import type { FrameBridgeLike, PlatformBridge } from '@bstage-sdk/core'

/** useNavigation이 반환하는 네비게이션 함수 모음. */
export interface NavigationActions {
  /** 앱 내 경로로 이동. */
  navigate: (path: string, params?: Record<string, string>) => void
  /** 이전 화면으로 돌아가기. */
  goBack: () => void
  /** 외부 URL을 새 탭으로 열기. */
  openExternal: (url: string) => void
  /** 같은 탭에서 외부 https 사이트로 이동(플랫폼이 확인 창을 띄우고 거절할 수 있다). */
  navigateExternal: (url: string) => void
}

/**
 * 로컬 dev fallback에서도 https만 이동한다(`javascript:` 등 스킴 차단). 사용자 정보가 든 URL
 * (`https://trusted.example@evil.test/`)은 보이는 앞부분과 실제 목적지가 달라 거절한다(호스트 `validateExternalUrl`과 같은 규칙).
 */
function isHttpsUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && parsed.username === '' && parsed.password === ''
  } catch {
    return false
  }
}

function withQuery(path: string, params?: Record<string, string>): string {
  return path + (params ? '?' + new URLSearchParams(params).toString() : '')
}

/**
 * @internal 실행 환경에 맞는 네비게이션 함수를 만든다. 우선순위:
 *
 * 1. 격리 프레임(`frameBridge`) — 호스트에 navigate·back·openExternal·navigateExternal 요청. 호스트가 경로·URL을 검증한다
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
      navigateExternal: (url) => send('navigateExternal', { url }),
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
    navigateExternal: (url) => {
      // 플랫폼 채널에도 검증한 URL만 보낸다(https·사용자 정보 없음) — 호스트가 채널 계약을 믿고 그대로 이동해도 안전하게.
      if (!isHttpsUrl(url)) return
      if (platformBridge) {
        platformBridge.emit('navigate-external', { url })
      } else {
        window.location.assign(url)
      }
    },
  }
}
