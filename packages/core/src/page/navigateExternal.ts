import { getFrameBridge } from '../frameBridge.js'
import { emitFromTemplateHost } from '../core/templateHosts.js'

/**
 * https 외부 URL만 통과시킨다(userinfo 금지). 정규화한 href를 돌려준다.
 * 브리지 호스트 `validateExternalUrl`과 같은 기준이다 — 최종 판정은 호스트가 다시 한다.
 */
function toExternalHref(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new TypeError('[bstage] navigateExternal: 올바른 URL이 아닙니다')
  }
  if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '') {
    throw new TypeError('[bstage] navigateExternal: https URL만 이동할 수 있습니다')
  }
  return parsed.href
}

/**
 * 같은 탭에서 외부 https 사이트로 이동을 요청한다. 플랫폼이 확인 창을 띄우고, 사용자가 취소하거나 플랫폼이
 * 허용하지 않으면 이동하지 않는다(이동 여부를 돌려주지는 않는다).
 *
 * - 격리 프레임: 브리지 `navigateExternal` 요청. 호스트가 거절하면(지원 안 함 `UNSUPPORTED`, http·userinfo
 *   `FORBIDDEN_DESTINATION` 등) `code`가 붙은 Error로 reject. 프레임 안에서 `window.open`은 동작하지 않고,
 *   `location.assign`으로 직접 나가면 격리 검사에 걸리므로 이 함수를 쓴다.
 * - inline: 템플릿 엘리먼트에서 `bstage:navigate-external`(`{ url }`) 이벤트를 낸다(`useNavigation`과 같은 채널).
 *   https가 아니거나 userinfo가 있으면 TypeError로 reject. 이 번들의 엘리먼트가 없거나 여럿이면 Error로 reject.
 */
export async function navigateExternal(url: string): Promise<void> {
  const bridge = getFrameBridge()
  if (bridge) {
    await bridge.request('navigateExternal', { url })
    return
  }
  if (!emitFromTemplateHost('navigate-external', { url: toExternalHref(url) })) {
    throw new Error(
      '[bstage] navigateExternal: 요청을 보낼 템플릿 엘리먼트를 정할 수 없습니다(엘리먼트가 없거나 여럿 — useNavigation을 쓰세요)',
    )
  }
}
