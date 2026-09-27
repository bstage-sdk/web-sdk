import { existsSync, realpathSync, statSync, watch, type FSWatcher } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { join, relative, sep } from 'node:path'
import type { Liquid } from 'liquidjs'

import { detectProjectKind } from '../project/detectKind.js'
import { ExitCode, fail } from '../portal/output.js'
import { LiquidPreviewError, createEngine, renderTemplate } from './render.js'
import { resolveRoute, type PreviewRoute } from './routes.js'
import { collectPreviewTemplates, type PreviewInventory } from './templates.js'
import {
  contentTypeFor,
  errorPage,
  escapeHtml,
  indexPage,
  injectReloadScript,
  listPage,
  notFoundPage,
} from './pages.js'

const LOOPBACK = '127.0.0.1'

export interface LiquidDevServer {
  /** 실제로 열린 포트. `port: 0`으로 띄웠으면 OS가 고른 값이다. */
  port: number
  /** 바인딩한 주소 — 항상 루프백(127.0.0.1)이다. */
  host: string
  /**
   * 템플릿 목록을 다시 훑는다. 파일 감시가 리로드를 보낼 때 부르는 것과 같은 경로다.
   * @internal 테스트에서 감시를 기다리지 않고 재계산을 일으키는 용도.
   */
  refresh(): void
  /**
   * 목록을 훑은 횟수(시작 때 1). 요청마다 다시 훑지 않는지 확인한다.
   * @internal 테스트용.
   */
  scans(): number
  close(): Promise<void>
}

export interface LiquidDevServerOptions {
  root: string
  /** 0이면 임의 포트(테스트용) */
  port: number
  /** 요청 한 건당 한 줄. 없으면 조용히 동작한다. */
  log?: (line: string) => void
}

/** 요청 처리에 필요한 것들. 요청마다 새로 만들지 않는 값만 담는다. */
interface ServerContext {
  root: string
  publicDir: string
  engine: Liquid
  clients: Set<ServerResponse>
  inventory: InventoryCache
}

/** 템플릿 목록 캐시. 읽기는 `get`, 갱신은 `refresh` 한 곳으로 모은다. */
interface InventoryCache {
  get(): PreviewInventory
  refresh(): void
  scans(): number
}

/**
 * `detectProjectKind`는 public/ 을 재귀로 훑는 동기 호출이라 요청마다 부르면 이미지 한 장에도
 * 전체 스캔이 붙는다. 시작 때 한 번 훑고, 파일 감시가 리로드를 보낼 때 함께 다시 훑는다 —
 * 폴더를 새로 만들어도 서버를 껐다 켤 필요가 없다는 성질은 그대로 유지된다.
 */
function createInventoryCache(root: string): InventoryCache {
  let inventory = collectPreviewTemplates(detectProjectKind(root))
  let scans = 1

  return {
    get: () => inventory,
    refresh() {
      inventory = collectPreviewTemplates(detectProjectKind(root))
      scans += 1
    },
    scans: () => scans,
  }
}

/**
 * 렌더 페이지(HTML)에 붙는 보안 헤더. 인라인 스크립트·스타일은 리로드 스크립트와 템플릿 자체가
 * 쓰므로 허용하되, 다른 오리진의 리소스와 프레이밍은 막는다.
 */
const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'content-security-policy':
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'",
} as const

/**
 * `public/` 정적 파일에 붙는 헤더. `.html`·`.svg`가 프리뷰 오리진에서 스크립트를 실행해 다른
 * 페이지·data.json을 읽는 경로를 끊는다 — 문서로 직접 열려도 `sandbox`로 격리된다.
 */
const ASSET_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'content-security-policy': "default-src 'none'; sandbox",
} as const

const HTML_HEADERS = { 'content-type': 'text/html; charset=utf-8', ...SECURITY_HEADERS } as const

/** 루프백으로 간주하는 호스트 이름. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

/** `host:port` 또는 오리진 문자열을 파싱한다. 실패하면 null. */
function parseOrigin(value: string): { protocol: string; hostname: string; port: string } | null {
  try {
    const u = new URL(value.includes('://') ? value : `http://${value}`)
    return { protocol: u.protocol, hostname: u.hostname, port: u.port || '80' }
  } catch {
    return null
  }
}

/** 이 서버 자신의 오리진(호스트·포트)인가. */
function isOwnOrigin(value: string, port: number): boolean {
  const o = parseOrigin(value)
  return (
    o !== null && o.protocol === 'http:' && LOCAL_HOSTS.has(o.hostname) && o.port === String(port)
  )
}

