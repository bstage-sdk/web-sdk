import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin, HtmlTagDescriptor } from 'vite'
import { getLoginPageHtml } from './loginPage.js'
import {
  proxyRequest,
  addCfAccessHeaders,
  stripResponseCookies,
  collectBody,
  type ProxyHeaders,
} from './proxyUtils.js'
import {
  PHASE_PATH_PREFIX,
  LOGIN_PATH,
  PROXY_PATH_PREFIX,
  AUTH_PATH_PREFIX,
  ACCESS_TOKEN_COOKIE_BY_MODE,
  ACCESS_TOKEN_RE_BY_MODE,
  AUTH_TOKEN_REFRESH_PATH_BY_MODE,
  TENANT_ID_HEADER,
  resolveProjectTarget,
  type AuthMode,
} from '../constants.js'
import { resolveDevHosts, type DevHosts } from './resolveHosts.js'
import { DEFAULT_PHASE } from './resolvePhase.js'
import { renderCss as userRenderCss } from '@bstage-sdk/design/user'
import { renderCss as adminRenderCss } from '@bstage-sdk/design/admin'

const RESOLVE_BASE_URL_RE = /function\s+resolveBaseUrl\(\)\s*\{[\s\S]*?\n\}/

/**
 * dev 전용 라이트/다크 토글 버튼.
 *
 * `bstage dev`에서만 index.html에 주입된다(빌드 산출물 미포함). `<html data-bspoke>`를
 * light↔dark로 토글해, design fallback CSS(`:root[data-bspoke="dark"]`)의 다크 모드를
 * 로컬에서 미리볼 수 있다. 유저 대상 — 어드민은 light 전용이라 주입하지 않는다.
 */
const DEV_THEME_TOGGLE = `
(function () {
  if (window.__bstage_theme_toggle__) return
  window.__bstage_theme_toggle__ = true
  var btn = document.createElement('button')
  var label = function () {
    return document.documentElement.dataset.bspoke === 'dark' ? '\u{1F319} Dark' : '\u{2600}\u{FE0F} Light'
  }
  btn.type = 'button'
  btn.title = 'bstage 디자인 토큰 라이트/다크 미리보기 (dev 전용)'
  btn.textContent = label()
  btn.style.cssText =
    'position:fixed;right:12px;bottom:12px;z-index:2147483647;padding:6px 10px;' +
    "font:12px/1 system-ui,sans-serif;border:1px solid rgba(0,0,0,.15);border-radius:8px;" +
    'background:#fff;color:#151515;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.15)'
  btn.onclick = function () {
    var cur = document.documentElement.dataset.bspoke
    document.documentElement.dataset.bspoke = cur === 'dark' ? 'light' : 'dark'
    btn.textContent = label()
  }
  document.body.appendChild(btn)
})()
`

/**
 * dev 전용 로케일 스위처 스크립트.
 *
 * `bstage dev`에서만 index.html에 주입된다(빌드 산출물 미포함). 콘솔에서
 * `__bstage_setLocale__('en')`을 호출하면 `<html lang>` + 쿠키를 갱신해,
 * `useLocale()`의 MutationObserver가 변경을 잡아 reactive 동작(SPA 언어 전환)을 로컬에서 검증할 수 있다.
 *
 * 두 대상 쿠키를 모두 갱신한다(core `i18n.ts` 계약): 유저단은 `bmf_bstage_lang`,
 * 어드민(`BstageLocaleProvider target="admin"`)은 `bmf_mybstage_locale`. 덕분에 어드민 템플릿도
 * dev에서 어드민 쿠키 경로 그대로 언어 전환을 검증할 수 있다.
 */
const DEV_LOCALE_SWITCHER = `
window.__bstage_setLocale__ = function (locale) {
  document.documentElement.lang = locale
  document.cookie = 'bmf_bstage_lang=' + locale + '; path=/'
  document.cookie = 'bmf_mybstage_locale=' + locale + '; path=/'
  return locale
}
`.trim()

/**
 * HTTP/2 pseudo-header(`:method`, `:path` 등)를 제거한 새 헤더 객체를 반환한다.
 * 소비자가 `vite.config.ts`에서 HTTPS dev 서버를 켜면 ALPN으로 HTTP/2가 협상되어
 * 들어오므로, 업스트림(HTTPS 1.1)으로 그대로 보내면
 * "Header name must be a valid HTTP token" 에러가 난다.
 */
function filterPseudoHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string | string[] | undefined> {
  const out: Record<string, string | string[] | undefined> = {}
  for (const [k, v] of Object.entries(headers)) {
    if (!k.startsWith(':')) out[k] = v
  }
  return out
}

/**
 * 인증 서버에 토큰 리프레시를 요청하고, 성공 시 새 accessToken을 반환한다.
 */
async function refreshAccessToken(
  mode: AuthMode,
  phase: string,
  hosts: DevHosts,
  tenantId: string,
  accessToken: string,
  cookieStr: string,
): Promise<string | null> {
  try {
    const authHost = hosts.auth(tenantId)
    if (!authHost) return null

    const postBody = JSON.stringify({ accessToken })

    const headers: ProxyHeaders = {
      host: authHost,
      'Content-Type': 'application/json',
      'Content-Length': String(Buffer.byteLength(postBody)),
      'x-bmf-sid': tenantId,
      cookie: cookieStr,
    }
    addCfAccessHeaders(headers, phase)

    const result = await proxyRequest({
      hostname: authHost,
      path: AUTH_TOKEN_REFRESH_PATH_BY_MODE[mode],
      method: 'POST',
      headers,
      body: Buffer.from(postBody),
    })

    const text = result.body.toString('utf-8')
    const json = JSON.parse(text)
    if (result.statusCode === 200 && json.accessToken) {
      console.info(`[bstage] token refreshed (${mode})`)
      return json.accessToken
    }
    console.warn('[bstage] token refresh failed:', result.statusCode, text)
    return null
  } catch {
    return null
  }
}

/**
 * 게이트웨이로 요청을 전송하고 응답을 반환한다.
 */
async function sendGatewayRequest(
  targetHost: string,
  targetPath: string,
  method: string,
  headers: ProxyHeaders,
  body: Buffer,
): Promise<{ statusCode: number; headers: ProxyHeaders; body: string }> {
  const result = await proxyRequest({
    hostname: targetHost,
    path: targetPath,
    method,
    headers,
    body,
  })
  return {
    statusCode: result.statusCode,
    headers: result.headers,
    body: result.body.toString('utf-8'),
  }
}

/**
 * 게이트웨이 API 프록시 — X-BSTAGE-TENANT-ID 헤더에서 tenant를 읽어
 * 동적으로 대상 호스트를 결정한다.
 * 401 + EXPIRED_ACCESS_TOKEN_CODE 시 토큰 리프레시 후 재시도한다.
 *
 * mode 에 따라 사용하는 쿠키 이름이 달라진다 (user/admin).
 */
function handleGatewayProxy(
  mode: AuthMode,
  phase: string,
  hosts: DevHosts,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  const tenantId = req.headers[TENANT_ID_HEADER] as string | undefined
  if (!tenantId) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ message: `Missing ${TENANT_ID_HEADER} header` }))
    return
  }

  const targetHost = hosts.gateway(tenantId)
  if (!targetHost) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ message: `Unknown phase: ${phase}` }))
    return
  }

  const targetPath = (req.url ?? '').replace(new RegExp(`^${PROXY_PATH_PREFIX}/${phase}`), '')

  const cookieName = ACCESS_TOKEN_COOKIE_BY_MODE[mode]
  const cookieRe = ACCESS_TOKEN_RE_BY_MODE[mode]

  collectBody(req).then(async (body) => {
    const buildHeaders = (accessToken?: string): Record<string, string | string[] | undefined> => {
      const h = filterPseudoHeaders(req.headers as Record<string, string | string[] | undefined>)
      h['host'] = targetHost
      addCfAccessHeaders(h, phase)
      const token = accessToken ?? (req.headers['cookie'] ?? '').match(cookieRe)?.[1]
      if (token) {
        h['authorization'] = `Bearer ${token}`
      }
      return h
    }

    console.info(`[bstage] ${req.method} https://${targetHost}${targetPath}`)

    try {
      const upstreamHeaders = buildHeaders()
      let result = await sendGatewayRequest(
        targetHost,
        targetPath,
        req.method ?? 'GET',
        upstreamHeaders,
        body,
      )

      // 401 시 토큰 리프레시 후 재시도
      if (result.statusCode === 401) {
        const cookieStr = req.headers['cookie'] ?? ''
        const oldToken = cookieStr.match(cookieRe)?.[1]
        if (oldToken) {
          const newToken = await refreshAccessToken(
            mode,
            phase,
            hosts,
            tenantId,
            oldToken,
            cookieStr,
          )
          if (newToken) {
            const retryHeaders = buildHeaders(newToken)
            result = await sendGatewayRequest(
              targetHost,
              targetPath,
              req.method ?? 'GET',
              retryHeaders,
              body,
            )

            // 브라우저 쿠키 갱신
            stripResponseCookies(result.headers, [`${cookieName}=${newToken}; Path=/`])
          }
        }
      }

      // 응답 전달
      stripResponseCookies(result.headers)
      res.writeHead(result.statusCode, result.headers)
      res.end(result.body)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      res.writeHead(502, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ message: 'Gateway proxy error', error: message }))
    }
  })
}

