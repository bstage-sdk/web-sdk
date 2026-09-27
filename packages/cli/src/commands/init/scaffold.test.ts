import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { scaffoldSdk, writeScaffold, type SdkScaffoldInput } from './scaffold.js'

/**
 * `bstage init`이 만드는 파일 목록의 회귀 방지.
 *
 * 조립이 순수 함수라 프롬프트·네트워크·디스크 없이 목록만 대조할 수 있다. 여기서 쓰는
 * appKey·appId는 전부 더미이고, 산출물(`.env` 포함)은 어떤 경우에도 출력하지 않는다.
 */

const dirs: string[] = []

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

const DUMMY_APP_KEY = 'bsp_dummy_for_test'

function input(overrides: Partial<SdkScaffoldInput> = {}): SdkScaffoldInput {
  return {
    space: 'acme',
    projectName: 'acme-custom-templates-sandbox',
    templateName: 'acme-hello',
    target: 'user',
    phase: 'sandbox',
    packageManager: 'npm',
    appId: 'bsa_dummy_for_test',
    appKey: DUMMY_APP_KEY,
    tenantId: 'acme',
    sdkVersions: { cli: '0.0.0', core: '0.0.0', react: '0.0.0', design: '0.0.0' },
    ...overrides,
  }
}

/** 디렉터리 아래 파일 개수(디렉터리 제외)를 재귀로 센다. */
function countFiles(dir: string): number {
  let total = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) total += countFiles(join(dir, entry.name))
    else if (entry.isFile()) total++
  }
  return total
}

const SKILL_NAMES = ['bstage-template', 'bstage-migrate', 'bstage-onboarding', 'bstage-deploy']

const EXPECTED_FILES = [
  'AGENTS.md',
  'CLAUDE.md',
  'README.md',
  'package.json',
  'tsconfig.json',
  'tsconfig.app.json',
  'tsconfig.node.json',
  'vite.config.ts',
  '.env',
  '.env.example',
  'index.html',
  '.gitignore',
  '.husky/pre-commit',
  '.husky/check-secrets.mjs',
  'eslint.config.js',
  'src/main.tsx',
  'src/App.tsx',
  'src/index.css',
  'src/vite-env.d.ts',
  'src/shared/client.ts',
  'src/pages/acme-hello/template.tsx',
  'src/slots/README.md',
  ...SKILL_NAMES.map((name) => `.claude/skills/${name}/SKILL.md`),
]

describe('scaffoldSdk', () => {
  it('1. 스캐폴드가 내는 파일 경로 집합 (sdk 스킬 4종 포함, liquid 스킬 제외)', () => {
    const paths = new Set(scaffoldSdk(input()).files.map((f) => f.path))

    for (const expected of EXPECTED_FILES) {
      expect(paths.has(expected), `${expected}가 없다`).toBe(true)
    }
    expect(paths.has('.claude/skills/bstage-liquid/SKILL.md')).toBe(false)
  })

  it('2. pnpm이면 pnpm-workspace.yaml이 있고 npm이면 없다', () => {
    const pnpmPaths = scaffoldSdk(input({ packageManager: 'pnpm' })).files.map((f) => f.path)
    const npmPaths = scaffoldSdk(input({ packageManager: 'npm' })).files.map((f) => f.path)

    expect(pnpmPaths).toContain('pnpm-workspace.yaml')
    expect(npmPaths).not.toContain('pnpm-workspace.yaml')
  })

  it('3. package.json의 bstage에 kind와 target이 기록된다', () => {
    const pkgFile = scaffoldSdk(input({ target: 'admin' })).files.find(
      (f) => f.path === 'package.json',
    )
    const parsed = JSON.parse(pkgFile!.content) as { bstage?: unknown }

    expect(parsed.bstage).toEqual({ kind: 'sdk', target: 'admin' })
  })

  it('4. dirs에 스킬 디렉터리 4종과 템플릿·슬롯 디렉터리가 들어간다', () => {
    const { dirs: scaffoldDirs } = scaffoldSdk(input())

    for (const name of SKILL_NAMES) {
      expect(scaffoldDirs).toContain(`.claude/skills/${name}`)
    }
    expect(scaffoldDirs).toContain('src/pages/acme-hello')
    expect(scaffoldDirs).toContain('src/slots')
    expect(scaffoldDirs).not.toContain('.claude/skills/bstage-liquid')
  })

  it('5. .env는 입력한 키를, .env.example은 placeholder를 담는다', () => {
    const files = scaffoldSdk(input()).files
    const dotEnv = files.find((f) => f.path === '.env')!.content
    const example = files.find((f) => f.path === '.env.example')!.content

    expect(dotEnv).toContain(DUMMY_APP_KEY)
    expect(example).toContain('YOUR_APP_KEY')
    expect(example).not.toContain(DUMMY_APP_KEY)
  })

  it('6. writeScaffold가 files 개수만큼 파일을 쓴다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bstage-scaffold-'))
    dirs.push(dir)
    const scaffold = scaffoldSdk(input({ packageManager: 'pnpm' }))

    writeScaffold(dir, scaffold)

    expect(countFiles(dir)).toBe(scaffold.files.length)
    // pre-commit 훅은 실행 비트가 있어야 git이 실행한다
    expect(statSync(join(dir, '.husky', 'pre-commit')).mode & 0o111).not.toBe(0)
  })
})
