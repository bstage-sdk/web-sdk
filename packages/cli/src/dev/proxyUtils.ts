import { request as httpsRequest } from 'node:https'
import type { IncomingMessage } from 'node:http'
import { gunzipSync, brotliDecompressSync, inflateSync } from 'node:zlib'
import { loadEnv } from 'vite'
import { isPublicPhase } from '../constants.js'

/** 프록시 헤더 타입 — Node.js HTTP 헤더와 호환 */
export type ProxyHeaders = Record<string, string | string[] | undefined>

/**
 * dev/qa 플랫폼 호스트는 Cloudflare Access 게이트 뒤에 있어 서비스 토큰이 필요하다.
 * 값은 **소비자가 `.env`로 공급한다** — SDK에 심어두지 않는다(패키지 번들·소스맵에 그대로 실려 나가고,
 * 저장소가 공개되면 게이트를 누구나 우회할 수 있다).
 */
const CF_ACCESS_ENV_KEYS = ['VITE_CF_ACCESS_CLIENT_ID', 'VITE_CF_ACCESS_CLIENT_SECRET'] as const

interface CfAccessCreds {
  id: string
  secret: string
}

/** 해석 결과 캐시. `undefined`는 미해석, `null`은 해석했으나 값이 없음. */
let cachedCreds: CfAccessCreds | null | undefined
let missingWarned = false

/**
 * CF Access 자격증명을 해석한다. 실제 셸 환경변수(CI 주입)를 먼저 보고, 없으면 `.env` 파일을 읽는다.
 * `bstage build`의 인증 값 점검과 같은 방식(`loadEnv`)이라 소비자가 보는 규칙이 하나로 유지된다.
 */
function resolveCfAccessCreds(): CfAccessCreds | null {
  if (cachedCreds !== undefined) return cachedCreds
  const [idKey, secretKey] = CF_ACCESS_ENV_KEYS
  const fileEnv = loadEnv('development', process.cwd(), '')
  const id = process.env[idKey] || fileEnv[idKey] || ''
  const secret = process.env[secretKey] || fileEnv[secretKey] || ''
  cachedCreds = id && secret ? { id, secret } : null
  return cachedCreds
}

/** 테스트에서 해석 캐시를 비운다. @internal */
export function __resetCfAccessCache(): void {
  cachedCreds = undefined
  missingWarned = false
}

/**
 * Set-Cookie 문자열에서 Domain / HttpOnly / Secure / SameSite 속성을 제거하여
 * localhost에서도 브라우저가 쿠키를 저장·전송할 수 있도록 한다.
 */
export function stripCookieAttributes(cookie: string): string {
  return cookie.replace(/;\s*(Domain=[^;]*|HttpOnly|Secure|SameSite=[^;]*)/gi, '')
}

/**
 * Cloudflare가 발급하는 자체 쿠키 이름 패턴. 이 쿠키들은 로컬 도메인에 저장하거나 upstream(Cloudflare)으로
 * 되돌려 보내면 안 된다 — CF Access는 서비스 토큰 헤더(addCfAccessHeaders)로 통과하므로 불필요하고,
 * `CF_Authorization`(수백 바이트 JWT) 등을 CF로 되돌리면 431(Request Header Fields Too Large)을 유발한다.
 */
const CLOUDFLARE_COOKIE_RE = /^(CF_Authorization|__cf_bm|__cflb|cf_clearance)$/i

/** `name=value` 쌍에서 쿠키 이름만 반환한다. */
function cookieName(pair: string): string {
  const i = pair.indexOf('=')
  return (i >= 0 ? pair.slice(0, i) : pair).trim()
}

/**
 * 압축된 응답 본문을 디코딩한다.
 * content-encoding 헤더 값에 따라 gzip/br/deflate를 처리.
 */
export function decompressBody(raw: Buffer, encoding: string | undefined): Buffer {
  try {
    if (encoding === 'gzip') return gunzipSync(raw)
    if (encoding === 'br') return brotliDecompressSync(raw)
    if (encoding === 'deflate') return inflateSync(raw)
  } catch {
    // 디코딩 실패 시 원본 반환
  }
  return raw
}

export interface ProxyResponse {
  statusCode: number
  headers: ProxyHeaders
  body: Buffer
}

/**
 * 범용 HTTPS 프록시 요청. Buffer를 반환하여 바이너리 안전하다.
 */