/**
 * import 문자열에서 `exports` 키 형태의 서브패스를 뽑는다.
 *
 * 스코프 패키지는 앞 두 세그먼트가 패키지명이다.
 *
 * @example
 * subpathOf('@bstage-sdk/core')            // '.'
 * subpathOf('@bstage-sdk/design/user')     // './user'
 * subpathOf('@bstage-sdk/design/css/user.css') // './css/user.css'
 */
export function subpathOf(source: string): string {
  const segments = source.split('/')
  const rest = segments.slice(source.startsWith('@') ? 2 : 1)
  return rest.length === 0 ? '.' : `./${rest.join('/')}`
}

function findPackageDir(from: string): string | null {
  let dir = dirname(from)
  while (dir !== dirname(dir)) {
    try {
      readFileSync(join(dir, 'package.json'))
      return dir
    } catch {
      dir = dirname(dir)
    }
  }
  return null
}

/**
 * 인증 프록시 — `/__auth__/*` 요청을 인증 서버로 전달한다.
 *
 * mode 에 따라 다음이 달라진다(호스트는 `resolveHosts.ts`가 정한다).
 * - user: 테넌트별 호스트, 응답 토큰을 유저 쿠키로 저장
 * - admin: 테넌트 공통 `account.*` 호스트, 응답 토큰을 어드민 쿠키로 저장
 *
 * 둘 다 tenantId는 `x-bmf-sid` 헤더로 전달한다 (admin 호스트가 테넌트 공통이어도
 * 서버 쪽에서 테넌트 컨텍스트를 알아야 하므로).
 */
function handleAuthProxy(
  mode: AuthMode,
  phase: string,
  hosts: DevHosts,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  const tenantId = req.headers[TENANT_ID_HEADER] as string | undefined
  if (!tenantId) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ message: `Missing ${TENANT_ID_HEADER} header` }))
    return
  }

  const targetHost = hosts.auth(tenantId)
  if (!targetHost) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ message: `Unknown phase: ${phase} (mode: ${mode})` }))
    return
  }

  const targetPath = (req.url ?? '').replace(new RegExp(`^${AUTH_PATH_PREFIX}`), '/svc')
  const cookieName = ACCESS_TOKEN_COOKIE_BY_MODE[mode]

  collectBody(req).then(async (body) => {
    // 업스트림 헤더 구성: 브라우저 헤더에서 HTTP/2 pseudo-header 제거 후 그대로 전달
    const upstreamHeaders = filterPseudoHeaders(
      req.headers as Record<string, string | string[] | undefined>,
    )
    upstreamHeaders['host'] = targetHost
    addCfAccessHeaders(upstreamHeaders, phase)
    upstreamHeaders['x-bmf-sid'] = tenantId

    try {
      const result = await proxyRequest({
        hostname: targetHost,
        path: targetPath,
        method: req.method ?? 'POST',
        headers: upstreamHeaders,
        body,
      })

      const textBody = result.body.toString('utf-8')

      // accessToken 추출 → 쿠키 발급
      // 응답 본문은 `{ accessToken, refreshToken, status: 'SUCCESS' | ... }` 형태.
      // 'SUCCESS' 외 status는 accessToken 미포함 (TWO_FACTOR_NEEDED 등) — 그 경우는 그대로 통과.
      const extraCookies: string[] = []
      if (result.statusCode >= 200 && result.statusCode < 300) {
        try {
          const json = JSON.parse(textBody)
          const accessToken = json.accessToken ?? json.data?.accessToken
          if (accessToken) {
            extraCookies.push(`${cookieName}=${accessToken}; Path=/`)
          } else {
            console.warn(
              `[bstage] auth response missing accessToken (mode=${mode}, status=${result.statusCode}, body status=${json.status ?? 'n/a'})`,
            )
          }
        } catch (parseErr) {
          console.warn(
            `[bstage] auth response JSON parse failed (mode=${mode}, status=${result.statusCode}):`,
            parseErr instanceof Error ? parseErr.message : parseErr,
          )
        }
      } else {
        console.warn(
          `[bstage] auth proxy upstream non-2xx (mode=${mode}, status=${result.statusCode}):`,
          textBody.slice(0, 500),
        )
      }

      stripResponseCookies(result.headers, extraCookies)
      res.writeHead(result.statusCode, result.headers)
      res.end(textBody)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      res.writeHead(502, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ message: 'Auth proxy error', error: message }))
    }
  })
}

