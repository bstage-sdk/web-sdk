import { PortalError } from '../../portal/client.js'
import { loadLink } from '../../portal/config.js'
import { CliExit, ExitCode, scrub } from '../../portal/output.js'
import { resolveContext, type PortalContext } from '../../portal/resolveContext.js'
import { requireTargets, selectPlacements } from '../../portal/selectPlacements.js'
import type { DiagnosisFinding, Placement, Surface } from '../../portal/types.js'

/**
 * `bstage doctor`의 포털 진단 — 로컬 검사로는 보이지 않는 "배포는 됐는데 왜 안 뜨나"를
 * 포털이 배치마다 판정한 결과(`GET .../placements/{id}/diagnosis`)로 보여 준다.
 *
 * 로그인·링크가 없으면 실패하지 않고 건너뛴다(doctor는 로컬 진단이 본업이다). 단 `--placement`로
 * 대상을 명시했으면 배포 명령과 같은 종료 코드(2 링크 없음, 3 인증)로 끝낸다.
 */

/** 한 번에 진단하는 배치 상한. 넘는 배치는 `omitted`로 개수만 알린다. */
export const MAX_DIAGNOSED_PLACEMENTS = 30
/** 동시에 보내는 진단 요청 수. */
export const DIAGNOSIS_CONCURRENCY = 4

/**
 * 포털 진단 전체의 결말.
 * - `ok`: 진단을 받았다(문제가 있어도 ok — 문제는 findings가 말한다)
 * - `skipped`: 로그인·링크가 없어 시도하지 않았다(`hint`가 할 일)
 * - `unsupported`: 포털 서버가 아직 진단 경로를 모른다
 * - `error`: 목록 조회나 일부 배치 진단이 실패했다(`reason` 또는 배치별 `error`)
 */
export type PortalStatus = 'ok' | 'skipped' | 'unsupported' | 'error'

export interface PortalPlacementResult {
  placementId: string
  path: string
  slotId: string
  surface: Surface
  findings: DiagnosisFinding[]
  /** 이 배치의 진단 요청이 실패했을 때만 있다. 그때 `findings`는 빈 배열이다. */
  error?: string
}

export interface PortalReport {
  status: PortalStatus
  reason?: string
  /** 사용자가 다음에 실행할 명령(예: `bstage login`). */
  hint?: string
  placements: PortalPlacementResult[]
  /** 상한(`MAX_DIAGNOSED_PLACEMENTS`)에 걸려 진단하지 않은 배치 수. 없으면 키가 없다. */
  omitted?: number
}

export interface PortalDiagnoseOptions {
  /** `--placement <id|path|slotId>` — deploy와 같은 정확 일치. */
  placement?: string
}

export interface PortalDiagnoseDeps {
  cwd?: string
  env?: NodeJS.ProcessEnv
  fetch?: typeof fetch
}

/** 포털 진단에 error 심각도 항목이 하나라도 있는가. */
export function portalHasErrorFinding(p: PortalReport | undefined): boolean {
  return (p?.placements ?? []).some((row) => row.findings.some((f) => f.severity === 'error'))
}

/**
 * 포털 진단이 사용자 작업을 요구하는가 — error 항목이 있거나 진단 자체가 실패했다(목록 조회
 * 실패, 일부 배치의 권한 부족·5xx 등). doctor 종료 코드 1의 기준이다. 진단을 못 끝낸 것을
 * 0으로 끝내면 CI·에이전트가 "문제 없음"으로 읽는다. 건너뜀(로그인·링크 없음)과 서버 미지원은
 * 진단 대상이 아니라 0이다.
 */
export function portalNeedsWork(p: PortalReport | undefined): boolean {
  return p !== undefined && (p.status === 'error' || portalHasErrorFinding(p))
}

