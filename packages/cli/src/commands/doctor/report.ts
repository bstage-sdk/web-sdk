import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { validateLiquid, type LiquidIssue } from '../../liquid/validate.js'
import { detectProjectKind, type DetectedKind } from '../../project/detectKind.js'
import {
  diagnoseFiles,
  diagnoseLayout,
  diagnosePnpmWorkspace,
  diagnoseRecommendedDeps,
  diagnoseScripts,
  tablesFor,
  type DepRow,
  type FileRow,
  type LayoutInfo,
  type PnpmWorkspaceInfo,
  type ScriptRow,
} from './checks.js'
import {
  cleanRange,
  compareSemver,
  readApplicableMigrations,
  type MigrationEntry,
  type MigrationResolver,
} from './migrations.js'
import {
  diagnoseAgentsMd,
  diagnoseSkills,
  resolveSkillKind,
  type AgentsMdInfo,
  type SkillRow,
} from './skills.js'

/**
 * 진단 대상 SDK 패키지.
 *
 * 디자인 토큰(design)도 포함한다 — 소비자가 실제로 뒤처지는 축이라 버전 표에서 빠지면
 * "cli만 최신인데 design은 몇 달 전"인 상태가 조용히 남는다.
 * 프로젝트가 선언·설치하지 않은 패키지는 리포트에서 제외된다(무관한 행으로 노이즈를 만들지 않음).
 */
// ai-toolkit은 cli의 의존성이라 소비자 프로젝트가 직접 설치하지 않는다 — 여기 넣지 않는다(bstage ai doctor가 따로 본다).
const SDK_PACKAGES = [
  '@bstage-sdk/cli',
  '@bstage-sdk/core',
  '@bstage-sdk/react',
  '@bstage-sdk/design',
] as const

type SdkPackage = (typeof SDK_PACKAGES)[number]

/** liquid 레포가 쓰는 유일한 SDK 패키지(저작 도구). */
const CLI_PACKAGE: SdkPackage = '@bstage-sdk/cli'

export interface VersionRow {
  pkg: SdkPackage
  installed: string | null
  latest: string | null
  outdated: boolean
}

/** liquid 레포 전용 진단. sdk 레포에서는 `null`이라 기존 `--json` 소비자가 분기할 수 있다. */
export interface LiquidInfo {
  issues: LiquidIssue[]
}

export interface DoctorReport {
  project: string | null
  /** 포털 빌더와 같은 규칙으로 판정한 레포 종류. 아래 표들이 이 값으로 갈린다. */
  kind: DetectedKind
  isBstageProject: boolean
  versions: VersionRow[]
  files: FileRow[]
  layout: LayoutInfo
  pnpmWorkspace: PnpmWorkspaceInfo
  scripts: ScriptRow[]
  recommendedDeps: DepRow[]
  migrations: MigrationEntry[]
  agentsMd: AgentsMdInfo
  skills: SkillRow[]
  /** sdk·liquid가 한 레포에 섞여 있어 스킬 검사를 건너뛰었는가 */
  skillsSkipped: boolean
  latestChecked: boolean
  /** liquid 레포일 때만 채워진다 — `validateLiquid` 결과. */
  liquid: LiquidInfo | null
}

type DepMap = Record<string, string>

interface ProjectPackage {
  name: string | null
  scripts: Record<string, string> | undefined
  /** 모든 의존성 구획을 병합한 맵. 탐지·버전 fallback에 쓴다. */
  deps: DepMap
}

/**
 * 프로젝트 package.json을 읽어 이름·스크립트·병합된 의존성 맵을 만든다.
 *
 * bstage 패키지는 dependencies뿐 아니라 devDependencies에도 흔히 있다
 * (bstage-cli는 빌드 도구, IIFE로 번들되는 템플릿은 core/react도 devDependencies 가능).
 * 파일이 없거나 파싱에 실패하면 빈 값으로 취급한다.
 */
async function readProjectPackage(root: string): Promise<ProjectPackage> {
  let pkgJson: {
    name?: string
    scripts?: Record<string, string>
    dependencies?: DepMap
    devDependencies?: DepMap
    peerDependencies?: DepMap
    optionalDependencies?: DepMap
  } | null = null
  try {
    pkgJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf-8'))
  } catch {
    // package.json 없음/파싱 실패 → null 유지
  }

  return {
    name: pkgJson?.name ?? null,
    scripts: pkgJson?.scripts,
    deps: {
      ...pkgJson?.dependencies,
      ...pkgJson?.devDependencies,
      ...pkgJson?.peerDependencies,
      ...pkgJson?.optionalDependencies,
    },
  }
}

/**
 * 설치 버전을 모은다. 정확도를 위해 node_modules의 실제 설치 버전을 우선 보고,
 * 없으면 package.json 선언값으로 fallback.
 */
async function collectInstalledVersions(
  root: string,
  deps: DepMap,
): Promise<Map<string, string | null>> {
  const installed = new Map<string, string | null>()
  for (const pkg of SDK_PACKAGES) {
    installed.set(pkg, (await readInstalledVersion(root, pkg)) ?? cleanRange(deps[pkg]))
  }
  return installed
}

