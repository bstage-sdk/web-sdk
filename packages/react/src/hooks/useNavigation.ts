import { useCallback, useContext } from 'react'
import { BstageContext } from '../BstageContext.js'

/** useNavigation이 반환하는 네비게이션 함수 모음. */
export interface NavigationActions {
  /** 앱 내 경로로 이동. */
  navigate: (path: string, params?: Record<string, string>) => void
  /** 이전 화면으로 돌아가기. */
  goBack: () => void
  /** 외부 URL을 새 탭으로 열기. */
  openExternal: (url: string) => void
}

/**
 * 플랫폼 네비게이션 hook.
 *
 * 플랫폼에 임베드된 상태에서는 PlatformBridge를 통해 네비게이션하고,
 * 로컬 dev 환경 등 BstageContext가 없을 때는 브라우저 네이티브 API로 fallback한다.
 *
 * @example
 * ```tsx
 * const { navigate, goBack, openExternal } = useNavigation()
 * navigate('/profile', { userId: '123' })
 * ```
 */
export function useNavigation(): NavigationActions {
  const ctx = useContext(BstageContext)
  const bridge = ctx?.bridge

  const navigate = useCallback(
    (path: string, params?: Record<string, string>) => {
      if (bridge) {
        bridge.emit('navigate', { path, params })
      } else {
        const query = params ? '?' + new URLSearchParams(params).toString() : ''
        window.location.href = path + query
      }
    },
    [bridge],
  )

  const goBack = useCallback(() => {
    if (bridge) {
      bridge.emit('go-back', {})
    } else {
      window.history.back()
    }
  }, [bridge])

  const openExternal = useCallback(
    (url: string) => {
      if (bridge) {
        bridge.emit('open-external', { url })
      } else {
        window.open(url, '_blank')
      }
    },
    [bridge],
  )

  return { navigate, goBack, openExternal }
}
