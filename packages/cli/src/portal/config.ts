import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { loadEnv } from 'vite'
import { PORTAL_HOSTS, PORTAL_HOST_ENV_KEY, isPublicPhase } from '../constants.js'
import { resolvePhase } from '../dev/resolvePhase.js'
import { ExitCode, fail } from './output.js'

/**
 * 포털 주소 해석(허용 목록 포함)과 프로젝트 링크 저장소.
 *
 * 프로젝트 링크는 저장소별 `.bstage/project.json`에 저장한다. CI에서는 파일 대신
 * `BSTAGE_TOKEN`·`BSTAGE_PORTAL_URL`·`BSTAGE_ORG`·`BSTAGE_SPACE`·`BSTAGE_REPO`·`BSTAGE_SURFACE`
 * 환경변수로 대체할 수 있다. 자격증명(토큰) 저장은 `credentials.ts`가 맡는다.
 */

export interface ProjectLink {
  portalUrl: string
  organizationId: string
  spaceId: string
  repoId: string
  surface: 'USER' | 'ADMIN'
}

type Env = NodeJS.ProcessEnv

/** http를 허용하는 로컬 호스트 — 포털을 로컬에서 띄워 붙일 때만 쓴다. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * 포털 URL을 키로 쓸 때의 정규형 — 후행 슬래시 제거. 스킴은 https만 받는다(로컬 호스트는
 * http 허용). 토큰을 Authorization 헤더로 보내는 주소이므로 평문 http는 그대로 새 나간다.
 *
 * `u.pathname = ...`로 빈 문자열을 대입하면 authority가 있는 URL은 스펙상 '/'로 되돌아가
 * 루트 경로(`https://x.example/`)의 후행 슬래시가 지워지지 않는다. 그래서 setter를 쓰지 않고
 * 잘라낸 경로를 origin에 직접 이어 붙인다.
 */
export function normalizePortalUrl(url: string): string {
  const u = new URL(url)
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && LOCAL_HOSTS.has(u.hostname))) {
    fail(
      ExitCode.PRECONDITION,
      `포털 주소는 https 여야 합니다 (받은 값: ${url}). http는 localhost·127.0.0.1 에서만 허용합니다.`,
    )
  }
  const path = u.pathname.replace(/\/+$/, '')
  return u.origin + path
}

export function linkPath(cwd: string): string {
  return join(cwd, '.bstage', 'project.json')
}

export async function saveLink(cwd: string, link: ProjectLink): Promise<void> {
  await mkdir(dirname(linkPath(cwd)), { recursive: true })
  await writeFile(linkPath(cwd), JSON.stringify(link, null, 2) + '\n')
}

function linkFromEnv(env: Env): ProjectLink | null {
  const { BSTAGE_PORTAL_URL, BSTAGE_ORG, BSTAGE_SPACE, BSTAGE_REPO, BSTAGE_SURFACE } = env
  if (!BSTAGE_PORTAL_URL || !BSTAGE_ORG || !BSTAGE_SPACE || !BSTAGE_REPO || !BSTAGE_SURFACE) {
    return null
  }
  if (BSTAGE_SURFACE !== 'USER' && BSTAGE_SURFACE !== 'ADMIN') return null
  return {
    portalUrl: BSTAGE_PORTAL_URL,
    organizationId: BSTAGE_ORG,
    spaceId: BSTAGE_SPACE,
    repoId: BSTAGE_REPO,
    surface: BSTAGE_SURFACE,
  }
}

/** 환경변수(CI) → 프로젝트 링크 파일 순. */
export async function loadLink(cwd: string, env: Env = process.env): Promise<ProjectLink | null> {
  const fromEnv = linkFromEnv(env)
  if (fromEnv) return fromEnv
  try {
    return JSON.parse(await readFile(linkPath(cwd), 'utf-8')) as ProjectLink
  } catch {
    return null
  }
}

/**
 * phase → 포털 URL. 공개 phase는 `PORTAL_HOSTS`, 사내 phase는 `.env`/셸의
 * `VITE_BSTAGE_PORTAL_HOST`. 사내 phase인데 호스트가 없으면 throw —
 * `resolveDevHosts`와 같은 이유(요청 자체를 만들 수 없다).
 */
export function portalUrlForPhase(phase: string, cwd: string, env: Env = process.env): string {
  if (isPublicPhase(phase) && PORTAL_HOSTS[phase]) return `https://${PORTAL_HOSTS[phase]}`

  const host = internalPortalHost(cwd, env)
  if (!host) {
    throw new Error(
      `${phase}는 사내 전용 환경이라 포털 주소가 SDK에 들어 있지 않습니다.\n` +
        `  설정되지 않은 값: ${PORTAL_HOST_ENV_KEY}\n` +
        `  · 사내: 위 값을 .env에 설정하세요 (호스트 값은 사내 문서를 참고하세요)\n` +
        `  · 그 외: --phase sandbox 또는 --portal <url> 을 지정하세요`,
    )
  }
  return normalizePortalUrl(host)
}

