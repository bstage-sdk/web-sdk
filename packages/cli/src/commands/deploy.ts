import pc from 'picocolors'
import { applyPlacements, reportOutcome } from '../portal/applyPlacements.js'
import { askConfirm, assertCanConfirm, type ConfirmDeps } from '../portal/confirm.js'
import { createAndAnnounceBuild, precheckGit, waitForCompletedBuild } from '../portal/buildFlow.js'
import { assertBuiltinLinked, resolveLinkedRepo } from '../portal/buildRepo.js'
import { hasPath, loadBuiltinState } from '../portal/builtinState.js'
import type { Exec } from '../portal/git.js'
import { scanSource } from '../portal/sourceManifest.js'
import { pushSource } from './push.js'
import {
  ExitCode,
  buildSourceLabel,
  buildSourceRef,
  cleanText,
  fail,
  jsonSummary,
  printJson,
  shortSha,
  table,
} from '../portal/output.js'
import { detectProjectKind } from '../project/detectKind.js'
import { blobFetch } from '../portal/blobTransfer.js'
import { resolveContext } from '../portal/resolveContext.js'
import { applyPlan, fetchTargets, type PlanRow } from '../portal/selectPlacements.js'
import { placementLabel, type Build, type Placement } from '../portal/types.js'

export interface DeployOptions {
  yes?: boolean
  json?: boolean
  placement?: string
  skipGitCheck?: boolean
  noWait?: boolean
  /** 내장 저장소: 빌드 전에 먼저 올린다. */
  push?: boolean
}

export interface DeployDeps extends ConfirmDeps {
  cwd?: string
  env?: NodeJS.ProcessEnv
  fetch?: typeof fetch
  exec?: Exec
  out?: (s: string) => void
  sleep?: (ms: number) => Promise<void>
}

/**
 * liquid 레포는 SLOT 배치에 쓸 수 없다 — 포털이 liquid 산출물의 SLOT 배치를 400으로 막는다.
 * 빌드를 만들기 전에 여기서 끊어, 기다린 끝에 400을 보는 일이 없게 한다.
 */
function assertNoSlotPlacement(targets: Placement[]): void {
  const slots = targets.filter((p) => p.kind === 'SLOT')
  if (slots.length === 0) return
  fail(
    ExitCode.PRECONDITION,
    `liquid 레포는 페이지(PAGE)에만 쓸 수 있습니다. 위젯 자리: ${slots
      .map(placementLabel)
      .join(', ')}. --placement로 페이지만 고르거나, 콘솔에서 이 레포의 위젯(슬롯)을 정리하세요.`,
  )
}

/** 내장 저장소: 마지막으로 올리거나 받은 기준과 다른(바뀌었거나 지워진) 로컬 파일 수. 알 수 없으면 null. */
async function countUnpushed(cwd: string, repoId: string): Promise<number | null> {
  const saved = await loadBuiltinState(cwd, repoId)
  if (!saved) return null
  const scan = await scanSource(cwd)
  const now = new Map(scan.files.map((f) => [f.path, f.sha256]))
  let n = 0
  for (const [path, sha] of now) {
    if (!hasPath(saved.files, path) || saved.files[path] !== sha) n++
  }
  for (const path of Object.keys(saved.files)) if (!now.has(path)) n++
  return n
}

/** `--no-wait` 경로 출력. 빌드 상태 조회 없이 즉시 끝난다. */
function reportNoWait(build: Build, options: DeployOptions, out: (s: string) => void): void {
  if (options.json) {
    printJson(jsonSummary([], { build }))
    return
  }
  out(
    `빌드 ${cleanText(build.id, 80)}를 시작했습니다. bstage logs ${cleanText(build.id, 80)} --follow로 진행 상황을 확인하세요.`,
  )
}