export function proxyRequest(options: {
  hostname: string
  path: string
  method: string
  headers: ProxyHeaders
  body?: Buffer
  /** 타임아웃 (밀리초, 기본 30초) */
  timeout?: number
}): Promise<ProxyResponse> {
  // upstream Accept-Encoding을 우리가 해제 가능한 인코딩으로 제한한다.
  // 브라우저는 `zstd`까지 요청하지만 decompressBody는 gzip/br/deflate만 처리하므로,
  // Cloudflare가 zstd를 고르면 압축 본문을 못 풀어 클라이언트의 JSON 파싱이 깨진다.
  // (네이티브 zstd 해제는 Node 22.15+ 필요 → 버전 무관하게 요청 측에서 차단)
  const headers = { ...options.headers }
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === 'accept-encoding') delete headers[key]
  }
  headers['accept-encoding'] = 'gzip, deflate, br'

  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        hostname: options.hostname,
        port: 443,
        path: options.path,
        method: options.method,
        headers,
        timeout: options.timeout ?? 30_000,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const raw = Buffer.concat(chunks)
          const encoding = res.headers['content-encoding']
          const body = decompressBody(raw, encoding as string | undefined)

          const resHeaders = { ...res.headers }
          delete resHeaders['content-encoding']
          delete resHeaders['content-length']
          delete resHeaders['transfer-encoding']

          resolve({
            statusCode: res.statusCode ?? 200,
            headers: resHeaders,
            body,
          })
        })
      },
    )
    req.on('timeout', () => {
      req.destroy()
      reject(
        new Error(`Proxy request timeout: ${options.method} ${options.hostname}${options.path}`),
      )
    })
    req.on('error', (err) => {
      reject(new Error(`Proxy request failed: ${options.hostname}${options.path} — ${err.message}`))
    })
    req.end(options.body)
  })
}

/**
 * 업스트림 프록시 헤더에 CF Access 인증을 추가한다 (사내 전용 phase 전용).
 * 호스트가 SDK에 들어 있는 phase(real·sandbox)는 게이트가 없어 헤더를 붙이지 않는다.
 *
 * 면제 판정을 `isPublicPhase`에 맡기는 이유: 여기에 목록을 따로 두면 호스트 맵과
 * 어긋날 수 있다 — 호스트는 `.env`에서 왔는데 CF 헤더는 안 붙는 식으로.
 *
 * 자격증명이 없으면 헤더를 붙이지 않고 **한 번만 경고한다.** 이 경우 업스트림이 302로
 * Cloudflare 로그인 페이지로 보내는데, 그 응답만 봐서는 원인을 알기 어렵기 때문이다.
 */
export function addCfAccessHeaders(headers: ProxyHeaders, phase: string): void {
  if (isPublicPhase(phase)) return

  const creds = resolveCfAccessCreds()
  if (!creds) {
    if (!missingWarned) {
      missingWarned = true
      const [idKey, secretKey] = CF_ACCESS_ENV_KEYS
      console.warn(
        `[bstage] ${phase}는 사내 전용 환경이라 Cloudflare Access 게이트 뒤에 있습니다.\n` +
          `  자격증명이 없어 로그인·API 프록시가 302(Cloudflare 로그인)로 막힙니다.\n` +
          `  · 사내: CF Access 서비스 토큰을 발급받아 .env에 ${idKey}·${secretKey} 설정\n` +
          `  · 그 외: --phase sandbox 로 개발하세요 (게이트가 없어 설정이 필요 없습니다)`,
      )
    }
    return
  }

  headers['CF-Access-Client-Id'] = creds.id
  headers['CF-Access-Client-Secret'] = creds.secret
}

/**
 * 응답 Set-Cookie 헤더의 보안 속성을 일괄 제거하고, 추가 쿠키가 있으면 함께 설정한다.
 */
export function stripResponseCookies(headers: ProxyHeaders, extraCookies?: string[]): void {
  const cookies = ((headers['set-cookie'] as string[] | undefined) ?? [])
    // Cloudflare 자체 쿠키는 로컬 도메인에 저장하지 않는다 — 저장되면 이후 매 요청마다 CF로 되돌아가 431을 유발한다.
    .filter((c) => !CLOUDFLARE_COOKIE_RE.test(cookieName(c)))
    .map(stripCookieAttributes)
  if (extraCookies) cookies.push(...extraCookies)
  if (cookies.length) {
    headers['set-cookie'] = cookies
  }
}

/**
 * 요청 본문을 Buffer로 수집한다.
 */
export function collectBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
  })
}