/**
 * 링크 파일(`.bstage/project.json`)·`.env` 는 저장소가 공급하는 값이라 PR 하나로 바뀔 수 있다.
 * 토큰을 Authorization 헤더로 보내는 주소를 그런 값이 마음대로 정하면, 적대적 PR이
 * `portalUrl: https://evil.example` 를 심어 CI의 `BSTAGE_TOKEN` 을 자기 서버로 끌어갈 수 있다.
 * 그래서 저장소 유래 주소는 아래 허용 목록 안의 오리진일 때만 쓴다.
 *
 * 허용 목록에 드는 것:
 *   1. `PORTAL_HOSTS` 의 모든 phase (SDK에 내장된 공개 포털)
 *   2. `--portal` 로 직접 준 주소 (사람이 그 자리에서 준 값)
 *   3. `BSTAGE_PORTAL_URL` (CI 설정 — 저장소 파일이 아니라 워크플로가 정한다)
 *   4. `.env`/셸의 `VITE_BSTAGE_PORTAL_HOST` — 단, `BSTAGE_TOKEN` 이 없을 때만.
 *      토큰이 환경변수로 들어온 상황(CI)에서는 저장소가 공급하는 `.env` 를 믿지 않는다.
 *
 * phase 는 목록을 좁히지 않는다 — phase 매핑이 낼 수 있는 주소는 1번 아니면 4번뿐이다.
 */
export function allowedPortalOrigins(
  cwd: string,
  env: Env = process.env,
  explicit?: string,
): Set<string> {
  const origins = new Set<string>(Object.values(PORTAL_HOSTS).map((host) => `https://${host}`))
  if (explicit) origins.add(originOf(explicit))
  if (env.BSTAGE_PORTAL_URL) origins.add(originOf(env.BSTAGE_PORTAL_URL))
  if (!env.BSTAGE_TOKEN) {
    const internal = internalPortalHost(cwd, env)
    if (internal) origins.add(originOf(internal))
  }
  return origins
}

/** 사내 phase 포털 호스트(`.env` 또는 셸). 스킴이 없으면 https 로 본다. */
function internalPortalHost(cwd: string, env: Env): string | null {
  const fileEnv = loadEnv('development', cwd, '')
  const host = (env[PORTAL_HOST_ENV_KEY] || fileEnv[PORTAL_HOST_ENV_KEY] || '').trim()
  if (!host) return null
  return host.startsWith('http') ? host : `https://${host}`
}

function originOf(url: string): string {
  return new URL(normalizePortalUrl(url)).origin
}

const TOKEN_ENV_HINT =
  'BSTAGE_TOKEN 이 설정된 환경에서는 포털 주소를 --portal, BSTAGE_PORTAL_URL, 또는 공개 phase 매핑으로만 정합니다.'

/** 링크 파일이 준 포털 주소를 검증한다 — 허용 목록 밖이면 요청을 만들지 않고 끝낸다. */
function portalUrlFromLink(raw: string, cwd: string, env: Env): string {
  const url = normalizePortalUrl(raw)
  if (env.BSTAGE_TOKEN) {
    fail(
      ExitCode.PRECONDITION,
      `${TOKEN_ENV_HINT} .bstage/project.json 의 주소는 쓰지 않습니다 — --portal 또는 BSTAGE_PORTAL_URL 로 명시하세요.`,
    )
  }
  const origin = new URL(url).origin
  if (!allowedPortalOrigins(cwd, env).has(origin)) {
    fail(
      ExitCode.PRECONDITION,
      `.bstage/project.json 의 포털 주소(${origin})가 허용 목록에 없습니다. --portal 또는 BSTAGE_PORTAL_URL 로 명시하거나 bstage link 를 다시 실행하세요`,
    )
  }
  return url
}

/** phase 매핑 결과 검증 — `BSTAGE_TOKEN` 이 있으면 `.env` 유래 사내 주소는 쓰지 않는다. */
function portalUrlFromPhase(phaseFlag: string | undefined, cwd: string, env: Env): string {
  const { phase } = resolvePhase(phaseFlag, cwd, env)
  const url = portalUrlForPhase(phase, cwd, env)
  if (env.BSTAGE_TOKEN && !allowedPortalOrigins(cwd, env).has(new URL(url).origin)) {
    fail(
      ExitCode.PRECONDITION,
      `${TOKEN_ENV_HINT} .env 의 ${PORTAL_HOST_ENV_KEY}(${phase})는 쓰지 않습니다 — --portal 또는 BSTAGE_PORTAL_URL 로 명시하세요.`,
    )
  }
  return url
}

export interface ResolvePortalOptions {
  /** false면 링크 파일을 읽지 않는다 — login 은 링크 파일로 포털을 정하지 않는다. */
  allowLink?: boolean
}

/**
 * 포털 주소 해석 순서:
 *   --portal → BSTAGE_PORTAL_URL → .bstage/project.json → phase 매핑(--phase → VITE_BSTAGE_PHASE → sandbox)
 * 앞의 둘은 사람·CI가 그 자리에서 준 값이라 그대로 신뢰하고, 뒤의 둘은 저장소가 공급하므로
 * `allowedPortalOrigins` 로 거른다.
 *
 * phase 매핑이 항상 값을 내거나 throw하므로 null은 실제로 돌아오지 않는다 — 반환 타입을
 * nullable로 둔 것은 호출자(로그인 전 안내 등)와의 호환을 위해서다.
 */
export async function resolvePortalUrl(
  explicit: string | undefined,
  cwd: string,
  env: Env = process.env,
  phaseFlag?: string,
  options: ResolvePortalOptions = {},
): Promise<string | null> {
  if (explicit) return normalizePortalUrl(explicit)
  if (env.BSTAGE_PORTAL_URL) return normalizePortalUrl(env.BSTAGE_PORTAL_URL)
  // 링크가 환경변수(5종)에서 왔다면 BSTAGE_PORTAL_URL 이 있어 위에서 이미 돌아갔다 —
  // 여기 오는 링크는 항상 파일이다.
  const link = options.allowLink === false ? null : await loadLink(cwd, env)
  if (link) return portalUrlFromLink(link.portalUrl, cwd, env)
  return portalUrlFromPhase(phaseFlag, cwd, env)
}
