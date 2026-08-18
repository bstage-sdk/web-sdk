import { useEffect, useRef } from 'react'

/**
 * 반환한 ref를 붙인 엘리먼트의 ShadowRoot에 CSS를 주입한다.
 *
 * `createTemplate`의 `styles` 옵션이 템플릿 전체 스타일을 등록 시점에 한 번 넣는 것과 달리,
 * 이 훅은 렌더 중에(조건부·컴포넌트 단위로) 넣는다. 같은 CSS는 해시로 한 번만 들어간다.
 */
export function useShadowStyle<T extends HTMLElement = HTMLElement>(css: string) {
  const ref = useRef<T>(null)
  const injected = useRef(false)

  useEffect(() => {
    if (injected.current || !ref.current) return

    const root = ref.current.getRootNode()
    if (!(root instanceof ShadowRoot)) return

    const hash = hashString(css)
    if (root.querySelector(`style[data-shadow-style="${hash}"]`)) return

    const style = document.createElement('style')
    style.setAttribute('data-shadow-style', hash)
    style.textContent = css
    root.appendChild(style)
    injected.current = true
  })

  return ref
}

function hashString(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = (Math.imul(31, hash) + str.charCodeAt(i)) | 0
  }
  return (hash >>> 0).toString(36)
}
