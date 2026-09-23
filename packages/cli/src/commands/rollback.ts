import pc from 'picocolors'
import { applyPlacements, reportOutcome } from '../portal/applyPlacements.js'
import { buildMatchesRepo, resolveLinkedRepo } from '../portal/buildRepo.js'
import { PortalError } from '../portal/client.js'
import { askConfirm, assertCanConfirm, type ConfirmDeps } from '../portal/confirm.js'
import { ExitCode, fail, shortSha, table } from '../portal/output.js'
import { resolveContext, type PortalContext } from '../portal/resolveContext.js'
import { fetchTargets, type PlanRow } from '../portal/selectPlacements.js'
import { placementLabel, type Build, type Placement, type StageRepo } from '../portal/types.js'

export interface RollbackOptions {
  yes?: boolean
  json?: boolean
  placement?: string
}

export interface RollbackDeps extends ConfirmDeps {
  cwd?: string
  env?: NodeJS.ProcessEnv
  fetch?: typeof fetch
  out?: (s: string) => void
}

/** `PlanRow` + 확인 계획표에 쓸 대상 빌드의 커밋. */
interface RollbackPlanRow extends PlanRow {
  targetCommit?: string
}

/**
 * 이 레포의 SUCCEEDED 빌드 중 `currentLive`보다 오래된 것 중 가장 최근 것 —
 * requestedAt 내림차순 목록에서 `currentLive` 바로 다음 항목이다.
 * `currentLive`가 없거나 목록에 없으면 가장 최근 SUCCEEDED 빌드로 돌아간다.
 */
export function pickRollbackTarget(
  builds: Build[],
  repo: Pick<StageRepo, 'id' | 'owner' | 'repo' | 'surface' | 'spaceId'>,
  currentLive: string | undefined,
): Build | null {
  const ok = builds
    .filter((b) => buildMatchesRepo(b, repo) && b.status === 'SUCCEEDED')
    .sort((a, b) => (a.requestedAt < b.requestedAt ? 1 : -1))
  if (!currentLive) return ok[0] ?? null
  const idx = ok.findIndex((b) => b.id === currentLive)
  if (idx === -1) return ok[0] ?? null
  return ok[idx + 1] ?? null
}

/**
 * 인자로 명시한 빌드(`bstage rollback <buildId>`)가 존재하고, SUCCEEDED이며, 이 레포 것인지 확인한다.
 * 캐시된 목록(`builds`)에 없으면 `getBuild`로 직접 조회한다 — 404면 원본 API 에러 텍스트를
 * 그대로 흘리지 않고 다른 사전조건 실패와 같은 스타일의 PRECONDITION으로 감싼다.
 */
async function resolveExplicitTarget(
  ctx: PortalContext,
  builds: Build[],
  repo: StageRepo,
  buildId: string,
): Promise<Build> {
  const { organizationId: org, spaceId: space } = ctx.link
  let target = builds.find((b) => b.id === buildId)
  if (!target) {
    try {
      target = await ctx.client.getBuild(org, space, buildId)
    } catch (err) {
      if (err instanceof PortalError && err.status === 404) {
        fail(
          ExitCode.PRECONDITION,
          `빌드 ${buildId} 를 찾을 수 없습니다. bstage list 로 최근 빌드를 확인하세요.`,
        )
      }
      throw err
    }
  }
  if (target.status !== 'SUCCEEDED' || !buildMatchesRepo(target, repo)) {
    fail(ExitCode.PRECONDITION, `빌드 ${buildId} 는 이 레포의 성공한 빌드가 아닙니다.`)
  }
  return target
}

/** 배치별 되돌릴 대상. 없으면 안내와 함께 PRECONDITION. */
function pickOrFail(
  builds: Build[],
  repo: StageRepo,
  currentLive: string | undefined,
  label: string,
): Build {
  const target = pickRollbackTarget(builds, repo, currentLive)
  if (!target) fail(ExitCode.PRECONDITION, `${label}: 되돌릴 이전 성공 빌드가 없습니다.`)
  return target
}

