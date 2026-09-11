import pc from 'picocolors'
import { applyPlacements, reportOutcome } from '../portal/applyPlacements.js'
import { askConfirm, assertCanConfirm, type ConfirmDeps } from '../portal/confirm.js'
import { assertDeployable, gitExec, readGitState, type Exec, type GitState } from '../portal/git.js'
import { ExitCode, fail, jsonSummary, printJson, shortSha, table } from '../portal/output.js'
import { resolveContext, type PortalContext } from '../portal/resolveContext.js'
import { applyPlan, fetchTargets, type PlanRow } from '../portal/selectPlacements.js'
import type { Build } from '../portal/types.js'
import { waitForBuild } from '../portal/waitBuild.js'

export interface DeployOptions {
  yes?: boolean
  json?: boolean
  placement?: string
  skipGitCheck?: boolean
  noWait?: boolean
}

export interface DeployDeps extends ConfirmDeps {
  cwd?: string
  env?: NodeJS.ProcessEnv
  fetch?: typeof fetch
  exec?: Exec
  out?: (s: string) => void
  sleep?: (ms: number) => Promise<void>
}

/** 링크된 레포의 기본 브랜치. 포털에서 레포를 못 찾으면(재연결 필요) PRECONDITION. */
async function repoDefaultBranch(ctx: PortalContext): Promise<string> {
  const repos = await ctx.client.listRepos(ctx.link.organizationId, ctx.link.spaceId)
  const repo = repos.find((r) => r.id === ctx.link.repoId)
  if (!repo) {
    fail(
      ExitCode.PRECONDITION,
      `연결된 레포 ${ctx.link.repoId} 를 포털에서 찾을 수 없습니다. bstage link 를 다시 실행하세요.`,
    )
  }
  return repo.defaultBranch
}

/** git 사전점검. git 미설치·저장소 아님 등 원본 에러를 그대로 던지지 않고 PRECONDITION으로 감싼다. */
async function precheckGit(deps: DeployDeps, defaultBranch: string): Promise<void> {
  const exec = deps.exec ?? gitExec(deps.cwd ?? process.cwd())
  let state: GitState
  try {
    state = await readGitState(exec)
  } catch (err) {
    fail(
      ExitCode.PRECONDITION,
      `git 상태를 확인할 수 없습니다: ${err instanceof Error ? err.message : String(err)}. ` +
        'git이 설치돼 있고 이 디렉터리가 git 저장소인지 확인하거나 --skip-git-check 로 건너뛰세요.',
    )
  }
  assertDeployable(state, defaultBranch)
}

/** 빌드를 시작하고 빌드 id·커밋을 알린다(대기 여부와 무관하게 공통). */
async function createAndAnnounceBuild(ctx: PortalContext, options: DeployOptions): Promise<Build> {
  const created = await ctx.client.createBuild(
    ctx.link.organizationId,
    ctx.link.spaceId,
    ctx.link.repoId,
  )
  if (!options.json) {
    console.error(pc.dim(`[bstage] 빌드 ${created.id} 시작 (${shortSha(created.commitSha)})`))
  }
  return created
}

/** `--no-wait` 경로 출력. 빌드 상태 조회 없이 즉시 끝난다. */
function reportNoWait(build: Build, options: DeployOptions, out: (s: string) => void): void {
  if (options.json) {
    printJson(jsonSummary([], { build }))
    return
  }
  out(
    `빌드 ${build.id} 를 시작했습니다. bstage logs ${build.id} --follow 로 진행 상황을 확인하세요.`,
  )
}

/** 빌드가 끝날 때까지 기다린다. 실패·타임아웃·취소면 FAILURE로 끝낸다(배치는 건드리지 않는다). */
async function waitForCompletedBuild(
  ctx: PortalContext,
  deps: DeployDeps,
  build: Build,
  json: boolean | undefined,
): Promise<Build> {
  const { organizationId: org, spaceId: space } = ctx.link
  const done = await waitForBuild(ctx.client, org, space, build.id, {
    sleep: deps.sleep,
    onLog: json ? undefined : (delta) => process.stderr.write(pc.dim(delta)),
  })
  if (done.status !== 'SUCCEEDED') {
    fail(
      ExitCode.FAILURE,
      `빌드 ${done.id} 실패: ${done.status}${done.failureReason ? ` (${done.failureReason})` : ''}. ` +
        `bstage logs ${done.id} 로 로그를 확인하세요.`,
    )
  }
  return done
}

