import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'

/** OS 구분자를 `/`로 — 보고 문자열은 항상 posix 형식이다(Windows에서도 `pages/home`). */
function toPosix(p: string): string {
  return p.split(sep).join('/')
}

/**
 * 포털 빌더(다른 레포 builder/entrypoint.sh)와 동일한 규칙으로 레포 종류를 판정한다.
 * CLI와 빌더의 판단이 어긋나면 안 되므로 판정 로직을 이 파일 하나로 미러링한다.
 *
 * `mixed`는 **템플릿 파일이 양쪽 다 있을 때만** 나온다 — 의존성만으로는 mixed가 되지 않는다
 * (liquid 스캐폴드도 저작 도구로 `@bstage-sdk/cli`를 의존한다). mixed는 오류가 아니라
 * 지원되는 상태다: 빌더가 sdk 템플릿을 빌드한 뒤 liquid 템플릿을 그대로 패키징하고, 포털은
 * 산출물 항목마다 kind를 따로 본다. CLI는 sdk 엔트리만 번들하고 liquid는 검증만 한다.
 */
export type DetectedKind = 'sdk' | 'liquid' | 'mixed' | 'unknown'

export interface KindReport {
  kind: DetectedKind
  /** `user/home` 형식 — public/{surface}/{name}/template.liquid 의 surface/name */
  liquidTemplates: string[]
  /** `pages/home` · `slots/my-widget` 형식 — src/{pages|slots}/… /template.tsx 의 상대 디렉터리 */
  sdkTemplates: string[]
  /** user·admin 밖이거나 깊이가 다른 template.liquid — 빌더가 무시하므로 경고용 (root 기준 상대 경로) */
  ignoredLiquid: string[]
  /**
   * package.json 의존성에 SDK 패키지가 선언돼 있는가.
   * liquid 템플릿 파일이 하나도 없을 때만 `sdk` 판정 근거가 된다 — liquid 파일이 있으면
   * 이 값이 true여도 kind는 `liquid`다(mixed로 올리지 않는다).
   */
  hasSdkDependency: boolean
}

// 빌더가 sdk 판정에 쓰는 패키지 목록과 동일하게 유지한다
const SDK_PACKAGES = [
  '@bstage-sdk/cli',
  '@bstage-sdk/core',
  '@bstage-sdk/react',
  '@bstage-sdk/design',
]

// public/{surface}/{name}/template.liquid 에서 liquid로 인정하는 surface
const LIQUID_SURFACES = new Set(['user', 'admin'])

// 무한 재귀·비정상적으로 깊은 트리를 막기 위한 상한. 실제 템플릿 깊이보다 여유를 둔다.
const PUBLIC_LIQUID_DEPTH = 6
const SRC_TEMPLATE_DEPTH = 8

/**
 * dir 아래를 재귀로 훑어 이름이 fileName과 같은 파일의 절대 경로를 모은다.
 * 심볼릭 링크는 따라가지 않는다(isDirectory()만 디렉터리로 인정). node_modules·점으로
 * 시작하는 디렉터리는 건너뛴다. depth는 남은 재귀 허용치다.
 */
function findFilesRecursive(dir: string, fileName: string, depth: number): string[] {
  if (depth < 0) return []

  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    // 디렉터리가 없거나 읽을 수 없으면 그냥 빈 결과로 취급한다
    return []
  }

  const found: string[] = []
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      found.push(...findFilesRecursive(join(dir, entry.name), fileName, depth - 1))
    } else if (entry.isFile() && entry.name === fileName) {
      found.push(join(dir, entry.name))
    }
  }
  return found
}

/**
 * package.json 의존성(dependencies·devDependencies·peerDependencies·optionalDependencies)에
 * SDK 패키지가 하나라도 선언돼 있는지 본다. 파일이 없거나 JSON 파싱에 실패하면 false — 예외를
 * 던지지 않는다. `bstage.kind` 힌트는 읽지 않는다(파일 구조가 우선이고 빌더도 보지 않는다).
 */
function hasSdkDependency(root: string): boolean {
  const pkgPath = join(root, 'package.json')
  if (!existsSync(pkgPath)) return false

  try {
    const raw = readFileSync(pkgPath, 'utf-8')
    const pkg = JSON.parse(raw) as Record<string, unknown>
    const merged = {
      ...(pkg.dependencies as Record<string, string> | undefined),
      ...(pkg.devDependencies as Record<string, string> | undefined),
      ...(pkg.peerDependencies as Record<string, string> | undefined),
      ...(pkg.optionalDependencies as Record<string, string> | undefined),
    }
    return SDK_PACKAGES.some((name) => name in merged)
  } catch {
    return false
  }
}

