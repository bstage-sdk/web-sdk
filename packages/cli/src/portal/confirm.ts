import * as p from '@clack/prompts'
import { ExitCode, fail } from './output.js'

export interface ConfirmDeps {
  confirm?: (message: string) => Promise<boolean>
  /** 확인 프롬프트가 stdin을 읽을 수 있는지. 테스트 주입용 — 생략 시 실제 `process.stdin.isTTY`. */
  isTTY?: () => boolean
}

const clackConfirm = async (message: string): Promise<boolean> => {
  const v = await p.confirm({ message })
  return !p.isCancel(v) && v === true
}

/**
 * `deps.confirm`이 있으면 그것을 쓴다(테스트 주입). 없으면 stdin이 TTY일 때만 clack 프롬프트를
 * 띄우고, 그 외(파이프·CI 등 비대화형인데 주입도 없는 경우)는 멈추지 않고 즉시 PRECONDITION.
 *
 * `deploy`·`rollback`이 함께 쓴다 — 확인 없이 라이브를 바꾸는 명령은 항상 같은 규칙을 따라야
 * "왜 이 명령만 다르게 멈추지" 하는 혼란이 생기지 않는다.
 */
export async function askConfirm(deps: ConfirmDeps, message: string): Promise<boolean> {
  if (deps.confirm) return deps.confirm(message)
  assertCanConfirm(deps)
  return clackConfirm(message)
}

/** 확인을 물을 수 있는가 — 주입된 confirm이 있으면 항상, 없으면 stdin이 TTY일 때만. */
export function canConfirm(deps: ConfirmDeps): boolean {
  if (deps.confirm) return true
  return (deps.isTTY ?? (() => Boolean(process.stdin.isTTY)))()
}

/**
 * 확인이 필요한데 물을 수 없으면 즉시 PRECONDITION. 빌드 생성 같은 부수효과 **앞**에서
 * 부른다 — 나중에 물어보면 이미 만들어진 것을 두고 멈추게 된다.
 */
export function assertCanConfirm(deps: ConfirmDeps): void {
  if (canConfirm(deps)) return
  fail(
    ExitCode.PRECONDITION,
    '터미널이 아니라 확인을 물을 수 없습니다. --yes 로 확인을 건너뛰세요.',
  )
}