/** 확인 계획표. "현재"는 배치의 라이브 커밋, "→ 적용"은 이번 빌드의 커밋(전 배치 동일). */
function renderPlanTable(plan: PlanRow[], build: Build): string {
  const header = `빌드 ${build.id} (커밋 ${shortSha(build.commitSha)})`
  const rows = table([
    ['자리', '현재', '→ 적용'],
    ...plan.map((row) => {
      const to = shortSha(build.commitSha) + (row.unchanged ? ' (변경 없음)' : '')
      return [row.label, shortSha(row.placement.liveCommit), to]
    }),
  ])
  return `${header}\n${rows}`
}

/** --yes면 통과, 아니면 계획표를 보여주고 물어본다. 거절 시 PRECONDITION(빌드는 남아 있다고 안내). */
async function confirmPlan(
  plan: PlanRow[],
  build: Build,
  options: DeployOptions,
  deps: DeployDeps,
): Promise<void> {
  if (options.yes) return
  const out = deps.out ?? console.log
  out(renderPlanTable(plan, build))
  const ok = await askConfirm(
    deps,
    `${plan.length}개 배치를 빌드 ${build.id} 로 라이브 전환합니다. 진행할까요?`,
  )
  if (!ok) {
    fail(ExitCode.PRECONDITION, '취소했습니다. 빌드는 남아 있으니 필요하면 다시 실행해 적용하세요.')
  }
}

/**
 * `bstage deploy` — git 사전점검 → 빌드 → 완료 대기(로그 tail) → 이 레포의 배치를 골라 확인 후
 * CAS(compare-and-swap)로 라이브 전환한다.
 *
 * 포털은 GitHub 기본 브랜치 HEAD를 clone해 빌드하므로, 로컬 커밋만 있고 push하지 않은 변경은
 * 반영되지 않는다 — git 사전점검이 그 사실을 빌드를 만들기 전에 드러낸다.
 *
 * CAS에 쓰는 `expectedLiveBuildId`는 빌드 대기가 끝난 직후 다시 조회한 값이다(대기가 길어지는
 * 동안 다른 사람이 먼저 배포했을 수 있어, 애초에 고른 시점의 값을 그대로 쓰면 신선하지 않다).
 * 그래도 서버 값이 그 사이 또 바뀌었다면 409가 나고, 그 배치만 conflict로 남긴 채 나머지는
 * 계속 진행한다 — 조용히 재시도하지 않는다.
 *
 * `--json`은 stdout에 JSON 객체 하나만 써야 하므로 확인 프롬프트와 조합할 수 없다 —
 * `--yes` 없이 `--json`을 주면 아무 것도 하지 않고 바로 끝낸다. 확인을 물을 수 없는 환경
 * (TTY 아님)인지도 **빌드를 만들기 전에** 판정한다 — 나중에 물으면 이미 만들어진 빌드를
 * 두고 멈추게 된다.
 */
export async function deployCommand(options: DeployOptions, deps: DeployDeps = {}): Promise<void> {
  if (options.json && !options.yes) {
    fail(ExitCode.PRECONDITION, '--json 은 --yes 와 함께 쓰세요.')
  }
  if (!options.yes) assertCanConfirm(deps) // 빌드를 만들기 전에 확인 가능 여부부터 본다

  const out = deps.out ?? console.log
  const ctx = await resolveContext({ cwd: deps.cwd, env: deps.env, fetch: deps.fetch })
  const defaultBranch = await repoDefaultBranch(ctx)
  if (!options.skipGitCheck) await precheckGit(deps, defaultBranch)

  await fetchTargets(ctx, options.placement) // 0개면 빌드를 만들기 전에 여기서 끝난다

  const created = await createAndAnnounceBuild(ctx, options)
  if (options.noWait) {
    reportNoWait(created, options, out)
    return
  }
  const build = await waitForCompletedBuild(ctx, deps, created, options.json)

  const fresh = await fetchTargets(ctx, options.placement, build.id)
  const plan = applyPlan(fresh, build.id)
  await confirmPlan(plan, build, options, deps)

  const results = await applyPlacements(ctx, plan)
  reportOutcome(results, options, out, { build })
}
