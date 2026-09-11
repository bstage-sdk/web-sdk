import pc from 'picocolors'
import { PortalError } from '../portal/client.js'
import { askConfirm, assertCanConfirm, type ConfirmDeps } from '../portal/confirm.js'
import { ExitCode, fail, jsonSummary, printJson, type SummaryStatus } from '../portal/output.js'
import { resolveContext, type PortalContext } from '../portal/resolveContext.js'
import { fetchTargets } from '../portal/selectPlacements.js'
import { placementLabel, type Placement } from '../portal/types.js'

export interface PublishOptions {
  placement?: string
  yes?: boolean
  json?: boolean
}

export interface PublishDeps extends ConfirmDeps {
  cwd?: string
  env?: NodeJS.ProcessEnv
  fetch?: typeof fetch
  out?: (s: string) => void
}

interface PublishResult {
  id: string
  label: string
  enabled: boolean
  /** deploy·rollback과 같은 낱말 — `--json` 요약 키가 세 명령에서 같아야 한다. */
  status: SummaryStatus
  message?: string
}

/** `state`가 `on`/`off`(대소문자 무관) 외의 값이면 PRECONDITION. */
export function parseOnOff(v: string): boolean {
  const s = v.toLowerCase()
  if (s === 'on') return true
  if (s === 'off') return false
  return fail(ExitCode.PRECONDITION, `publish 인자는 on 또는 off 여야 합니다 (받은 값: ${v})`)
}

/** 배치의 현재 게시 상태. 포털은 nil을 "게시 중"으로 읽는다 — undefined도 true로 취급한다. */
function isPublished(p: Placement): boolean {
  return p.enabled !== false
}

/**
 * --yes면 통과, 아니면 항상 물어본다. `--placement`로 하나만 특정해도 예외를 두지 않는다 —
 * 라이브에 보이는 것을 바꾸는 명령은 deploy·rollback과 같은 규칙이어야 한다. 거절 시 PRECONDITION.
 */
async function confirmToggle(
  toChange: Placement[],
  enabled: boolean,
  options: PublishOptions,
  deps: PublishDeps,
): Promise<void> {
  if (options.yes) return
  const names = toChange.map(placementLabel).join(', ')
  const ok = await askConfirm(deps, `${names} 게시를 ${enabled ? '켭니다' : '끕니다'}. 진행할까요?`)
  if (!ok) fail(ExitCode.PRECONDITION, '취소했습니다.')
}

/** 배치 하나를 목표 상태로 맞춘다. 이미 그 상태면 패치하지 않는다(멱등). */
async function togglePlacement(
  ctx: PortalContext,
  p: Placement,
  enabled: boolean,
): Promise<PublishResult> {
  const base = { id: p.id, label: placementLabel(p) }
  if (isPublished(p) === enabled) {
    return { ...base, enabled, status: 'unchanged', message: '변경 없음' }
  }
  try {
    const { organizationId: org, spaceId: space } = ctx.link
    const updated = await ctx.client.setPlacementEnabled(org, space, p.id, enabled)
    return { ...base, enabled: updated.enabled !== false, status: 'changed' }
  } catch (err) {
    if (err instanceof PortalError && err.status === 409) {
      return { ...base, enabled: isPublished(p), status: 'conflict', message: err.message }
    }
    return {
      ...base,
      enabled: isPublished(p),
      status: 'failed',
      message: err instanceof Error ? err.message : String(err),
    }
  }
}

function printResults(results: PublishResult[], enabled: boolean, out: (s: string) => void): void {
  for (const r of results) {
    const mark =
      r.status === 'failed' ? pc.red('✗') : r.status === 'conflict' ? pc.yellow('!') : pc.green('✓')
    const stateLabel = r.status === 'unchanged' ? '변경 없음' : `게시 ${r.enabled ? 'on' : 'off'}`
    const suffix = r.message && r.status !== 'unchanged' ? pc.dim(`  ${r.message}`) : ''
    out(`${mark} ${r.label}  ${stateLabel}${suffix}`)
  }
  if (!enabled) {
    out(pc.dim('  라이브 버전 포인터는 유지됩니다 — 다시 켜면 같은 빌드가 즉시 서빙됩니다.'))
  }
}

/**
 * 결과를 출력하고 규약대로 종료코드를 매긴다(deploy·rollback과 동일 규약).
 * conflict가 하나라도 있으면 CAS 신호를 먼저 알려야 하므로 error보다 우선한다.
 */
function reportOutcome(
  results: PublishResult[],
  options: PublishOptions,
  enabled: boolean,
  out: (s: string) => void,
): void {
  if (options.json) printJson(jsonSummary(results))
  else printResults(results, enabled, out)

  const conflicts = results.filter((r) => r.status === 'conflict')
  const errors = results.filter((r) => r.status === 'failed')
  if (conflicts.length > 0) {
    fail(
      ExitCode.CONFLICT,
      `다른 변경이 먼저 적용된 배치가 있습니다: ${conflicts.map((r) => r.label).join(', ')}. ` +
        'bstage list 로 확인하고 다시 실행하세요.',
    )
  }
  if (errors.length > 0) {
    fail(
      ExitCode.FAILURE,
      `일부 배치 적용에 실패했습니다: ${errors.map((r) => r.label).join(', ')}`,
    )
  }
}

/**
 * `bstage publish on|off` — 이 레포의 배치(들)에 게시(`enabled`) 토글을 적용한다.
 * `--placement` 없이 실행하면 이 레포에 연결된 배치 전부가 대상이다.
 *
 * `deploy`가 라이브 빌드를 바꾸는 것과 달리, publish는 라이브 버전 포인터를 그대로 두고
 * 사용자에게 보이는지만 바꾼다 — 꺼도 빌드는 남아 다시 켜면 즉시 서빙된다.
 *
 * 이미 목표 상태인 배치는 패치하지 않고 "변경 없음"으로만 보고한다(멱등) — 여러 배치를
 * 한 번에 다룰 때 이미 맞는 배치까지 매번 PATCH를 보내면 불필요한 쓰기가 반복된다.
 *
 * `--json`은 stdout에 JSON 객체 하나만 써야 하므로 확인 프롬프트와 조합할 수 없다 —
 * `--yes` 없이 `--json`을 주면 아무 것도 하지 않고 바로 끝낸다.
 */
export async function publishCommand(
  state: string,
  options: PublishOptions,
  deps: PublishDeps = {},
): Promise<void> {
  if (options.json && !options.yes) {
    fail(ExitCode.PRECONDITION, '--json 은 --yes 와 함께 쓰세요.')
  }
  const enabled = parseOnOff(state) // 인자 오타는 TTY 여부보다 먼저 알려준다
  if (!options.yes) assertCanConfirm(deps) // deploy·rollback과 같은 자리에서 같은 규칙으로 막는다
  const out = deps.out ?? console.log
  const ctx = await resolveContext({ cwd: deps.cwd, env: deps.env, fetch: deps.fetch })

  const targets = await fetchTargets(ctx, options.placement)
  const toChange = targets.filter((p) => isPublished(p) !== enabled)
  if (toChange.length > 0) await confirmToggle(toChange, enabled, options, deps)

  const results: PublishResult[] = []
  for (const p of targets) {
    results.push(await togglePlacement(ctx, p, enabled))
  }
  reportOutcome(results, options, enabled, out)
}