/** 확인 계획표. "현재"는 배치의 라이브 커밋, "→ 적용"은 이번 빌드의 커밋(전 배치 동일). */
function renderPlanTable(plan: PlanRow[], build: Build): string {
  const header = `빌드 ${cleanText(build.id, 80)} (${buildSourceLabel(build)})`
  const rows = table([
    ['자리', '현재', '→ 업데이트'],
    ...plan.map((row) => {
      const to = buildSourceRef(build) + (row.unchanged ? ' (변경 없음)' : '')
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
    `${plan.length}개 페이지·위젯을 빌드 ${cleanText(build.id, 80)}로 업데이트합니다. 진행할까요?`,
  )
  if (!ok) {
    fail(
      ExitCode.PRECONDITION,
      '취소했습니다. 빌드는 남아 있으니 필요하면 다시 실행해 업데이트하세요.',
    )
  }
}

/**
 * `bstage deploy` — git 사전점검(내장 저장소는 `--push` 로 올리기) → 빌드 → 완료 대기(로그 tail) → 이 레포의 배치를 골라 확인 후
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
    fail(ExitCode.PRECONDITION, '--json은 --yes와 함께 쓰세요.')
  }
  if (!options.yes) assertCanConfirm(deps) // 빌드를 만들기 전에 확인 가능 여부부터 본다

  // 레포 종류는 네트워크를 타기 전에 본다 — liquid 전용 레포의 SLOT 사전점검과 안내문에 쓴다.
  // mixed(sdk + liquid)는 지원되는 상태다: 빌더가 sdk를 빌드한 뒤 liquid를 함께 패키징하고
  // 포털이 산출물 항목마다 kind를 따로 보므로, 여기서 막지 않는다.
  const report = detectProjectKind(deps.cwd ?? process.cwd())
  const kind = report.kind

  const out = deps.out ?? console.log
  const ctx = await resolveContext({ cwd: deps.cwd, env: deps.env, fetch: deps.fetch })
  // 없을 때 문구는 내장 저장소 이전 deploy 와 똑같이(레포 id 포함) 둔다.
  const repo = await resolveLinkedRepo(
    ctx,
    `연결된 레포 ${ctx.link.repoId}를 콘솔에서 찾을 수 없습니다. bstage link를 다시 실행하세요.`,
  )
  // 분기 기준은 서버가 준 source 다. 없거나 github 면 아래 git 경로가 그대로다.
  if (repo.source === 'builtin') {
    // 서버 값만 믿지 않는다 — 링크 파일도 같은 레포를 builtin 으로 적었을 때만 올리거나 git 점검을 건너뛴다(Ruling 26).
    assertBuiltinLinked(ctx, repo)
    const cwd = deps.cwd ?? process.cwd()
    // `--json` 은 stdout 에 JSON 하나만 나가야 하므로 안내는 stderr 로 보낸다.
    const log = options.json ? (s: string) => console.error(s) : out
    if (options.push) {
      await pushSource(ctx, repo, cwd, { fromDeploy: true }, deps.fetch ?? blobFetch, log)
    } else {
      let n: number | null = null
      try {
        n = await countUnpushed(cwd, repo.id)
      } catch {
        /* 경고용 비교라 실패해도 배포를 막지 않는다 */
      }
      if (n === null) {
        log(
          pc.yellow(
            '[bstage] 이 폴더에서 받거나 올린 기록이 없어 올리지 않은 변경을 셀 수 없습니다. 최신 코드를 반영하려면 bstage push 후 배포하거나 --push 를 붙이세요.',
          ),
        )
      } else if (n > 0) {
        log(
          pc.yellow(
            `[bstage] 올리지 않은 변경 ${n}개가 있습니다 — 이 변경은 빌드에 들어가지 않습니다. bstage push 후 배포하거나 --push 를 붙이세요.`,
          ),
        )
      }
    }
  } else {
    if (options.push) {
      fail(
        ExitCode.PRECONDITION,
        '--push 는 내장 저장소 전용입니다. GitHub 레포는 git push 로 올리세요.',
      )
    }
    if (!options.skipGitCheck) await precheckGit(deps, repo.defaultBranch)
  }

  const targets = await fetchTargets(ctx, options.placement) // 0개면 빌드를 만들기 전에 여기서 끝난다
  if (kind === 'liquid') {
    // liquid 전용 레포만 미리 끊는다 — 혼합 레포의 SLOT 배치는 sdk 위젯일 수 있어 항목별 판정을
    // 포털에 맡긴다(liquid 항목에 SLOT을 걸면 포털이 그 항목만 400으로 막는다).
    assertNoSlotPlacement(targets)
  }
  // `--json`은 stdout에 JSON 객체 하나만 나가야 하므로 안내를 내지 않는다.
  if (!options.json && kind === 'liquid') {
    out(
      pc.dim(
        '[bstage] liquid 레포 — 로컬 빌드 없이 콘솔이 push된 커밋의 public/{user|admin}/을 그대로 패키징합니다.',
      ),
    )
  }
  if (!options.json && kind === 'mixed') {
    out(
      pc.dim(
        `[bstage] 혼합 레포 — sdk 템플릿은 콘솔이 빌드하고, liquid 템플릿 ${report.liquidTemplates.length}개는 ` +
          'push된 커밋의 public/{user|admin}/을 그대로 패키징합니다.',
      ),
    )
  }

  const created = await createAndAnnounceBuild(ctx, options.json)
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
