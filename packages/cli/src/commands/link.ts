import * as p from '@clack/prompts'
import pc from 'picocolors'
import { saveLink, type ProjectLink } from '../portal/config.js'
import { gitExec, type Exec } from '../portal/git.js'
import { ExitCode, fail, printJson } from '../portal/output.js'
import { resolveClientOnly } from '../portal/resolveContext.js'
import type { PortalClient } from '../portal/client.js'
import type { StageRepo } from '../portal/types.js'

export interface LinkOptions {
  portal?: string
  phase?: string
  org?: string
  space?: string
  repo?: string
  yes?: boolean
  json?: boolean
}

type Select = <T>(message: string, items: { value: T; label: string }[]) => Promise<T>

interface LinkDeps {
  cwd?: string
  env?: NodeJS.ProcessEnv
  fetch?: typeof fetch
  select?: Select
  /** `git remote get-url origin` 실행기. 테스트는 실제 git 대신 이 시그니처를 주입한다. */
  exec?: Exec
}

const clackSelect: Select = async (message, items) => {
  // p.select의 Option<Value>는 Value가 문자열 등 원시값인지 여부로 조건부 타입이 갈린다.
  // 여기서는 제네릭 T가 호출 시점까지 확정되지 않아 그 분기를 컴파일 타임에 풀 수 없으므로
  // unknown으로 넘기고 반환값만 T로 되돌린다 — 두 분기 모두 value/label 모양은 같다.
  const options = items.map((i) => ({
    value: i.value,
    label: i.label,
  })) as unknown as p.Option<unknown>[]
  const v = await p.select({ message, options })
  if (p.isCancel(v)) fail(ExitCode.PRECONDITION, '취소했습니다.')
  return v as (typeof items)[number]['value']
}

/**
 * `git remote get-url origin`에서 owner/repo를 읽는다. SSH(`git@host:owner/repo.git`)와
 * HTTPS(`https://host/owner/repo`) 두 형식 모두 지원한다. git이 없거나 origin이 없으면
 * (테스트 임시 디렉터리 포함) 조용히 null — 기본값 매칭은 있으면 좋은 편의 기능이지
 * 필수 경로가 아니다.
 */
async function originOwnerRepo(exec: Exec): Promise<string | null> {
  try {
    const stdout = await exec(['remote', 'get-url', 'origin'])
    const m = stdout.trim().match(/[/:]([^/:]+)\/([^/]+?)(?:\.git)?$/)
    return m ? `${m[1]}/${m[2]}` : null
  } catch {
    return null
  }
}

/** origin과 owner/repo가 대소문자 무시하고 유일하게 일치하는 레포. 0개·2개 이상이면 null. */
function findUniqueOriginMatch(repos: StageRepo[], origin: string): StageRepo | null {
  const lower = origin.toLowerCase()
  const matches = repos.filter((r) => `${r.owner}/${r.repo}`.toLowerCase() === lower)
  return matches.length === 1 ? matches[0] : null
}

/** 후보가 하나면 그것, 옵션으로 지정됐으면 그것, 아니면 프롬프트(TTY 없거나 --yes면 실패). */
async function pick<T>(
  label: string,
  flag: string,
  items: { value: T; label: string; match: string[] }[],
  explicit: string | undefined,
  yes: boolean | undefined,
  interactive: boolean,
  select: Select,
): Promise<T> {
  if (items.length === 0)
    fail(ExitCode.PRECONDITION, `선택할 ${label} 항목이 없습니다. 포털에서 먼저 연결하세요.`)
  if (explicit) {
    const hit = items.find((i) => i.match.includes(explicit))
    if (!hit) {
      fail(
        ExitCode.PRECONDITION,
        `${label} '${explicit}' 을(를) 찾을 수 없습니다. 후보: ${items.map((i) => i.label).join(', ')}`,
      )
    }
    return hit.value
  }
  if (items.length === 1) return items[0].value
  if (yes || !interactive) {
    fail(
      ExitCode.PRECONDITION,
      `${label} 후보가 여러 개입니다. --${flag} 로 지정하세요: ${items.map((i) => i.label).join(', ')}`,
    )
  }
  return select(`${label}을(를) 선택하세요`, items)
}

