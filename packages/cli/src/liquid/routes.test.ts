import { describe, expect, it } from 'vitest'

import { resolveRoute } from './routes.js'

// 규약 안 템플릿 하나 + 규약 밖(중첩) 템플릿 하나
const TEMPLATES = ['user/home', 'user/events/summer']

/** public/ 기준 상대 경로 목록으로 만드는 exists 콜백 */
function existsIn(paths: string[]): (p: string) => boolean {
  return (p) => paths.includes(p)
}

const noFiles = existsIn([])

describe('resolveRoute', () => {
  it('/ 는 index', () => {
    expect(resolveRoute('/', TEMPLATES, noFiles)).toEqual({ kind: 'index' })
  })

  it('/user·/admin 은 목록', () => {
    expect(resolveRoute('/user', TEMPLATES, noFiles)).toEqual({ kind: 'list', type: 'user' })
    expect(resolveRoute('/admin', TEMPLATES, noFiles)).toEqual({ kind: 'list', type: 'admin' })
  })

  it('끝 슬래시가 붙어도 목록으로 본다', () => {
    expect(resolveRoute('/user/', TEMPLATES, noFiles)).toEqual({ kind: 'list', type: 'user' })
  })

  it('templates에 있는 이름은 template', () => {
    expect(resolveRoute('/user/home', TEMPLATES, noFiles)).toEqual({
      kind: 'template',
      type: 'user',
      name: 'home',
    })
  })

  it('중첩 이름도 templates에 있으면 template', () => {
    expect(resolveRoute('/user/events/summer', TEMPLATES, noFiles)).toEqual({
      kind: 'template',
      type: 'user',
      name: 'events/summer',
    })
  })

  it('템플릿이 아니고 public/ 아래 실존 파일이면 asset', () => {
    const exists = existsIn(['user/home/images/a.png'])

    expect(resolveRoute('/user/home/images/a.png', TEMPLATES, exists)).toEqual({
      kind: 'asset',
      path: 'user/home/images/a.png',
    })
  })

  it('user·admin 밖이어도 실존 파일이면 asset', () => {
    expect(resolveRoute('/shared/logo.svg', TEMPLATES, existsIn(['shared/logo.svg']))).toEqual({
      kind: 'asset',
      path: 'shared/logo.svg',
    })
  })

  it('없는 경로는 null', () => {
    expect(resolveRoute('/other/x', TEMPLATES, noFiles)).toBeNull()
  })

  it('.. 는 실존 여부와 무관하게 거부한다 — public/ 밖으로 못 나간다', () => {
    const anyFile = () => true

    expect(resolveRoute('/../package.json', TEMPLATES, anyFile)).toBeNull()
    expect(resolveRoute('/user/../../package.json', TEMPLATES, anyFile)).toBeNull()
    expect(resolveRoute('/%2e%2e/package.json', TEMPLATES, anyFile)).toBeNull()
  })

  it('/__bstage__/reload 는 reload', () => {
    expect(resolveRoute('/__bstage__/reload', TEMPLATES, noFiles)).toEqual({ kind: 'reload' })
  })

  it('디코딩할 수 없는 경로는 null', () => {
    expect(resolveRoute('/%E0%A4%A', TEMPLATES, () => true)).toBeNull()
  })
})
