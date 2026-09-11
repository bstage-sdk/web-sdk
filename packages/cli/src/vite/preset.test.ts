import { describe, expect, it } from 'vitest'
import { createViteConfig } from './preset.js'

/**
 * 앱 키 env 별칭은 `bstage build`가 프리셋을 통해 얹어야 기존 프로젝트(옛 이름을 읽는 client.ts)에
 * 포털이 새 이름으로 넣은 값이 번들에 실린다. 프리셋에서 빠지면 빌드는 성공하고 배포 뒤 401만 난다.
 */
describe('createViteConfig', () => {
  it('앱 키 env 별칭 플러그인을 포함한다', () => {
    const names = (createViteConfig().plugins as Array<{ name?: string }>)
      .flat()
      .map((p) => p?.name)
    expect(names).toContain('bstage-app-key-env-alias')
  })
})
