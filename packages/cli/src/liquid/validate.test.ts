import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { validateLiquid, type LiquidIssue } from './validate.js'

/**
 * liquid 레포에는 빌드 단계가 없다 — 포털이 push된 커밋의 `public/`을 그대로 패키징한다.
 * 그래서 문법 오류·규약 위반은 **배포된 뒤 화면에서** 드러난다. `bstage build`가 검증만 하는
 * 이유가 여기고, 그 검증이 곧 이 함수다. 손 검증은 정상 템플릿 하나를 지나갈 뿐이라
 * 아래 분기는 전부 비어 있다.
 */

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'liquid-validate-'))
  roots.push(root)
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content, 'utf-8')
  }
  return root
}

const OK_TEMPLATE = '<h1>{{ title }}</h1>\n'

function errors(issues: LiquidIssue[]): LiquidIssue[] {
  return issues.filter((i) => i.level === 'error')
}

function warns(issues: LiquidIssue[]): LiquidIssue[] {
  return issues.filter((i) => i.level === 'warn')
}

describe('validateLiquid', () => {
  it('규약을 지킨 템플릿은 이슈가 없다', () => {
    const root = fixture({
      'public/user/home/template.liquid': OK_TEMPLATE,
      'public/user/home/data.json': '{"title":"안녕"}\n',
    })
    expect(validateLiquid(root)).toEqual([])
  })

  it('닫히지 않은 태그는 error이고 메시지에 줄 번호가 있다', () => {
    const root = fixture({
      'public/user/home/template.liquid': '한 줄\n두 줄\n{% if x %}\n닫지 않음\n',
    })
    const issues = errors(validateLiquid(root))
    expect(issues).toHaveLength(1)
    expect(issues[0].path).toBe('public/user/home/template.liquid')
    expect(issues[0].message).toContain('3')
  })

  it('깨진 data.json은 error다 — 포털은 지우지만 로컬 프리뷰가 깨진다', () => {
    const root = fixture({
      'public/user/home/template.liquid': OK_TEMPLATE,
      'public/user/home/data.json': '{ "title": }\n',
    })
    const issues = errors(validateLiquid(root))
    expect(issues).toHaveLength(1)
    expect(issues[0].path).toBe('public/user/home/data.json')
  })

  it('user·admin 밖의 template.liquid는 warn이다 — 포털이 무시한다', () => {
    const root = fixture({
      'public/user/home/template.liquid': OK_TEMPLATE,
      'public/other/thing/template.liquid': OK_TEMPLATE,
    })
    const issues = warns(validateLiquid(root))
    expect(issues).toHaveLength(1)
    expect(issues[0].path).toBe('public/other/thing/template.liquid')
    expect(errors(validateLiquid(root))).toEqual([])
  })

  it('sdk 템플릿과 섞여 있으면 error다 — 포털 빌더가 둘을 함께 패키징하지 못한다', () => {
    const root = fixture({
      'public/user/home/template.liquid': OK_TEMPLATE,
      'src/pages/home/template.tsx': 'export default null\n',
    })
    const issues = errors(validateLiquid(root))
    expect(issues.some((i) => i.message.includes('섞여'))).toBe(true)
  })

  it('대문자가 섞인 폴더명은 error다 — CDN 경로가 되는 이름이다', () => {
    const root = fixture({ 'public/user/Home/template.liquid': OK_TEMPLATE })
    const issues = errors(validateLiquid(root))
    expect(issues.some((i) => i.path === 'public/user/Home')).toBe(true)
  })

  it('layout.json이 있으면 warn이다 — 포털이 패키징에서 지운다', () => {
    const root = fixture({
      'public/user/home/template.liquid': OK_TEMPLATE,
      'public/user/home/layout.json': '{}\n',
    })
    const issues = warns(validateLiquid(root))
    expect(issues).toHaveLength(1)
    expect(issues[0].path).toBe('public/user/home/layout.json')
  })

  it('template.liquid가 아닌 이름만 있는 폴더는 warn이다', () => {
    const root = fixture({
      'public/user/home/template.liquid': OK_TEMPLATE,
      'public/user/promo/index.html': '<h1>x</h1>\n',
    })
    const issues = warns(validateLiquid(root))
    expect(issues).toHaveLength(1)
    expect(issues[0].path).toBe('public/user/promo')
    expect(issues[0].message).toContain('template.liquid')
  })

  it('liquid 템플릿이 하나도 없으면 error다', () => {
    const root = fixture({ 'package.json': '{}\n' })
    const issues = errors(validateLiquid(root))
    expect(issues).toHaveLength(1)
    expect(issues[0].message).toContain('template.liquid')
  })

  it('결과는 path 순으로 정렬된다', () => {
    const root = fixture({
      'public/user/zzz/template.liquid': OK_TEMPLATE,
      'public/user/aaa/template.liquid': '{% if x %}\n',
      'public/user/mmm/template.liquid': OK_TEMPLATE,
      'public/user/mmm/layout.json': '{}\n',
    })
    const paths = validateLiquid(root).map((i) => i.path)
    expect(paths).toEqual([...paths].sort())
    expect(paths.length).toBeGreaterThan(1)
  })
})
