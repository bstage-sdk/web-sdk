import pc from 'picocolors'
import { resolvePortalUrl } from '../portal/config.js'
import { deleteCredential, orgLabel } from '../portal/credentials.js'
import { ExitCode, fail } from '../portal/output.js'

export interface LogoutOptions {
  portal?: string
  phase?: string
  /** 이 조직 토큰만 삭제. 없으면 그 포털에 저장된 모든 조직 토큰을 지운다. */
  org?: string
}

interface LogoutDeps {
  cwd?: string
  env?: NodeJS.ProcessEnv
}

export async function logoutCommand(options: LogoutOptions, deps: LogoutDeps = {}): Promise<void> {
  const cwd = deps.cwd ?? process.cwd()
  const env = deps.env ?? process.env
  const portalUrl = await resolvePortalUrl(options.portal, cwd, env, options.phase)
  if (!portalUrl) {
    fail(
      ExitCode.PRECONDITION,
      '포털 주소를 정할 수 없습니다: bstage logout --phase <phase> 또는 --portal <url>',
    )
  }
  const removed = await deleteCredential(portalUrl, options.org, env)
  if (removed.length === 0) {
    const scope = options.org ? `조직 ${options.org} 의 ` : ''
    console.log(pc.yellow(`${portalUrl} 에 저장된 ${scope}자격증명이 없습니다.`))
  } else {
    const orgs = removed.map(orgLabel).join(', ')
    console.log(pc.green(`✓ ${portalUrl} 자격증명을 삭제했습니다 — 조직 ${orgs}`))
  }
  console.log(pc.dim('  포털 화면에서 토큰 자체를 폐기하면 다른 기기에서도 무효가 됩니다.'))
}