export async function diagnosePortal(
  opts: PortalDiagnoseOptions,
  deps: PortalDiagnoseDeps = {},
): Promise<PortalReport> {
  const explicit = Boolean(opts.placement)
  const ctx = await openContext(deps, explicit)
  if (!('client' in ctx)) return ctx

  const { client, link } = ctx
  let all: Placement[]
  try {
    all = await client.listPlacements(link.organizationId, link.spaceId, link.surface)
  } catch (err) {
    return {
      status: 'error',
      reason: `배치 목록을 가져오지 못했습니다 — ${describeError(err)}`,
      placements: [],
    }
  }

  const targets = explicit
    ? requireTargets(all, link.repoId, opts.placement)
    : selectPlacements(all, link.repoId)
  if (targets.length === 0) {
    return {
      status: 'ok',
      reason: '이 레포에 연결된 배치가 없습니다.',
      hint: 'bstage placement create --template <산출물 이름>',
      placements: [],
    }
  }

  const picked = targets.slice(0, MAX_DIAGNOSED_PLACEMENTS)
  const omitted = targets.length - picked.length
  const outcomes = await mapLimit(picked, DIAGNOSIS_CONCURRENCY, (p) => diagnoseOne(ctx, p))

  // 진단 경로를 하나도 못 찾았으면 서버가 진단을 모르는 것이다. 일부만 404면(목록과 진단 사이에
  // 배치가 지워진 경합 등) 서버 문제가 아니라 그 배치의 실패로 남긴다.
  if (outcomes.every((o) => o.unsupported)) {
    return {
      status: 'unsupported',
      reason: '콘솔 서버가 아직 배치 진단을 지원하지 않습니다.',
      placements: [],
    }
  }
  const placements = outcomes.map((o) => o.row)
  return {
    status: placements.some((r) => r.error !== undefined) ? 'error' : 'ok',
    placements,
    ...(omitted > 0 ? { omitted } : {}),
  }
}

/**
 * 링크·토큰을 푼다. 실패하면 건너뜀 리포트를 돌려준다(`--placement`를 줬으면 그대로 던진다).
 * 링크 유무를 먼저 보는 이유: resolveContext는 링크 없음과 포털 주소 문제를 같은 코드(2)로 끝내
 * 안내(`bstage link`)를 고를 근거가 메시지뿐이다.
 */
async function openContext(
  deps: PortalDiagnoseDeps,
  explicit: boolean,
): Promise<PortalContext | PortalReport> {
  const cwd = deps.cwd ?? process.cwd()
  const env = deps.env ?? process.env
  const hasLink = (await loadLink(cwd, env)) !== null
  try {
    return await resolveContext({ cwd, env, fetch: deps.fetch })
  } catch (err) {
    if (explicit) throw err
    const reason = scrub(err instanceof Error ? err.message : String(err))
    const isAuth = err instanceof CliExit && err.code === ExitCode.AUTH
    const hint = isAuth ? 'bstage login' : hasLink ? undefined : 'bstage link'
    return { status: 'skipped', reason, ...(hint ? { hint } : {}), placements: [] }
  }
}

interface Outcome {
  row: PortalPlacementResult
  /** 진단 경로 자체가 없다는 응답(구버전 서버). */
  unsupported: boolean
}

async function diagnoseOne(ctx: PortalContext, p: Placement): Promise<Outcome> {
  const base = {
    placementId: p.id,
    path: p.path ?? '',
    slotId: p.slotId ?? '',
    surface: p.surface,
  }
  try {
    const d = await ctx.client.getPlacementDiagnosis(
      ctx.link.organizationId,
      ctx.link.spaceId,
      p.id,
    )
    return {
      row: {
        ...base,
        path: d.path || base.path,
        slotId: d.slotId || base.slotId,
        surface: d.surface ?? base.surface,
        findings: d.findings,
      },
      unsupported: false,
    }
  } catch (err) {
    return {
      row: { ...base, findings: [], error: describeError(err) },
      unsupported: isUnsupported(err),
    }
  }
}

/** 진단 경로가 있는 서버가 배치를 못 찾았을 때 내는 문구. 경로가 없는 404와 가른다. */
const PLACEMENT_NOT_FOUND = '배치를 찾을 수 없습니다'

/**
 * 구버전 서버의 신호. 404는 경로 없음(배치가 사라진 404는 서버 문구로 가른다), 403은 CLI 토큰 등급
 * 허용 목록에 이 경로가 없을 때 서버가 내는 문구일 때만이다 — 권한 부족 403은 사용자가 알아야
 * 하는 실패라 지원 안 함으로 덮지 않는다.
 */
function isUnsupported(err: unknown): boolean {
  if (!(err instanceof PortalError)) return false
  if (err.status === 404) return !err.message.includes(PLACEMENT_NOT_FOUND)
  return err.status === 403 && err.message.includes('토큰 등급으로 허용되지 않는')
}

/** 사용자에게 보일 짧은 실패 이유. 토큰 모양은 가린다. */
function describeError(err: unknown): string {
  if (err instanceof PortalError && err.status > 0) {
    return scrub(`${err.message} (HTTP ${err.status})`)
  }
  return scrub(err instanceof Error ? err.message : String(err))
}

/** 순서를 지키며 동시에 `limit`개까지만 `fn`을 돌린다. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}
