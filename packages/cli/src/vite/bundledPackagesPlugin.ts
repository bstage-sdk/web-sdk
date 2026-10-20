import { readFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import type { Plugin } from 'vite'
import { isValidBridgeProtocol } from '../build/manifest.js'

/**
 * 번들에 실린 패키지 이름 → 실린 버전들. 버전을 알 수 없는 사본은 {@link UNKNOWN_VERSION}으로 남는다 —
 * 소비자(`pickSdkVersion`)는 SemVer가 아닌 값이 하나라도 있으면 버전을 주장하지 않는다(fail-closed).
 */
export type BundledPackages = ReadonlyMap<string, ReadonlySet<string>>

/**
 * 번들에 실린 패키지 이름 → 실린 사본들의 `package.json` `bstage.bridgeProtocol` 값.
 * 필드가 없거나 양의 정수가 아니거나 사본을 package.json으로 귀속하지 못했으면 `null`("모름")이다 —
 * 소비자(`pickBridgeProtocol`)는 `null`이 하나라도 있으면 값을 주장하지 않는다(fail-closed).
 */
export type BundledBridgeProtocols = ReadonlyMap<string, ReadonlySet<number | null>>

interface PackageInfo {
  name: string
  version: string
  bridgeProtocol: number | null
}

/** `bstage.bridgeProtocol`을 읽는다. 양의 안전 정수만 값으로 인정하고 나머지는 "모름"(null)이다. */
function readBridgeProtocol(pkg: { bstage?: unknown }): number | null {
  const bstage = pkg.bstage
  if (typeof bstage !== 'object' || bstage === null) return null
  const value = (bstage as { bridgeProtocol?: unknown }).bridgeProtocol
  return isValidBridgeProtocol(value) ? value : null
}

/** 사본은 실렸는데 버전을 읽지 못했다는 표시. SemVer가 아니어서 게이트에서 "모름"으로 읽힌다. */
export const UNKNOWN_VERSION = 'unknown'

/**
 * manifest가 읽는 SDK 패키지 이름. 스코프 접두사로 조립하지 않고 전체를 적는다 — 공개 스냅샷은
 * `@bstage-sdk/` 접두사째 치환하므로 조립하면 공개판 이름(`@bstage-sdk/core`)과 어긋난다.
 */
export const CORE_PACKAGE = '@bstage-sdk/core'
export const REACT_PACKAGE = '@bstage-sdk/react'

/** 이 접두사의 패키지만 기록한다 — manifest에 필요한 건 SDK 패키지뿐이다. */
const TRACKED_SCOPE = '@bstage-sdk/'

/**
 * 스코프 디렉터리(`@scope`) 뒤에 `/`·`\`(npm, posix·win) 또는 `+`(pnpm 스토어 디렉터리명)가 오고 패키지
 * 이름이 이어지는 자리. 스코프는 {@link TRACKED_SCOPE}에서 만든다 — 패키지 이름을 리터럴로 적으면 공개판처럼
 * 스코프·이름 규칙이 다른 빌드에서 추정이 어긋난다.
 */
const SDK_PATH_RE = new RegExp(
  `${TRACKED_SCOPE.slice(0, -1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[/\\\\+]([a-z0-9][a-z0-9-]*)`,
  'g',
)

/**
 * package.json으로 귀속하지 못한 모듈 id에서 SDK 패키지 이름을 추정한다(npm·pnpm 레이아웃, posix·win 경로).
 * 이름만 알고 버전은 모르므로 UNKNOWN_VERSION으로 기록한다 — 조용히 버리면 다른 사본의 버전만 남아
 * 실린 것보다 높은 버전을 주장할 수 있다.
 */
function guessSdkPackage(id: string): PackageInfo | null {
  // **마지막(가장 안쪽)** 세그먼트가 그 모듈의 패키지다 — pnpm 경로
  // `.pnpm/{스코프}+{react}@x/node_modules/{스코프}/{core}/...`에서 첫 매칭을 쓰면
  // core 사본이 react로 잘못 귀속돼 core의 "모름"이 사라진다.
  const matches = [...id.matchAll(SDK_PATH_RE)]
  const last = matches[matches.length - 1]
  return last
    ? { name: `${TRACKED_SCOPE}${last[1]}`, version: UNKNOWN_VERSION, bridgeProtocol: null }
    : null
}

/** Rollup 모듈 id에서 파일 경로만 남긴다(가상 모듈 `\0` 접두사·쿼리 제거). 경로가 아니면 null. */
function moduleFilePath(id: string): string | null {
  if (id.startsWith('\0')) return null
  const path = id.split('?')[0]
  return isAbsolute(path) ? path : null
}

/**
 * 파일에서 위로 올라가며 `name`이 있는 가장 가까운 package.json을 찾는다. `dist/package.json`
 * (`{"type":"module"}`처럼 name 없는 것)은 건너뛴다. 디렉터리 단위로 캐시한다.
 */
function makePackageLookup(): (file: string) => PackageInfo | null {
  const cache = new Map<string, PackageInfo | null>()

  function readPackage(dir: string): PackageInfo | null | undefined {
    let raw: string
    try {
      raw = readFileSync(join(dir, 'package.json'), 'utf-8')
    } catch {
      return undefined
    }
    try {
      const pkg = JSON.parse(raw) as { name?: unknown; version?: unknown; bstage?: unknown }
      if (typeof pkg.name !== 'string') return undefined
      // version이 없거나 문자열이 아니어도 그 패키지의 사본이다 — 버전만 "모름"으로 남긴다.
      return {
        name: pkg.name,
        version: typeof pkg.version === 'string' ? pkg.version : UNKNOWN_VERSION,
        bridgeProtocol: readBridgeProtocol(pkg),
      }
    } catch {
      // 깨진 package.json에서 멈춘다 — 더 올라가면 바깥 패키지(다른 SDK 패키지일 수도)로 잘못 귀속된다.
      return null
    }
  }

  function lookupDir(dir: string): PackageInfo | null {
    const cached = cache.get(dir)
    if (cached !== undefined) return cached
    const found = readPackage(dir)
    const parent = dirname(dir)
    const result = found !== undefined ? found : parent === dir ? null : lookupDir(parent)
    cache.set(dir, result)
    return result
  }

  return (file) => lookupDir(dirname(file))
}

/**
 * 출력 청크에 **실제로 렌더된** 모듈(트리셰이킹 뒤 renderedLength > 0)이 속한 SDK 패키지와 버전을 모은다.
 * `node_modules/@bstage-sdk/core/package.json`을 직접 읽지 않는 이유: pnpm에서는 core가
 * 프로젝트 직속 의존이 아니라 react의 의존이라 그 경로에 없을 수 있고, 있더라도 번들에 실린 사본과
 * 다를 수 있다. 번들 그래프에서 읽으면 "실린 그 버전"이다.
 */
export function createBundledPackagesPlugin(): {
  plugin: Plugin
  getBundled: () => BundledPackages
  getBridgeProtocols: () => BundledBridgeProtocols
} {
  let bundled: BundledPackages = new Map()
  let bridgeProtocols: BundledBridgeProtocols = new Map()

  const plugin: Plugin = {
    name: 'bstage-bundled-packages',
    apply: 'build',

    generateBundle(_options, bundle) {
      const lookup = makePackageLookup()
      const found = Object.values(bundle)
        .flatMap((output) => (output.type === 'chunk' ? Object.entries(output.modules) : []))
        .filter(([, info]) => info.renderedLength > 0)
        .map(([id]) => {
          const file = moduleFilePath(id)
          // 경로로 귀속하지 못하면(가상 모듈·깨진 package.json) 이름이라도 추정해 "모름"으로 남긴다.
          return (file ? lookup(file) : null) ?? guessSdkPackage(id)
        })
        .filter((pkg): pkg is PackageInfo => pkg !== null && pkg.name.startsWith(TRACKED_SCOPE))
      // 빌드마다 새 맵을 만든다(이전 값을 고쳐 쓰지 않는다).
      const names = [...new Set(found.map((p) => p.name))]
      const copiesOf = (name: string) => found.filter((p) => p.name === name)
      bundled = new Map(names.map((name) => [name, new Set(copiesOf(name).map((p) => p.version))]))
      bridgeProtocols = new Map(
        names.map((name) => [name, new Set(copiesOf(name).map((p) => p.bridgeProtocol))]),
      )
    },
  }

  return { plugin, getBundled: () => bundled, getBridgeProtocols: () => bridgeProtocols }
}
