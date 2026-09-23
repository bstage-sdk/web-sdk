import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { diagnose } from './report.js'

/**
 * liquid 레포는 sdk 전제를 하나도 만족하지 않는다 — react도 vite도 tsconfig도 없다.
 * 그대로 sdk 표로 진단하면 "bstage 프로젝트가 아닙니다"로 끝나거나 없는 파일만 잔뜩 나열한다.
 * 손 검증은 sdk 레포에서 돌려 보는 것으로 끝나므로 이 분기는 테스트로만 덮인다.
 */

const roots: string[] = []

/**
 * 공개판 `diagnose`는 최신 버전을 npm 레지스트리에 물어본다. 테스트가 네트워크를 타지 않게
 * fetch 를 실패로 막는다 — 조회 실패는 `latest: null` 로 끝나고 진단은 계속된다.
 */
beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline (test)'))
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'doctor-liquid-'))
  roots.push(root)
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content, 'utf-8')
  }
  return root
}

const LIQUID_PKG = JSON.stringify({
  name: 'acme-custom-templates-user',
  bstage: { kind: 'liquid', target: 'user' },
  scripts: { dev: 'bstage dev', build: 'bstage build' },
  dependencies: { '@bstage-sdk/cli': '^0.55.0' },
})

function liquidRepo(extra: Record<string, string> = {}): string {
  return fixture({
    'package.json': LIQUID_PKG,
    'public/user/home/template.liquid': '<h1>{{ title }}</h1>\n',
    'public/user/home/data.json': '{"title":"x"}\n',
    'AGENTS.md': '# AGENTS\n',
    ...extra,
  })
}

describe('diagnose — liquid 레포', () => {
  it('kind를 liquid로 보고 bstage 프로젝트로 인정한다', async () => {
    const r = await diagnose(liquidRepo())
    expect(r.kind).toBe('liquid')
    expect(r.isBstageProject).toBe(true)
  })

  it('cli를 아예 의존하지 않아도 bstage 프로젝트다 — 판정 근거는 파일 구조다', async () => {
    const root = liquidRepo({ 'package.json': JSON.stringify({ name: 'x' }) })
    const r = await diagnose(root)
    expect(r.isBstageProject).toBe(true)
  })

  it('버전 표는 cli 한 줄뿐이다 — liquid가 의존하는 SDK 패키지는 그것뿐이다', async () => {
    const r = await diagnose(liquidRepo())
    expect(r.versions.map((v) => v.pkg)).toEqual(['@bstage-sdk/cli'])
  })

  it('cli가 설치·선언돼 있지 않아도 행은 남는다 (설치 안 됨이 곧 진단 결과다)', async () => {
    const root = liquidRepo({ 'package.json': JSON.stringify({ name: 'x' }) })
    const r = await diagnose(root)
    // 공개판은 토큰 없이 npm 레지스트리를 보므로 latest 는 실행 환경에 따라 달라진다 —
    // 행이 남는지와 설치 여부만 본다(이 테스트가 보려는 것도 그것이다).
    expect(r.versions).toHaveLength(1)
    expect(r.versions[0]).toMatchObject({ pkg: '@bstage-sdk/cli', installed: null })
  })

  it('liquid 전용 표를 쓴다 — public/{user|admin}·AGENTS.md, dev·build 스크립트', async () => {
    const r = await diagnose(liquidRepo())
    expect(r.files.map((f) => f.path)).toEqual(['public/{user|admin}', 'AGENTS.md'])
    expect(r.files.every((f) => f.present)).toBe(true)
    expect(r.scripts.map((s) => [s.name, s.expected, s.actual])).toEqual([
      ['dev', 'bstage dev', 'bstage dev'],
      ['build', 'bstage build', 'bstage build'],
    ])
    // sdk 전용 권장 의존성(design·@types/node)은 liquid에 해당이 없다.
    expect(r.recommendedDeps).toEqual([])
  })

  it('public/admin만 있어도 템플릿 루트가 있는 것으로 본다', async () => {
    const root = fixture({
      'package.json': LIQUID_PKG,
      'public/admin/home/template.liquid': '<h1>x</h1>\n',
      'AGENTS.md': '# AGENTS\n',
    })
    const r = await diagnose(root)
    expect(r.files.find((f) => f.path === 'public/{user|admin}')?.present).toBe(true)
  })

  it('validateLiquid 결과를 liquid.issues로 함께 낸다', async () => {
    const root = liquidRepo({ 'public/user/home/template.liquid': 'a\nb\n{% if x %}\n' })
    const r = await diagnose(root)
    expect(r.liquid?.issues.some((i) => i.level === 'error')).toBe(true)
  })

  it('레지스트리 조회가 실패해도 진단은 끝난다 — latest 는 null', async () => {
    const r = await diagnose(liquidRepo())
    expect(r.versions[0]).toMatchObject({ latest: null })
  })

  it('sdk 레포에서는 liquid가 null이라 기존 소비자가 분기할 수 있다', async () => {
    const root = fixture({
      'package.json': JSON.stringify({
        name: 'sdk-repo',
        dependencies: { '@bstage-sdk/react': '^0.43.0' },
      }),
      'src/pages/home/template.tsx': 'export default null\n',
    })
    const r = await diagnose(root)
    expect(r.kind).toBe('sdk')
    expect(r.liquid).toBeNull()
    expect(r.files.map((f) => f.path)).toContain('tsconfig.app.json')
  })
})
