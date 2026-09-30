import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { collidingSdkPages, detectProjectKind } from './detectKind.js'

/**
 * 포털 빌더(다른 레포 builder/entrypoint.sh)와 동일한 규칙으로 레포 종류를 판정해야 한다.
 * 어긋나면 CLI가 sdk/liquid를 잘못 판단해 로컬 안내와 실제 배포 판정이 갈린다.
 */

const dirs: string[] = []

function tmpProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bstage-kind-'))
  dirs.push(dir)
  return dir
}

function writeNested(root: string, relPath: string, content = ''): void {
  const full = join(root, relPath)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content, 'utf-8')
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('detectProjectKind', () => {
  it('1. liquid 템플릿만 있으면 kind=liquid', () => {
    const dir = tmpProject()
    writeNested(dir, 'public/user/home/template.liquid')
    writeNested(dir, 'public/admin/notice/template.liquid')

    const report = detectProjectKind(dir)

    expect(report.kind).toBe('liquid')
    expect(report.liquidTemplates).toEqual(['admin/notice', 'user/home'])
    expect(report.sdkTemplates).toEqual([])
    expect(report.ignoredLiquid).toEqual([])
    expect(report.hasSdkDependency).toBe(false)
  })

  it('2. sdk 템플릿·의존성만 있으면 kind=sdk', () => {
    const dir = tmpProject()
    writeNested(dir, 'src/pages/home/template.tsx')
    writeNested(dir, 'src/slots/w/template.tsx')
    writeNested(
      dir,
      'package.json',
      JSON.stringify({ dependencies: { '@bstage-sdk/react': '0.1.0' } }),
    )

    const report = detectProjectKind(dir)

    expect(report.kind).toBe('sdk')
    expect(report.sdkTemplates).toEqual(['pages/home', 'slots/w'])
    expect(report.liquidTemplates).toEqual([])
    expect(report.ignoredLiquid).toEqual([])
    expect(report.hasSdkDependency).toBe(true)
  })

  it('3. liquid와 sdk 신호가 둘 다 있으면 kind=mixed', () => {
    const dir = tmpProject()
    writeNested(dir, 'public/user/home/template.liquid')
    writeNested(dir, 'src/pages/home/template.tsx')
    writeNested(
      dir,
      'package.json',
      JSON.stringify({ dependencies: { '@bstage-sdk/react': '0.1.0' } }),
    )

    const report = detectProjectKind(dir)

    expect(report.kind).toBe('mixed')
    expect(report.liquidTemplates).toEqual(['user/home'])
    expect(report.sdkTemplates).toEqual(['pages/home'])
  })

  it('4. surface가 user/admin이 아니면 무시된다', () => {
    const dir = tmpProject()
    writeNested(dir, 'public/other/x/template.liquid')

    const report = detectProjectKind(dir)

    expect(report.kind).toBe('unknown')
    expect(report.liquidTemplates).toEqual([])
    expect(report.ignoredLiquid).toEqual(['public/other/x/template.liquid'])
  })

  it('5. name이 한 세그먼트가 아니면(깊이 초과) 무시된다', () => {
    const dir = tmpProject()
    writeNested(dir, 'public/user/a/b/template.liquid')

    const report = detectProjectKind(dir)

    expect(report.kind).toBe('unknown')
    expect(report.liquidTemplates).toEqual([])
    expect(report.ignoredLiquid).toHaveLength(1)
    expect(report.ignoredLiquid).toEqual(['public/user/a/b/template.liquid'])
  })

  it('6. liquid + Next 저작 하네스 package.json은 liquid로 남는다', () => {
    const dir = tmpProject()
    writeNested(dir, 'public/user/home/template.liquid')
    writeNested(
      dir,
      'package.json',
      JSON.stringify({ dependencies: { next: '14.0.0', react: '18.0.0' } }),
    )

    const report = detectProjectKind(dir)

    expect(report.kind).toBe('liquid')
    expect(report.hasSdkDependency).toBe(false)
  })

  it('7. 빈 디렉터리는 unknown이고 모든 배열이 비어 있다', () => {
    const dir = tmpProject()

    const report = detectProjectKind(dir)

    expect(report.kind).toBe('unknown')
    expect(report.liquidTemplates).toEqual([])
    expect(report.sdkTemplates).toEqual([])
    expect(report.ignoredLiquid).toEqual([])
    expect(report.hasSdkDependency).toBe(false)
  })

  it('8. package.json이 깨져 있어도 예외 없이 liquid로 판정한다', () => {
    const dir = tmpProject()
    writeNested(dir, 'public/user/home/template.liquid')
    writeNested(dir, 'package.json', '{')

    const report = detectProjectKind(dir)

    expect(report.kind).toBe('liquid')
    expect(report.hasSdkDependency).toBe(false)
  })

  it('9. liquid 파일 + SDK 의존성만(sdk 템플릿 파일 없음)이면 liquid가 이긴다', () => {
    const dir = tmpProject()
    writeNested(dir, 'public/user/home/template.liquid')
    writeNested(
      dir,
      'package.json',
      JSON.stringify({ devDependencies: { '@bstage-sdk/cli': '^0.55.0' } }),
    )

    const report = detectProjectKind(dir)

    expect(report.kind).toBe('liquid')
    expect(report.hasSdkDependency).toBe(true)
    expect(report.sdkTemplates).toEqual([])
  })

  it('10. liquid 파일이 없고 SDK 의존성만 있으면 sdk로 남는다', () => {
    const dir = tmpProject()
    writeNested(
      dir,
      'package.json',
      JSON.stringify({ dependencies: { '@bstage-sdk/cli': '^0.55.0' } }),
    )

    const report = detectProjectKind(dir)

    expect(report.kind).toBe('sdk')
    expect(report.hasSdkDependency).toBe(true)
  })
})

