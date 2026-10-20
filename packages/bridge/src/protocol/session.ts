/** 세션 값 형식 — 128비트를 소문자 hex 32자로 표기한다. */
const SESSION_RE = /^[0-9a-f]{32}$/

/** CSP nonce 형식 — base64(url) 문자 22자 이상(128비트 이상). */
const NONCE_RE = /^[A-Za-z0-9+/_-]{22,}={0,2}$/

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  globalThis.crypto.getRandomValues(bytes)
  return bytes
}

/** 프레임마다 새 세션(128비트 임의값)을 만든다. srcdoc 부트스트랩에만 심는다. */
export function createSession(): string {
  return Array.from(randomBytes(16), (b) => b.toString(16).padStart(2, '0')).join('')
}

export function isValidSession(value: unknown): value is string {
  return typeof value === 'string' && SESSION_RE.test(value)
}

/** srcdoc 부트스트랩 스크립트용 CSP nonce(128비트, base64url)를 만든다. */
export function createNonce(): string {
  const binary = String.fromCharCode(...randomBytes(16))
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function isValidNonce(value: unknown): value is string {
  return typeof value === 'string' && NONCE_RE.test(value)
}
