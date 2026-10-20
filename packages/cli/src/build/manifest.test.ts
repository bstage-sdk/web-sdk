import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  compareSemver,
  createManifest,
  isValidSemver,
  MAX_MANIFEST_BYTES,
  pickBridgeProtocol,
  pickSdkVersion,
  emitManifest,
  type ManifestInput,
} from './manifest.js'

/**
 * 포털(게시 빌드 전개)과 빌드 서버(manifest 검증)가 읽는 계약.
 * 손 검증은 정상 템플릿 하나를 빌드해 보는 데서 끝나므로, "쓰지 않는" 분기와 버전 선택 규칙이 비어 있다.
 * 특히 빌더가 거절할 manifest를 쓰면 **빌드 전체가 실패**하므로 그 경계를 여기서 고정한다.
 */

const base: ManifestInput = {
  elementName: 'my-space-hello',
  sdkVersion: '0.48.0',
  bridgeProtocol: undefined,
  framework: 'react',
  bundlesReact: true,
}

describe('createManifest', () => {
  it('옛 CLI와 같은 키 순서·들여쓰기로 직렬화한다', () => {
    const r = createManifest(base)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.json).toBe(
      '{\n  "elementName": "my-space-hello",\n  "entry": "template.js",\n  "sdkVersion": "0.48.0",\n  "framework": "react"\n}\n',
    )
  })

  it('같은 입력이면 같은 바이트다', () => {
    const a = createManifest(base)
    const b = createManifest({ ...base })
    expect(a).toEqual(b)
  })

  it('빌드 서버 manifest 검증의 필수 네 필드를 모두 채운다', () => {
    const r = createManifest({ ...base, framework: undefined, bundlesReact: false })
    expect(r.ok && r.manifest).toEqual({
      elementName: 'my-space-hello',
      entry: 'template.js',
      sdkVersion: '0.48.0',
      framework: 'vanilla',
    })
  })

  it('framework를 소스에서 못 찾았으면 번들에 실린 react로 채운다', () => {
    const r = createManifest({ ...base, framework: undefined })
    expect(r.ok && r.manifest.framework).toBe('react')
  })

  it('framework 옵션은 소문자로 정규화한다', () => {
    const r = createManifest({ ...base, framework: 'Vue' })
    expect(r.ok && r.manifest.framework).toBe('vue')
  })

  it('식별자가 아닌 framework 값은 쓰지 않는다', () => {
    const r = createManifest({ ...base, framework: 'x'.repeat(100) })
    expect(r.ok && r.manifest.framework).toBe('react')
  })

  it.each(['my--space', 'my-space-', 'myspace', 'My-space', '-my-space'])(
    'CLI는 받지만 포털·빌더 규칙에 어긋나는 이름 %s 은 쓰지 않는다',
    (elementName) => {
      const r = createManifest({ ...base, elementName })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.reason).toMatch(/Custom Element/)
    },
  )

  it('100자를 넘는 이름은 쓰지 않는다', () => {
    const r = createManifest({ ...base, elementName: `a-${'b'.repeat(99)}` })
    expect(r.ok).toBe(false)
  })

  it('core 버전을 모르면 쓰지 않는다 — 빌더가 sdkVersion 누락으로 빌드를 실패시킨다', () => {
    expect(createManifest({ ...base, sdkVersion: undefined }).ok).toBe(false)
    expect(createManifest({ ...base, sdkVersion: 'workspace:*' }).ok).toBe(false)
  })

  it('bridgeProtocol을 알면 framework 뒤에 적는다 — 옛 네 필드의 순서·값은 그대로', () => {
    const r = createManifest({ ...base, bridgeProtocol: 1 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.json).toBe(
      '{\n  "elementName": "my-space-hello",\n  "entry": "template.js",\n  "sdkVersion": "0.48.0",\n  "framework": "react",\n  "bridgeProtocol": 1\n}\n',
    )
  })

  it('bridgeProtocol을 모르면 필드를 쓰지 않는다 — 포털은 없는 값을 격리 불가로 읽는다', () => {
    const r = createManifest(base)
    expect(r.ok && 'bridgeProtocol' in r.manifest).toBe(false)
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53])(
    '양의 정수가 아닌 bridgeProtocol %s 는 쓰지 않는다',
    (bridgeProtocol) => {
      const r = createManifest({ ...base, bridgeProtocol })
      expect(r.ok && 'bridgeProtocol' in r.manifest).toBe(false)
    },
  )

  it('sdkVersion을 모르면 bridgeProtocol을 알아도 쓰지 않는다 — 빌더가 sdkVersion을 필수로 본다', () => {
    expect(createManifest({ ...base, sdkVersion: undefined, bridgeProtocol: 1 }).ok).toBe(false)
  })

  it('산출물은 포털 상한보다 한참 작다', () => {
    const r = createManifest({ ...base, elementName: `a-${'b'.repeat(98)}` })
    expect(r.ok && Buffer.byteLength(r.json)).toBeLessThan(MAX_MANIFEST_BYTES)
  })
})

