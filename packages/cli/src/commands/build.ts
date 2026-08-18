import { resolve, join, relative } from 'node:path'
import { readFile, access, readdir, rename, mkdir, rm } from 'node:fs/promises'
import { build as viteBuild, loadEnv } from 'vite'
import pc from 'picocolors'
import { getSlotsByTargetV2, isSlotIdV2, slotIdToDirName } from '@bstage-sdk/core'
import { createViteConfig } from '../vite/preset.js'
import { createMetaPlugin, type ExtractedMeta } from '../vite/metaPlugin.js'
import { createRegisterPlugin } from '../vite/registerPlugin.js'
import {
  checkCredentials,
  collectReferencedVars,
  usesBstageClient,
} from '../build/credentialCheck.js'

/** Custom Element 스펙: 소문자로 시작 + 최소 1개 하이픈 + 소문자·숫자·하이픈만 허용. */
const ELEMENT_NAME_RE = /^[a-z][a-z0-9-]*-[a-z0-9-]*$/

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

const IGNORE_DIRS = new Set(['node_modules', 'dist', '.git'])

/** 페이지 템플릿의 기준 디렉토리. 이 아래 폴더 구조가 곧 배포 경로가 된다. */
const PAGES_ROOT = 'src/pages'
/** 위젯 템플릿의 기준 디렉토리. 폴더 이름은 자유이고, 배치는 `slot` 옵션이 정한다. */
const SLOTS_ROOT = 'src/slots'
/** 옛 구조. 빌드 대상이 아니고, 엔트리를 못 찾았을 때 마이그레이션 안내를 띄우는 데만 쓴다. */
const LEGACY_ROOT = 'src/templates'

const TEMPLATE_FILE = 'template.tsx'

/** 빌드 산출물 루트. */
const DIST_DIR = 'dist'
/**
 * 빌드 중 산출물을 잠시 두는 곳(`dist/` 아래).
 *
 * 최종 위치로 바로 빌드할 수 없는 이유가 둘이다. 위젯은 번들에서 `slot`을 뽑아야 위치가 정해지고,
 * 중첩 경로(`/settings`와 `/settings/custom`)는 Vite의 `emptyOutDir`가 뒤에 빌드한 쪽이
 * 앞 산출물을 지워버린다.
 */
const STAGING_DIR = '.staging'

/** 페이지냐 위젯이냐 — 엔트리가 어느 기준 디렉토리에서 나왔는지. */
type EntryKind = 'page' | 'slot'

export interface DiscoveredEntry {
  kind: EntryKind
  /** 프로젝트 루트 기준 `template.tsx` 경로. */
  entry: string
  /**
   * 기준 디렉토리 이후의 폴더 세그먼트.
   *
   * 페이지는 이게 곧 배포 경로다(`['settings', 'custom']` → `/settings/custom`).
   * 위젯은 사람이 읽는 이름일 뿐이고 산출물 위치에 영향을 주지 않는다.
   */
  segments: string[]
}

/** 로그·에러 메시지에 쓸 이름. */
function entryLabel(entry: DiscoveredEntry): string {
  if (entry.kind === 'page') return entry.segments.length > 0 ? `/${entry.segments.join('/')}` : '/'
  return [SLOTS_ROOT, ...entry.segments].join('/')
}

/**
 * `src/pages`·`src/slots` 아래의 `template.tsx`를 찾는다.
 *
 * 기준 디렉토리 밖은 보지 않는다 — 폴더 경로가 배포 경로가 되므로 어디서부터 세는지가
 * 정해져 있어야 한다. 예전에는 프로젝트 전체를 훑고 부모 폴더 이름을 임시 라벨로만 썼다.
 */
async function discoverEntries(cwd: string): Promise<DiscoveredEntry[]> {
  const roots: Array<[EntryKind, string]> = [
    ['page', PAGES_ROOT],
    ['slot', SLOTS_ROOT],
  ]

  const results: DiscoveredEntry[] = []

  async function walk(kind: EntryKind, dir: string, segments: string[]) {
    let dirents
    try {
      dirents = await readdir(dir, { withFileTypes: true })
    } catch {
      // 기준 디렉토리가 없는 건 정상이다 — 페이지만 있거나 위젯만 있는 프로젝트가 있다.
      return
    }

    for (const d of dirents) {
      if (IGNORE_DIRS.has(d.name) || d.name.startsWith('.')) continue
      const fullPath = resolve(dir, d.name)
      if (d.isDirectory()) {
        await walk(kind, fullPath, [...segments, d.name])
      } else if (d.name === TEMPLATE_FILE) {
        results.push({ kind, entry: relative(cwd, fullPath), segments })
      }
    }
  }

  for (const [kind, root] of roots) {
    await walk(kind, resolve(cwd, root), [])
  }

  // 빌드 순서를 고정해 로그와 에러 메시지가 실행마다 흔들리지 않게 한다.
  return results.sort((a, b) => a.entry.localeCompare(b.entry))
}