/**
 * public/ 아래에서 template.liquid를 찾아 정상 위치(public/{user|admin}/{name}/template.liquid,
 * name은 정확히 한 세그먼트)만 liquidTemplates로 인정하고 나머지는 ignoredLiquid로 뺀다.
 */
function collectLiquidTemplates(root: string): { liquid: string[]; ignored: string[] } {
  const publicDir = join(root, 'public')
  const liquid: string[] = []
  const ignored: string[] = []

  for (const filePath of findFilesRecursive(publicDir, 'template.liquid', PUBLIC_LIQUID_DEPTH)) {
    const rest = relative(publicDir, filePath)
    const segments = rest.split(sep)

    if (segments.length === 3 && LIQUID_SURFACES.has(segments[0])) {
      liquid.push(`${segments[0]}/${segments[1]}`)
    } else {
      ignored.push(toPosix(relative(root, filePath)))
    }
  }

  return { liquid, ignored }
}

/**
 * src/pages·src/slots 아래에서 template.tsx를 찾아 src/ 기준 상대 디렉터리를 모은다.
 */
function collectSdkTemplates(root: string): string[] {
  const srcDir = join(root, 'src')
  const templates: string[] = []

  for (const sub of ['pages', 'slots']) {
    const base = join(srcDir, sub)
    for (const filePath of findFilesRecursive(base, 'template.tsx', SRC_TEMPLATE_DEPTH)) {
      templates.push(toPosix(relative(srcDir, dirname(filePath))))
    }
  }

  return templates
}

export function detectProjectKind(root: string): KindReport {
  const { liquid: liquidTemplates, ignored: ignoredLiquid } = collectLiquidTemplates(root)
  const sdkTemplates = collectSdkTemplates(root)
  const sdkDependency = hasSdkDependency(root)

  // 입력 배열을 바꾸지 않는다(불변) — 복사 후 정렬
  const sortedLiquid = [...liquidTemplates].sort()
  const sortedSdk = [...sdkTemplates].sort()
  const sortedIgnored = [...ignoredLiquid].sort()

  const hasLiquidFiles = sortedLiquid.length > 0
  const hasSdkFiles = sortedSdk.length > 0

  // mixed는 파일 구조 충돌일 때만이다 — 의존성만으로는 올리지 않는다(liquid가 이긴다).
  let kind: DetectedKind
  if (hasLiquidFiles && hasSdkFiles) {
    kind = 'mixed'
  } else if (hasLiquidFiles) {
    kind = 'liquid'
  } else if (hasSdkFiles || sdkDependency) {
    kind = 'sdk'
  } else {
    kind = 'unknown'
  }

  return {
    kind,
    liquidTemplates: sortedLiquid,
    sdkTemplates: sortedSdk,
    ignoredLiquid: sortedIgnored,
    hasSdkDependency: sdkDependency,
  }
}

/**
 * 혼합 레포에서 liquid 자리와 겹치는 sdk 페이지. 페이지 산출물은 `dist/{segments...}/template.js`로
 * 나가므로 첫 세그먼트가 `user`·`admin`이면 liquid 산출물 `dist/{user|admin}/{name}/`과 같은 트리에
 * 놓인다. 같은 디렉터리에 template.js와 template.liquid가 함께 있으면 포털은 sdk로만 판정해
 * liquid가 조용히 사라지고, 같은 트리에만 있어도 서빙 프리픽스가 겹친다 — 빌더와 CLI 양쪽에서
 * 막는다(fail-closed). 위젯은 슬롯 id(`user.xxx--yyy`, 슬래시 없음)로 나가므로 해당 없다.
 * liquid 템플릿이 없으면 겹칠 상대가 없으니 빈 배열이다.
 *
 * 비교는 **대소문자를 무시**한다 — `src/pages/User/`도 잡는다. 페이지 폴더 이름에는 대소문자 규칙이
 * 없어 `User`가 통과하면 macOS·Windows 같은 대소문자 무시 파일시스템에서 `dist/User`와 `dist/user`가
 * 같은 디렉터리가 된다(시큐리티 리뷰 MEDIUM). 예약 이름은 어느 표기든 예약이다.
 *
 * 반환값은 `sdkTemplates`와 같은 형식(`pages/user/home`)이고 정렬돼 있다.
 */
export function collidingSdkPages(report: KindReport): string[] {
  if (report.liquidTemplates.length === 0) return []
  return report.sdkTemplates.filter((t) => {
    const [root, first] = t.split('/')
    return root === 'pages' && first !== undefined && LIQUID_SURFACES.has(first.toLowerCase())
  })
}
