import pc from 'picocolors'
import { PortalError } from './client.js'
import { ExitCode, fail, jsonSummary, printJson, shortSha, type SummaryItem } from './output.js'
import type { PortalContext } from './resolveContext.js'
import type { PlanRow } from './selectPlacements.js'
import type { Placement } from './types.js'

/** `deploy`·`rollback`이 공유하는 배치 1건의 CAS 적용 결과. */
export interface ApplyResult extends SummaryItem {
  to: string
}

/** enabled===false인 배치는 배포해도 사용자에게 보이지 않는다 — deploy/rollback은 배포만, 게시는 publish의 몫이다. */
function publishHint(placement: Placement): string | undefined {
  return placement.enabled === false
    ? '게시 꺼짐 — bstage publish 로 게시해야 사용자에게 보입니다.'
    : undefined
}

/**
 * 배치마다 CAS(compare-and-swap) 배포를 시도한다. 409는 그 배치만 conflict로 남기고
 * 나머지는 계속 진행한다 — 조용히 재시도하지 않는다.
 *
 * 이미 그 빌드가 라이브인 배치(`row.unchanged`)는 쓰지 않고 `unchanged`로만 보고한다 —
 * 같은 값을 다시 CAS로 써도 바뀌는 게 없다(멱등, publish와 같은 규칙).
 */
export async function applyPlacements(ctx: PortalContext, plan: PlanRow[]): Promise<ApplyResult[]> {
  const { organizationId: org, spaceId: space } = ctx.link
  const results: ApplyResult[] = []
  for (const row of plan) {
    const base = { id: row.placement.id, label: row.label, from: row.from, to: row.to }
    if (row.unchanged) {
      results.push({ ...base, status: 'unchanged', message: '변경 없음' })
      continue
    }
    try {
      await ctx.client.deployPlacement(org, space, row.placement.id, row.to, row.from ?? '')
      results.push({ ...base, status: 'changed', message: publishHint(row.placement) })
    } catch (err) {
      results.push({ ...base, ...failureOf(err) })
    }
  }
  return results
}

/** 409는 CAS 충돌, 그 외는 실패. 둘 다 그 배치 하나만 표시하고 나머지는 계속 간다. */
function failureOf(err: unknown): Pick<ApplyResult, 'status' | 'message'> {
  if (err instanceof PortalError && err.status === 409) {
    return {
      status: 'conflict',
      message: `다른 배포가 먼저 적용됐습니다(${err.message}) — 라이브 상태가 바뀌었습니다.`,
    }
  }
  return { status: 'failed', message: err instanceof Error ? err.message : String(err) }
}

const MARKS: Record<ApplyResult['status'], string> = {
  changed: pc.green('✓'),
  unchanged: pc.dim('='),
  conflict: pc.yellow('!'),
  failed: pc.red('✗'),
}

function printResults(results: ApplyResult[], out: (s: string) => void): void {
  for (const r of results) {
    const suffix = r.message ? pc.dim(`  ${r.message}`) : ''
    out(`${MARKS[r.status]} ${r.label}  ${shortSha(r.from)} → ${shortSha(r.to)}${suffix}`)
  }
}

/**
 * 결과를 출력하고 규약대로 종료코드를 매긴다. conflict는 CAS 신호를 먼저 알려야 하므로
 * error보다 우선한다. `extra`는 JSON 출력에 덧붙일 필드다(예: deploy의 `build` — rollback은
 * 배치마다 되돌리는 빌드가 다를 수 있어 전체를 대표하는 단일 build가 없으므로 생략한다).
 */
export function reportOutcome(
  results: ApplyResult[],
  options: { json?: boolean },
  out: (s: string) => void,
  extra: Record<string, unknown> = {},
): void {
  if (options.json) printJson(jsonSummary(results, extra))
  else printResults(results, out)

  const conflicts = results.filter((r) => r.status === 'conflict')
  const errors = results.filter((r) => r.status === 'failed')
  if (conflicts.length > 0) {
    const names = conflicts.map((r) => r.label).join(', ')
    const errSuffix =
      errors.length > 0 ? ` (그 외 실패: ${errors.map((r) => r.label).join(', ')})` : ''
    fail(
      ExitCode.CONFLICT,
      `다른 배포가 먼저 적용된 배치가 있습니다: ${names}.${errSuffix} bstage list 로 확인하고 다시 실행하세요.`,
    )
  }
  if (errors.length > 0) {
    fail(
      ExitCode.FAILURE,
      `일부 배치 적용에 실패했습니다: ${errors.map((r) => r.label).join(', ')}`,
    )
  }
}
