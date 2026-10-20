import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * 템플릿 산출물마다 `template.js` 옆에 두는 `manifest.json`.
 *
 * 0.50에서 없앴다가(태그명은 번들이 `__bstage_elements__`로 알린다) 다시 낸다. 호스트 로더는 여전히
 * 이 파일을 읽지 않는다 — 읽는 쪽은 **포털**이다. 포털은 게시 빌드를 전개할 때 산출물 디렉터리의
 * manifest에서 `bridgeProtocol`·`elementName`을 기록하고, 둘 다 알 때만 iframe 격리를 연다.
 *
 * 앞 네 필드는 0.50 이전 CLI가 내던 것과 같다 — 옛 형식을 읽던 소비자(호스트 측 어댑터, 빌드 서버의
 * manifest 검증)가 그대로 읽는다. `type`은 넣지 않는다(읽는 곳이 없다). `bridgeProtocol`은 뒤에 붙는다.
 */
export interface TemplateManifest {
  elementName: string
  entry: string
  /** 번들에 실제로 실린 `@bstage-sdk/core` 버전. 정보용이다 — 격리 게이트는 `bridgeProtocol`을 본다. */
  sdkVersion: string
  framework: string
  /**
   * 번들에 실린 core가 구현한 브리지 프로토콜 버전(core `package.json`의 `bstage.bridgeProtocol`).
   * 포털 격리 게이트가 이 값으로 판정한다. 모르면 필드 자체가 없다.
   */
  bridgeProtocol?: number
}

export const MANIFEST_FILE = 'manifest.json'

/** 엔트리 파일명. 프리셋의 `fileName`과 같다 — manifest의 `entry`는 manifest 디렉터리 기준 상대 경로다. */
export const MANIFEST_ENTRY = 'template.js'

/** 포털이 manifest를 파싱하는 크기 상한. 넘으면 포털은 값을 기록하지 않는다. */
export const MAX_MANIFEST_BYTES = 16 * 1024

/**
 * 포털·빌드 서버가 쓰는 Custom Element 이름 규칙(양쪽이 같은 정규식으로 검사한다).
 * CLI의 name 검증(`ELEMENT_NAME_RE`)보다 좁다 — `a--b`·`a-` 같은 이름은 CLI는 통과하지만 빌더는
 * MANIFEST_INVALID로 빌드를 실패시킨다. 그래서 이 규칙에 맞지 않으면 manifest를 **쓰지 않는다**.
 */
const PORTAL_ELEMENT_NAME_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/
const MAX_ELEMENT_NAME_LEN = 100

/** 포털이 받는 SemVer 형태와 같다(SemVer 2.0, 앞 `v` 없음, 64자 상한). */
const SEMVER_RE =
  /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const MAX_SEMVER_LEN = 64

/** framework는 옵션 문자열에서 올 수 있다 — 짧은 식별자만 받아 manifest 크기를 묶어 둔다. */
const FRAMEWORK_RE = /^[a-z][a-z0-9-]{0,31}$/

interface ParsedSemver {
  core: [number, number, number]
  pre: string[]
}

function parseSemver(v: string): ParsedSemver | null {
  if (v.length === 0 || v.length > MAX_SEMVER_LEN) return null
  const m = SEMVER_RE.exec(v)
  if (!m) return null
  const pre = m[4] ? m[4].split('.') : []
  // 숫자 프리릴리스 식별자에 앞자리 0은 SemVer 위반이다(포털도 거절한다).
  // 9자리 상한도 포털과 같다(비교 정확성).
  if (
    pre.some((id) => /^\d+$/.test(id) && ((id.length > 1 && id.startsWith('0')) || id.length > 9))
  )
    return null
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre }
}

export function isValidSemver(v: string): boolean {
  return parseSemver(v) !== null
}

function comparePre(a: string[], b: string[]): number {
  // 프리릴리스가 없는 쪽이 높다.
  if (a.length === 0 || b.length === 0) return Math.sign(b.length - a.length)
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const [x, y] = [a[i], b[i]]
    if (x === y) continue
    const [xn, yn] = [/^\d+$/.test(x), /^\d+$/.test(y)]
    if (xn && yn) return Math.sign(Number(x) - Number(y))
    if (xn !== yn) return xn ? -1 : 1
    return x < y ? -1 : 1
  }
  return Math.sign(a.length - b.length)
}

/** SemVer 순서 비교(빌드 메타데이터 무시). 둘 다 유효하다고 가정한다. */
export function compareSemver(a: string, b: string): number {
  const [pa, pb] = [parseSemver(a), parseSemver(b)]
  if (!pa || !pb) throw new Error(`invalid semver: ${pa ? b : a}`)
  for (let i = 0; i < 3; i++) {
    if (pa.core[i] !== pb.core[i]) return Math.sign(pa.core[i] - pb.core[i])
  }
  return comparePre(pa.pre, pb.pre)
}

/**
 * 번들에 실린 버전들 중 manifest에 적을 값. **가장 낮은** 것을 고른다 —
 * 한 번들에 core가 두 벌 실렸다면 격리 게이트는 낮은 쪽 기준으로 판단해야 안전하다(fail-closed).
 * 정렬 기준이 고정이라 입력 순서와 무관하게 같은 값이 나온다.
 */
