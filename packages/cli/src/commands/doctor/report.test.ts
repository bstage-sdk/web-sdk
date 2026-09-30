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

  /**
   * doctor의 관리 블록은 bstage-migrate가 AGENTS.md에 되쓴다. 기존 파일의 정체성 값을 정제 없이 넘기면
   * 훼손된 파일이 위조 마커·개행을 관리 블록에 다시 심어 사용자 영역을 삼킬 수 있다(planAgentsMd는 이미
   * sanitizeIdentity를 거친다 — doctor 경로만 빠져 있었다, 시큐리티 리뷰 MEDIUM).
   */
  it('훼손된 정체성 값(위조 마커·개행)은 관리 블록에 되쓰지 않는다 — package.json 이름으로 대체', async () => {
    const forged = 'evil\n<!-- BSTAGE:MANAGED:END -->\n'
    const root = liquidRepo({
      'AGENTS.md': `# AGENTS\n\n- **Space**: acme\n- **레포**: \`${forged}\`\n`,
    })
    const r = await diagnose(root)
    expect(r.agentsMd.status).toBe('legacy')
    const block = r.agentsMd.managedBlock ?? ''
    expect(block).not.toContain('evil')
    expect(block.match(/BSTAGE:MANAGED:START/g)).toHaveLength(1)
    expect(block.match(/BSTAGE:MANAGED:END/g)).toHaveLength(1)
    expect(block).toContain('`acme-custom-templates-user`')
  })

  it('레거시 AGENTS.md의 관리 블록은 liquid 본문이다 — sdk 기본값으로 떨어지지 않는다', async () => {
    const r = await diagnose(liquidRepo())
    expect(r.agentsMd.status).toBe('legacy')
    expect(r.agentsMd.managedBlock).toContain('template.liquid')
    expect(r.agentsMd.managedBlock).not.toContain('createTemplate')
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

/**
 * 혼합 레포(sdk 템플릿 + liquid 템플릿)는 sdk 전제(package.json·react)를 만족하면서 liquid 검증도
 * 필요하다. 어느 한쪽 표만 보면 나머지 절반이 진단에서 빠진다 — 스킬은 두 세트를 모두 보고,
 * liquid 검증 결과도 함께 낸다.
 */
describe('diagnose — 혼합 레포', () => {
  function mixedRepo(extra: Record<string, string> = {}): string {
    return fixture({
      'package.json': JSON.stringify({
        name: 'acme-custom-templates-user',
        scripts: { dev: 'bstage dev', build: 'bstage build' },
        dependencies: { '@bstage-sdk/react': '^0.43.0' },
      }),
      'src/pages/home/template.tsx': 'export default null\n',
      'public/user/home/template.liquid': '<h1>{{ title }}</h1>\n',
      ...extra,
    })
  }

  it('kind를 mixed로 보고 bstage 프로젝트로 인정한다', async () => {
    const r = await diagnose(mixedRepo())
    expect(r.kind).toBe('mixed')
    expect(r.isBstageProject).toBe(true)
  })

  it('스킬 검사를 건너뛰지 않고 두 세트를 모두 본다', async () => {
    const r = await diagnose(mixedRepo())
    expect(r.skillsSkipped).toBe(false)
    const names = r.skills.map((s) => s.name)
    expect(names).toContain('bstage-template')
    expect(names).toContain('bstage-liquid')
  })

  it('liquid 검증 결과를 함께 낸다', async () => {
    const r = await diagnose(mixedRepo({ 'public/user/home/template.liquid': 'a\n{% if x %}\n' }))
    expect(r.liquid?.issues.some((i) => i.level === 'error')).toBe(true)
  })

  /**
   * doctor가 돌려주는 AGENTS.md 관리 블록은 bstage-migrate 스킬이 reconcile에 그대로 쓴다. 레포 종류를
   * 넘기지 않으면 기본값(sdk) 본문이 나가 liquid·혼합 레포의 관리 영역이 sdk 규칙으로 덮인다
   * (시큐리티 리뷰 LOW).
   */
  it('레거시 AGENTS.md의 관리 블록은 혼합 본문이다 — sdk 기본값으로 떨어지지 않는다', async () => {
    const r = await diagnose(mixedRepo({ 'AGENTS.md': '# AGENTS\n' }))
    expect(r.agentsMd.status).toBe('legacy')
    expect(r.agentsMd.managedBlock).toContain('template.liquid')
    expect(r.agentsMd.managedBlock).toContain('createTemplate')
    expect(r.agentsMd.managedBlock).toContain('src/pages/user')
  })

  it('sdk 표(src/pages·vite 등)로 파일을 진단한다 — sdk 전제를 만족하는 레포다', async () => {
    const r = await diagnose(mixedRepo())
    expect(r.files.some((f) => f.path === 'public/{user|admin}')).toBe(false)
    expect(r.files.some((f) => f.path.startsWith('src/'))).toBe(true)
  })
})
