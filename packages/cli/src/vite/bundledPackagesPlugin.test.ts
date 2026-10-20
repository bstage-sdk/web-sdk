import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { pickBridgeProtocol, pickSdkVersion } from '../build/manifest.js'
import {
  CORE_PACKAGE,
  createBundledPackagesPlugin,
  REACT_PACKAGE,
  UNKNOWN_VERSION,
} from './bundledPackagesPlugin.js'

/**
 * manifest의 sdkVersion은 "번들에 실린 core"에서 온다. pnpm 레이아웃(.pnpm 스토어 아래 실경로),
 * name 없는 중첩 package.json, 트리셰이킹된 모듈은 정상 빌드 한 번으로는 갈리지 않는 분기다.
 */

type GenerateBundle = (options: unknown, bundle: Record<string, unknown>) => void

let root = ''

const CORE_NAME = CORE_PACKAGE
const REACT_NAME = REACT_PACKAGE

/** pnpm 스토어 디렉터리명(`@scope+name@version`). 스코프 리터럴을 쓰지 않아 공개판 스코프로 치환돼도 맞는다. */
function pnpmStoreDir(name: string, version: string): string {
  return `${name.replace('/', '+')}@${version}`
}

function pkg(dir: string, json: object): string {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify(json))
  return dir
}

function generate(modules: Record<string, number>) {
  const created = createBundledPackagesPlugin()
  const { plugin } = created
  const chunk = {
    type: 'chunk',
    modules: Object.fromEntries(
      Object.entries(modules).map(([id, renderedLength]) => [id, { renderedLength }]),
    ),
  }
  ;(plugin.generateBundle as unknown as GenerateBundle)(
    {},
    { 'template.js': chunk, 'x.css': { type: 'asset' } },
  )
  return created
}

function run(modules: Record<string, number>) {
  return generate(modules).getBundled()
}