/**
 * 요청이 정말 이 프리뷰 페이지(같은 오리진)에서 온 것인가.
 *
 * 루프백 바인딩만으로는 DNS 리바인딩이나 **다른 localhost 포트의 페이지**가 fetch로 `public/`을
 * 읽는 것을 막지 못한다. 그래서 Host는 이 서버의 host:port와 정확히 같아야 하고, Origin이
 * 있으면 같은 오리진이어야 하며(`null` 포함 그 외는 전부 거절), Sec-Fetch-Site는
 * same-origin·none(주소창 직접 입력)만 받는다.
 */
function isLocalRequest(req: IncomingMessage, port: number): boolean {
  if (!isOwnOrigin(req.headers.host ?? '', port)) return false
  const origin = req.headers.origin
  if (typeof origin === 'string' && !isOwnOrigin(origin, port)) return false
  const site = req.headers['sec-fetch-site']
  if (site !== undefined && site !== 'same-origin' && site !== 'none') return false
  return true
}

/**
 * 실경로가 `public/` 안인가. 라우팅은 요청 URL의 `..`만 막으므로, `public/` 안에 놓인
 * 심볼릭 링크가 밖을 가리키는 경우는 여기서 걸러야 한다(로컬 서버라도 LAN에 열릴 수 있다).
 */
function isInside(publicDir: string, full: string): boolean {
  try {
    const base = realpathSync(publicDir)
    const real = realpathSync(full)
    return real === base || real.startsWith(base + sep)
  } catch {
    return false
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function sendHtml(res: ServerResponse, status: number, html: string): number {
  res.writeHead(status, HTML_HEADERS)
  res.end(html)
  return status
}

/**
 * 템플릿 렌더. 실패해도 **200 오류 페이지**를 준다 — 화면이 주 진단 수단이라 상태코드보다
 * 내용이 중요하고, 고친 즉시 리로드로 복구되어야 하기 때문이다.
 */
async function sendTemplate(
  ctx: ServerContext,
  route: Extract<PreviewRoute, { kind: 'template' }>,
  res: ServerResponse,
): Promise<number> {
  try {
    const { html } = await renderTemplate(ctx.engine, ctx.root, route.type, route.name)
    return sendHtml(res, 200, injectReloadScript(html))
  } catch (err) {
    if (!(err instanceof LiquidPreviewError)) throw err
    return sendHtml(res, 200, errorPage(err, relative(ctx.root, err.file)))
  }
}

async function sendAsset(ctx: ServerContext, path: string, res: ServerResponse): Promise<number> {
  const full = join(ctx.publicDir, path)
  if (!isInside(ctx.publicDir, full)) return sendHtml(res, 404, notFoundPage())
  try {
    const body = await readFile(full)
    res.writeHead(200, { 'content-type': contentTypeFor(full), ...ASSET_HEADERS })
    res.end(body)
    return 200
  } catch {
    // 라우팅 시점에는 있었는데 그 사이 지워진 경우
    return sendHtml(res, 404, notFoundPage())
  }
}

/** SSE 구독. 응답을 끝내지 않고 clients에 남겨 둔다 — close()가 정리한다. */
function subscribeReload(ctx: ServerContext, res: ServerResponse): number {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    ...SECURITY_HEADERS,
  })
  // 첫 바이트를 바로 보내 프록시·버퍼가 스트림을 붙잡지 않게 한다
  res.write(': connected\n\n')
  ctx.clients.add(res)
  res.on('close', () => ctx.clients.delete(res))
  return 200
}

/** 템플릿 목록은 캐시에서 읽는다 — 갱신은 파일 감시가 맡는다(`createInventoryCache`). */
async function route(ctx: ServerContext, pathname: string, res: ServerResponse): Promise<number> {
  const inventory = ctx.inventory.get()
  const ids = inventory.templates.map((t) => t.id)
  const match = resolveRoute(pathname, ids, (rel) => isFile(join(ctx.publicDir, rel)))

  if (match === null) return sendHtml(res, 404, notFoundPage())

  switch (match.kind) {
    case 'index':
      return sendHtml(res, 200, indexPage(inventory))
    case 'list':
      return sendHtml(res, 200, listPage(match.type, inventory))
    case 'template':
      return await sendTemplate(ctx, match, res)
    case 'asset':
      return await sendAsset(ctx, match.path, res)
    case 'reload':
      return subscribeReload(ctx, res)
  }
}

