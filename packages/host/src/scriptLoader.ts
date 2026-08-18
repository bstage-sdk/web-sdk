const cache = new Map<string, Promise<void>>()

/**
 * 멱등성 스크립트 로더 — 동일한 URL은 한 번만 로드됩니다.
 * 실패 또는 타임아웃 시 캐시 항목이 제거되어 재시도가 가능합니다.
 */
export function loadScript(url: string, timeoutMs = 10_000): Promise<void> {
  const existing = cache.get(url)
  if (existing) return existing

  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = url
    script.async = true

    const timer = setTimeout(() => {
      cleanup()
      cache.delete(url)
      reject(new Error(`Script load timed out after ${timeoutMs}ms: ${url}`))
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
      reject(new Error(`Failed to load script: ${url}`))
    }

    script.addEventListener('load', onLoad)
    script.addEventListener('error', onError)
    document.head.appendChild(script)
  })

  cache.set(url, promise)
  return promise
}
