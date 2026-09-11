import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { ExitCode, fail } from './output.js'

const execFileP = promisify(execFile)

/** git 서브커맨드 실행, stdout 반환. 테스트에서는 실제 git 대신 이 시그니처를 주입한다. */
export type Exec = (args: string[]) => Promise<string>

export interface GitState {
  branch: string
  head: string
  dirty: boolean
  upstream: string | null
  ahead: number
  behind: number
}

/** 실제 git 바이너리를 execFile로 호출하는 Exec 구현. 셸을 거치지 않는다. */
export function gitExec(cwd: string): Exec {
  return async (args) => (await execFileP('git', args, { cwd })).stdout
}

async function tryExec(exec: Exec, args: string[]): Promise<string | null> {
  try {
    return (await exec(args)).trim()
  } catch {
    return null
  }
}

/**
 * 포털은 GitHub 기본 브랜치 HEAD를 clone해 빌드한다. 로컬이 그 HEAD와 다르면
 * "배포했는데 안 바뀐다"가 기본 경험이 되므로, deploy 전에 상태를 읽어 둔다.
 */
export async function readGitState(exec: Exec): Promise<GitState> {
  const branch = (await exec(['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
  const head = (await exec(['rev-parse', 'HEAD'])).trim()
  const dirty = (await exec(['status', '--porcelain'])).trim().length > 0
  const upstream = await tryExec(exec, [
    'rev-parse',
    '--abbrev-ref',
    '--symbolic-full-name',
    '@{u}',
  ])
  let ahead = 0
  let behind = 0
  if (upstream) {
    const counts = await tryExec(exec, ['rev-list', '--left-right', '--count', 'HEAD...@{u}'])
    const [a, b] = (counts ?? '0\t0').split(/\s+/).map((n) => parseInt(n, 10) || 0)
    ahead = a
    behind = b
  }
  return { branch, head, dirty, upstream, ahead, behind }
}

/**
 * deploy 사전점검. 셋 중 하나라도 걸리면 CliExit(PRECONDITION)으로 종료한다.
 * 더티 트리 → 커밋 안내, 브랜치 불일치 → 기본 브랜치 안내, push 안 됨(업스트림 없음 포함) → push 안내.
 */
export function assertDeployable(state: GitState, defaultBranch: string): void {
  if (state.dirty) {
    fail(
      ExitCode.PRECONDITION,
      '커밋되지 않은 변경이 있습니다. 포털은 push된 커밋만 빌드합니다 — 커밋·push 후 다시 실행하세요. (--skip-git-check 로 무시 가능)',
    )
  }
  if (state.branch !== defaultBranch) {
    fail(
      ExitCode.PRECONDITION,
      `포털은 ${defaultBranch} 브랜치 HEAD를 빌드합니다. 현재 브랜치는 ${state.branch} 입니다 — ${defaultBranch} 에 머지·push 후 다시 실행하세요.`,
    )
  }
  if (!state.upstream || state.ahead > 0) {
    fail(
      ExitCode.PRECONDITION,
      'push되지 않은 커밋이 있습니다. git push 후 다시 실행하세요. (--skip-git-check 로 무시 가능)',
    )
  }
}
