import { ExitCode, fail } from './output.js'
import type { PortalContext } from './resolveContext.js'
import type { Build, StageRepo } from './types.js'

/**
 * 빌드가 연결된 레포 소속인지 판정한다.
 *
 * API 빌드 응답(`GET .../builds`)에는 `stageRepoId`가 없다 — `owner`/`repo`만 온다.
 * 판정 규칙(agent #336 MEDIUM 반영):
 *  - 빌드에 `stageRepoId`가 있으면 **그 값과의 일치만** 인정한다(다르면 owner/repo 폴백 없이 거부).
 *  - 없으면 owner(대소문자 무시)/repo가 같고 **surface와 spaceId도 정확히 같아야** 한다(fail-closed —
 *    빌드에 surface·spaceId가 없으면 매칭 실패). API 빌드 응답에는 surface가 항상 있고 spaceId는
 *    PortalClient가 조회 스테이지로 새겨 준다. 같은 GitHub 레포가 USER/ADMIN 두 surface나 두
 *    스테이지에 연결된 경우 다른 쪽 빌드를 이 레포의 배치에 적용하지 않기 위해서다.
 */
export function buildMatchesRepo(
  b: Build,
  repo: Pick<StageRepo, 'id' | 'owner' | 'repo' | 'surface' | 'spaceId'>,
): boolean {
  if (b.stageRepoId) return b.stageRepoId === repo.id
  if (!b.owner || !b.repo) return false
  // GitHub 의 owner·repo 이름은 대소문자를 구분하지 않는다 — 둘 다 소문자로 비교(agent #337 LOW)
  if (b.owner.toLowerCase() !== repo.owner.toLowerCase()) return false
  if (b.repo.toLowerCase() !== repo.repo.toLowerCase()) return false
  if (!b.surface || b.surface !== repo.surface) return false
  if (!b.spaceId || b.spaceId !== repo.spaceId) return false
  return true
}

/**
 * 링크 파일(`ctx.link.repoId`)이 가리키는 StageRepo를 포털에서 조회한다.
 * 링크 이후 포털에서 레포 연결이 지워졌다면 재연결을 안내하고 끝낸다.
 */
export async function resolveLinkedRepo(ctx: PortalContext): Promise<StageRepo> {
  const repos = await ctx.client.listRepos(ctx.link.organizationId, ctx.link.spaceId)
  const repo = repos.find((r) => r.id === ctx.link.repoId)
  if (!repo) {
    fail(
      ExitCode.PRECONDITION,
      '연결된 레포를 스테이지에서 찾을 수 없습니다. bstage link 를 다시 실행하세요.',
    )
  }
  return repo
}