/** 배치마다 되돌릴 대상 빌드를 정해 계획을 세운다. `buildId`가 있으면 전 배치가 같은 빌드를 쓴다. */
async function buildRollbackPlan(
  ctx: PortalContext,
  placements: Placement[],
  builds: Build[],
  repo: StageRepo,
  buildId: string | undefined,
): Promise<RollbackPlanRow[]> {
  const sharedTarget = buildId ? await resolveExplicitTarget(ctx, builds, repo, buildId) : undefined
  return placements.map((pl) => {
    const target = sharedTarget ?? pickOrFail(builds, repo, pl.liveBuildId, placementLabel(pl))
    return {
      placement: pl,
      label: placementLabel(pl),
      from: pl.liveBuildId || undefined,
      to: target.id,
      unchanged: pl.liveBuildId === target.id,
      targetCommit: target.commitSha,
    }
  })
}

/** 확인 계획표. "현재"·"→ 되돌릴 빌드"는 커밋으로 보여준다(deploy와 같은 방식). */
function renderConfirmTable(changing: RollbackPlanRow[]): string {
  const header = `빌드 ${changing[0].to} (커밋 ${shortSha(changing[0].targetCommit)})`
  const rows = table([
    ['자리', '현재', '→ 되돌릴 빌드'],
    ...changing.map((r) => [r.label, shortSha(r.placement.liveCommit), shortSha(r.targetCommit)]),
  ])
  return `${header}\n${rows}`
}

/** --yes면 통과, 아니면 계획표를 보여주고 물어본다. 거절 시 PRECONDITION. */
async function confirmRollback(
  changing: RollbackPlanRow[],
  out: (s: string) => void,
  deps: RollbackDeps,
): Promise<void> {
  out(renderConfirmTable(changing))
  const ok = await askConfirm(deps, `${changing.length}개 배치를 되돌립니다. 진행할까요?`)
  if (!ok) fail(ExitCode.PRECONDITION, '취소했습니다.')
}

/**
 * `bstage rollback [buildId]` — 이 레포의 배치를 골라, 지정한 빌드(생략 시 배치별 직전 성공
 * 빌드)로 라이브를 되돌린다. `deploy`와 달리 새 빌드를 만들지 않고 git 사전점검도 하지 않는다
 * — 이미 성공한 과거 산출물을 그대로 다시 얹을 뿐이다.
 *
 * 적용은 `deploy`와 같은 CAS(compare-and-swap) 규칙을 공유한다(`applyPlacements`) — 다른
 * 사람이 그사이 먼저 배포했다면 409로 그 배치만 conflict로 남기고 나머지는 계속 진행한다.
 *
 * `--json`은 stdout에 JSON 객체 하나만 써야 하므로 확인 프롬프트와 조합할 수 없다 —
 * `--yes` 없이 `--json`을 주면 아무 것도 하지 않고 바로 끝낸다.
 */
export async function rollbackCommand(
  buildId: string | undefined,
  options: RollbackOptions,
  deps: RollbackDeps = {},
): Promise<void> {
  if (options.json && !options.yes) {
    fail(ExitCode.PRECONDITION, '--json 은 --yes 와 함께 쓰세요.')
  }
  if (!options.yes) assertCanConfirm(deps) // deploy와 같은 자리에서 같은 규칙으로 막는다

  const out = deps.out ?? console.log
  const ctx = await resolveContext({ cwd: deps.cwd, env: deps.env, fetch: deps.fetch })
  const { organizationId: org, spaceId: space } = ctx.link

  const [placements, builds, repo] = await Promise.all([
    fetchTargets(ctx, options.placement),
    ctx.client.listBuilds(org, space, 50),
    resolveLinkedRepo(ctx),
  ])
  const plan = await buildRollbackPlan(ctx, placements, builds, repo, buildId)

  const changing = plan.filter((r) => !r.unchanged)
  if (changing.length === 0) {
    fail(ExitCode.PRECONDITION, '이미 해당 빌드가 라이브입니다.')
  }

  if (!options.yes) await confirmRollback(changing, out, deps)

  // 계획 전체를 넘긴다 — 이미 대상 빌드인 배치는 applyPlacements가 쓰지 않고 unchanged로 보고한다.
  const results = await applyPlacements(ctx, plan)
  reportOutcome(results, options, out)
  if (!options.json) {
    out(
      pc.dim('  되돌린 뒤에도 최신 빌드는 남아 있습니다 — bstage deploy 로 다시 올릴 수 있습니다.'),
    )
  }
}