/** 빌드 규칙 위반. 메시지를 그대로 사용자에게 보여준다. */
export class BuildRuleError extends Error {}

/** 페이지 폴더 이름에 쓸 수 없는 형태 — 동적 경로는 아직 지원하지 않는다. */
const DYNAMIC_SEGMENT_RE = /^\[.*\]$/

/**
 * 엔트리 위치와 `slot` 옵션이 맞는지 확인하고, 산출물 디렉토리 이름(`dist/` 아래 상대 경로)을 정한다.
 *
 * 위치가 곧 규칙이라 어긋난 조합은 여기서 끊는다. 빌드는 `tsc`를 타지 않으므로
 * 타입으로 막았다고 여긴 것이 여기까지 도달한다.
 *
 * @internal 테스트용으로 노출한다. public API 아님.
 */
export function resolveOutputName(entry: DiscoveredEntry, slot: string | undefined): string {
  const label = entryLabel(entry)

  if (entry.kind === 'page') {
    if (slot) {
      throw new BuildRuleError(
        `${label}: 페이지(${PAGES_ROOT}/)에는 slot 옵션을 쓸 수 없습니다.\n` +
          `  배포 경로는 ${PAGES_ROOT}/ 아래 폴더 구조가 정합니다.\n` +
          `  위젯으로 만들 생각이었다면 이 폴더를 ${SLOTS_ROOT}/ 아래로 옮기세요.`,
      )
    }
    const dynamic = entry.segments.find((s) => DYNAMIC_SEGMENT_RE.test(s))
    if (dynamic) {
      throw new BuildRuleError(
        `${label}: 동적 경로("${dynamic}")는 아직 지원하지 않습니다.\n` +
          `  고정 경로 폴더로 바꿔주세요.`,
      )
    }
    return entry.segments.join('/')
  }

  if (!slot) {
    throw new BuildRuleError(
      `${label}: 위젯(${SLOTS_ROOT}/)에는 slot 옵션이 필요합니다.\n` +
        `  createTemplate(Component, { name: '...', slot: 'user.contents-home.curation:after' })\n` +
        `  폴더 이름은 배치에 쓰이지 않습니다 — 어느 자리에 붙을지는 slot 옵션만 정합니다.`,
    )
  }

  if (!isSlotIdV2(slot)) {
    throw new BuildRuleError(
      `${label}: 카탈로그에 없는 슬롯 id "${slot}"입니다.\n` +
        `  쓸 수 있는 자리:\n${formatSlotSuggestions(slot)}`,
    )
  }

  return slotIdToDirName(slot)
}

/** 오타 난 슬롯 id 옆에 붙일 후보 목록. 앞부분이 겹치는 자리를 먼저 보여준다. */
function formatSlotSuggestions(slot: string): string {
  const all = [...getSlotsByTargetV2('user'), ...getSlotsByTargetV2('admin')].map((s) => s.id)
  // 같은 페이지의 자리를 헷갈리는 경우가 대부분이라 `{target}.{page}`가 겹치는 것을 먼저 올린다.
  const prefix = slot.split('.').slice(0, 2).join('.')
  const near = all.filter((id) => id.startsWith(`${prefix}.`))
  const shown = near.length > 0 ? near : all
  const lines = shown.slice(0, 12).map((id) => `    - ${id}`)
  if (shown.length > lines.length) lines.push(`    ... 전체 목록은 SLOT_CATALOG_V2 참조`)
  return lines.join('\n')
}

/** 인증 변수 참조를 찾을 소스 확장자. 타입 선언(`.d.ts`)은 참조가 아니라 선언이므로 제외한다. */
const SOURCE_EXT_RE = /\.(?:[cm]?[jt]sx?)$/

/** 프로젝트 소스 파일을 모아 읽는다(`node_modules`·`dist` 제외). */
async function readProjectSources(cwd: string): Promise<string[]> {
  const sources: string[] = []

  async function walk(dir: string) {
    let dirents
    try {
      dirents = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const d of dirents) {
      if (IGNORE_DIRS.has(d.name)) continue
      const fullPath = resolve(dir, d.name)
      if (d.isDirectory()) {
        await walk(fullPath)
      } else if (SOURCE_EXT_RE.test(d.name) && !d.name.endsWith('.d.ts')) {
        try {
          sources.push(await readFile(fullPath, 'utf-8'))
        } catch {
          // 읽지 못한 파일은 건너뛴다 — 점검은 보조 기능이라 빌드를 막지 않는다.
        }
      }
    }
  }

  await walk(cwd)
  return sources
}

