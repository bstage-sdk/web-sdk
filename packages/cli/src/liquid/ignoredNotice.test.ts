import { describe, expect, it } from 'vitest'
import { ignoredLiquidNotice } from './ignoredNotice.js'

/**
 * 규약 밖 `.liquid`는 조용히 무시되는 것이 증상이라, 안내가 어느 명령에서는 나오고 어느 명령에서는
 * 안 나오면 사용자는 명령마다 다른 결론을 얻는다. 문구를 한 곳에서 만들고 그 모양을 고정한다.
 */

describe('ignoredLiquidNotice', () => {
  it('무시된 파일이 없으면 null이다', () => {
    expect(ignoredLiquidNotice([])).toBeNull()
  })

  it('파일 목록과 인정되는 자리를 함께 적는다', () => {
    const text = ignoredLiquidNotice([
      'public/user/pages/deep/template.liquid',
      'src/x/template.liquid',
    ])
    expect(text).toContain('public/user/pages/deep/template.liquid')
    expect(text).toContain('src/x/template.liquid')
    expect(text).toContain('public/{user|admin}/{이름}/template.liquid')
  })
})