function protocols(modules: Record<string, number>): (number | null)[] {
  return [...(generate(modules).getBridgeProtocols().get('@bstage-sdk/core') ?? [])]
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bstage-bundled-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('createBundledPackagesPlugin', () => {
  it('pnpm 스토어 실경로에서 core 버전을 읽는다', () => {
    const core = pkg(
      join(
        root,
        `node_modules/.pnpm/${pnpmStoreDir(CORE_NAME, '0.48.0')}/node_modules/${CORE_NAME}`,
      ),
      { name: '@bstage-sdk/core', version: '0.48.0' },
    )
    // dist 아래 name 없는 package.json은 건너뛰고 패키지 루트까지 올라간다.
    pkg(join(core, 'dist'), { type: 'module' })
    const bundled = run({ [join(core, 'dist/index.js')]: 120 })
    expect([...(bundled.get('@bstage-sdk/core') ?? [])]).toEqual(['0.48.0'])
  })

  it('렌더되지 않은(트리셰이킹된) 모듈은 세지 않는다', () => {
    const core = pkg(join(root, 'core'), { name: '@bstage-sdk/core', version: '0.47.1' })
    expect(run({ [join(core, 'index.js')]: 0 }).size).toBe(0)
  })

  it('깨진 package.json에서 멈추고 바깥 패키지로 귀속하지 않는다', () => {
    const outer = pkg(join(root, 'outer'), { name: '@bstage-sdk/core', version: '0.48.0' })
    mkdirSync(join(outer, 'inner'), { recursive: true })
    writeFileSync(join(outer, 'inner', 'package.json'), '{ broken')
    expect(run({ [join(outer, 'inner', 'i.js')]: 1 }).size).toBe(0)
  })

  it('귀속하지 못한 core 사본은 버리지 않고 "모름"으로 남긴다 — 다른 사본 버전만 주장하지 않게', () => {
    const good = pkg(join(root, 'good'), { name: '@bstage-sdk/core', version: '0.48.0' })
    const broken = join(root, 'node_modules/@bstage-sdk/core')
    mkdirSync(broken, { recursive: true })
    writeFileSync(join(broken, 'package.json'), '{ broken')
    const bundled = run({
      [join(good, 'i.js')]: 1,
      [join(broken, 'i.js')]: 1,
      '\0virtual:@bstage-sdk/core/x': 1,
    })
    const versions = [...(bundled.get('@bstage-sdk/core') ?? [])]
    expect(versions.sort()).toEqual(['0.48.0', UNKNOWN_VERSION])
    expect(pickSdkVersion(versions)).toBeUndefined()
  })

  it('pnpm 중첩 경로에서는 가장 안쪽 SDK 패키지로 추정한다', () => {
    const good = pkg(join(root, 'good'), { name: '@bstage-sdk/core', version: '0.48.0' })
    const nested = join(
      root,
      `node_modules/.pnpm/${pnpmStoreDir(REACT_NAME, '0.44.0')}/node_modules/${CORE_NAME}`,
    )
    mkdirSync(nested, { recursive: true })
    writeFileSync(join(nested, 'package.json'), '{ broken')
    const bundled = run({ [join(good, 'i.js')]: 1, [join(nested, 'dist/index.js')]: 1 })
    expect(bundled.has('@bstage-sdk/react')).toBe(false)
    expect(pickSdkVersion(bundled.get('@bstage-sdk/core') ?? [])).toBeUndefined()
  })

  it('version 없는 SDK package.json도 "모름"으로 남긴다', () => {
    const core = pkg(join(root, 'nov'), { name: '@bstage-sdk/core' })
    expect([...(run({ [join(core, 'i.js')]: 1 }).get('@bstage-sdk/core') ?? [])]).toEqual([
      UNKNOWN_VERSION,
    ])
  })

  it('SDK 범위 밖 패키지·가상 모듈·쿼리는 무시하거나 정리한다', () => {
    const react = pkg(join(root, 'react'), { name: 'react', version: '19.0.0' })
    const sdkReact = pkg(join(root, 'sdk-react'), {
      name: '@bstage-sdk/react',
      version: '0.44.0',
    })
    const bundled = run({
      [join(react, 'index.js')]: 10,
      '\0vite/preload-helper': 10,
      [`${join(sdkReact, 'index.js')}?commonjs-proxy`]: 10,
    })
    expect([...bundled.keys()]).toEqual(['@bstage-sdk/react'])
  })

  it('두 사본이 실리면 두 버전을 모두 기록한다', () => {
    const a = pkg(join(root, 'a'), { name: '@bstage-sdk/core', version: '0.47.1' })
    const b = pkg(join(root, 'b'), { name: '@bstage-sdk/core', version: '0.48.0' })
    const bundled = run({ [join(a, 'i.js')]: 1, [join(b, 'i.js')]: 1 })
    expect([...(bundled.get('@bstage-sdk/core') ?? [])].sort()).toEqual([
      '0.47.1',
      '0.48.0',
    ])
  })
})

describe('createBundledPackagesPlugin — bridgeProtocol', () => {
  const CORE = '@bstage-sdk/core'

  it('package.json의 bstage.bridgeProtocol을 읽는다', () => {
    const core = pkg(join(root, 'core'), {
      name: CORE,
      version: '0.48.0',
      bstage: { bridgeProtocol: 1 },
    })
    expect(protocols({ [join(core, 'i.js')]: 1 })).toEqual([1])
  })

  it('필드가 없는(브리지 이전) core는 "모름"(null)이다', () => {
    const core = pkg(join(root, 'old'), { name: CORE, version: '0.46.0' })
    expect(protocols({ [join(core, 'i.js')]: 1 })).toEqual([null])
  })

  it.each([0, -1, 1.5, '1', null, { v: 1 }])(
    '정수가 아닌 값 %j 은 "모름"이다',
    (bridgeProtocol) => {
      const core = pkg(join(root, 'bad'), {
        name: CORE,
        version: '0.48.0',
        bstage: { bridgeProtocol },
      })
      expect(protocols({ [join(core, 'i.js')]: 1 })).toEqual([null])
    },
  )

  it('두 사본 중 하나가 필드가 없으면 manifest에 적지 않는다', () => {
    const a = pkg(join(root, 'a'), { name: CORE, version: '0.48.0', bstage: { bridgeProtocol: 1 } })
    const b = pkg(join(root, 'b'), { name: CORE, version: '0.46.0' })
    const values = protocols({ [join(a, 'i.js')]: 1, [join(b, 'i.js')]: 1 })
    expect(values.sort()).toEqual([1, null])
    expect(pickBridgeProtocol(values)).toBeUndefined()
  })

  it('두 사본이 모두 알면 작은 값을 고른다', () => {
    const a = pkg(join(root, 'a'), { name: CORE, version: '0.49.0', bstage: { bridgeProtocol: 2 } })
    const b = pkg(join(root, 'b'), { name: CORE, version: '0.48.0', bstage: { bridgeProtocol: 1 } })
    expect(pickBridgeProtocol(protocols({ [join(a, 'i.js')]: 1, [join(b, 'i.js')]: 1 }))).toBe(1)
  })

  it('귀속하지 못한 사본(가상 모듈·깨진 package.json)은 "모름"이다', () => {
    const good = pkg(join(root, 'good'), {
      name: CORE,
      version: '0.48.0',
      bstage: { bridgeProtocol: 1 },
    })
    const values = protocols({
      [join(good, 'i.js')]: 1,
      '\0virtual:@bstage-sdk/core/x': 1,
    })
    expect(pickBridgeProtocol(values)).toBeUndefined()
  })
})

describe('createBundledPackagesPlugin — 실제 Vite 빌드', () => {
  it('Rollup 출력 청크에서 번들된 core 버전을 읽는다', async () => {
    const { build } = await import('vite')
    const coreDir = fileURLToPath(new URL('../../../core', import.meta.url))
    const coreVersion = (
      JSON.parse(readFileSync(join(coreDir, 'package.json'), 'utf-8')) as { version: string }
    ).version
    const entry = join(root, 'entry.ts')
    writeFileSync(
      entry,
      `import * as core from ${JSON.stringify(join(coreDir, 'src/index.ts'))}\n` +
        'console.log(Object.keys(core))\n',
    )
    const { plugin, getBundled, getBridgeProtocols } = createBundledPackagesPlugin()
    await build({
      configFile: false,
      root,
      logLevel: 'silent',
      plugins: [plugin],
      build: {
        lib: { entry, formats: ['iife'], name: 'T', fileName: () => 'template.js' },
        outDir: join(root, 'out'),
        write: false,
      },
    })
    expect([...(getBundled().get('@bstage-sdk/core') ?? [])]).toEqual([coreVersion])
    // 공개 스냅샷도 core package.json의 bstage 필드를 그대로 내보낸다 — 실제 core가 1을 선언한다.
    expect([...(getBridgeProtocols().get('@bstage-sdk/core') ?? [])]).toEqual([1])
  }, 30_000)
})