interface BuildEntryContext {
  cwd: string
  /** 산출물 디렉토리 이름 → 먼저 차지한 엔트리 라벨. 두 템플릿이 같은 자리로 나가는 걸 막는다. */
  takenOutputs: Map<string, string>
  /** Custom Element 태그명 → 먼저 쓴 엔트리 라벨. 같은 태그가 둘이면 나중 것이 등록되지 않는다. */
  takenElementNames: Map<string, string>
}

interface BuildEntryResult {
  /** 이 번들이 BstageClient를 포함하는지 — 인증 값 점검 대상인지 가른다. */
  usesClient: boolean
}

async function buildEntry(
  ctx: BuildEntryContext,
  entryInfo: DiscoveredEntry,
): Promise<BuildEntryResult> {
  const { cwd } = ctx
  const { entry } = entryInfo
  const label = entryLabel(entryInfo)

  console.log(`\nBuilding template: ${label}`)

  const { plugin: metaPlugin, getMeta } = createMetaPlugin()

  // 스테이징 디렉토리에 먼저 받는다 — 위젯의 최종 위치는 번들에서 뽑은 slot 옵션을 봐야 정해진다.
  const outDir = join(DIST_DIR, STAGING_DIR)
  const viteConfig = createViteConfig({ entry, outDir })
  await viteBuild({
    ...viteConfig,
    configFile: false,
    root: cwd,
    logLevel: 'info',
    plugins: [...((viteConfig.plugins as any[]) ?? []), metaPlugin, createRegisterPlugin()],
  })

  // 번들을 한 번 읽어 크기와 BstageClient 포함 여부를 함께 얻는다.
  const bundlePath = join(cwd, outDir, 'template.js')
  let bundleSize = 0
  let usesClient = false
  try {
    const bundle = await readFile(bundlePath)
    bundleSize = bundle.length
    usesClient = usesBstageClient(bundle)
  } catch {
    console.warn('Warning: Could not read the built bundle.')
  }

  // Vite 플러그인에서 추출한 메타데이터 조회
  const bundleMeta: ExtractedMeta | null = getMeta()

  const name = bundleMeta?.name

  if (!name) {
    console.error(`Error: Could not determine template metadata (name) for "${label}".`)
    console.error('Ensure createTemplate() is called at module level with name.')
    process.exit(1)
  }

  if (!ELEMENT_NAME_RE.test(name)) {
    console.error(
      `Error: 잘못된 name "${name}". Custom Element 스펙상 소문자로 시작하고 하이픈을 1개 이상 포함해야 하며, 소문자·숫자·하이픈만 사용할 수 있습니다. 예: "bmf-hello"`,
    )
    process.exit(1)
  }

  const elementName = bundleMeta?.elementName ?? name

  // 산출물 위치를 정한다. 위젯은 여기서야 slot 옵션을 알 수 있어 빌드 뒤에 계산한다.
  let outputName: string
  try {
    outputName = resolveOutputName(entryInfo, bundleMeta?.slot)
  } catch (e) {
    if (!(e instanceof BuildRuleError)) throw e
    console.error(`\n${pc.red('Error')} ${e.message}`)
    process.exit(1)
  }

  const previousOwner = ctx.takenOutputs.get(outputName)
  if (previousOwner !== undefined) {
    console.error(
      `\n${pc.red('Error')} ${label}: 산출물 위치 "${join(DIST_DIR, outputName)}"가 ${previousOwner}와 겹칩니다.\n` +
        `  두 템플릿이 같은 자리로 나갈 수 없습니다.`,
    )
    process.exit(1)
  }
  ctx.takenOutputs.set(outputName, label)

  const elementNameOwner = ctx.takenElementNames.get(elementName)
  if (elementNameOwner !== undefined) {
    // 같은 페이지에 둘이 함께 로드되면 `customElements.define`이 먼저 등록된 쪽만 살아남아
    // 나중 템플릿이 조용히 앞 템플릿의 화면을 그린다. 빌드에서 끊는 게 낫다.
    console.error(
      `\n${pc.red('Error')} ${label}: name "${elementName}"을 ${elementNameOwner}가 이미 씁니다.\n` +
        `  Custom Element 태그명은 템플릿마다 달라야 합니다.`,
    )
    process.exit(1)
  }
  ctx.takenElementNames.set(elementName, label)

  // 스테이징에서 최종 위치로 옮긴다. outputName이 빈 문자열이면 루트 페이지라 dist/ 바로 아래다.
  const finalDir = outputName ? join(cwd, DIST_DIR, outputName) : join(cwd, DIST_DIR)
  await mkdir(finalDir, { recursive: true })
  await rename(join(cwd, outDir, 'template.js'), join(finalDir, 'template.js'))

  console.log(`  ${relative(cwd, finalDir)}/template.js  (${formatSize(bundleSize)})`)

  return { usesClient }
}

