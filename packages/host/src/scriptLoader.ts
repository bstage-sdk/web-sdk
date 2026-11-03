const cache = new Map<string, Promise<void>>()

/**
 * 멱등성 스크립트 로더 — 동일한 URL은 한 번만 로드됩니다.
 * 실패 또는 타임아웃 시 캐시 항목이 제거되어 재시도가 가능합니다.
 *
 * `crossOrigin`이 `'anonymous'`면 `<script crossorigin="anonymous">`로 로드합니다. 교차 origin 번들의 에러가
 * "Script error."로 가려지지 않게 하는 용도이며, CDN이 CORS로 응답해야 합니다(아니면 로드가 실패합니다).
 * 그 밖의 값은 무시합니다. 캐시는 URL 기준이라, 이미 로드한(또는 로드 중인) URL은 crossOrigin과 무관하게 그 결과를 씁니다.
 */
export function loadScript(
  url: string,
  timeoutMs = 10_000,
  crossOrigin?: 'anonymous',
): Promise<void> {
  const existing = cache.get(url)
  if (existing) return existing

  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    // 요청 모드가 src 대입 시점에 정해지는 브라우저가 있어 src보다 먼저 둔다.
    if (crossOrigin === 'anonymous') script.crossOrigin = 'anonymous'
    script.src = url
    script.async = true

    const timer = setTimeout(() => {
      cleanup()
      cache.delete(url)
      reject(
        new Error(
          `[bstage-host] 템플릿 번들을 ${timeoutMs}ms 안에 불러오지 못했습니다: ${url}. 네트워크 상태를 확인하거나 timeout 옵션을 늘리세요.`,
        ),
      )
    }, timeoutMs)

    const cleanup = () => {
      clearTimeout(timer)
      script.removeEventListener('load', onLoad)
      script.removeEventListener('error', onError)
    }

    const onLoad = () => {
      cleanup()
      resolve()
    }

    const onError = () => {
      cleanup()
      cache.delete(url)
      reject(
        new Error(
          `[bstage-host] 템플릿 번들을 불러오지 못했습니다: ${url}. URL이 맞는지, 브라우저에서 열리는지 확인하세요.`,
        ),
      )
    }

    script.addEventListener('load', onLoad)
    script.addEventListener('error', onError)
    document.head.appendChild(script)
  })

  cache.set(url, promise)
  return promise
}