/**
 * 혼합 레포에서 sdk 페이지 `src/pages/user/...`·`src/pages/admin/...`은 산출물이 `dist/user/...`로
 * 나가 liquid의 `dist/{user|admin}/{name}/` 자리와 겹친다. 같은 디렉터리에 template.js와
 * template.liquid가 함께 놓이면 포털은 sdk로만 판정해 liquid가 조용히 사라진다 — 빌드에서 끊어야 한다.
 */
describe('collidingSdkPages', () => {
  it('liquid가 있고 sdk 페이지 첫 세그먼트가 user·admin이면 그 페이지를 돌려준다', () => {
    const dir = tmpProject()
    writeNested(dir, 'public/user/home/template.liquid')
    writeNested(dir, 'src/pages/user/home/template.tsx')
    writeNested(dir, 'src/pages/admin/template.tsx')
    writeNested(dir, 'src/pages/landing/template.tsx')

    expect(collidingSdkPages(detectProjectKind(dir))).toEqual(['pages/admin', 'pages/user/home'])
  })

  it('liquid 템플릿이 없으면 user·admin 페이지도 충돌이 아니다', () => {
    const dir = tmpProject()
    writeNested(dir, 'src/pages/user/home/template.tsx')

    expect(collidingSdkPages(detectProjectKind(dir))).toEqual([])
  })

  it('대소문자가 달라도 잡는다 — 대소문자 무시 파일시스템에서 dist/User와 dist/user는 같은 자리다', () => {
    const dir = tmpProject()
    writeNested(dir, 'public/admin/notice/template.liquid')
    writeNested(dir, 'src/pages/User/home/template.tsx')
    writeNested(dir, 'src/pages/ADMIN/template.tsx')

    expect(collidingSdkPages(detectProjectKind(dir))).toEqual(['pages/ADMIN', 'pages/User/home'])
  })

  it('위젯(slots)은 슬롯 id로 나가므로 폴더 이름이 user여도 충돌이 아니다', () => {
    const dir = tmpProject()
    writeNested(dir, 'public/user/home/template.liquid')
    writeNested(dir, 'src/slots/user/template.tsx')
    writeNested(dir, 'src/pages/users/template.tsx')

    expect(collidingSdkPages(detectProjectKind(dir))).toEqual([])
  })
})
