import { ExitCode, fail } from './output.js'
import type { PortalContext } from './resolveContext.js'
import { placementLabel, type Placement } from './types.js'

/**
 * 이 레포(`stageRepoId === repoId`)에 묶인 배치 중 `filter`에 맞는 것만 고른다.
 * `filter`가 없으면 전부, 있으면 id·path·slotId 중 하나와 정확히 일치하는 배치만.
 */
export function selectPlacements(all: Placement[], repoId: string, filter?: string): Placement[] {
  const mine = all.filter((p) => p.stageRepoId === repoId)
  if (!filter) return mine
  return mine.filter((p) => p.id === filter || p.path === filter || p.slotId === filter)
}

export interface PlanRow {
  placement: Placement
  label: string
  from?: string
  to: string
  unchanged: boolean
}

/** 각 배치가 지금(from) 어떤 빌드를 물고 있고 이번에 어떤 빌드(to)로 넘어가는지 계획한다. */
export function applyPlan(placements: Placement[], buildId: string): PlanRow[] {
  return placements.map((p) => ({
    placement: p,
    label: placementLabel(p),
    from: p.liveBuildId || undefined,
    to: buildId,
    unchanged: p.liveBuildId === buildId,
  }))
}

/**
 * 대상 배치. 0개면 PRECONDITION으로 끝낸다 — 필터 유무로 안내가 갈리고, `buildIdHint`가
 * 있으면(빌드를 이미 만든 뒤 다시 고르는 deploy) 그 빌드가 남아 있다는 것도 함께 알린다.
 */
export function requireTargets(
  all: Placement[],
  repoId: string,
  filter?: string,
  buildIdHint?: string,
): Placement[] {
  const mine = selectPlacements(all, repoId, filter)
  if (mine.length > 0) return mine
  const base = filter
    ? `배치 '${filter}' 을(를) 찾을 수 없습니다. bstage list 로 확인하세요.`
    : '이 레포에 연결된 배치가 없습니다. 포털 > 스테이지 > 페이지에서 배치를 먼저 만드세요.'
  const hint = buildIdHint
    ? ` 빌드 ${buildIdHint} 는 남아 있으니 배치를 확인한 뒤 다시 실행해 적용할 수 있습니다.`
    : ''
  return fail(ExitCode.PRECONDITION, base + hint)
}

/** 포털에서 이 스테이지의 배치를 받아 `requireTargets`를 적용한다 — 세 명령의 공통 진입점. */
export async function fetchTargets(
  ctx: PortalContext,
  filter?: string,
  buildIdHint?: string,
): Promise<Placement[]> {
  const all = await ctx.client.listPlacements(
    ctx.link.organizationId,
    ctx.link.spaceId,
    ctx.link.surface,
  )
  return requireTargets(all, ctx.link.repoId, filter, buildIdHint)
}
