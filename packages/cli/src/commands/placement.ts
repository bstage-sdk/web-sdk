import pc from 'picocolors'
import { buildMatchesRepo, resolveLinkedRepo } from '../portal/buildRepo.js'
import {
  createAndAnnounceBuild,
  precheckGit,
  waitForCompletedBuild,
  type BuildFlowDeps,
} from '../portal/buildFlow.js'
import { PortalError } from '../portal/client.js'
import { askConfirm, assertCanConfirm, type ConfirmDeps } from '../portal/confirm.js'
import { ExitCode, fail, jsonSummary, printJson, shortSha } from '../portal/output.js'
import {
  derivedPagePath,
  findPathOwner,
  normalizePagePath,
  pageArtifactNames,
  resolvePageArtifact,
  type BuildArtifact,
} from '../portal/pagePlacement.js'
import { resolveContext, type PortalContext } from '../portal/resolveContext.js'
import { placementLabel, type Build, type Placement, type StageRepo } from '../portal/types.js'

export interface PlacementCreateOptions {
  /** 빌드 산출물 이름 — sdk는 `src/pages/{이름}`, liquid는 `public/{surface}/{이름}`. */
  template?: string
  /** 페이지 경로. 없으면 포털이 산출물 이름에서 파생한다(`/{이름}`). */
  path?: string
  /** 성공 빌드가 있어도 push된 기본 브랜치 HEAD로 새로 빌드한다. */
  build?: boolean
  skipGitCheck?: boolean
  yes?: boolean
  json?: boolean
}

export interface PlacementCreateDeps extends ConfirmDeps, BuildFlowDeps {
  env?: NodeJS.ProcessEnv
  fetch?: typeof fetch
  out?: (s: string) => void
}

/** 최근 빌드를 몇 개까지 훑어 성공 빌드를 찾을지. deploy·list가 쓰는 목록 API의 기본값과 같다. */
const RECENT_BUILDS = 20

/** 이 레포의 가장 최근 SUCCEEDED 빌드. 목록은 요청 시각 역순이 보장되지 않으니 직접 정렬한다. */
function latestSucceeded(builds: Build[], repo: StageRepo): Build | undefined {
  return builds
    .filter((b) => b.status === 'SUCCEEDED' && buildMatchesRepo(b, repo))
    .sort((a, b) => (a.requestedAt < b.requestedAt ? 1 : -1))[0]
}

interface Resolved {
  build: Build
  artifact: BuildArtifact
}

/** 빌드가 필요한 이유 — 사람이 읽는 안내 한 줄(stderr). */
function buildReason(latest: Build | undefined, options: PlacementCreateOptions): string {
  if (options.build) return '--build 지정 — push된 기본 브랜치 HEAD로 새로 빌드합니다.'
  if (!latest)
    return '이 레포의 성공한 빌드가 없어 먼저 빌드합니다(포털은 레포 연결만으로 빌드하지 않습니다).'
  return `최신 성공 빌드 ${latest.id} 에 '${options.template}' 페이지가 없어 push된 HEAD로 다시 빌드합니다.`
}

/**
 * `--template`을 담은 성공 빌드를 확보한다. 최신 성공 빌드에 그 산출물이 있으면 그대로 쓰고,
 * 없으면(성공 빌드 0개 — 레포만 연결된 상태, 새 페이지를 막 push, 산출물 목록이 없는 옛 빌드)
 * 빌드를 시작해 끝날 때까지 기다린다. 포털 CreatePlacement는 최신 SUCCEEDED 빌드의 산출물로
 * 검증하므로, 여기서 확보한 빌드가 곧 포털이 볼 빌드다.
 */
async function ensureBuildWithArtifact(
  ctx: PortalContext,
  repo: StageRepo,
  template: string,
  options: PlacementCreateOptions,
  deps: PlacementCreateDeps,
): Promise<Resolved> {
  const { organizationId: org, spaceId: space, surface } = ctx.link
  const latest = options.build
    ? undefined
    : latestSucceeded(await ctx.client.listBuilds(org, space, RECENT_BUILDS), repo)
  const found = latest && resolvePageArtifact(latest, template, surface)
  if (latest && found) return { build: latest, artifact: found }

  if (!options.json) console.error(pc.dim(`[bstage] ${buildReason(latest, options)}`))
  if (!options.skipGitCheck) await precheckGit(deps, repo.defaultBranch)
  const created = await createAndAnnounceBuild(ctx, options.json)
  const done = await waitForCompletedBuild(ctx, deps, created, options.json)
  const artifact = resolvePageArtifact(done, template, surface)
  if (!artifact) {
    const names = pageArtifactNames(done, surface)
    fail(
      ExitCode.PRECONDITION,
      `빌드 ${done.id} 의 산출물에 '${template}' 페이지가 없습니다. ` +
        `--template 에 쓸 수 있는 값: ${names.length > 0 ? names.join(', ') : '(없음)'}. ` +
        'sdk는 src/pages/{이름}/template.tsx, liquid는 public/{user|admin}/{이름}/ 을 커밋·push했는지 확인하세요.',
    )
  }
  return { build: done, artifact }
}

