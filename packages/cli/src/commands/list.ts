import pc from 'picocolors'
import { buildMatchesRepo, resolveLinkedRepo } from '../portal/buildRepo.js'
import { printJson, shortSha, table } from '../portal/output.js'
import { resolveContext } from '../portal/resolveContext.js'
import { placementLabel, type Build, type Placement, type StageRepo } from '../portal/types.js'

export interface ListOptions {
  json?: boolean
  /** 표시할 최근 빌드 개수. 기본 5. */
  builds?: string
}

interface ListDeps {
  cwd?: string
  env?: NodeJS.ProcessEnv
  fetch?: typeof fetch
  out?: (s: string) => void
}

/**
 * 이 레포의 배치 상태 + 최근 빌드 N개를 사람이 읽는 텍스트로 그린다.
 * 순수 함수 — 네트워크·콘솔 I/O 없이 테스트한다.
 *
 * 배치는 `stageRepoId`로, 빌드는 `buildMatchesRepo`로 거른다 — 빌드 API 응답에는
 * `stageRepoId`가 없어 owner/repo로 매칭해야 하기 때문이다.
 */
export function renderList(
  placements: Placement[],
  builds: Build[],
  repo: Pick<StageRepo, 'id' | 'owner' | 'repo' | 'surface' | 'spaceId'>,
): string {
  const mine = placements.filter((p) => p.stageRepoId === repo.id)
  const lines: string[] = []
  lines.push(pc.bold('배치'))
  if (mine.length === 0) {
    lines.push(
      pc.yellow(
        '  이 레포에 연결된 배치가 없습니다. 포털 > 스테이지 > 페이지에서 배치를 먼저 만드세요.',
      ),
    )
  } else {
    lines.push(
      table([
        ['종류', '자리', '상태', '라이브 커밋', '게시'],
        ...mine.map((p) => [
          p.kind,
          placementLabel(p),
          p.status,
          shortSha(p.liveCommit),
          p.enabled === false ? 'off' : 'on',
        ]),
      ]),
    )
  }

  lines.push('')
  lines.push(pc.bold('최근 빌드'))
  const recent = builds.filter((b) => buildMatchesRepo(b, repo))
  lines.push(
    recent.length === 0
      ? pc.dim('  빌드 이력이 없습니다.')
      : table([
          ['빌드', '상태', '커밋', '요청 시각'],
          ...recent.map((b) => [b.id, b.status, shortSha(b.commitSha), b.requestedAt]),
        ]),
  )
  return lines.join('\n')
}

/** 이 레포의 배치(라이브 버전·게시 상태)와 최근 빌드를 조회해 출력한다. */
export async function listCommand(options: ListOptions, deps: ListDeps = {}): Promise<void> {
  const out = deps.out ?? console.log
  const { client, link } = await resolveContext({
    cwd: deps.cwd,
    env: deps.env,
    fetch: deps.fetch,
  })
  const limit = parseInt(options.builds ?? '5', 10) || 5
  const [placements, builds, repo] = await Promise.all([
    client.listPlacements(link.organizationId, link.spaceId, link.surface),
    client.listBuilds(link.organizationId, link.spaceId, limit),
    resolveLinkedRepo({ client, link }),
  ])
  const mine = placements.filter((p) => p.stageRepoId === repo.id)
  const myBuilds = builds.filter((b) => buildMatchesRepo(b, repo))

  if (options.json) {
    printJson({ link, placements: mine, builds: myBuilds })
    return
  }
  out(pc.dim(`${link.organizationId} / ${link.spaceId} [${link.surface}]`))
  out(renderList(placements, builds, repo))
}
