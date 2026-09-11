import { hostname as osHostname } from 'node:os'
import pc from 'picocolors'
import { PortalClient, PortalError } from '../portal/client.js'
import { resolvePortalUrl } from '../portal/config.js'
import { orgLabel, saveCredential, scopeLabel, UNKNOWN_ORG } from '../portal/credentials.js'
import { openBrowser as defaultOpenBrowser } from '../portal/openBrowser.js'
import { ExitCode, fail, printJson } from '../portal/output.js'
import type { IssuedToken } from '../portal/types.js'

export interface LoginOptions {
  portal?: string
  phase?: string
  /** 붙여 넣기 경로(CI). 없으면 디바이스 코드 흐름. */
  token?: string
  /** 붙여 넣은 토큰이 어느 조직 것인지 (BSTAGE_ORG). 디바이스 흐름은 응답이 알려준다. */
  org?: string
  noBrowser?: boolean
  json?: boolean
}

interface LoginDeps {
  cwd?: string
  env?: NodeJS.ProcessEnv
  fetch?: typeof fetch
  openBrowser?: (url: string) => Promise<boolean>
  sleep?: (ms: number) => Promise<void>
  hostname?: () => string
  cliVersion?: string
  now?: () => number
}

const SLOW_DOWN_STEP_MS = 5000

/** 붙여 넣은 토큰을 검증한다. 유효하지 않으면 AUTH로 종료해 저장을 막는다. */
async function verifyToken(client: PortalClient): ReturnType<PortalClient['me']> {
  try {
    return await client.me()
  } catch (err) {
    if (err instanceof PortalError && (err.status === 401 || err.status === 403)) {
      fail(
        ExitCode.AUTH,
        '토큰이 유효하지 않습니다. 포털 설정 › CLI 토큰에서 새 토큰을 발급하세요.',
      )
    }
    throw err
  }
}

/** 붙여 넣기 경로 — auth/me 로 한 번 확인한 뒤 저장. 잘못된 토큰이 파일에 남지 않게 한다. */
async function loginWithToken(
  portalUrl: string,
  token: string,
  options: LoginOptions,
  deps: LoginDeps,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  if (!token.startsWith('bsc_')) {
    fail(
      ExitCode.PRECONDITION,
      'CLI 토큰은 bsc_ 로 시작합니다. 포털 설정 › CLI 토큰에서 발급한 값인지 확인하세요.',
    )
  }
  // 토큰은 조직 하나에 묶이는데 auth/me 로는 어느 조직 것인지 알 수 없다 — 조직별로
  // 저장하려면 사람이 알려줘야 한다. 모른 채 저장하면 다른 조직 토큰을 덮어쓴다.
  const organizationId = options.org ?? env.BSTAGE_ORG
  if (!organizationId) {
    fail(
      ExitCode.PRECONDITION,
      '붙여 넣은 토큰이 어느 조직 것인지 알 수 없습니다. --org <id> 또는 BSTAGE_ORG 로 조직을 지정하세요.',
    )
  }
  const client = new PortalClient({ portalUrl, token, fetch: deps.fetch })
  const me = await verifyToken(client)
  await saveCredential({ portalUrl, organizationId, token, savedAt: new Date().toISOString() }, env)
  if (options.json) {
    printJson({
      portalUrl,
      method: 'token',
      organizationId,
      email: me.user.email,
      organizations: me.memberships.map((m) => m.organizationId),
    })
    return
  }
  console.log(
    pc.green(`✓ ${portalUrl} 에 ${me.user.email} 로 로그인했습니다 (조직 ${organizationId}).`),
  )
}

/** `slow_down` 응답을 대기 간격에 반영한다 — 기본 +5초, `retryAfter`가 더 크면 그것을 하한으로 쓴다. */
function nextIntervalOnSlowDown(interval: number, retryAfterSec?: number): number {
  const bumped = interval + SLOW_DOWN_STEP_MS
  return retryAfterSec !== undefined ? Math.max(bumped, retryAfterSec * 1000) : bumped
}