/** 설치 버전 vs 레지스트리 latest. bstage 프로젝트가 아니면 latest는 건너뛴다. */
async function diagnoseVersions(
  deps: DepMap,
  installed: Map<string, string | null>,
  isBstageProject: boolean,
  isLiquid: boolean,
): Promise<{ versions: VersionRow[]; latestChecked: boolean }> {
  // liquid 레포가 의존하는 SDK 패키지는 저작 도구인 cli 하나뿐이다. 설치 여부와 무관하게
  // 행을 남긴다 — 없으면 "cli를 안 깔았다"는 사실이 표에서 사라져 버린다.
  // 그 밖에는 이 프로젝트와 관련 있는 패키지만 대조·표시한다 — 선언하지 않은 패키지 행은 노이즈다.
  const relevantPackages = isLiquid
    ? [CLI_PACKAGE]
    : SDK_PACKAGES.filter((pkg) => installed.get(pkg) !== null || pkg in deps)

  const latest = new Map<SdkPackage, string | null>()
  let latestChecked = false
  if (isBstageProject) {
    latestChecked = true
    await Promise.all(
      relevantPackages.map(async (pkg) => {
        latest.set(pkg, await fetchLatestVersion(pkg).catch(() => null))
      }),
    )
  }

  const versions: VersionRow[] = relevantPackages.map((pkg) => {
    const inst = installed.get(pkg) ?? null
    const lat = latest.get(pkg) ?? null
    return {
      pkg,
      installed: inst,
      latest: lat,
      outdated: !!inst && !!lat && compareSemver(inst, lat) < 0,
    }
  })
  return { versions, latestChecked }
}

/**
 * 마이그레이션 항목이 요구하는 패키지의 설치 상태를 돌려주는 resolver.
 * 항목 헤더가 명시한 패키지의 설치 버전을 각각 대조한다(패키지 독립 버전이라 core 하나로 통일 불가).
 */
function migrationResolver(
  root: string,
  deps: DepMap,
  installed: Map<string, string | null>,
): MigrationResolver {
  const cache = new Map<string, { version: string | null; relevant: boolean }>()
  return async (pkg: string) => {
    const cached = cache.get(pkg)
    if (cached) return cached
    const version =
      installed.get(pkg) ?? (await readInstalledVersion(root, pkg)) ?? cleanRange(deps[pkg])
    // relevant: 설치돼 있거나(node_modules) 의존성으로 선언된 패키지만 이 소비자와 관련 있다.
    const resolved = { version, relevant: version !== null || pkg in deps }
    cache.set(pkg, resolved)
    return resolved
  }
}

/**
 * 프로젝트를 훑어 진단 리포트를 만든다. 파일을 일절 수정하지 않는다.
 *
 * @internal 진입점(`doctorCommand`)과 테스트가 부른다. public API 아님.
 */
export async function diagnose(root: string): Promise<DoctorReport> {
  const pkg = await readProjectPackage(root)
  const deps = pkg.deps
  const kind = detectProjectKind(root).kind
  const isLiquid = kind === 'liquid'
  // liquid 스캐폴드는 cli만 의존하고 그마저 없을 수 있다. 파일 구조가 liquid라고 말하면
  // 그것이 bstage 프로젝트라는 근거로 충분하다 — 아니면 리포트가 통째로 비어 버린다.
  const isBstageProject = isLiquid || SDK_PACKAGES.some((p) => p in deps)

  const installed = await collectInstalledVersions(root, deps)
  const { versions, latestChecked } = await diagnoseVersions(
    deps,
    installed,
    isBstageProject,
    isLiquid,
  )

  // 레포 종류에 맞는 세트만 본다 — liquid 레포에서 sdk 스킬을 미설치로 잡으면 안 된다.
  const skillKind = resolveSkillKind(kind)
  const tables = tablesFor(isLiquid ? 'liquid' : 'sdk')

  return {
    project: pkg.name,
    kind,
    isBstageProject,
    versions,
    files: diagnoseFiles(root, tables.files),
    layout: await diagnoseLayout(root),
    pnpmWorkspace: await diagnosePnpmWorkspace(root),
    scripts: diagnoseScripts(pkg.scripts, tables.scripts),
    recommendedDeps: diagnoseRecommendedDeps(deps, tables.deps),
    migrations: await readApplicableMigrations(migrationResolver(root, deps, installed)),
    agentsMd: await diagnoseAgentsMd(root, pkg.name),
    skills: skillKind === null ? [] : await diagnoseSkills(root, skillKind),
    skillsSkipped: skillKind === null,
    latestChecked,
    liquid: isLiquid ? { issues: validateLiquid(root) } : null,
  }
}

/** node_modules에 실제 설치된 패키지 버전을 읽는다. 없으면 null. */
async function readInstalledVersion(root: string, pkg: string): Promise<string | null> {
  try {
    const raw = await readFile(join(root, 'node_modules', pkg, 'package.json'), 'utf-8')
    const parsed = JSON.parse(raw) as { version?: string }
    return parsed.version ?? null
  } catch {
    return null
  }
}

/** npm 레지스트리에서 latest 버전을 조회한다. (init.ts와 동일 규칙) */
async function fetchLatestVersion(packageName: string): Promise<string> {
  const res = await fetch(`https://registry.npmjs.org/${packageName}`, {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = (await res.json()) as { 'dist-tags'?: { latest?: string } }
  const latest = data['dist-tags']?.latest
  if (!latest) throw new Error('latest 없음')
  return latest
}
