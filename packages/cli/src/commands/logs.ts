import pc from 'picocolors'
import { buildMatchesRepo, resolveLinkedRepo } from '../portal/buildRepo.js'
import type { PortalClient } from '../portal/client.js'
import { ExitCode, fail, printJson } from '../portal/output.js'
import { resolveContext, type PortalContext } from '../portal/resolveContext.js'
import { TERMINAL_STATUSES, type Build } from '../portal/types.js'
import { waitForBuild } from '../portal/waitBuild.js'

export interface LogsOptions {
  follow?: boolean
  json?: boolean
}

export interface LogsDeps {
  cwd?: string
  env?: NodeJS.ProcessEnv
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  /** 로그 본문 출력. 기본은 stdout에 그대로 쓴다(줄바꿈은 호출자가 맞춘다). */
  out?: (s: string) => void
}

/** 사람이 읽는 빌드 상태 한 줄. follow·비-follow 두 경로가 공유한다. */
function statusLine(build: Build): string {
  return `[bstage] 빌드 ${build.id} · ${build.status}${build.failureReason ? ` · ${build.failureReason}` : ''}`
}

/** buildId 생략 시 이 레포의 가장 최근 빌드. 없으면 PRECONDITION. */
async function latestBuildId(ctx: PortalContext): Promise<string> {
  const { organizationId: org, spaceId: space } = ctx.link
  const repo = await resolveLinkedRepo(ctx)
  const latest = (await ctx.client.listBuilds(org, space, 20)).find((b) =>
    buildMatchesRepo(b, repo),
  )
  if (!latest) fail(ExitCode.PRECONDITION, '이 레포의 빌드 이력이 없습니다.')
  return latest.id
}

/**
 * follow 중 흘려보낼 로그 델타의 목적지.
 * `--json`이면 stdout은 JSON 객체 하나만 담아야 하므로 델타는 stderr로 보낸다.
 */
function logSink(json: boolean | undefined): (delta: string) => void {
  return json
    ? (delta) => void process.stderr.write(pc.dim(delta))
    : (delta) => void process.stdout.write(delta)
}

/**
 * `bstage logs [buildId]` — 빌드 로그를 본다. `--follow`면 터미널 상태가 될 때까지 이어서
 * 흘린다(진행 중인 빌드에 한해).
 *
 * `--json`은 follow 여부와 관계없이 stdout에 `{build, log}` 객체 **하나만** 쓴다 — follow
 * 중 흘러가는 델타는 stderr로 보내고, 끝난 뒤 전체 로그를 한 번 더 받아 담는다. 그래야
 * `bstage logs -f --json | jq` 가 깨지지 않는다.
 */
export async function logsCommand(
  buildId: string | undefined,
  options: LogsOptions,
  deps: LogsDeps = {},
): Promise<void> {
  const out = deps.out ?? ((s: string) => void process.stdout.write(s))
  const ctx = await resolveContext({ cwd: deps.cwd, env: deps.env, fetch: deps.fetch })
  const { organizationId: org, spaceId: space } = ctx.link
  const id = buildId ?? (await latestBuildId(ctx))

  const initial = await ctx.client.getBuild(org, space, id)
  const following = Boolean(options.follow) && !TERMINAL_STATUSES.has(initial.status)
  const build = following
    ? await waitForBuild(ctx.client, org, space, id, {
        sleep: deps.sleep,
        onLog: logSink(options.json),
      })
    : initial

  await report(ctx.client, org, space, id, build, options, out, following)

  // follow 완료 빌드는 항상 터미널이고, 비-follow는 아직 진행 중일 수 있다(그때는 0 유지).
  if (TERMINAL_STATUSES.has(build.status) && build.status !== 'SUCCEEDED') {
    process.exitCode = ExitCode.FAILURE
  }
}

/** 출력 한 곳 — JSON이면 객체 하나, 아니면 로그 본문(비-follow)과 상태 줄(stderr). */
async function report(
  client: PortalClient,
  org: string,
  space: string,
  id: string,
  build: Build,
  options: LogsOptions,
  out: (s: string) => void,
  following: boolean,
): Promise<void> {
  if (options.json) {
    printJson({ build, log: await client.getBuildLog(org, space, id) })
    return
  }
  if (following) {
    console.error(pc.dim(`\n${statusLine(build)}`))
    return
  }
  const log = await client.getBuildLog(org, space, id)
  out(log.endsWith('\n') ? log : log + '\n')
  console.error(pc.dim(statusLine(build)))
}