function nextCommand(path: string): string {
  return `bstage deploy --placement ${path}`
}

/**
 * 같은 경로에 배치가 이미 있을 때. 이 레포·같은 산출물이면 만든 것으로 보고 성공(멱등) —
 * 에이전트가 같은 명령을 다시 돌려도 중복이 생기지 않는다. 다른 레포·산출물이면 CONFLICT.
 */
function reportExisting(
  owner: Placement,
  resolved: Resolved,
  repoId: string,
  options: PlacementCreateOptions,
  out: (s: string) => void,
): void {
  const label = placementLabel(owner)
  if (owner.stageRepoId === repoId && owner.artifact === resolved.artifact.name) {
    if (options.json) {
      printJson(
        jsonSummary([{ id: owner.id, label, status: 'unchanged' }], {
          placement: owner,
          build: { id: resolved.build.id, commitSha: resolved.build.commitSha },
          next: nextCommand(label),
        }),
      )
      return
    }
    out(
      `${pc.green('✓')} ${label} 에 이 레포의 '${resolved.artifact.name}' 배치가 이미 있습니다 (${owner.id}).`,
    )
    out(pc.dim(`  다음: ${nextCommand(label)}`))
    return
  }
  const who = `배치 ${owner.id}, 산출물 ${owner.artifact ?? '-'}${owner.stageRepoId === repoId ? '' : ', 다른 레포'}`
  if (options.json) {
    printJson(
      jsonSummary([{ id: owner.id, label, status: 'conflict', message: who }], {
        placement: owner,
      }),
    )
  }
  fail(
    ExitCode.CONFLICT,
    `경로 ${label} 에는 이미 다른 배치가 있습니다 (${who}). 다른 --path 를 쓰거나 포털에서 기존 배치를 정리하세요.`,
  )
}

/**
 * 빌드 전에 거는 경로 충돌 검사. `--path`(없으면 `/{--template}`)를 다른 레포가 쓰고 있거나,
 * 같은 레포의 다른 산출물이 쓰고 있으면 빌드를 기다리기 전에 CONFLICT로 끝낸다. 산출물 이름이
 * 아직 확정되지 않았으므로(liquid는 `user/{이름}`) 두 모양을 모두 같은 산출물로 본다. 확정 후
 * 검사(`reportExisting`)가 다시 한 번 판정한다 — 여기는 헛빌드를 줄이는 조기 차단일 뿐이다.
 */
function assertPathNotTakenEarly(
  placements: Placement[],
  earlyPath: string,
  template: string,
  ctx: PortalContext,
  options: PlacementCreateOptions,
): void {
  const owner = findPathOwner(placements, earlyPath)
  if (!owner) return
  const sameArtifact =
    owner.artifact === template ||
    owner.artifact === `${ctx.link.surface.toLowerCase()}/${template}`
  if (owner.stageRepoId === ctx.link.repoId && (owner.artifact === undefined || sameArtifact)) {
    return
  }
  const label = placementLabel(owner)
  const who = `배치 ${owner.id}, 산출물 ${owner.artifact ?? '-'}${owner.stageRepoId === ctx.link.repoId ? '' : ', 다른 레포'}`
  if (options.json) {
    printJson(
      jsonSummary([{ id: owner.id, label, status: 'conflict', message: who }], {
        placement: owner,
      }),
    )
  }
  fail(
    ExitCode.CONFLICT,
    `경로 ${label} 에는 이미 다른 배치가 있습니다 (${who}). 다른 --path 를 쓰거나 포털에서 기존 배치를 정리하세요.`,
  )
}

/**
 * 포털 오류를 다음 행동이 보이는 문구·종료코드로 바꾼다. 그 밖의 오류는 그대로 올린다.
 * `--json`이면 로컬에서 잡은 충돌과 같은 모양의 요약을 stdout에 먼저 낸다 — 에이전트가
 * 충돌을 어디서 잡았는지와 무관하게 같은 JSON을 읽게 한다.
 */
