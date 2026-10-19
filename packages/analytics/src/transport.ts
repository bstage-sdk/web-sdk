export const BODY_MAX = 48 * 1024

/** body가 상한을 넘는지. 문자 수가 아니라 byte로 잰다 — 한글은 UTF-8에서 3바이트다 */
export function overBodyMax(body: string): boolean {
  return new TextEncoder().encode(body).length > BODY_MAX
}

export async function post(url: string, body: string): Promise<boolean> {
  if (navigator.onLine === false) return false

  const blob = new Blob([body], { type: 'text/plain' })
  if (navigator.sendBeacon?.(url, blob)) return true

  try {
    await fetch(url, {
      method: 'POST',
      body: blob,
      keepalive: true,
      mode: 'no-cors',
      referrerPolicy: 'no-referrer',
    })
    return true
  } catch {
    return false
  }
}
