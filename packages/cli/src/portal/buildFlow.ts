import pc from 'picocolors'
import { assertDeployable, gitExec, readGitState, type Exec, type GitState } from './git.js'
import { ExitCode, fail, shortSha } from './output.js'
import type { PortalContext } from './resolveContext.js'
import type { Build } from './types.js'
import { waitForBuild } from './waitBuild.js'

/**
 * 포털 빌드를 시작하고 기다리는 공통 단계 — `deploy`와 `placement create`가 함께 쓴다.
 * 두 명령이 같은 사전점검·같은 실패 문구를 내야 "왜 이 명령만 다르게 멈추지"가 없다.
 */
export interface BuildFlowDeps {
  cwd?: string
  exec?: Exec
  sleep?: (ms: number) => Promise<void>
}

/** 링크된 레포의 기본 브랜치. 포털에서 레포를 못 찾으면(재연결 필요) PRECONDITION. */
export async function repoDefaultBranch(ctx: PortalContext): Promise<string> {
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
export async function precheckGit(deps: BuildFlowDeps, defaultBranch: string): Promise<void> {
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
export async function createAndAnnounceBuild(
  ctx: PortalContext,
  json: boolean | undefined,
): Promise<Build> {
  const created = await ctx.client.createBuild(
    ctx.link.organizationId,
    ctx.link.spaceId,
    ctx.link.repoId,
  )
  if (!json) {
    console.error(pc.dim(`[bstage] 빌드 ${created.id} 시작 (${shortSha(created.commitSha)})`))
  }
  return created
}

/** 빌드가 끝날 때까지 기다린다. 실패·타임아웃·취소면 FAILURE로 끝낸다(배치는 건드리지 않는다). */
export async function waitForCompletedBuild(
  ctx: PortalContext,
  deps: BuildFlowDeps,
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