function explainCreateError(err: unknown, label: string, options: PlacementCreateOptions): never {
  if (!(err instanceof PortalError)) throw err
  if (options.json) {
    const status = err.status === 409 ? 'conflict' : 'failed'
    printJson(jsonSummary([{ id: '', label, status, message: err.message }]))
  }
  if (err.status === 409) {
    fail(
      ExitCode.CONFLICT,
      `같은 대상의 배치가 이미 있습니다: ${err.message}. bstage list 로 확인하세요.`,
    )
  }
  if (err.status === 403) {
    fail(
      ExitCode.AUTH,
      `배치를 만들 권한이 없습니다: ${err.message}. 배치 생성에는 deploy 등급 CLI 토큰과 ` +
        '스테이지 관리자 이상 권한이 필요합니다 — bstage login 으로 deploy 등급 토큰을 받으세요. ' +
        '포털이 CLI 배치 생성을 아직 지원하지 않는 버전이면 포털 화면(스테이지 > 페이지 > 새 페이지)에서 만드세요.',
    )
  }
  if (err.status === 400) {
    const hint = err.message.includes('빌드') ? ' --build 로 다시 빌드한 뒤 실행하세요.' : ''
    fail(ExitCode.PRECONDITION, `배치를 만들 수 없습니다: ${err.message}.${hint}`)
  }
  throw err
}

function reportCreated(
  created: Placement,
  resolved: Resolved,
  options: PlacementCreateOptions,
  out: (s: string) => void,
): void {
  const label = placementLabel(created)
  if (options.json) {
    printJson(
      jsonSummary([{ id: created.id, label, status: 'changed' }], {
        placement: created,
        build: { id: resolved.build.id, commitSha: resolved.build.commitSha },
        next: nextCommand(label),
      }),
    )
    return
  }
  out(
    `${pc.green('✓')} 배치를 만들었습니다: ${label} ← ${resolved.artifact.name} ` +
      `(${created.id}, 빌드 ${resolved.build.id} · ${shortSha(resolved.build.commitSha)})`,
  )
  out(pc.dim(`  아직 라이브가 아닙니다. 다음: ${nextCommand(label)}`))
}

/**
 * `bstage placement create` — 이 레포의 빌드 산출물 하나를 페이지(PAGE) 배치로 만든다.
 * 조직·스테이지·레포·surface는 `.bstage/project.json`(또는 BSTAGE_* 환경변수)을 따른다.
 *
 * 흐름: 입력 검증 → 산출물을 담은 성공 빌드 확보(없으면 빌드·대기) → 같은 경로의 기존 배치
 * 확인(같은 레포·산출물이면 멱등 성공, 다르면 CONFLICT) → 확인 → `POST .../placements`.
 * 만든 배치는 라이브가 아니다 — `bstage deploy`로 적용해야 서빙된다.
 *
 * 위젯(SLOT) 배치와 배치 삭제는 하지 않는다 — 슬롯 자리 선택과 삭제는 포털 화면 전용이다.
 * `--json`은 확인 프롬프트와 조합할 수 없어 `--yes`가 필요하고, 확인을 물을 수 없는 환경인지는
 * 빌드를 만들기 **전에** 판정한다(deploy와 같은 규칙).
 */
export async function placementCreateCommand(
  options: PlacementCreateOptions,
  deps: PlacementCreateDeps = {},
): Promise<void> {
  if (options.json && !options.yes) {
    fail(ExitCode.PRECONDITION, '--json 은 --yes 와 함께 쓰세요.')
  }
  const template = options.template?.trim()
  if (!template) {
    fail(
      ExitCode.PRECONDITION,
      '--template <산출물 이름> 이 필요합니다 (sdk: src/pages/{이름}, liquid: public/{user|admin}/{이름}).',
    )
  }
  const path = options.path !== undefined ? normalizePagePath(options.path) : undefined
  if (!options.yes) assertCanConfirm(deps)
  const out = deps.out ?? console.log

  const ctx = await resolveContext({ cwd: deps.cwd, env: deps.env, fetch: deps.fetch })
  const { organizationId: org, spaceId: space, surface, repoId } = ctx.link
  const repo = await resolveLinkedRepo(ctx)
  const before = await ctx.client.listPlacements(org, space, surface)
  assertPathNotTakenEarly(before, path ?? '/' + template, template, ctx, options)
  const resolved = await ensureBuildWithArtifact(ctx, repo, template, options, deps)

  const targetPath = path ?? derivedPagePath(resolved.artifact)
  const placements = await ctx.client.listPlacements(org, space, surface)
  const owner = findPathOwner(placements, targetPath)
  if (owner) {
    reportExisting(owner, resolved, repoId, options, out)
    return
  }

  if (!options.yes) {
    const ok = await askConfirm(
      deps,
      `${org} / ${space} [${surface}] 의 ${targetPath} 에 '${resolved.artifact.name}' 페이지 배치를 만듭니다. 진행할까요?`,
    )
    if (!ok) fail(ExitCode.PRECONDITION, '취소했습니다.')
  }

  let created: Placement
  try {
    created = await ctx.client.createPlacement(org, space, {
      kind: 'PAGE',
      surface,
      repoId,
      artifact: resolved.artifact.name,
      ...(path !== undefined ? { path } : {}),
    })
  } catch (err) {
    explainCreateError(err, targetPath, options)
  }
  reportCreated(created, resolved, options, out)
}