interface SelectionContext {
  client: PortalClient
  exec: Exec
  env: NodeJS.ProcessEnv
  options: LinkOptions
  interactive: boolean
  select: Select
  /**
   * **조직이 정해진 뒤** 그 조직 토큰이 다룰 수 있는 스테이지를 돌려준다. 좁힐 근거가 없으면
   * `null`이고 그때는 후보를 건드리지 않는다. 조직보다 먼저 읽으면 다른 조직(또는 조직 미상)
   * 자격증명의 스코프로 엉뚱한 스테이지를 자동 선택할 수 있다.
   */
  tokenSpaceIds: (organizationId: string) => Promise<string[] | null>
}

interface RepoSelection {
  repo: StageRepo
  fromOrigin: boolean
}

/**
 * 레포 선택. `--repo`/`BSTAGE_REPO`가 없고 후보가 둘 이상인데 git origin과 owner/repo가
 * 유일하게 일치하면 그 레포를 실제 기본값으로 자동 선택한다(인터랙티브·`--yes` 구분 없이) —
 * 매치가 없거나 여러 개면 기존 pick 경로(프롬프트 또는 --yes PRECONDITION)로 넘어간다.
 */
async function resolveRepoSelection(
  repos: StageRepo[],
  ctx: SelectionContext,
): Promise<RepoSelection> {
  const explicit = ctx.options.repo ?? ctx.env.BSTAGE_REPO
  if (!explicit && repos.length > 1) {
    const origin = await originOwnerRepo(ctx.exec)
    const match = origin ? findUniqueOriginMatch(repos, origin) : null
    if (match) return { repo: match, fromOrigin: true }
  }
  const items = repos.map((r) => ({
    value: r,
    label: `${r.owner}/${r.repo} [${r.surface}] (${r.defaultBranch})`,
    match: [r.id, `${r.owner}/${r.repo}`],
  }))
  const repo = await pick<StageRepo>(
    '레포',
    'repo',
    items,
    explicit,
    ctx.options.yes,
    ctx.interactive,
    ctx.select,
  )
  return { repo, fromOrigin: false }
}

interface Selections {
  organizationId: string
  spaceId: string
  repo: StageRepo
  repoFromOrigin: boolean
}

/** 조직 → 스테이지 → 레포 순으로 고른다. 각 단계는 유일하면 자동, 아니면 옵션/프롬프트. */
async function resolveSelections(ctx: SelectionContext): Promise<Selections> {
  const { client, options, env, interactive, select } = ctx

  const me = await client.me()
  const organizationId = await pick(
    '조직',
    'org',
    me.memberships.map((m) => ({
      value: m.organizationId,
      label: m.organizationId,
      match: [m.organizationId],
    })),
    options.org ?? env.BSTAGE_ORG,
    options.yes,
    interactive,
    select,
  )

  const spaces = await client.listSpaces(organizationId)
  // 토큰이 스테이지 몇 개로 묶여 있으면 그 밖은 애초에 쓸 수 없다 — 후보로 보여 주면
  // 하나뿐인데도 `--space`를 요구하거나, 고른 뒤 권한 오류로 끝난다. 교집합이 비면
  // 좁히지 않는다(목록이 낡았거나 스코프 정보가 없는 경우까지 막지 않기 위해서다).
  const allowed = await ctx.tokenSpaceIds(organizationId)
  const narrowed = allowed ? spaces.filter((s) => allowed.includes(s.spaceId)) : []
  const candidates = narrowed.length > 0 ? narrowed : spaces
  const spaceId = await pick(
    '스테이지',
    'space',
    candidates.map((s) => ({
      value: s.spaceId,
      label: `${s.spaceId} (${s.tier})`,
      match: [s.spaceId],
    })),
    options.space ?? env.BSTAGE_SPACE,
    options.yes,
    interactive,
    select,
  )

  const repos = await client.listRepos(organizationId, spaceId)
  const { repo, fromOrigin } = await resolveRepoSelection(repos, ctx)
  return { organizationId, spaceId, repo, repoFromOrigin: fromOrigin }
}

