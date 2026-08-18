import { describe, expect, it } from 'vitest'
import * as adminTokens from '@bstage-sdk/design/admin'
import * as userTokens from '@bstage-sdk/design/user'
import { designGuideSection, designRulesBrief, meta } from './designGuide.js'
import type { DesignTarget } from './designGuide.js'

/**
 * designGuide는 에이전트가 그대로 베껴 쓰는 예시 키를 **문자열로** 들고 있다.
 * design의 토큰 키가 바뀌어도 타입 에러가 나지 않으므로(문서 문자열이라) 여기서 대조한다.
 *
 * 실제 사고: 어드민 예시가 `shadow['large']`였는데 실제 키는 `default-large`였다.
 * `shadow`가 `Record<string, string>`이라 `undefined`가 조용히 들어가 그림자만 사라졌다.
 */

/** 두 타깃의 공통 구조만 본다(타깃별 cssVar/textStyle 시그니처가 달라 그대로는 합쳐지지 않는다). */
interface DesignTokens {
  color: Record<string, Record<string, string>>
  shadow: Record<string, string>
  modeColors: Record<string, unknown>
  flatColors: Record<string, unknown>
  fontWeightMap: Record<string, number>
}

const TARGETS: {
  target: DesignTarget
  tokens: DesignTokens
  textStyle: (token: string) => unknown
}[] = [
  {
    target: 'user',
    tokens: userTokens,
    textStyle: (token) => userTokens.textStyle(token as Parameters<typeof userTokens.textStyle>[0]),
  },
  {
    target: 'admin',
    tokens: adminTokens,
    textStyle: (token) =>
      adminTokens.textStyle(token as Parameters<typeof adminTokens.textStyle>[0]),
  },
]

describe.each(TARGETS)(
  'designGuide 예시 키 ↔ 실제 design 토큰 ($target)',
  ({ target, tokens, textStyle }) => {
    const m = meta(target)

    it('import 경로가 실제 서브패스와 일치한다', () => {
      expect(m.pkg).toBe(`@bstage-sdk/design/${target}`)
    })

    it('shadowExample이 실제 shadow 키로 존재한다', () => {
      expect(Object.keys(tokens.shadow)).toContain(m.shadowExample)
    })

    it('shadowExample이 prefix까지 포함해 기대한 CSS 변수로 해석된다', () => {
      // prefix가 어긋나면 값이 존재해도 플랫폼 변수와 연결되지 않는다.
      expect(tokens.shadow[m.shadowExample]).toBe(
        `var(--${m.prefix}-mode-shadow-${m.shadowExample})`,
      )
    })

    it('cssVarExample이 실제 색 slug로 존재한다', () => {
      const known = m.cssVarExample in tokens.modeColors || m.cssVarExample in tokens.flatColors
      expect(known).toBe(true)
    })

    it('colorExample이 색 트리에서 해석된다', () => {
      const [root, category, name] = m.colorExample.split('.')
      expect(root).toBe('color')
      expect(tokens.color[category]?.[name]).toMatch(new RegExp(`^var\\(--${m.prefix}-`))
    })

    it('textStyleExample이 throw 없이 해석된다', () => {
      expect(() => textStyle(m.textStyleExample)).not.toThrow()
    })

    it('textStyleExample의 weight가 fontWeightMap에 존재한다', () => {
      // resolveTextStyle은 모르는 weight를 조용히 400으로 떨어뜨린다 → throw만 봐선 못 잡는다.
      const parts = m.textStyleExample.split('/')
      const weight = parts[parts.length - 1]
      const weightBase = weight.split('-')[0]
      const known = weight in tokens.fontWeightMap || weightBase in tokens.fontWeightMap
      expect(known).toBe(true)
    })

    it('렌더된 가이드 본문이 같은 예시를 쓴다', () => {
      // meta()는 통과하는데 템플릿 본문에 다른 키가 하드코딩돼 있으면 소비자가 받는 문서만 틀린다.
      for (const text of [designRulesBrief(target), designGuideSection(target)]) {
        expect(text).toContain(`shadow['${m.shadowExample}']`)
        expect(text).toContain(m.pkg)
      }
      expect(designRulesBrief(target)).toContain(`cssVar('${m.cssVarExample}')`)
      expect(designGuideSection(target)).toContain(`textStyle('${m.textStyleExample}')`)
    })
  },
)
