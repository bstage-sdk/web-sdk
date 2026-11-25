import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { scanSource } from '../../portal/sourceManifest.js'
import { checkEnvFile } from '../../templates/envSecrets.js'
import { scaffoldSdk, writeScaffold, type Scaffold } from './scaffold.js'
import { scaffoldLiquid } from './scaffoldLiquid.js'

/**
 * AWS Security Agent 6차(Ruling 24 S1) — `bstage push` 의 올릴 파일 허용 목록이 `bstage init` 이 만든 프로젝트의
 * 필요한 파일을 하나도 빠뜨리지 않는지 고정한다. 템플릿에 새 파일 종류가 생기면 여기서 깨진다 — 허용 목록에 더한다.
 * 일부러 올리지 않는 것은 로컬 비밀 파일(`.env` — 실제 값, `.npmrc` — 레지스트리 토큰 자리)뿐이다.
 */

const NEVER_UPLOADED = new Set(['.env', '.npmrc'])

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

async function scanScaffold(s: Scaffold) {
  const dir = mkdtempSync(join(tmpdir(), 'bstage-scaffold-upload-'))
  dirs.push(dir)
  writeScaffold(dir, s)
  return scanSource(dir)
}

const sdkCases = (['npm', 'pnpm'] as const).flatMap((packageManager) =>
  (['user', 'admin'] as const).map((target) => ({ packageManager, target })),
)

describe('템플릿 프로젝트는 허용 목록으로 빠짐없이 올라간다', () => {
  it.each(sdkCases)('sdk ($packageManager, $target)', async ({ packageManager, target }) => {
    const s = scaffoldSdk({
      space: 'acme',
      projectName: 'acme-custom-templates-sandbox',
      templateName: 'acme-hello',
      target,
      phase: 'sandbox',
      packageManager,
      appId: 'bsa_dummy_for_test',
      appKey: 'bsp_dummy_for_test',
      tenantId: 'acme',
      sdkVersions: { cli: '0.0.0', core: '0.0.0', react: '0.0.0', design: '0.0.0' },
    })
    const r = await scanScaffold(s)
    expect(r.notAllowed).toEqual([])
    expect(r.invalid).toEqual([])
    expect(r.files.map((f) => f.path)).toEqual(
      s.files
        .map((f) => f.path)
        .filter((p) => !NEVER_UPLOADED.has(p))
        .sort(),
    )
    // 생성된 .env.example 은 견본 규칙을, .env 를 .env.production 으로 옮긴 것은 VITE_ 공개 값 규칙을 통과한다.
    const content = (p: string) => s.files.find((f) => f.path === p)!.content
    expect(checkEnvFile(content('.env.example'), 'placeholder')).toEqual([])
    expect(checkEnvFile(content('.env'), 'mode')).toEqual([])
  })

  it.each(['npm', 'pnpm'] as const)('liquid (%s)', async (packageManager) => {
    const s = scaffoldLiquid({
      space: 'acme',
      projectName: 'acme-custom-templates-sandbox',
      templateName: 'hello',
      target: 'user',
      packageManager,
      cliVersion: '0.0.0',
    })
    const r = await scanScaffold(s)
    expect(r.notAllowed).toEqual([])
    expect(r.invalid).toEqual([])
    expect(r.files.map((f) => f.path)).toEqual(
      s.files
        .map((f) => f.path)
        .filter((p) => !NEVER_UPLOADED.has(p))
        .sort(),
    )
  })
})
