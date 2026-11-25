import pc from 'picocolors'
import { PortalError } from './client.js'
import { cleanText, scrub } from './sanitize.js'

export { cleanLines, cleanText, labelList, scrub, stripInvisible } from './sanitize.js'

/**
 * CLI 종료코드 규약. `bstage <command>`가 스크립트에서 호출된다는 전제이므로
 * 실패 원인별로 코드를 분리한다 — 예: 인증 실패(3)와 사전조건 미충족(2)을 구분해야
 * CI 스크립트가 "로그인부터 다시" vs "bstage link부터" 를 분기할 수 있다.
 */
export const ExitCode = {
  OK: 0,
  FAILURE: 1,
  PRECONDITION: 2,
  AUTH: 3,
  CONFLICT: 4,
  RATE_LIMIT: 5,
} as const

/** 명령이 스스로 끝내고 싶을 때 던진다. runCommand가 받아 코드로 종료한다. */
export class CliExit extends Error {
  constructor(
    public readonly code: number,
    message: string,
  ) {
    super(message)
    this.name = 'CliExit'
  }
}

export function fail(code: number, message: string): never {
  throw new CliExit(code, message)
}

/** PortalError 상태 → 종료코드. CliExit은 자기 코드를 그대로, 그 외는 실패(1)로 뭉갠다. */
export function exitCodeFor(err: unknown): number {
  if (err instanceof CliExit) return err.code
  if (err instanceof PortalError) {
    if (err.status === 401 || err.status === 403) return ExitCode.AUTH
    if (err.status === 409) return ExitCode.CONFLICT
    if (err.status === 429) return ExitCode.RATE_LIMIT
  }
  return ExitCode.FAILURE
}

/**
 * `--json` 출력 전용. 이것만 stdout에 쓴다 — 사람이 읽는 안내문은 항상 stderr로 보내
 * `bstage ... --json | jq` 같은 파이프에서 잡음이 섞이지 않게 한다.
 */
export function printJson(v: unknown): void {
  process.stdout.write(JSON.stringify(v, null, 2) + '\n')
}

/** deploy·rollback·publish가 공유하는 `--json` 요약의 항목 하나. */
export interface SummaryEntry {
  id: string
  label: string
  from?: string
  to?: string
  message?: string
}

/** 항목의 결말. 세 명령이 같은 낱말을 쓴다 — 스크립트가 명령별로 분기하지 않아도 된다. */
export type SummaryStatus = 'changed' | 'unchanged' | 'conflict' | 'failed'

export interface SummaryItem extends SummaryEntry {
  status: SummaryStatus
}

function toEntry(i: SummaryItem): SummaryEntry {
  // undefined 필드는 JSON.stringify가 지운다 — 해당 없는 명령(publish의 from/to)은 키가 안 나온다.
  return { id: i.id, label: i.label, from: i.from, to: i.to, message: i.message }
}

/**
 * `{ ...extra, changed[], unchanged[], conflicts[], failed[] }` — deploy·rollback·publish의
 * `--json` 단일 계약. 네 배열은 비어 있어도 항상 넣는다(소비자가 키 존재로 분기하지 않게).
 */
export function jsonSummary(
  items: SummaryItem[],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const pick = (status: SummaryStatus): SummaryEntry[] =>
    items.filter((i) => i.status === status).map(toEntry)
  return {
    ...extra,
    changed: pick('changed'),
    unchanged: pick('unchanged'),
    conflicts: pick('conflict'),
    failed: pick('failed'),
  }
}

/**
 * 열 폭을 맞춘 텍스트 표. 마지막 열은 패딩하지 않는다(줄 끝 공백 방지).
 * 칸은 서버가 준 값이 섞이므로 기본으로 cleanText 한다 — CR·이스케이프로 앞줄을 덮거나 열을 어긋나게 해 확인표를
 * 꾸미지 못하게(AWS Security Agent 7차 L). 로컬 값만 담고 색을 입힌 표(whoami)는 `{ clean: false }`.
 */
export function table(rows: string[][], opts: { clean?: boolean } = {}): string {
  const clean = opts.clean ?? true
  const cells = clean ? rows.map((row) => row.map((cell) => cleanText(cell, 300))) : rows
  const widths: number[] = []
  for (const row of cells) {
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i] ?? 0, cell.length)
    })
  }
  return cells
    .map((row) =>
      row.map((cell, i) => (i === row.length - 1 ? cell : cell.padEnd(widths[i]))).join('  '),
    )
    .join('\n')
}

/** 빌드 id 로 받아들이는 모양 — 영숫자·`_`·`-`·`.` 1~64자(hex·UUID·ULID 모두 포함). 제어 문자·공백·경로 문자는 거부한다. */
export function isSafeBuildId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(id)
}

/** 커밋 SHA를 7자로 줄인다. 없으면 대시로 표시한다. 서버 값이라 보이지 않는 문자를 먼저 지운다. */
export function shortSha(sha?: string): string {
  return (sha ? cleanText(sha).slice(0, 7) : '') || '-'
}

/**
 * 서버가 준 버전 번호 — 양의 정수만(AWS Security Agent 7차 L). `"\r12"` 처럼 숫자로 바뀌는 문자열·소수·음수는
 * 버리고 커밋 SHA(없으면 `-`)로 돌아간다.
 */
function sourceVersion(b: { sourceVersionNo?: unknown }): number | null {
  const n = b.sourceVersionNo
  return typeof n === 'number' && Number.isSafeInteger(n) && n > 0 ? n : null
}

/** 빌드의 소스 표시 — 내장 저장소 빌드는 `v12`(버전 번호), GitHub 빌드는 커밋 SHA 7자. */
export function buildSourceRef(b: { commitSha?: string; sourceVersionNo?: number }): string {
  const n = sourceVersion(b)
  return cleanText(n !== null ? `v${n}` : shortSha(b.commitSha))
}

/** `버전 v12` 또는 `커밋 abc1234` — 빌드 머리글용. */
export function buildSourceLabel(b: { commitSha?: string; sourceVersionNo?: number }): string {
  const n = sourceVersion(b)
  return cleanText(n !== null ? `버전 v${n}` : `커밋 ${shortSha(b.commitSha)}`)
}

/**
 * 명령 실행 래퍼. 성공 시 아무것도 하지 않고, 실패 시 규약대로 종료코드를 매핑해
 * `process.exit`한다 — 각 명령이 직접 try/catch·exit 코드를 반복해 적지 않게 한다.
 */
export async function runCommand(fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
  } catch (err) {
    const code = exitCodeFor(err)
    const message = err instanceof Error ? err.message : String(err)
    console.error(pc.red(`[bstage] ${scrub(message)}`))
    if (code === ExitCode.AUTH) {
      console.error(
        pc.dim(
          '  bstage login으로 토큰을 다시 등록하거나, 토큰 등급·스테이지 스코프를 확인하세요.',
        ),
      )
    }
    process.exit(code)
  }
}