function printDeviceCodePrompt(
  userCode: string,
  verificationUriComplete: string,
  expiresIn: number,
): void {
  console.log('')
  console.log(`  브라우저에서 아래 코드를 확인하고 승인하세요.`)
  console.log('')
  console.log(`    코드  ${pc.bold(userCode)}`)
  console.log(`    주소  ${pc.underline(verificationUriComplete)}`)
  console.log('')
  console.log(
    pc.dim(
      `  터미널의 코드와 브라우저의 코드가 같은지 꼭 확인하세요. ${Math.round(expiresIn / 60)}분 안에 승인되지 않으면 만료됩니다.`,
    ),
  )
}

/**
 * 폴링해 토큰이 발급될 때까지 대기한다. 회복 불가능한 상태는 `fail`로 즉시 종료한다.
 *
 * `expiresIn`으로 클라이언트 쪽 시한을 둔다 — 서버가 계속 `authorization_pending`/`slow_down`을
 * 돌려주는 한 서버의 `expired_token` 판정에만 기대면 영원히 폴링하게 된다. 매 반복 시작 시
 * 시한을 넘겼는지 먼저 확인하고, 남은 시간보다 긴 대기는 시한까지로 잘라 시한 직후 지체 없이
 * 종료되게 한다.
 */
async function pollUntilIssued(
  client: PortalClient,
  deviceCode: string,
  startInterval: number,
  expiresIn: number,
  sleep: (ms: number) => Promise<void>,
  now: () => number,
): Promise<IssuedToken> {
  let interval = startInterval
  const deadline = now() + expiresIn * 1000
  for (;;) {
    const remaining = deadline - now()
    if (remaining <= 0) {
      fail(ExitCode.PRECONDITION, '승인 시간이 지났습니다. bstage login 을 다시 실행하세요')
    }
    await sleep(Math.min(interval, remaining))
    let result
    try {
      result = await client.pollDeviceToken(deviceCode)
    } catch (err) {
      if (err instanceof PortalError && err.message === 'access_denied') {
        fail(ExitCode.AUTH, '포털에서 이 로그인 요청을 거부했습니다.')
      }
      if (err instanceof PortalError && err.message === 'expired_token') {
        fail(
          ExitCode.PRECONDITION,
          '10분 안에 승인되지 않아 코드가 만료됐습니다. bstage login 을 다시 실행하세요.',
        )
      }
      throw err
    }
    if (result.status === 'slow_down') {
      interval = nextIntervalOnSlowDown(interval, result.retryAfter)
      continue
    }
    if (result.status === 'pending') continue
    return result
  }
}

/**
 * 승인 주소는 포털이 준 값이다 — 포털과 오리진이 같을 때만 연다. 다르면 주소만 알리고
 * 열지 않는다(응답이 조작됐거나 리다이렉트를 태우려는 경우, 브라우저를 자동으로 여는 것은
 * 사용자가 주소를 보기 전에 낯선 사이트에 도착시키는 일이다).
 */
async function openVerificationUri(
  portalUrl: string,
  verificationUriComplete: string,
  options: LoginOptions,
  deps: LoginDeps,
): Promise<void> {
  if (!sameOrigin(portalUrl, verificationUriComplete)) {
    if (!options.json) {
      console.log(
        pc.yellow(
          '  승인 주소가 포털과 다른 사이트입니다. 브라우저를 열지 않았습니다 — 주소를 확인한 뒤 직접 열어 주세요.',
        ),
      )
    }
    return
  }
  const opened = await (deps.openBrowser ?? defaultOpenBrowser)(verificationUriComplete)
  if (!opened && !options.json) {
    console.log(pc.dim('  브라우저를 자동으로 열지 못했습니다. 위 주소를 직접 열어 주세요.'))
  }
}

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin
  } catch {
    return false
  }
}

