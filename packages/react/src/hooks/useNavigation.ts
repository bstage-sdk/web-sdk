import { useMemo, useContext } from 'react'
import { getFrameBridge } from '@bstage-sdk/core'
import { BstageContext } from '../BstageContext.js'
import { createNavigationActions, type NavigationActions } from './navigationActions.js'

export type { NavigationActions } from './navigationActions.js'

/**
 * 플랫폼 네비게이션 hook.
 *
 * 격리 프레임(`__bstage_bridge__` 있음)에서는 호스트에 브리지 요청을 보내고,
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
  const frameBridge = getFrameBridge()
  return useMemo(() => createNavigationActions(frameBridge, bridge), [frameBridge, bridge])
}
