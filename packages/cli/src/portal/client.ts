import type {
  Build,
  DeviceCodeResponse,
  DevicePollResult,
  IssuedToken,
  Me,
  Placement,
  Space,
  StageRepo,
  Surface,
} from './types.js'

/** `POST .../deploy` 응답 — 배치 전체가 아니라 이 둘만 온다. */
export interface DeployedPlacement {
  id: string
  liveBuildId: string
}

export class PortalError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly retryAfter?: number,
  ) {
    super(message)
    this.name = 'PortalError'
  }
}

export interface PortalClientOptions {
  portalUrl: string
  token: string
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  /** 요청 하나의 제한 시간(ms). 테스트에서 줄여 쓸 수 있게 옵션으로 둔다. */
  timeoutMs?: number
}

const MAX_RETRY = 3
const DEFAULT_BACKOFF_MS = [5000, 10000, 20000]
/** `Retry-After` 상한. 서버가 몇 시간을 주더라도 CLI는 그 이상 붙들려 있지 않는다. */
const MAX_RETRY_AFTER_MS = 60_000
const DEFAULT_TIMEOUT_MS = 30_000

/**
 * 포털 REST API 클라이언트.
 *
 * 명령들은 이 클래스만 안다 — 경로·헤더·재시도(429 백오프)는 여기서 끝난다.
 * `token: ''`으로 만들면 Authorization 헤더 없이 호출한다 — 디바이스 코드 흐름(로그인 전) 전용이다.
 */
export class PortalClient {
  private readonly base: string
  private readonly token: string
  private readonly fetchFn: typeof fetch
  private readonly sleep: (ms: number) => Promise<void>
  private readonly timeoutMs: number

