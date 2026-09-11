import pc from 'picocolors'
import type { PortalClient } from './client.js'
import { ExitCode, fail } from './output.js'
import { TERMINAL_STATUSES, type Build } from './types.js'

export interface WaitOptions {
  intervalMs?: number
  timeoutMs?: number
  onLog?: (delta: string) => void
  sleep?: (ms: number) => Promise<void>
}

const DEFAULT_INTERVAL = 3000
/** 포털 빌드 Job의 activeDeadlineSeconds(900)보다 넉넉하게. */
const DEFAULT_TIMEOUT = 20 * 60 * 1000

/**
 * 빌드가 터미널 상태(SUCCEEDED·FAILED·TIMED_OUT·CANCELED)가 될 때까지 폴링한다.
 *
 * `onLog`가 있으면 매 폴링마다 로그를 받아 이전에 흘려보낸 길이 이후의 부분만 전달한다.
 * 서버가 이전보다 짧은 로그를 돌려주면(빌드 재시작) 처음부터 다시 흘리고 그 사실을 알린다.
 * 타임아웃을 넘기면 빌드 id를 담은 메시지와 함께 `CliExit(FAILURE)`를 던진다.
 */
export async function waitForBuild(
  client: PortalClient,
  org: string,
  space: string,
  buildId: string,
  o: WaitOptions = {},
): Promise<Build> {
  const interval = o.intervalMs ?? DEFAULT_INTERVAL
  const timeout = o.timeoutMs ?? DEFAULT_TIMEOUT
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const started = Date.now()
  let seen = 0
  let logFailing = false

  const flushLog = async (): Promise<void> => {
    if (!o.onLog) return
    let log: string
    try {
      log = await client.getBuildLog(org, space, buildId)
    } catch {
      // 일시적 조회 실패를 빈 로그로 취급하면 길이가 줄어든 것처럼 보여 재시작으로
      // 오판한다 — seen을 건드리지 않고 이번 폴링만 건너뛴다. 연속 실패는 1회만 알린다.
      if (!logFailing) {
        console.error(pc.dim('[bstage] 로그 조회 실패, 다음 폴링에서 재시도합니다.'))
        logFailing = true
      }
      return
    }
    logFailing = false
    if (log.length < seen) {
      o.onLog('\n[bstage] 로그가 재시작된 것으로 보입니다 — 처음부터 다시 출력합니다.\n')
      seen = 0
    }
    if (log.length > seen) {
      o.onLog(log.slice(seen))
      seen = log.length
    }
  }

  for (;;) {
    const build = await client.getBuild(org, space, buildId)
    await flushLog()
    if (TERMINAL_STATUSES.has(build.status)) return build
    if (Date.now() - started > timeout) {
      fail(
        ExitCode.FAILURE,
        `빌드 ${buildId} 가 ${Math.round(timeout / 60000)}분 안에 끝나지 않았습니다. 포털에서 상태를 확인하세요.`,
      )
    }
    await sleep(interval)
  }
}
