import { PortalClient } from './client.js'
import { loadLink, resolvePortalUrl, type ProjectLink } from './config.js'
import { listCredentialOrgs, resolveToken, UNKNOWN_ORG } from './credentials.js'
import { ExitCode, fail } from './output.js'

export interface PortalContext {
  client: PortalClient
  link: ProjectLink
  /** 이 요청에 쓰인 토큰의 조직. 조직 미상 토큰이면 `"*"`. */
  organizationId?: string
}

export interface ContextOptions {
  portal?: string
  /** --phase. 포털 주소를 phase로 정할 때만 쓰인다(링크 파일이 있으면 무시). */
  phase?: string
  /** --org. 저장된 토큰이 여러 조직에 걸쳐 있을 때 어느 것을 쓸지 정한다. */
  organizationId?: string
  cwd?: string
  env?: NodeJS.ProcessEnv
  fetch?: typeof fetch
}

/**
 * 토큰을 고르지 못했을 때의 안내. 조직마다 토큰이 따로이므로 "로그인하세요"만으로는
 * 부족하다 — 무엇이 저장돼 있는지, 무엇을 지정해야 하는지까지 알린다.
 */
export function failNoToken(
  portalUrl: string,
  organizationId: string | undefined,
  storedOrgs: string[],
): never {
  const named = storedOrgs.filter((o) => o !== UNKNOWN_ORG)
  const listed = named.length > 0 ? `\n  저장된 조직: ${named.join(', ')}` : ''
  if (organizationId) {
    fail(
      ExitCode.AUTH,
      `${portalUrl} 의 조직 ${organizationId} 토큰이 없습니다. 이 조직으로 bstage login 하세요.${listed}`,
    )
  }
  if (named.length > 1) {
    fail(
      ExitCode.AUTH,
      `${portalUrl} 에 여러 조직의 토큰이 저장돼 있어 하나를 고를 수 없습니다. --org <id> 또는 BSTAGE_ORG 로 조직을 지정하거나, 쓰려는 조직으로 bstage login 하세요.${listed}`,
    )
  }
  fail(
    ExitCode.AUTH,
    `${portalUrl} 에 로그인되어 있지 않습니다. bstage login --portal ${portalUrl} 을 먼저 실행하세요.`,
  )
}

/** 링크 없이 포털 URL과 토큰만 필요한 명령(link)용. */
export async function resolveClientOnly(
  opts: ContextOptions = {},
): Promise<{ client: PortalClient; portalUrl: string; organizationId?: string }> {
  const cwd = opts.cwd ?? process.cwd()
  const env = opts.env ?? process.env
  const portalUrl = await resolvePortalUrl(opts.portal, cwd, env, opts.phase)
  if (!portalUrl) {
    fail(
      ExitCode.PRECONDITION,
      '포털 주소를 정할 수 없습니다. --portal <url> 또는 --phase 를 지정하세요.',
    )
  }
  const organizationId =
    opts.organizationId ?? env.BSTAGE_ORG ?? (await loadLink(cwd, env))?.organizationId
  const token = await resolveToken(portalUrl, env, organizationId)
  if (!token) failNoToken(portalUrl, organizationId, await listCredentialOrgs(portalUrl, env))
  return {
    client: new PortalClient({ portalUrl, token, fetch: opts.fetch }),
    portalUrl,
    organizationId,
  }
}

/** 링크 + 토큰. deploy·list·logs·rollback·publish가 쓴다. */
export async function resolveContext(opts: ContextOptions = {}): Promise<PortalContext> {
  const cwd = opts.cwd ?? process.cwd()
  const env = opts.env ?? process.env
  const link = await loadLink(cwd, env)
  if (!link) {
    fail(
      ExitCode.PRECONDITION,
      '이 디렉터리는 포털 프로젝트에 연결되지 않았습니다. bstage link 를 먼저 실행하세요.',
    )
  }
  // 링크 파일 주소로 폴백하지 않는다 — resolvePortalUrl 이 허용 목록으로 거른 값만 쓴다.
  const portalUrl = await resolvePortalUrl(opts.portal, cwd, env)
  if (!portalUrl) {
    fail(
      ExitCode.PRECONDITION,
      '포털 주소를 정할 수 없습니다. --portal <url> 또는 BSTAGE_PORTAL_URL 을 지정하세요.',
    )
  }
  // 토큰은 조직마다 다르다 — 이 프로젝트가 연결된 조직의 토큰을 쓴다.
  const organizationId = opts.organizationId ?? link.organizationId
  const token = await resolveToken(portalUrl, env, organizationId)
  if (!token) failNoToken(portalUrl, organizationId, await listCredentialOrgs(portalUrl, env))
  return {
    client: new PortalClient({ portalUrl, token, fetch: opts.fetch }),
    link: { ...link, portalUrl },
    organizationId,
  }
}