export interface BstageDevPluginOptions {
  /** Target phase for the login page (default: 'sandbox') */
  phase?: string
  /**
   * 인증 모드 (default: 'user').
   * 어드민 슬롯을 확인하려면 'admin'으로 지정한다.
   */
  mode?: AuthMode
}

/**
 * bstage 로컬 개발용 Vite 플러그인.
 *
 * 1. bstage-core의 PHASE_BASE_URLS를 localhost 프록시 경로로 치환
 * 2. Vite 프록시를 설정하여 API 호출을 실제 게이트웨이로 전달
 * 3. 쿠키 보안 속성을 제거하여 localhost에서도 httpOnly 쿠키 동작
 * 4. /__bstage__/login에 간이 로그인 페이지 제공 (user/admin 모드 지원)
 * 5. /__auth__/*에서 동적 인증 프록시 — 요청 헤더의 X-BSTAGE-TENANT-ID 참조
 *
 * 별도 프록시 서버 없이 Vite 안에서 모두 처리.
 */
export function bstageDevPlugin(options: BstageDevPluginOptions = {}): Plugin {
  const phase = options.phase ?? DEFAULT_PHASE
  const mode: AuthMode = options.mode ?? 'user'
  /** 디자인 토큰 fallback 타깃 — package.json의 `bstage.target`. */
  let isAdmin = false
  let configPort: number
  let actualPort: number | undefined
  let projectRequire: NodeRequire
  /** phase에 쓸 호스트. `configResolved`에서 한 번 정해진다. */
  let hosts: DevHosts

  return {
    name: 'bstage-dev',
    enforce: 'pre',

    config() {
      const root = process.cwd()
      projectRequire = createRequire(join(root, 'package.json'))

      return {
        optimizeDeps: {
          exclude: ['@bstage-sdk/core', '@bstage-sdk/react'],
        },
        resolve: {
          dedupe: ['react', 'react-dom', 'react/jsx-runtime'],
        },
      }
    },

    configResolved(config) {
      configPort = config.server.port ?? 5173
      isAdmin = resolveProjectTarget(config.root) === 'admin'
      // 사내 전용 phase인데 호스트가 없으면 여기서 멈춘다. `bstage dev`와 소비자의
      // `vite dev`가 모두 이 훅을 지나므로 진입점 한 곳만 막으면 되지 않는다.
      hosts = resolveDevHosts(phase, mode, config.root)
    },

    resolveId(source) {
      if (!source.startsWith('@bstage-sdk/')) return null
      try {
        const cjsPath = projectRequire.resolve(source)
        const pkgDir = findPackageDir(cjsPath)
        if (!pkgDir) return cjsPath
        const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf-8')) as {
          exports?: Record<string, { import?: { default?: string } } | string>
          module?: string
        }
        // **요청된 서브패스**의 ESM 엔트리를 찾는다. `exports['.']`만 보면
        // `bstage-design/user` 같은 서브패스가 루트 엔트리로 해석돼 export가 없다고 깨진다.
        const entry = pkg.exports?.[subpathOf(source)]
        const esmEntry =
          (typeof entry === 'string' ? entry : entry?.import?.default) ??
          (subpathOf(source) === '.' ? pkg.module : undefined)
        return esmEntry ? join(pkgDir, esmEntry) : cjsPath
      } catch {
        return null
      }
    },

    configureServer(server) {
      // 서버가 listen한 뒤 실제 포트를 감지
      const httpServer = server.httpServer
      if (httpServer) {
        httpServer.on('listening', () => {
          const addr = httpServer.address()
          if (addr && typeof addr === 'object') {
            actualPort = addr.port
          }
        })
      }

      server.middlewares.use((req, res, next) => {
        const url = req.url ?? ''

        if (url === LOGIN_PATH || url === `${LOGIN_PATH}/`) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(getLoginPageHtml(phase, mode))
          return
        }

        // 동적 게이트웨이 프록시 — 요청 헤더에서 tenant 결정.
        // 설정된 phase의 경로만 받는다. transform 훅이 그 경로만 주입하므로 다른 phase가
        // 올 일이 없고, 받아주면 phase가 섞인 조합(dev로 띄웠는데 qa 경로)이 생긴다.
        if (url.startsWith(`${PROXY_PATH_PREFIX}/${phase}/`)) {
          handleGatewayProxy(mode, phase, hosts, req, res)
          return
        }

        // 동적 인증 프록시 — 요청 헤더에서 tenant 결정
        if (url.startsWith(`${AUTH_PATH_PREFIX}/`)) {
          handleAuthProxy(mode, phase, hosts, req, res)
          return
        }

        next()
      })
    },

    transformIndexHtml(_html, ctx) {
      const tags: HtmlTagDescriptor[] = [
        // dev 전용 로케일 스위처 주입 (useLocale 변경 감지 검증용)
        {
          tag: 'script',
          attrs: { type: 'text/javascript' },
          children: DEV_LOCALE_SWITCHER,
          injectTo: 'head',
        },
        // 번역 사전 phase 주입 — core는 hostname으로 phase를 추론하는데 로컬 호스트에는
        // phase 마커가 없다(`localhost`, 로컬 별칭 호스트). dev 서버는 `--phase`를 아니까
        // 알려준다. core가 이 전역을 config 다음 우선순위로 읽는다(`resolvePhase`).
        {
          tag: 'script',
          attrs: { type: 'text/javascript' },
          children: `window.__bstage_i18n_phase__ = ${JSON.stringify(phase)}`,
          injectTo: 'head',
        },
      ]

      // dev serve에서만 fallback 주입 — build(ctx.server 없음)엔 절대 포함하지 않는다.
      // (사용자 vite.config에 이 플러그인을 넣고 vite build 하는 경우까지 프로덕션 유입 차단)
      if (ctx?.server) {
        // 디자인 토큰 fallback 타깃 = 프로젝트 target. 한 레포는 유저 아니면 어드민 하나다.
        tags.push({
          tag: 'style',
          attrs: { 'data-bstage-design-fallback': isAdmin ? 'admin' : 'user' },
          children: isAdmin ? adminRenderCss() : userRenderCss(),
          injectTo: 'head',
        })
        // 유저는 light/dark 둘 다 → 미리보기 토글 제공. 어드민은 light 전용이라 생략.
        if (!isAdmin) {
          tags.push({
            tag: 'script',
            attrs: { type: 'text/javascript' },
            children: DEV_THEME_TOGGLE,
            injectTo: 'body',
          })
        }
      }

      return tags
    },

    transform(code, id) {
      if (!id.includes('bstage-core') && !id.includes('bstage-sdk/packages/core')) return null
      if (!RESOLVE_BASE_URL_RE.test(code)) return null

      const origin = `http://localhost:${actualPort ?? configPort}`
      const proxyBase = `${origin}${PROXY_PATH_PREFIX}/${phase}${PHASE_PATH_PREFIX[phase] ?? ''}`

      return {
        code: code.replace(
          RESOLVE_BASE_URL_RE,
          `function resolveBaseUrl() { return "${proxyBase}" }`,
        ),
        map: null,
      }
    },
  }
}