describe('SemVer', () => {
  it.each(['0.48.0', '1.2.3-rc.1', '1.2.3+build.5', '0.61.0-0'])('%s 는 유효하다', (v) => {
    expect(isValidSemver(v)).toBe(true)
  })

  it.each(['v1.2.3', '1.2', '01.2.3', '1.2.3-01', '', `1.2.3-${'a'.repeat(64)}`])(
    '%s 는 포털처럼 거절한다',
    (v) => {
      expect(isValidSemver(v)).toBe(false)
    },
  )

  it('프리릴리스는 같은 정식 버전보다 낮다', () => {
    expect(compareSemver('0.48.0-rc.1', '0.48.0')).toBe(-1)
    expect(compareSemver('0.48.0-rc.2', '0.48.0-rc.10')).toBe(-1)
    expect(compareSemver('0.48.0-1', '0.48.0-alpha')).toBe(-1)
    expect(compareSemver('0.10.0', '0.9.9')).toBe(1)
    expect(compareSemver('1.0.0+a', '1.0.0+b')).toBe(0)
  })
})

describe('pickSdkVersion', () => {
  it('여러 사본이 실렸으면 가장 낮은 버전을 고른다(게이트 fail-closed)', () => {
    expect(pickSdkVersion(['0.48.0', '0.47.1', '0.48.0-rc.1'])).toBe('0.47.1')
  })

  it('입력 순서와 무관하다', () => {
    expect(pickSdkVersion(['0.48.0', '0.47.1'])).toBe(pickSdkVersion(['0.47.1', '0.48.0']))
  })

  it('하나라도 SemVer가 아니면 undefined — 모르는 사본보다 높은 값을 주장하지 않는다', () => {
    expect(pickSdkVersion(['bogus', '0.48.0'])).toBeUndefined()
    expect(pickSdkVersion(['bogus'])).toBeUndefined()
    expect(pickSdkVersion([])).toBeUndefined()
  })
})

describe('pickBridgeProtocol', () => {
  it('사본이 하나면 그 값이다', () => {
    expect(pickBridgeProtocol([1])).toBe(1)
  })

  it('여러 사본이면 가장 작은 값이다(fail-closed)', () => {
    expect(pickBridgeProtocol([3, 1, 2])).toBe(1)
  })

  it('하나라도 모르면(null·정수 아님) undefined — 모르는 사본보다 높은 값을 주장하지 않는다', () => {
    expect(pickBridgeProtocol([1, null])).toBeUndefined()
    expect(pickBridgeProtocol([2, 1.5])).toBeUndefined()
    expect(pickBridgeProtocol([0])).toBeUndefined()
    expect(pickBridgeProtocol([])).toBeUndefined()
  })
})

describe('emitManifest', () => {
  let dir = ''
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('디렉터리에 manifest.json을 쓴다', async () => {
    dir = mkdtempSync(join(tmpdir(), 'bstage-manifest-'))
    const r = await emitManifest(dir, base)
    if (!r.ok) throw new Error('unexpected')
    expect(readFileSync(join(dir, 'manifest.json'), 'utf-8')).toBe(r.json)
  })

  it('만들 수 없으면 파일을 쓰지 않는다 — 빌더가 그 빌드를 실패시키지 않게', async () => {
    dir = mkdtempSync(join(tmpdir(), 'bstage-manifest-'))
    const r = await emitManifest(dir, { ...base, sdkVersion: undefined })
    expect(r.ok).toBe(false)
    expect(existsSync(join(dir, 'manifest.json'))).toBe(false)
  })
})