/**
 * 변경 알림을 묶어서 보낸다 — 저장 한 번에 watch 이벤트가 여러 번 오기 때문이다.
 * 알림을 보내기 직전에 템플릿 목록도 다시 훑는다(브라우저가 곧 새 목록을 요청한다).
 */
function createNotifier(
  clients: Set<ServerResponse>,
  refresh: () => void,
): { notify: () => void; stop: () => void } {
  let timer: NodeJS.Timeout | undefined

  return {
    notify() {
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = undefined
        refresh()
        for (const client of clients) client.write('data: reload\n\n')
      }, 50)
      timer.unref()
    },
    stop() {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
    },
  }
}

/**
 * public/ 재귀 감시. `recursive`를 지원하지 않는 플랫폼(일부 리눅스·구버전)에서는 감시를 포기하고
 * 안내만 한다 — 프리뷰 자체는 새로고침으로 계속 쓸 수 있다.
 */
function startWatch(
  publicDir: string,
  notify: () => void,
  log?: (line: string) => void,
): FSWatcher | undefined {
  if (!existsSync(publicDir)) {
    log?.('public/ 이 없어 자동 새로고침을 켜지 않습니다.')
    return undefined
  }

  try {
    const watcher = watch(publicDir, { recursive: true }, () => notify())
    watcher.on('error', () => notify())
    return watcher
  } catch {
    log?.('이 플랫폼은 재귀 파일 감시를 지원하지 않습니다 — 자동 새로고침 없이 동작합니다.')
    return undefined
  }
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => reject(err)
    server.once('error', onError)
    // 로컬 프리뷰다 — 루프백에만 묶어 같은 네트워크의 다른 기기가 public/ 을 훑지 못하게 한다.
    server.listen(port, LOOPBACK, () => {
      server.removeListener('error', onError)
      const address = server.address()
      resolve(typeof address === 'object' && address !== null ? address.port : port)
    })
  })
}

/**
 * liquid 레포용 로컬 프리뷰 서버. Vite도 인증 프록시도 없다 — 플랫폼이 서버에서 데이터를 넣는
 * 구조라 로컬에서 재현할 인증 컨텍스트가 없고, 대신 폴더의 data.json을 컨텍스트로 쓴다.
 */
export async function startLiquidDevServer(
  options: LiquidDevServerOptions,
): Promise<LiquidDevServer> {
  const { root, port, log } = options
  const ctx: ServerContext = {
    root,
    publicDir: join(root, 'public'),
    engine: createEngine(root),
    clients: new Set<ServerResponse>(),
    inventory: createInventoryCache(root),
  }

  // listen 뒤에 확정된다 — 요청은 listen 이후에만 들어오므로 핸들러가 볼 때는 항상 채워져 있다.
  let boundPort = 0
  const server = createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
    if (!isLocalRequest(req, boundPort)) {
      res.writeHead(403, HTML_HEADERS)
      res.end(notFoundPage())
      log?.(`${req.method ?? '?'} ${pathname} 403`)
      return
    }
    if (req.method !== 'GET') {
      res.writeHead(405, HTML_HEADERS)
      res.end(notFoundPage())
      log?.(`${req.method ?? '?'} ${pathname} 405`)
      return
    }

    void route(ctx, pathname, res)
      .then((status) => log?.(`GET ${pathname} ${status}`))
      .catch((err: unknown) => {
        log?.(`GET ${pathname} 500`)
        if (!res.headersSent) res.writeHead(500, HTML_HEADERS)
        res.end(`<pre>${escapeHtml((err as Error).message)}</pre>`)
      })
  })

  let resolvedPort: number
  try {
    resolvedPort = await listen(server, port)
    boundPort = resolvedPort
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      fail(
        ExitCode.FAILURE,
        `포트 ${port}가 이미 사용 중입니다. -p 로 다른 포트를 쓰거나 기존 프로세스를 끄세요.`,
      )
    }
    throw err
  }

  const notifier = createNotifier(ctx.clients, () => ctx.inventory.refresh())
  const watcher = startWatch(ctx.publicDir, notifier.notify, log)

  return {
    port: resolvedPort,
    host: LOOPBACK,
    refresh: () => ctx.inventory.refresh(),
    scans: () => ctx.inventory.scans(),
    async close() {
      notifier.stop()
      watcher?.close()
      for (const client of ctx.clients) client.end()
      ctx.clients.clear()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      // keep-alive로 남은 소켓이 close를 붙잡지 않게 한다(테스트가 여기서 멈추던 자리)
      server.closeAllConnections()
    },
  }
}
