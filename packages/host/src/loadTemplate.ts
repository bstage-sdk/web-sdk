import { lookupElementName } from '@bstage-sdk/core'
import type { LoadTemplateOptions } from './types.js'
import { loadScript } from './scriptLoader.js'
import { TemplateHandle } from './TemplateHandle.js'

/**
 * 템플릿 번들 URL로부터 템플릿을 로드합니다.
 *
 * 1. `<script>`로 IIFE 번들을 로드합니다 (멱등성)
 * 2. 번들이 등록한 Custom Element 태그명을 확인합니다
 * 3. 생명주기 관리를 위한 TemplateHandle을 반환합니다
 *
 * 예전에는 manifest.json을 먼저 받아 태그명과 번들 경로를 읽었습니다. manifest가 실어 나르던
 * 정보는 태그명 하나뿐이었고 entry는 늘 `template.js`로 고정이라, 번들이 로드되면서 스스로
 * 태그명을 알리는 방식으로 바꿨습니다. 관리도구도 `templateUrl` 하나만 내려줍니다.
 *
 * @example
 * const tpl = await loadTemplate('/cdn/bmf/landing/template.js')
 * tpl.on('navigate', ({ path }) => router.push(path))
 * tpl.mount(container)
 */
export async function loadTemplate(
  templateUrl: string,
  options?: LoadTemplateOptions,
): Promise<TemplateHandle> {
  const timeout = options?.timeout ?? 10_000

  await loadScript(templateUrl, timeout)

  const elementName = lookupElementName(templateUrl) ?? recoverLegacyElementName(templateUrl)
  if (!elementName) {
    // 번들은 받았는데 등록 흔적이 없고 폴백도 실패했다 — `bstage build` 산출물이 아니거나
    // 번들 실행이 실패한 경우다. 여기서 끊지 않으면 빈 화면만 남아 원인을 찾기 어렵다.
    throw new Error(
      `Template bundle registered no custom element: ${templateUrl}. ` +
        `Rebuild the template with a current @bstage-sdk/cli.`,
    )
  }

  return new TemplateHandle({ elementName })
}

/**
 * 옛 번들에서 태그명을 되찾는다.
 *
 * 태그명을 스스로 알리는 코드가 없던 시절의 번들은 조회에 실패한다. 그때 산출물 디렉토리
 * 이름이 곧 Custom Element 태그명이었으므로(`dist/{createTemplate의 name}/`), URL의
 * 마지막 디렉토리 세그먼트가 후보가 된다.
 *
 * **추측으로 쓰지 않고 `customElements.get()`으로 확인한다.** 번들은 이미 실행돼 등록을
 * 마친 상태이므로, 후보 이름이 실제로 등록돼 있으면 그게 정답이다. 새 산출물 경로(`landing`,
 * `user.contents-home.curation--after`)가 후보로 잡혀도 등록된 이름이 아니라 그냥 걸러진다.
 *
 * @remarks 옛 번들이 전부 재빌드·재배포되면 걷어낼 수 있다.
 * @internal 테스트용으로 노출한다. public API 아님.
 */
export function recoverLegacyElementName(templateUrl: string): string | undefined {
  const path = templateUrl.split('?')[0].split('#')[0]
  const segments = path.split('/').filter(Boolean)
  // `.../{태그명}/template.js` 또는 `.../{태그명}/manifest.json` — 파일명 앞 세그먼트.
  // `Array.prototype.at`은 ES2022라 쓰지 않는다 — 이 레포의 lib은 ES2020이다.
  const candidate = segments[segments.length - 2]
  if (!candidate) return undefined

  return customElements.get(candidate) ? candidate : undefined
}