/** 디바이스 코드 경로(RFC 8628). */
async function loginWithDevice(
  portalUrl: string,
  options: LoginOptions,
  deps: LoginDeps,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const anon = new PortalClient({ portalUrl, token: '', fetch: deps.fetch })
  const code = await anon.startDeviceAuth(
    (deps.hostname ?? osHostname)(),
    deps.cliVersion ?? 'unknown',
  )

  if (!options.json)
    printDeviceCodePrompt(code.userCode, code.verificationUriComplete, code.expiresIn)
  if (!options.noBrowser) {
    await openVerificationUri(portalUrl, code.verificationUriComplete, options, deps)
  }

  const now = deps.now ?? Date.now
  const issued = await pollUntilIssued(
    anon,
    code.deviceCode,
    code.interval * 1000,
    code.expiresIn,
    sleep,
    now,
  )

  // 조직은 응답이 알려준다. 옛 포털(필드 없음)은 조직 미상으로 저장된다.
  const organizationId = issued.organizationId ?? options.org ?? env.BSTAGE_ORG
  await storeIssued(portalUrl, issued, organizationId, env)
  reportIssued(portalUrl, issued, organizationId, options.json)
}

/** 발급 결과를 조직별로 저장한다 — 등급·스코프·만료는 whoami가 보여줄 수 있게 함께 남긴다. */
async function storeIssued(
  portalUrl: string,
  issued: IssuedToken,
  organizationId: string | undefined,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  await saveCredential(
    {
      portalUrl,
      organizationId,
      token: issued.token,
      savedAt: new Date().toISOString(),
      permission: issued.permission,
      allSpaces: issued.allSpaces,
      spaceIds: issued.spaceIds,
      expiresAt: issued.expiresAt,
    },
    env,
  )
}

/** 로그인 결과 안내. 토큰 값은 찍지 않는다(prefix만). */
function reportIssued(
  portalUrl: string,
  issued: IssuedToken,
  organizationId: string | undefined,
  json?: boolean,
): void {
  if (json) {
    printJson({
      portalUrl,
      method: 'device',
      tokenId: issued.id,
      prefix: issued.prefix,
      organizationId: organizationId ?? null,
      permission: issued.permission,
      allSpaces: issued.allSpaces ?? false,
      spaceIds: issued.spaceIds,
      expiresAt: issued.expiresAt,
    })
    return
  }
  console.log(pc.green(`✓ ${portalUrl} 에 로그인했습니다.`))
  console.log(
    pc.dim(
      `  조직 ${orgLabel(organizationId ?? UNKNOWN_ORG)} · 토큰 ${issued.prefix}… · 등급 ${issued.permission} · ${scopeLabel(issued.allSpaces, issued.spaceIds)} · 만료 ${issued.expiresAt.slice(0, 10)}`,
    ),
  )
  console.log(pc.dim('  다음: 프로젝트 디렉터리에서 bstage link'))
}

/**
 * `bstage login` — 기본은 디바이스 코드 흐름(브라우저 승인). `--token`/BSTAGE_TOKEN 이 있으면
 * 붙여 넣기 경로(CI). 포털 주소는 --portal → BSTAGE_PORTAL_URL → phase 매핑 순이며,
 * **링크 파일은 보지 않는다** — 저장소가 적어 둔 주소로 새 토큰을 발급받게 하지 않는다.
 */
export async function loginCommand(options: LoginOptions, deps: LoginDeps = {}): Promise<void> {
  const env = deps.env ?? process.env
  const portalUrl = (await resolvePortalUrl(
    options.portal,
    deps.cwd ?? process.cwd(),
    env,
    options.phase,
    { allowLink: false },
  ))!
  const pasted = (options.token ?? env.BSTAGE_TOKEN ?? '').trim()
  if (pasted) return loginWithToken(portalUrl, pasted, options, deps, env)
  return loginWithDevice(portalUrl, options, deps, env)
}
