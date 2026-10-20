import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { MANIFEST_ENTRY, MANIFEST_FILE } from '../build/manifest.js'
import { CORE_PACKAGE } from '../vite/bundledPackagesPlugin.js'
import { buildCommand } from './build.js'

/**
 * `bstage build`를 실제 Vite로 돌려 산출물 디렉터리(페이지·위젯)마다 `template.js` 옆에 `manifest.json`이
 * 생기는지 고정한다. manifest 단위 테스트(`manifest.test.ts`)는 내용 규칙만 보므로, 빌드 흐름에서 쓰는 위치
 * (스테이징이 아닌 최종 디렉터리)와 번들에서 읽은 core 버전·bridgeProtocol이 실리는지는 여기서만 드러난다.
 *
 * core는 픽스처 안의 가짜 패키지다 — 저장소의 core dist 빌드 여부와 무관하게 돌고, 버전·bridgeProtocol을
 * 픽스처가 정한다. 경로·import는 `CORE_PACKAGE`로 만든다(공개판에서 스코프가 바뀌어도 맞게).
 */

const CORE_VERSION = '1.2.3-rc.1'

const root = mkdtempSync(join(tmpdir(), 'bstage-build-manifest-'))

afterAll(() => {
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
})

function writeFixture(files: Readonly<Record<string, string>>): void {
  Object.entries(files).forEach(([rel, content]) => {
    const abs = join(root, rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, content)
  })
}

const corePath = join('node_modules', ...CORE_PACKAGE.split('/'))

const FAKE_CORE: Readonly<Record<string, string>> = {
  [join(corePath, 'package.json')]: JSON.stringify({
    name: CORE_PACKAGE,
    version: CORE_VERSION,
    type: 'module',
    exports: { '.': './index.js' },
    bstage: { bridgeProtocol: 1 },
  }),
  [join(corePath, 'index.js')]:
    'export function createWebComponent(_a, _c, options) {\n' +
    '  return class extends HTMLElement { static tag = options.name }\n' +
    '}\n',
}

function template(name: string, slot?: string): string {
  const slotProp = slot ? `, slot: '${slot}'` : ''
  return (
    `import { createWebComponent } from '${CORE_PACKAGE}'\n` +
    `const El = createWebComponent(() => null, null, { name: '${name}'${slotProp} })\n` +
    `customElements.define('${name}', El)\n`
  )
}

function readManifest(dir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, MANIFEST_FILE), 'utf-8'))
}

describe('bstage build — 산출물 manifest.json', () => {
  it('페이지·위젯 산출물 디렉터리마다 template.js 옆에 manifest.json을 쓴다', async () => {
    writeFixture({
      ...FAKE_CORE,
      'package.json': JSON.stringify({ name: 'fixture', private: true, type: 'module' }),
      'src/pages/landing/template.tsx': template('it-landing'),
      'src/slots/banner/template.tsx': template('it-banner', 'user.contents-home.curation:after'),
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})

    await buildCommand({}, { cwd: root })

    const outputs = [
      [join(root, 'dist', 'landing'), 'it-landing'],
      [join(root, 'dist', 'user.contents-home.curation--after'), 'it-banner'],
    ] as const
    outputs.forEach(([dir, elementName]) => {
      expect(existsSync(join(dir, MANIFEST_ENTRY))).toBe(true)
      expect(readManifest(dir)).toEqual({
        elementName,
        entry: MANIFEST_ENTRY,
        sdkVersion: CORE_VERSION,
        framework: 'vanilla',
        bridgeProtocol: 1,
      })
    })
    // dist 바로 아래(스테이징·루트)에는 manifest가 남지 않는다 — 루트 페이지가 없는 빌드다.
    expect(existsSync(join(root, 'dist', MANIFEST_FILE))).toBe(false)
  }, 60_000)
})