  constructor(opts: PortalClientOptions) {
    this.base = opts.portalUrl.replace(/\/+$/, '') + '/api/v1'
    this.token = opts.token
    this.fetchFn = opts.fetch ?? globalThis.fetch
    this.sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  /**
   * 429는 `Retry-After`(초)가 있으면 그만큼, 없으면 5/10/20초로 최대 3회 재시도한다.
   * 그 외 실패(4xx/5xx)는 즉시 `PortalError`로 던진다.
   */
  private async request(method: string, path: string, body?: unknown): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const res = await this.sendWithNetworkRetry(method, path, body)
      if (res.status !== 429 || attempt >= MAX_RETRY) {
        if (!res.ok) throw await toError(res)
        return res
      }
      await this.sleep(backoffMs(res.headers.get('Retry-After'), attempt))
    }
  }

  /**
   * 네트워크 계층 실패(`fetch failed`, 예: keep-alive 소켓이 서버 쪽에서 닫힌 뒤 재사용된
   * UND_ERR_SOCKET)는 재시도해도 안전한 요청에 한해 한 번만 즉시 다시 보낸다. sandbox 실측:
   * 디바이스 코드 폴링이 5초 간격이라 그 사이 유휴 연결이 닫혀 첫 재사용에서 실패했다.
   * GET과 디바이스 흐름(code·token)만 대상이다 — deploy 같은 비멱등 POST는 재시도하지 않는다.
   */
  private async sendWithNetworkRetry(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> {
    try {
      return await this.send(method, path, body)
    } catch (err) {
      if (!isNetworkError(err)) throw err
      if (!isSafeToRetry(method, path)) throw toNetworkError(err, method, path)
      await this.sleep(NETWORK_RETRY_DELAY_MS)
      try {
        return await this.send(method, path, body)
      } catch (again) {
        throw isNetworkError(again) ? toNetworkError(again, method, path) : again
      }
    }
  }

  /** fetch 한 번. 응답이 없는 실패(타임아웃·네트워크)는 `PortalError`로 바꿔 종료코드 1이 되게 한다. */
  private async send(method: string, path: string, body?: unknown): Promise<Response> {
    try {
      return await this.fetchFn(this.base + path, {
        method,
        headers: {
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
          Accept: 'application/json, text/plain',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (err) {
      if (isAbortError(err)) {
        throw new PortalError(
          0,
          `포털 응답이 ${Math.round(this.timeoutMs / 1000)}초 안에 오지 않았습니다 (${method} ${path}). 네트워크·포털 상태를 확인하고 다시 시도하세요.`,
        )
      }
      throw err
    }
  }

  private async json<T>(method: string, path: string, body?: unknown): Promise<T> {
    return (await this.request(method, path, body)).json() as Promise<T>
  }

  private stage(org: string, space: string): string {
    return `/organizations/${enc(org)}/stages/${enc(space)}`
  }

  me(): Promise<Me> {
    return this.json('GET', '/auth/me')
  }

  async listSpaces(org: string): Promise<Space[]> {
    const body = await this.json<{ spaces?: Space[] } | Space[]>(
      'GET',
      `/organizations/${enc(org)}/spaces`,
    )
    return unwrap(body, 'spaces')
  }

  async listRepos(org: string, space: string): Promise<StageRepo[]> {
    const body = await this.json<{ repos?: StageRepo[] } | StageRepo[]>(
      'GET',
      `${this.stage(org, space)}/repos`,
    )
    // 빌드와 같은 이유로 조회한 스테이지를 새긴다 — 응답 항목에 spaceId가 없어 buildMatchesRepo의
    // spaceId 대조(fail-closed)가 모든 빌드를 거르는 것을 sandbox에서 실측했다.
    return unwrap(body, 'repos').map((r) => ({ ...r, spaceId: r.spaceId ?? space }))
  }

  async listBuilds(org: string, space: string, limit = 20): Promise<Build[]> {
    const body = await this.json<{ builds?: Build[] } | Build[]>(
      'GET',
      `${this.stage(org, space)}/builds?limit=${limit}`,
    )
    // 빌드 목록은 스테이지 경로로 조회되지만 응답 항목에는 spaceId가 없다. 조회한 스테이지를
    // 각 빌드에 새겨 두어 buildMatchesRepo가 spaceId까지 엄격히 대조할 수 있게 한다.
    return unwrap(body, 'builds').map((b) => ({ ...b, spaceId: b.spaceId ?? space }))
  }

  async getBuild(org: string, space: string, buildId: string): Promise<Build> {
    const b = await this.json<Build>('GET', `${this.stage(org, space)}/builds/${enc(buildId)}`)
    return { ...b, spaceId: b.spaceId ?? space }
  }

  async getBuildLog(org: string, space: string, buildId: string): Promise<string> {
    return (
      await this.request('GET', `${this.stage(org, space)}/builds/${enc(buildId)}/log`)
    ).text()
  }

  createBuild(org: string, space: string, repoId: string): Promise<Build> {
    return this.json('POST', `${this.stage(org, space)}/builds`, { repoId })
  }

  async listPlacements(org: string, space: string, surface: Surface): Promise<Placement[]> {
    const body = await this.json<{ placements?: Placement[] } | Placement[]>(
      'GET',
      `${this.stage(org, space)}/placements?surface=${surface}`,
    )
    return unwrap(body, 'placements')
  }

  /**
   * `expectedLiveBuildId`는 CAS(compare-and-swap) — 서버 측 live 빌드와 다르면 409.
   * 응답은 배치 전체가 아니라 `{id, liveBuildId}`만 온다(포털 핸들러 그대로).
   */
  deployPlacement(
    org: string,
    space: string,
    placementId: string,
    buildId: string,
    expectedLiveBuildId: string,
  ): Promise<DeployedPlacement> {
    return this.json<DeployedPlacement>(
      'POST',
      `${this.stage(org, space)}/placements/${enc(placementId)}/deploy`,
      { buildId, expectedLiveBuildId },
    )
  }

  async setPlacementEnabled(
    org: string,
    space: string,
    placementId: string,
    enabled: boolean,
  ): Promise<Placement> {
    const r = await this.json<{ placement: Placement }>(
      'PATCH',
      `${this.stage(org, space)}/placements/${enc(placementId)}`,
      { enabled },
    )
    return r.placement
  }

  // ── 디바이스 코드 흐름(RFC 8628) — 토큰 없이 호출된다 ─────────────────────

  startDeviceAuth(deviceName: string, cliVersion: string): Promise<DeviceCodeResponse> {
    return this.json('POST', '/cli/device/code', { deviceName, cliVersion })
  }

  /**
   * `authorization_pending`·`slow_down`은 정상 흐름의 결과로 돌려준다(폴링 계속).
   * `expired_token`·`access_denied`는 더 폴링해도 회복되지 않으므로 `PortalError(400, 코드)`로 던진다.
   */
  async pollDeviceToken(deviceCode: string): Promise<DevicePollResult> {
    try {
      const issued = await this.json<IssuedToken>('POST', '/cli/device/token', { deviceCode })
      return { status: 'ok', ...issued }
    } catch (err) {
      if (err instanceof PortalError && err.status === 400) {
        if (err.message === 'authorization_pending') return { status: 'pending' }
        if (err.message === 'slow_down') {
          return err.retryAfter === undefined
            ? { status: 'slow_down' }
            : { status: 'slow_down', retryAfter: err.retryAfter }
        }
      }
      throw err
    }
  }
}

function enc(s: string): string {
  return encodeURIComponent(s)
}

/**
 * 429 대기 시간. `Retry-After`(초)를 그대로 믿으면 서버가 준 값만큼(몇 시간이라도) 멈춘다 —
 * 60초로 자르고, 값이 없거나 숫자가 아니거나 0 이하면 기본 백오프로 되돌린다.
 */
function backoffMs(retryAfterHeader: string | null, attempt: number): number {
  const seconds = Number(retryAfterHeader)
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS)
  }
  return DEFAULT_BACKOFF_MS[attempt] ?? 20000
}

/** `AbortSignal.timeout`은 TimeoutError, 그 밖의 중단은 AbortError로 온다. */
const NETWORK_RETRY_DELAY_MS = 500

/** 응답 자체가 없는 실패 — undici는 TypeError('fetch failed')로 감싸고 cause에 코드를 둔다. Abort는 제외. */
function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError && !isAbortError(err)
}

/** 원시 네트워크 오류를 사용자용 PortalError(status 0 → 종료코드 1)로 바꾼다. */
function toNetworkError(err: unknown, method: string, path: string): PortalError {
  const code = (err as { cause?: { code?: string } }).cause?.code
  return new PortalError(
    0,
    `포털에 연결할 수 없습니다 (${method} ${path}${code ? `, ${code}` : ''}). 네트워크·포털 주소를 확인하고 다시 시도하세요.`,
  )
}

function isSafeToRetry(method: string, path: string): boolean {
  return method === 'GET' || path === '/cli/device/token' || path === '/cli/device/code'
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
}

/** `{key: [...]}`와 `[...]` 두 모양을 모두 받는다 — 포털 핸들러마다 래퍼 유무가 다르다. */
function unwrap<T>(body: Record<string, T[] | undefined> | T[], key: string): T[] {
  if (Array.isArray(body)) return body
  return body[key] ?? []
}

/**
 * 오류 응답을 `PortalError`로 변환한다. 본문이 JSON이 아닌 경우(예: chi의
 * `404 page not found` 평문)도 파싱 실패로 죽지 않고 본문 텍스트를 메시지로 쓴다.
 */
async function toError(res: Response): Promise<PortalError> {
  const text = await res.text().catch(() => '')
  let message = `HTTP ${res.status}`
  try {
    const parsed = JSON.parse(text) as { error?: string; message?: string }
    message = parsed.error ?? parsed.message ?? message
  } catch {
    if (text.trim()) message = text.trim().slice(0, 300)
  }
  const retryAfter = Number(res.headers.get('Retry-After'))
  return new PortalError(res.status, message, retryAfter > 0 ? retryAfter : undefined)
}
