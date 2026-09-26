import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { skillsFor } from '@bstage-sdk/ai-toolkit'

import { writeScaffold } from './scaffold.js'
import {
  LIQUID_TEMPLATE_NAME_RE,
  scaffoldLiquid,
  type LiquidScaffoldInput,
} from './scaffoldLiquid.js'
import { detectProjectKind } from '../../project/detectKind.js'

/**
 * `bstage init --kind liquid`가 만드는 파일 목록의 회귀 방지.
 *
 * 조립이 순수 함수라 프롬프트·네트워크·디스크 없이 목록만 대조할 수 있다. 여기서 고정하는 것은
 * **포털 빌더 규약**(`public/{user|admin}/{name}/template.liquid`)이라, 깨지면 빌더가 템플릿을
 * 조용히 무시하는 상태가 된다.
 */

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true })
})

function input(overrides: Partial<LiquidScaffoldInput> = {}): LiquidScaffoldInput {
  return {
    space: 'acme',
    projectName: 'acme-custom-templates-sandbox',
    templateName: 'hello',
    target: 'user',
    packageManager: 'npm',
    cliVersion: '0.0.0',
    ...overrides,
  }
}

const SKILL_NAMES = ['bstage-onboarding', 'bstage-liquid', 'bstage-deploy', 'bstage-migrate']

function expectedFiles(packageManager: 'npm' | 'pnpm', target = 'user', name = 'hello'): string[] {
  return [
    'AGENTS.md',
    'CLAUDE.md',
    'README.md',
    'package.json',
    '.gitignore',
    ...(packageManager === 'pnpm' ? ['pnpm-workspace.yaml'] : []),
    '.husky/pre-commit',
    '.husky/check-secrets.mjs',
    `public/${target}/${name}/template.liquid`,
    `public/${target}/${name}/data.json`,
    ...SKILL_NAMES.map((s) => `.claude/skills/${s}/SKILL.md`),
  ].sort()
}

/** sdk 스캐폴드에만 있어야 하는 파일 — liquid 레포에 섞이면 빌더가 mixed로 본다. */
const FORBIDDEN = [
  'vite.config.ts',
  'tsconfig.json',
  'tsconfig.app.json',
  'tsconfig.node.json',
  'eslint.config.js',
  'index.html',
  '.env',
  '.env.example',
]

describe('scaffoldLiquid', () => {
  it('1. 파일 경로 집합이 정확히 규약 목록과 같다 (npm/pnpm 분기 포함)', () => {
    const npmPaths = scaffoldLiquid(input())
      .files.map((f) => f.path)
      .sort()
    const pnpmPaths = scaffoldLiquid(input({ packageManager: 'pnpm' }))
      .files.map((f) => f.path)
      .sort()

    expect(npmPaths).toEqual(expectedFiles('npm'))
    expect(pnpmPaths).toEqual(expectedFiles('pnpm'))
  })

  it('2. sdk 전용 파일(src/·vite·tsconfig·env 등)은 하나도 들어가지 않는다', () => {
    const paths = scaffoldLiquid(input()).files.map((f) => f.path)

    for (const forbidden of FORBIDDEN) {
      expect(paths, `${forbidden}가 들어 있다`).not.toContain(forbidden)
    }
    expect(paths.some((p) => p.startsWith('src/'))).toBe(false)
  })

  it('3. package.json은 kind liquid이고 의존성은 cli 하나뿐이다 (react 없음)', () => {
    const pkgFile = scaffoldLiquid(input({ target: 'admin', cliVersion: '1.2.3' })).files.find(
      (f) => f.path === 'package.json',
    )
    const parsed = JSON.parse(pkgFile!.content) as {
      bstage?: unknown
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }

    expect(parsed.bstage).toEqual({ kind: 'liquid', target: 'admin' })
    expect(parsed.dependencies).toEqual({ '@bstage-sdk/cli': '1.2.3' })
    expect(Object.keys(parsed.devDependencies ?? {})).toEqual(['husky'])
    expect(JSON.stringify(parsed)).not.toContain('react')
  })

  it('4. AGENTS.md는 liquid 규약을 안내한다 (template.liquid 있고 template.tsx 없음)', () => {
    const agents = scaffoldLiquid(input()).files.find((f) => f.path === 'AGENTS.md')!.content

    expect(agents).toContain('template.liquid')
    expect(agents).not.toContain('template.tsx')
  })

  it('5. 스킬은 skillsFor(liquid) 세트와 정확히 같다 (bstage-template 제외)', () => {
    const scaffold = scaffoldLiquid(input())
    const installed = scaffold.files
      .filter((f) => f.path.startsWith('.claude/skills/'))
      .map((f) => f.path.split('/')[2])
      .sort()

    expect(installed).toEqual(
      skillsFor('liquid')
        .map((s) => s.name)
        .sort(),
    )
    expect(installed).not.toContain('bstage-template')
    for (const name of skillsFor('liquid')) {
      expect(scaffold.dirs).toContain(`.claude/skills/${name.name}`)
    }
  })

  it('6. LIQUID_TEMPLATE_NAME_RE는 소문자·숫자·하이픈 한 세그먼트만 받는다', () => {
    for (const ok of ['hello', 'landing-v1', 'a', 'a1-b2']) {
      expect(LIQUID_TEMPLATE_NAME_RE.test(ok), `${ok}가 거부됐다`).toBe(true)
    }
    for (const bad of ['Hello', 'a b', '-x', '한글', '', 'a/b', '1abc']) {
      expect(LIQUID_TEMPLATE_NAME_RE.test(bad), `${bad}가 통과됐다`).toBe(false)
    }
  })

  it('7. 쓰고 나면 detectProjectKind가 liquid로 본다 (cli 의존성이 있어도)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bstage-liquid-'))
    tempDirs.push(dir)

    writeScaffold(dir, scaffoldLiquid(input({ target: 'admin', templateName: 'landing-v1' })))
    const report = detectProjectKind(dir)

    expect(report.kind).toBe('liquid')
    expect(report.liquidTemplates).toEqual(['admin/landing-v1'])
    expect(report.sdkTemplates).toEqual([])
    expect(report.ignoredLiquid).toEqual([])
    // 저작 도구로 cli를 의존한다 — 그래도 liquid가 이긴다(빌더와 같은 규칙).
    expect(report.hasSdkDependency).toBe(true)
  })
})