/** 성공 출력. `--json`이면 링크 객체만 stdout에 쓰고 그 외 안내문은 찍지 않는다. */
function printLinked(
  link: ProjectLink,
  repoLabel: string,
  repoFromOrigin: boolean,
  json: boolean | undefined,
): void {
  if (json) {
    printJson(link)
    return
  }
  if (repoFromOrigin) {
    console.log(pc.dim(`  git origin(${repoLabel})과 일치하는 레포를 기본값으로 선택했습니다.`))
  }
  console.log(
    pc.green(
      `✓ 연결했습니다: ${link.organizationId} / ${link.spaceId} / ${repoLabel} [${link.surface}]`,
    ),
  )
  console.log(
    pc.dim(
      '  .bstage/project.json 에 저장 (gitignore 대상). CI에서는 BSTAGE_ORG·BSTAGE_SPACE·BSTAGE_REPO·BSTAGE_SURFACE·BSTAGE_PORTAL_URL 환경변수를 쓰세요.',
    ),
  )
}

/**
 * `bstage link` — 조직·스테이지·레포를 골라 `.bstage/project.json`에 저장한다.
 *
 * `--json`은 stdout에 링크 객체 하나만 써야 하므로 선택 프롬프트와 조합할 수 없다(프롬프트가
 * stdout을 더럽힌다) — deploy·rollback·publish와 같은 규칙으로 `--yes`를 함께 요구한다.
 */
export async function linkCommand(options: LinkOptions, deps: LinkDeps = {}): Promise<void> {
  if (options.json && !options.yes) {
    fail(ExitCode.PRECONDITION, '--json 은 --yes 와 함께 쓰세요.')
  }
  const cwd = deps.cwd ?? process.cwd()
  const env = deps.env ?? process.env
  // deps.select가 주어지면(테스트) 항상 인터랙티브로 취급한다 — 실제 stdin은 건드리지 않는다.
  const interactive = deps.select !== undefined || p.isTTY(process.stdout)
  const select = deps.select ?? clackSelect
  const exec = deps.exec ?? gitExec(cwd)
  const {
    client,
    portalUrl,
    credential: authCredential,
  } = await resolveClientOnly({
    portal: options.portal,
    phase: options.phase,
    // 링크 파일이 아직 없을 수 있으니 조직은 사람이 준 값으로 정한다 — 여러 조직 토큰이
    // 저장돼 있을 때 --org 안내가 실제로 통하게 하는 자리다.
    organizationId: options.org ?? env.BSTAGE_ORG,
    cwd,
    env,
    fetch: deps.fetch,
  })

  /**
   * 좁히기의 근거는 **이 조직의 저장된 토큰**뿐이다. 아래 경우에는 좁히지 않는다.
   *
   * - `BSTAGE_TOKEN`이 있으면 실제로 쓰는 토큰이 저장된 자격증명과 무관하다. 그 스코프로
   *   좁히면 환경변수 토큰이 쓸 수 없는 스테이지를 후보 하나로 만들어 **묻지 않고** 고른다.
   * - 조직 미상(`*`)이거나 다른 조직의 항목이면 이 조직의 스코프가 아니다.
   *
   * 링크 파일은 이후 deploy·rollback·publish가 그대로 읽으므로, 사람이 고르지 않은 스테이지가
   * 조용히 적히는 일은 만들지 않는다.
   */
  const tokenSpaceIds = async (organizationId: string): Promise<string[] | null> => {
    // 좁히기의 근거는 **인증에 실제로 쓴 그 항목**이어야 한다. 조직을 나중에 고르는 경로에서는
    // 인증 토큰이 조직 미상(`*`) 항목에서 나오고, 조직 키 항목은 다른 토큰일 수 있다 — 그 스코프로
    // 좁히면 사람이 고르지 않은 스테이지가 후보 하나가 되어 묻지 않고 링크 파일에 적힌다.
    const credential = authCredential
    if (!credential || credential.allSpaces) return null
    if (credential.organizationId !== organizationId) return null
    return credential.spaceIds?.length ? credential.spaceIds : null
  }

  const { organizationId, spaceId, repo, repoFromOrigin } = await resolveSelections({
    client,
    exec,
    env,
    options,
    interactive,
    select,
    tokenSpaceIds,
  })

  const link: ProjectLink = {
    portalUrl,
    organizationId,
    spaceId,
    repoId: repo.id,
    surface: repo.surface,
  }
  await saveLink(cwd, link)
  printLinked(link, `${repo.owner}/${repo.repo}`, repoFromOrigin, options.json)
}
