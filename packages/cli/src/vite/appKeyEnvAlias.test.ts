import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { appKeyEnvAliasPlugin, appKeyEnvDefine } from './appKeyEnvAlias.js'

/**
 * 앱 키의 환경변수 이름이 `VITE_BSTAGE_APP_SECRET`(옛)에서 `VITE_BSTAGE_APP_KEY`(새)로 바뀌었다.
 * 소스와 .env가 서로 다른 이름을 쓰는 조합이 별칭 기간 동안 실제로 생긴다 — 기존 프로젝트의
 * `client.ts`는 옛 이름을 읽는데 포털의 환경변수 드롭다운은 새 이름을 넣는다. 그 조합을
 * 빌드가 이어 붙이지 않으면 번들에 undefined가 박혀 배포 뒤 401로만 드러난다.
 */
describe('appKeyEnvDefine', () => {
  it('새 이름만 있으면 옛 이름으로도 읽히게 한다 — 옛 client.ts + 포털이 넣은 새 .env', () => {
    expect(appKeyEnvDefine({ VITE_BSTAGE_APP_KEY: 'bsp_key' })).toEqual({
      'import.meta.env.VITE_BSTAGE_APP_SECRET': '"bsp_key"',
    })
  })

  it('옛 이름만 있으면 새 이름으로도 읽히게 한다 — 새 client.ts + 옛 .env', () => {
    expect(appKeyEnvDefine({ VITE_BSTAGE_APP_SECRET: 'bsp_legacy' })).toEqual({
      'import.meta.env.VITE_BSTAGE_APP_KEY': '"bsp_legacy"',
    })
  })

  it('둘 다 있으면 손대지 않는다 — 각자 실제 값이 그대로 실린다', () => {
    expect(
      appKeyEnvDefine({ VITE_BSTAGE_APP_KEY: 'bsp_key', VITE_BSTAGE_APP_SECRET: 'bsp_legacy' }),
    ).toEqual({})
  })

  it('둘 다 없으면 아무것도 정의하지 않는다 — UI 전용 템플릿', () => {
    expect(appKeyEnvDefine({})).toEqual({})
  })

  it('빈 문자열·공백은 없는 값으로 본다', () => {
    expect(
      appKeyEnvDefine({ VITE_BSTAGE_APP_KEY: '  ', VITE_BSTAGE_APP_SECRET: 'bsp_legacy' }),
    ).toEqual({ 'import.meta.env.VITE_BSTAGE_APP_KEY': '"bsp_legacy"' })
  })

  it('값을 JSON 문자열로 감싼다 — define은 코드 조각으로 치환되므로 따옴표 없이는 식별자가 된다', () => {
    const define = appKeyEnvDefine({ VITE_BSTAGE_APP_KEY: 'bsp_a"b' })
    expect(JSON.parse(define['import.meta.env.VITE_BSTAGE_APP_SECRET'])).toBe('bsp_a"b')
  })
})

describe('appKeyEnvAliasPlugin', () => {
  const dirs: string[] = []
  function project(envFile: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'bstage-app-key-alias-'))
    dirs.push(dir)
    writeFileSync(join(dir, '.env'), envFile)
    return dir
  }
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  function runConfig(root: string, mode: string) {
    const plugin = appKeyEnvAliasPlugin()
    const hook = plugin.config as (
      config: { root?: string },
      env: { mode: string; command: 'build' | 'serve' },
    ) => { define?: Record<string, string> }
    return hook({ root }, { mode, command: mode === 'production' ? 'build' : 'serve' })
  }

  it('프로젝트 .env를 Vite와 같은 규칙으로 읽어 define을 만든다', () => {
    const root = project('VITE_BSTAGE_APP_KEY=bsp_from_env\n')
    expect(runConfig(root, 'production').define).toEqual({
      'import.meta.env.VITE_BSTAGE_APP_SECRET': '"bsp_from_env"',
    })
  })

  it('.env에 두 이름이 다 있으면 define을 비운다', () => {
    const root = project('VITE_BSTAGE_APP_KEY=bsp_a\nVITE_BSTAGE_APP_SECRET=bsp_b\n')
    expect(runConfig(root, 'development').define).toEqual({})
  })
})
