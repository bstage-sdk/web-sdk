import pc from 'picocolors'
import { PortalClient } from '../portal/client.js'
import { resolvePortalUrl } from '../portal/config.js'
import {
  listCredentials,
  loadCredential,
  orgLabel,
  scopeLabel,
  type Credential,
} from '../portal/credentials.js'
import { ExitCode, fail, printJson, table } from '../portal/output.js'
import type { Me } from '../portal/types.js'

export interface WhoamiOptions {
  portal?: string
  phase?: string
  /** 저장된 토큰이 여러 조직에 걸쳐 있을 때 어느 것으로 조회할지. */
  org?: string
  json?: boolean
}

interface WhoamiDeps {
  cwd?: string
  env?: NodeJS.ProcessEnv
  fetch?: typeof fetch
}

/** `--json` 항목 — 토큰 값은 담지 않는다. */
function jsonEntry(c: Credential, active: boolean) {
  return {
    organizationId: c.organizationId,
    permission: c.permission ?? null,
    allSpaces: c.allSpaces ?? false,
    spaceIds: c.spaceIds ?? [],
    expiresAt: c.expiresAt ?? null,
    savedAt: c.savedAt,
    active,
  }
}

/** 저장된 조직별 토큰 표. 토큰 값은 어떤 경로로도 찍지 않는다. */
function printCredentials(stored: Credential[], activeOrg?: string): void {
  // BSTAGE_TOKEN 만으로 도는 CI 처럼 저장된 것이 없으면 빈 표를 그리지 않는다.
  if (stored.length === 0) return
  console.log(pc.dim('저장된 토큰'))
  const rows = stored.map((c) => [
    `  조직 ${orgLabel(c.organizationId)}`,
    `등급 ${c.permission ?? '-'}`,
    scopeLabel(c.allSpaces, c.spaceIds),
    `만료 ${c.expiresAt ? c.expiresAt.slice(0, 10) : '-'}`,
    c.organizationId === activeOrg ? pc.dim('(사용 중)') : '',
  ])
  console.log(table(rows))
}

function printMe(me: Me, portalUrl: string): void {
  console.log(`${pc.bold(me.user.email)}  ${pc.dim(portalUrl)}`)
  for (const m of me.memberships) {
    const stages = Object.entries(m.stageRoles ?? {})
      .map(([s, r]) => `${s}:${r}`)
      .join(', ')
    console.log(`  조직 ${m.organizationId}  ${m.organizationRole ?? ''}  ${pc.dim(stages)}`)
  }
}

/**
 * 현재 로그인 사용자·조직·스테이지 역할 + 이 포털에 저장된 조직별 토큰.
 * 토큰 값 자체는 절대 찍지 않는다.
 *
 * 토큰이 조직마다 따로이므로 어느 것으로 물을지 정해야 한다 — 정하지 못하면(여러 조직이
 * 저장돼 있는데 `--org`·`BSTAGE_ORG`가 없으면) 포털에 묻지 않고 목록만 보여준다.
 */
export async function whoamiCommand(options: WhoamiOptions, deps: WhoamiDeps = {}): Promise<void> {
  const cwd = deps.cwd ?? process.cwd()
  const env = deps.env ?? process.env
  const portalUrl = await resolvePortalUrl(options.portal, cwd, env, options.phase)
  if (!portalUrl) {
    fail(
      ExitCode.PRECONDITION,
      '포털 주소를 정할 수 없습니다. --portal <url> 또는 --phase 를 지정하세요.',
    )
  }
  const stored = await listCredentials(portalUrl, env)
  const organizationId = options.org ?? env.BSTAGE_ORG
  const picked = await loadCredential(portalUrl, organizationId, env)
  // 빈 BSTAGE_TOKEN 은 다른 명령(resolveToken)과 같이 "없음"으로 본다(agent #337 LOW).
  const envToken = env.BSTAGE_TOKEN || undefined
  const viaEnv = Boolean(envToken)
  const token = envToken ?? picked?.token
  // BSTAGE_TOKEN이 있으면 요청은 그 토큰으로 나간다 — 저장된 항목을 "사용 중"으로 표시하면
  // 다른 조직의 토큰이 쓰인다고 오해할 수 있다(agent #337 LOW). 활성 표시는 저장 토큰일 때만.
  const activeOrg = viaEnv ? undefined : picked?.organizationId
  if (!token) {
    if (stored.length === 0) {
      fail(
        ExitCode.AUTH,
        `${portalUrl} 에 로그인되어 있지 않습니다. bstage login --portal ${portalUrl} 을 먼저 실행하세요.`,
      )
    }
    return reportStoredOnly(portalUrl, stored, options.json)
  }
  const me = await new PortalClient({ portalUrl, token, fetch: deps.fetch }).me()
  if (options.json) {
    printJson({
      portalUrl,
      tokenSource: viaEnv ? 'env' : 'stored',
      organizationId: activeOrg ?? null,
      user: me.user,
      memberships: me.memberships,
      credentials: stored.map((c) => jsonEntry(c, !viaEnv && c.organizationId === activeOrg)),
    })
    return
  }
  printMe(me, portalUrl)
  if (viaEnv) console.error('  토큰 출처: BSTAGE_TOKEN 환경변수 (저장된 자격증명은 사용하지 않음)')
  printCredentials(stored, activeOrg)
}

/** 조직을 특정할 수 없을 때 — 포털에 묻지 않고 저장된 목록과 다음 수를 알린다. */
function reportStoredOnly(portalUrl: string, stored: Credential[], json?: boolean): void {
  if (json) {
    printJson({
      portalUrl,
      organizationId: null,
      user: null,
      memberships: [],
      credentials: stored.map((c) => jsonEntry(c, false)),
    })
    return
  }
  console.log(pc.dim(portalUrl))
  printCredentials(stored)
  console.log(
    pc.yellow('  여러 조직의 토큰이 있습니다 — --org <id> 로 조직을 지정하면 계정 정보도 봅니다.'),
  )
}
