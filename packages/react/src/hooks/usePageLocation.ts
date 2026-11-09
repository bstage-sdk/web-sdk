import { useMemo, useSyncExternalStore } from 'react'
import { getPageLocation, onPageLocationChange, type PageLocation } from '@bstage-sdk/core'

/** 스냅샷은 문자열로 비교한다 — getPageLocation()은 호출마다 새 객체라 그대로 쓰면 무한 렌더가 된다. */
function snapshot(): string {
  const { path, query } = getPageLocation()
  const search = query.toString()
  return search ? `${path}?${search}` : path
}

/**
 * 호스트 페이지의 현재 경로·쿼리를 구독하는 hook(core `getPageLocation`·`onPageLocationChange` 래퍼).
 * 격리 프레임에서는 호스트가 보내는 위치, inline에서는 `window.location`과 호스트의 `bstage:page` 이벤트를 따른다.
 * 호스트가 위치를 주지 않는 배치에서는 `path`가 빈 문자열이다.
 *
 * 쿼리를 바꾸려면 `useNavigation().navigate('/shop?id=1')`처럼 경로에 쿼리를 붙여 이동한다.
 *
 * @example
 * ```tsx
 * const { path, query } = usePageLocation()
 * const productId = query.get('id')
 * ```
 */
export function usePageLocation(): PageLocation {
  const current = useSyncExternalStore(onPageLocationChange, snapshot, () => '')
  return useMemo(() => {
    const at = current.indexOf('?')
    return at === -1
      ? { path: current, query: new URLSearchParams() }
      : { path: current.slice(0, at), query: new URLSearchParams(current.slice(at)) }
  }, [current])
}
