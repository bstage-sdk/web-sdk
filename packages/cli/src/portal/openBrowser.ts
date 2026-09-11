import { execFile } from 'node:child_process'

/**
 * 셸·핸들러가 다시 해석할 수 있는 문자. 이런 문자가 든 주소는 열지 않는다.
 *
 * URL 자체는 `execFile`(셸 없음)로 넘기므로 인자 분리는 이미 안전하지만, 윈도우의
 * 프로세스 생성은 인자를 문자열 한 줄로 붙여 넘기고 받는 쪽이 다시 쪼갠다 — 중간에
 * `cmd.exe`나 그렇게 동작하는 핸들러가 끼면 `&`·`|` 뒤가 별개 명령이 된다.
 * 정상적인 승인 주소에는 이 문자들이 필요 없으므로(`%` 로 퍼센트 인코딩된 주소는
 * 열지 않고 출력만 한다) 통째로 막는 쪽이 싸다.
 */
const SHELL_METACHARS = /[&|^<>%!"'`\\]/

/** http(s)만 연다. `file:`·`javascript:` 같은 스킴을 OS 핸들러에 그대로 넘기지 않는다. */
function isWebUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * 기본 브라우저로 URL을 연다. 실패는 false로만 알린다 — URL은 이미 터미널에 찍혀 있어
 * 사용자가 직접 열 수 있다(SSH·컨테이너에서는 원래 열리지 않는다). http(s)가 아니거나
 * 셸 메타문자가 든 주소도 열지 않고 false다.
 *
 * 윈도우에서 `cmd /c start` 를 쓰지 않는 이유: `cmd.exe` 가 인자를 다시 파싱해
 * `%VAR%` 치환·`&` 명령 연결이 살아난다. `rundll32 url.dll,FileProtocolHandler` 는
 * 셸을 거치지 않고 기본 브라우저로 바로 넘긴다.
 */
export function openBrowser(url: string): Promise<boolean> {
  if (!isWebUrl(url) || SHELL_METACHARS.test(url)) return Promise.resolve(false)
  const [cmd, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
        : ['xdg-open', [url]]
  return new Promise((resolve) => {
    try {
      execFile(cmd, args, { timeout: 5000 }, (err) => resolve(!err))
    } catch {
      resolve(false)
    }
  })
}