/**
 * 인증 값 점검 결과를 빌드 로그 맨 끝에 출력한다.
 *
 * **빌드를 실패시키지는 않는다.** 값이 비어도 번들 자체는 정상적으로 나오고, 여기서 exit 1을
 * 내면 기존 소비자 CI가 갑자기 깨진다. 대신 마지막 화면에 남겨 놓쳐도 로그 끝에서 보이게 한다.
 */
function printCredentialReport(env: Record<string, string>, referenced: Set<string>): void {
  const issues = checkCredentials(env, referenced)
  if (issues.length === 0) return

  const hasError = issues.some((i) => i.level === 'error')
  console.log('')
  console.log(
    hasError
      ? pc.red(pc.bold('✗ 인증 값 점검 — 이대로 배포하면 API 호출이 실패합니다.'))
      : pc.yellow(pc.bold('⚠ 인증 값 점검')),
  )
  for (const i of issues) {
    const mark = i.level === 'error' ? pc.red('✗') : pc.yellow('⚠')
    console.log(`  ${mark} ${i.varName}  ${i.message}`)
  }
  console.log(
    pc.dim(
      '\n  .env 값은 빌드 시점에 번들로 인라인됩니다 — 값을 고친 뒤 다시 빌드해야 반영됩니다.\n' +
        '  배포할 환경에서 발급한 키인지도 확인하세요(키 포맷만으로는 SDK가 구분할 수 없습니다).\n' +
        '  배포 전 점검 목록: SDK 문서의 GETTING_STARTED.md — "9. 배포"',
    ),
  )
  console.log('')
}

export async function buildCommand(): Promise<void> {
  const cwd = process.cwd()

  const entries = await discoverEntries(cwd)

  if (entries.length === 0) {
    console.error(
      `Error: ${PAGES_ROOT}/ · ${SLOTS_ROOT}/ 아래에서 ${TEMPLATE_FILE}을 찾지 못했습니다.`,
    )
    if (await exists(join(cwd, LEGACY_ROOT))) {
      // 옛 구조가 그대로 있는 프로젝트다. 여기서 바로 알려주는 게 가장 빠른 피드백이다.
      console.error(
        `\n  ${LEGACY_ROOT}/ 이 남아 있습니다. 빌드 산출물 경로 규칙이 바뀌면서\n` +
          `  페이지는 ${PAGES_ROOT}/, 위젯은 ${SLOTS_ROOT}/ 아래로 옮겨야 합니다.\n` +
          `  진단: npx @bstage-sdk/cli@latest doctor\n` +
          `  변환: 에이전트에게 "bstage 마이그레이션" 요청 (bstage-migrate 스킬)`,
      )
    }
    process.exit(1)
  }

  // dist를 통째로 비우고 시작한다. 경로가 폴더 구조를 따라가므로, 페이지 폴더를 옮기거나
  // 지운 뒤 다시 빌드하면 옛 산출물이 그대로 남아 관리도구에 옛 자리가 계속 보인다.
  await rm(join(cwd, DIST_DIR), { recursive: true, force: true })

  const ctx: BuildEntryContext = {
    cwd,
    takenOutputs: new Map(),
    takenElementNames: new Map(),
  }

  console.log(
    `Found ${entries.length} template${entries.length > 1 ? 's' : ''}: ${entries.map(entryLabel).join(', ')}`,
  )

  const results: BuildEntryResult[] = []
  for (const entry of entries) {
    results.push(await buildEntry(ctx, entry))
  }

  await rm(join(cwd, DIST_DIR, STAGING_DIR), { recursive: true, force: true })

  console.log(`\nBuild complete.`)

  // 인증 값은 프로젝트 전체가 공유하므로 템플릿마다 반복하지 않고 마지막에 한 번만 점검한다.
  // BstageClient를 쓰는 번들이 하나도 없으면(UI 전용 템플릿) 인증 값이 아예 무의미하므로 침묵한다.
  // env는 Vite가 빌드에 쓰는 것과 같은 방식으로 읽는다 — `.env` 파일뿐 아니라 CI가 process.env로
  // 주입한 값도 번들에 인라인되므로, 파일만 읽으면 멀쩡한 빌드를 오탐한다.
  if (results.some((r) => r.usesClient)) {
    const referenced = collectReferencedVars(await readProjectSources(cwd))
    printCredentialReport(loadEnv('production', cwd, 'VITE_'), referenced)
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  const mb = kb / 1024
  return `${mb.toFixed(2)} MB`
}
