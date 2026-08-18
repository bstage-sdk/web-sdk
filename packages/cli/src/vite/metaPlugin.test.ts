import { describe, expect, it } from 'vitest'
import type { Plugin } from 'vite'
import { createMetaPlugin } from './metaPlugin.js'

/**
 * 소스 문자열을 손으로 파싱해 빌드 메타데이터를 뽑는다. 파싱이 틀리면 빌드가 조용히
 * elementName을 놓치거나 엉뚱한 값을 넣는다. 비공개 `extractMeta`를 export하지 않고
 * 플러그인을 통해 태워서 확장자 필터·"첫 매칭 후 memo" 동작까지 함께 덮는다.
 */

type TransformFn = (code: string, id: string) => unknown

function harness() {
  const { plugin, getMeta } = createMetaPlugin()
  const transform = (plugin as Plugin).transform as unknown as TransformFn
  return {
    getMeta,
    /** transform 훅을 태우고 반환값을 돌려준다(항상 null이어야 한다 — 코드를 바꾸지 않는다). */
    run: (code: string, id = '/src/template.tsx') => transform(code, id),
  }
}

const REACT_IMPORT = "import { createTemplate } from '@bstage-sdk/react'\n"

describe('createMetaPlugin — createTemplate', () => {
  it('2번째 인자에서 name을 뽑고 elementName으로 함께 쓴다', () => {
    const { run, getMeta } = harness()
    run(`${REACT_IMPORT}export default createTemplate(MyWidget, { name: 'my-space-my-widget' })`)
    expect(getMeta()).toEqual({
      name: 'my-space-my-widget',
      elementName: 'my-space-my-widget',
      framework: 'react',
    })
  })

  it('transform은 코드를 변형하지 않는다 (항상 null 반환)', () => {
    const { run } = harness()
    expect(run(`${REACT_IMPORT}createTemplate(A, { name: 'my-space-a' })`)).toBeNull()
  })

  it('type 옵션도 뽑는다', () => {
    const { run, getMeta } = harness()
    run(`${REACT_IMPORT}createTemplate(A, { name: 'my-space-a', type: 'route' })`)
    expect(getMeta()?.type).toBe('route')
  })

  it('여러 줄에 걸친 옵션 객체도 읽는다', () => {
    const { run, getMeta } = harness()
    run(`${REACT_IMPORT}createTemplate(A, {
  name: 'my-space-multiline',
  type: 'slot',
})`)
    expect(getMeta()?.name).toBe('my-space-multiline')
  })

  it('name이 없으면 메타를 만들지 않는다', () => {
    const { run, getMeta } = harness()
    run(`${REACT_IMPORT}createTemplate(A, { type: 'route' })`)
    expect(getMeta()).toBeNull()
  })

  it('키 이름이 name으로 끝나는 다른 속성에 오매칭되지 않는다', () => {
    const { run, getMeta } = harness()
    run(`${REACT_IMPORT}createTemplate(A, { displayName: 'wrong', name: 'my-space-right' })`)
    expect(getMeta()?.name).toBe('my-space-right')
  })

  // 슬롯 id는 값 안에 콜론이 들어가는 유일한 옵션이라(`curation:after`), 값 파싱이 콜론에서
  // 끊기면 위젯이 엉뚱한 디렉토리로 나간다. 빌드가 이 값으로 산출물 경로를 정한다.
  it('slot 옵션을 값 안의 콜론까지 온전히 뽑는다', () => {
    const { run, getMeta } = harness()
    run(
      `${REACT_IMPORT}createTemplate(A, { name: 'my-space-a', slot: 'user.contents-home.curation:after' })`,
    )
    expect(getMeta()?.slot).toBe('user.contents-home.curation:after')
  })

  it('slot이 없으면 메타에 넣지 않는다 (페이지)', () => {
    const { run, getMeta } = harness()
    run(`${REACT_IMPORT}createTemplate(A, { name: 'my-space-a' })`)
    expect(getMeta()?.slot).toBeUndefined()
  })

  it('slot으로 시작하는 다른 키에 오매칭되지 않는다', () => {
    const { run, getMeta } = harness()
    run(`${REACT_IMPORT}createTemplate(A, { name: 'my-space-a', slotId: 'wrong' })`)
    expect(getMeta()?.slot).toBeUndefined()
  })
})