export function pickSdkVersion(versions: Iterable<string>): string | undefined {
  const all = [...new Set(versions)]
  // 하나라도 SemVer가 아니면 그 사본의 버전을 모르는 것이다 — 나머지 중 최솟값을 적으면 모르는 사본보다
  // 높은 값을 주장할 수 있으므로 아예 적지 않는다(fail-closed).
  if (all.length === 0 || !all.every(isValidSemver)) return undefined
  return [...all].sort((a, b) => compareSemver(a, b) || (a < b ? -1 : a > b ? 1 : 0))[0]
}

/** bridgeProtocol로 인정하는 값 — 양의 안전 정수. */
export function isValidBridgeProtocol(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 1
}

/**
 * 번들에 실린 core 사본들의 `bridgeProtocol` 중 manifest에 적을 값. **가장 작은** 것을 고른다 —
 * 두 벌이 실렸다면 낮은 쪽이 구현한 만큼만 격리를 열어야 안전하다. 하나라도 모르면(`null`·양의 정수 아님)
 * 적지 않는다 — 모르는 사본(브리지 이전 core일 수 있다)보다 높은 값을 주장하지 않는다(fail-closed).
 */
export function pickBridgeProtocol(values: Iterable<number | null>): number | undefined {
  const all = [...values]
  if (all.length === 0 || !all.every(isValidBridgeProtocol)) return undefined
  return Math.min(...(all as number[]))
}

export interface ManifestInput {
  elementName: string
  /** 번들에서 찾은 core 버전. 못 찾았으면 undefined. */
  sdkVersion: string | undefined
  /** 번들에서 고른 core `bridgeProtocol`({@link pickBridgeProtocol}). 모르면 undefined — 필드를 쓰지 않는다. */
  bridgeProtocol: number | undefined
  /** 소스에서 감지했거나 옵션으로 준 프레임워크. */
  framework: string | undefined
  /** 번들에 bstage-react가 실렸는지 — framework를 소스에서 못 찾았을 때의 대체값. */
  bundlesReact: boolean
}

export type ManifestResult =
  | { ok: true; manifest: TemplateManifest; json: string }
  | { ok: false; reason: string }

/**
 * manifest를 만든다. 빌드 서버의 manifest 검증이 거절할 manifest는 **만들지 않는다** — 쓰면 빌드 전체가
 * MANIFEST_INVALID로 실패하지만, 안 쓰면 그 템플릿만 격리를 못 쓸 뿐 inline으로 정상 동작한다.
 */
export function createManifest(input: ManifestInput): ManifestResult {
  const { elementName, sdkVersion } = input

  if (elementName.length > MAX_ELEMENT_NAME_LEN || !PORTAL_ELEMENT_NAME_RE.test(elementName)) {
    return {
      ok: false,
      reason: `name ${JSON.stringify(elementName)}이 포털 Custom Element 규칙(${PORTAL_ELEMENT_NAME_RE.source}, ${MAX_ELEMENT_NAME_LEN}자 이하)에 맞지 않습니다`,
    }
  }
  if (sdkVersion === undefined || !isValidSemver(sdkVersion)) {
    return {
      ok: false,
      reason: '번들에서 @bstage-sdk/core 버전을 찾지 못했습니다',
    }
  }

  // 옵션 값은 대소문자를 정규화하고, 식별자가 아니면(긴 문자열 등) 번들 기준 대체값을 쓴다.
  const explicit = input.framework?.toLowerCase()
  const framework =
    explicit && FRAMEWORK_RE.test(explicit) ? explicit : input.bundlesReact ? 'react' : 'vanilla'

  // 키 순서를 고정해 같은 입력이면 바이트까지 같은 파일이 나오게 한다(옛 CLI와 같은 순서·들여쓰기).
  // bridgeProtocol은 옛 네 필드 뒤에 붙인다 — 앞부분 바이트는 옛 CLI와 같다.
  const manifest: TemplateManifest = {
    elementName,
    entry: MANIFEST_ENTRY,
    sdkVersion,
    framework,
    ...(isValidBridgeProtocol(input.bridgeProtocol)
      ? { bridgeProtocol: input.bridgeProtocol }
      : {}),
  }
  const json = JSON.stringify(manifest, null, 2) + '\n'
  // 위 필드 상한(100·64·32자, 안전 정수)으로는 닿지 않는 방어선이다 — 필드가 늘면 의미가 생긴다.
  if (Buffer.byteLength(json, 'utf-8') > MAX_MANIFEST_BYTES) {
    return { ok: false, reason: `manifest가 상한(${MAX_MANIFEST_BYTES}바이트)을 넘습니다` }
  }
  return { ok: true, manifest, json }
}

/**
 * manifest를 만들어 `dir/manifest.json`에 쓴다. 만들 수 없으면 아무것도 쓰지 않고 이유를 돌려준다
 * (dist는 빌드 시작 때 통째로 지워지므로 옛 manifest가 남지 않는다).
 */
export async function emitManifest(dir: string, input: ManifestInput): Promise<ManifestResult> {
  const result = createManifest(input)
  if (result.ok) await writeFile(join(dir, MANIFEST_FILE), result.json, 'utf-8')
  return result
}