describe('createMetaPlugin — 인자 위치 계산', () => {
  it('1번째 인자의 문자열 리터럴 안 쉼표를 인자 구분으로 세지 않는다', () => {
    const { run, getMeta } = harness()
    run(`${REACT_IMPORT}createTemplate(withLabel('a, b, c'), { name: 'my-space-comma' })`)
    expect(getMeta()?.name).toBe('my-space-comma')
  })

  it('1번째 인자의 중첩 객체·배열·괄호를 건너뛴다', () => {
    const { run, getMeta } = harness()
    run(
      `${REACT_IMPORT}createTemplate(wrap({ list: [1, 2], fn: (x, y) => x }), { name: 'my-space-nested' })`,
    )
    expect(getMeta()?.name).toBe('my-space-nested')
  })

  it('createWebComponent는 3번째 인자를 본다', () => {
    const { run, getMeta } = harness()
    run("createWebComponent(El, adapter, { name: 'my-space-wc' })")
    expect(getMeta()?.name).toBe('my-space-wc')
  })
})

describe('createMetaPlugin — framework 감지', () => {
  it('import 문에서 react를 감지한다', () => {
    const { run, getMeta } = harness()
    run(`${REACT_IMPORT}createTemplate(A, { name: 'my-space-a' })`)
    expect(getMeta()?.framework).toBe('react')
  })

  it('큰따옴표 import도 감지한다', () => {
    const { run, getMeta } = harness()
    run(
      `import { createTemplate } from "@bstage-sdk/react"\ncreateTemplate(A, { name: 'my-space-a' })`,
    )
    expect(getMeta()?.framework).toBe('react')
  })

  it('옵션의 framework가 import 감지를 이긴다', () => {
    const { run, getMeta } = harness()
    run(`${REACT_IMPORT}createTemplate(A, { name: 'my-space-a', framework: 'vue' })`)
    expect(getMeta()?.framework).toBe('vue')
  })

  it('아무 SDK import도 없으면 framework는 undefined', () => {
    const { run, getMeta } = harness()
    run("createTemplate(A, { name: 'my-space-a' })")
    expect(getMeta()?.framework).toBeUndefined()
  })
})

describe('createMetaPlugin — 대상 파일 필터와 memo', () => {
  it('createTemplate/createWebComponent 문자열이 없으면 파싱하지 않는다', () => {
    const { run, getMeta } = harness()
    run("export const x = 1\n// name: 'my-space-a'")
    expect(getMeta()).toBeNull()
  })

  it.each([
    '/src/main.ts',
    '/src/main.jsx',
    '/src/main.js',
    '/src/main.mjs',
    '/src/main.cjs',
    '/src/main.mts',
  ])('%s도 통과시킨다', (id) => {
    const { run, getMeta } = harness()
    run(`${REACT_IMPORT}createTemplate(A, { name: 'my-space-a' })`, id)
    expect(getMeta()?.name).toBe('my-space-a')
  })

  it.each(['/src/style.css', '/src/data.json', '/src/main.ms'])('%s는 걸러낸다', (id) => {
    // `.ms`는 옛 필터 `[tjm]sx?`가 잘못 통과시키던 확장자다 — 이제 안 걸린다.
    const { run, getMeta } = harness()
    run(`${REACT_IMPORT}createTemplate(A, { name: 'my-space-a' })`, id)
    expect(getMeta()).toBeNull()
  })

  it('첫 매칭 이후에는 다른 파일을 무시한다 (템플릿 1개 계약)', () => {
    const { run, getMeta } = harness()
    run(`${REACT_IMPORT}createTemplate(A, { name: 'my-space-first' })`, '/src/a.tsx')
    run(`${REACT_IMPORT}createTemplate(B, { name: 'my-space-second' })`, '/src/b.tsx')
    expect(getMeta()?.name).toBe('my-space-first')
  })
})
