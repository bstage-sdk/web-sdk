import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pc from 'picocolors'
import { skillsInstallCommand } from './skills.js'
import { renderManagedBlock } from '../templates/agentsMd.js'
import { agentsMdStatus, parseAgentsIdentity } from '../templates/agentsMdRegion.js'
import type { AgentsMdStatus } from '../templates/agentsMdRegion.js'
import { BSTAGE_SKILLS } from '../templates/skills.js'
import { resolveProjectTarget } from '../constants.js'

export interface DoctorOptions {
  json?: boolean
}

/**
 * 진단 대상 SDK 패키지.
 *
 * 디자인 토큰(design)도 포함한다 — 소비자가 실제로 뒤처지는 축이라 버전 표에서 빠지면
 * "cli만 최신인데 design은 몇 달 전"인 상태가 조용히 남는다.
 * 프로젝트가 선언·설치하지 않은 패키지는 리포트에서 제외된다(무관한 행으로 노이즈를 만들지 않음).
 */
const SDK_PACKAGES = [
  '@bstage-sdk/cli',
  '@bstage-sdk/core',
  '@bstage-sdk/react',
  '@bstage-sdk/design',
] as const

type SdkPackage = (typeof SDK_PACKAGES)[number]

/**
 * 선언해두면 좋은(없어도 빌드는 되는) 의존성 — **선언 여부만** 본다.
 *
 * 마이그레이션 항목은 헤더가 명시한 패키지의 버전 대조로 노출되므로(`## → cli 0.42.0`),
 * cli를 이미 올린 프로젝트에서는 "의존성을 아직 추가하지 않았다"는 사실이 항목으로 잡히지 않는다.
 * 버전과 무관한 이 축을 따로 진단해, 마이그레이션 스킬이 사용자에게 물어볼 근거를 만든다.
 */
/**
 * 프로젝트에 **선언**돼 있어야 하는 의존성. `templates/packageJson.ts`의 의존성과 함께 갱신한다
 * — 스캐폴드에만 넣으면 새 프로젝트만 고쳐지고 기존 프로젝트는 감지되지 않는다.
 */
const RECOMMENDED_DEPS: { pkg: string; note: string; why: string }[] = [
  {
    pkg: '@bstage-sdk/design',
    note: 'bstage 디자인 토큰 (색·타이포·그림자)',
    why: '없으면 에이전트가 hex/rgb를 하드코딩해 플랫폼 테마·다크모드와 어긋난다',
  },
  {
    pkg: '@types/node',
    note: 'vite.config.ts 타입 (tsconfig.node.json이 `types: ["node"]` 선언)',
    why: '없으면 `npm run typecheck`(tsc -b)가 TS2688로 깨진다 — vite.config.ts가 process.cwd()를 쓴다',
  },
]

/**
 * 현재 `bstage init`이 넣는 package.json 스크립트 중, 오래된 프로젝트에 없을 수 있는 것.
 * `templates/packageJson.ts`의 `scripts`와 함께 갱신한다.
 *
 * 존재 여부와 **명령이 다른지**를 함께 본다 — 특히 `tsc --noEmit`은 스캐폴드 tsconfig가
 * solution-style(`files: []`)이라 **아무 파일도 검사하지 않는다.** 있는데 조용히 통과하는 상태가
 * 없는 것보다 위험하므로 다름도 보고한다(고칠지는 변환 단계의 판단).
 */
const EXPECTED_SCRIPTS: { name: string; command: string; why: string }[] = [
  {
    name: 'typecheck',
    command: 'tsc -b',
    why: '`bstage build`는 tsc를 타지 않아, 이 스크립트가 없으면 없는 번역 키·타입 오류가 조용히 통과한다',
  },
]

/**
 * 현재 `bstage init`이 생성하는 보일러플레이트 중, 오래된 프로젝트에 없을 수 있는 파일.
 * 존재 여부만 본다(내용 비교는 변환 단계의 몫). init.ts의 파일 목록과 함께 갱신한다.
 */
const EXPECTED_FILES: { path: string; note: string }[] = [
  { path: 'tsconfig.app.json', note: 'tsconfig 분리 (app)' },
  { path: 'tsconfig.node.json', note: 'tsconfig 분리 (node)' },
  { path: 'eslint.config.js', note: 'ESLint flat config' },
  { path: 'src/vite-env.d.ts', note: 'Vite client 타입' },
  { path: 'src/App.tsx', note: 'dev 화면 분리 (없으면 lint 실패)' },
]

interface VersionRow {
  pkg: SdkPackage
  installed: string | null
  latest: string | null
  outdated: boolean
}

interface FileRow {
  path: string
  note: string
  present: boolean
}

/** 권장 의존성의 선언 상태. `declared`는 package.json의 의존성 구획 선언 여부다. */
interface DepRow {
  pkg: string
  note: string
  why: string
  declared: boolean
}

interface PnpmWorkspaceInfo {
  /** pnpm 프로젝트인가 (`pnpm-lock.yaml` 존재). npm 프로젝트면 검사 대상이 아니다. */
  relevant: boolean
  /** `pnpm-workspace.yaml`에 `allowBuilds:`가 선언돼 있나. */
  allowBuildsDeclared: boolean
  /** `pnpm-workspace.yaml`에 `packages:`가 선언돼 있나. 없으면 pnpm 9에서 install이 죽는다. */
  packagesDeclared: boolean
  /** `pnpm-workspace.yaml` 자체가 있나. 없으면 두 항목 모두 미선언이지만 원인이 다르다. */
  filePresent: boolean
}

interface ScriptRow {
  name: string
  /** init이 넣는 명령. */
  expected: string
  why: string
  /** 프로젝트에 선언된 명령. 없으면 `null`. */
  actual: string | null
}

/**
 * 마이그레이션 항목이 요구하는 (패키지, 최소 버전) 쌍. 헤더 `## → cli 0.43.0`에서 파싱.
 * @internal 파서 테스트용으로 노출. public API 아님.
 */
export interface MigrationRequirement {
  /** 정규화된 패키지 이름(예: `@bstage-sdk/cli`). */
  pkg: string
  /** 이 버전 이상이면 항목이 이미 적용된 상태다(설치본이 더 낮으면 적용 대상). */
  version: string
}

/** @internal 파서 테스트용으로 노출. public API 아님. */
export interface MigrationEntry {
  /** 헤더 원문 표기(예: `cli 0.43.0`, `core 0.32.0 · react 0.32.0 · cli 0.32.0`). 리포트·JSON 표시용. */
  label: string
  /** 이 항목이 딸린 패키지·버전 요구. 하나라도 미충족(설치본이 더 낮음)이면 적용 대상. */
  requirements: MigrationRequirement[]
  items: string[]
}

interface AgentsMdInfo {
  status: AgentsMdStatus
  /** 갱신이 필요한 경우(legacy/stale) 적용할 최신 관리 영역 블록. 마이그레이션 스킬이 reconcile에 쓴다. */
  managedBlock: string | null
}

/**
 * 에이전트 스킬 설치 상태.
 * - missing: `.claude/skills/{name}/SKILL.md` 없음 — 스킬이 한 번도 설치되지 않음
 * - stale: 파일은 있으나 이 CLI의 최신 템플릿과 내용이 다름(구버전 또는 수동 수정)
 * - ok: 최신
 *
 * 스킬은 SDK 소유 자산(`skills install`이 덮어씀)이므로 내용 불일치는 곧 동기화 대상이다.
 */
type SkillStatus = 'missing' | 'stale' | 'ok'

interface SkillRow {
  name: string
  status: SkillStatus
}

/**
 * 템플릿 디렉토리 구조 진단.
 *
 * `EXPECTED_FILES`는 "있어야 하는데 없는 파일"을 찾는 검사라 **"이제 있으면 안 되는 옛 구조"는
 * 잡지 못한다.** 산출물 경로가 폴더 구조를 따라가게 바뀌면서 `src/templates/`는 빌드 대상에서
 * 빠졌고, 그대로 둔 프로젝트는 `bstage build`가 엔트리를 하나도 못 찾고 멈춘다.
 */
interface LayoutInfo {
  /** 옛 구조(`src/templates/`)가 남아 있는지. */
  legacyPresent: boolean
  /**
   * 옛 구조 아래 템플릿 폴더 이름들.
   *
   * 마이그레이션 스킬이 하나씩 짚어 "페이지인가 위젯인가"를 물을 목록이다 — 소스만으로는
   * 판별할 수 없어(폴더 이름이 지금까지 아무 의미가 없었다) 사람에게 물어야 한다.
   */
  legacyTemplates: string[]
  pagesPresent: boolean
  slotsPresent: boolean
}

interface DoctorReport {
  project: string | null
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
  latestChecked: boolean
}

/**
 * `bstage doctor` — 마이그레이션 감지(결정론). 진단 자체는 파일을 일절 수정하지 않는다.
 *
 * 1) 버전 드리프트: 설치 버전 vs 레지스트리 latest
 * 2) 보일러플레이트 누락: 현재 init 산출 파일의 존재 여부
 * 3) 권장 의존성 미선언: 버전 대조로는 안 잡히는 축(예: `bstage-design`을 아직 안 넣은 프로젝트)
 * 4) 적용 가능한 마이그레이션: CLI 동봉 MIGRATION.md에서 항목이 명시한 패키지의 설치 버전보다 높은 섹션 추출
 * 5) SDK 소유 자산 드리프트: AGENTS.md 관리 영역 + 에이전트 스킬(.claude/skills/) 설치·동기화 상태
 *
 * 실제 변환(코드 수정)은 마이그레이션 스킬/사람의 몫이다. 예외로 스킬 드리프트는
 * 판단이 필요 없는 결정론적 동기화(SDK 소유 자산 덮어쓰기, 사용자 파일 무접촉)이므로
 * 발견 즉시 `skills install`을 실행해 치유한다. `--json`은 순수 리포트 계약이라 제외.
 */
export async function doctorCommand(options: DoctorOptions): Promise<void> {
  const root = process.cwd()
  const report = await diagnose(root)

  if (options.json) {
    console.log(JSON.stringify(report, null, 2))
    return
  }

  printReport(report)
  await autoSyncSkills(report)
}

/**
 * 스킬 드리프트가 있으면 즉시 `skills install`로 동기화한다.
 *
 * 스킬은 SDK 소유 자산이라 동기화에 판단이 필요 없고(덮어쓰기가 계약), 사용자 파일은
 * 건드리지 않는다. AGENTS.md는 관리 영역 마커가 있을 때만 함께 갱신된다(skills install의
 * 기존 동작 — 레거시 파일은 보존하고 안내만 한다).
 */
async function autoSyncSkills(report: DoctorReport): Promise<void> {
  if (!report.isBstageProject) return
  if (!report.skills.some((s) => s.status !== 'ok')) return

  await skillsInstallCommand({ dir: '.claude/skills' })
}

async function diagnose(root: string): Promise<DoctorReport> {
  // ── 프로젝트 package.json ───────────────────────────────────────────────
  type DepMap = Record<string, string>
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

  // bstage 패키지는 dependencies뿐 아니라 devDependencies에도 흔히 있다
  // (bstage-cli는 빌드 도구, IIFE로 번들되는 템플릿은 core/react도 devDependencies 가능).
  // 모든 의존성 구획을 병합해 탐지·버전 fallback에 쓴다.
  const deps: DepMap = {
    ...pkgJson?.dependencies,
    ...pkgJson?.devDependencies,
    ...pkgJson?.peerDependencies,
    ...pkgJson?.optionalDependencies,
  }
  const isBstageProject = SDK_PACKAGES.some((p) => p in deps)

  // ── 설치 버전 ────────────────────────────────────────────────────────────
  // 정확도를 위해 node_modules의 실제 설치 버전을 우선 보고, 없으면 package.json 선언값으로 fallback.
  const installed = new Map<string, string | null>()
  for (const pkg of SDK_PACKAGES) {
    installed.set(pkg, (await readInstalledVersion(root, pkg)) ?? cleanRange(deps[pkg]))
  }

  // 이 프로젝트와 관련 있는 패키지만 대조·표시한다 — 선언하지 않은 패키지 행은 노이즈다.
  const relevantPackages = SDK_PACKAGES.filter((pkg) => installed.get(pkg) !== null || pkg in deps)

  // ── 레지스트리 latest ────────────────────────────────────────────────────
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

  // ── 보일러플레이트 ────────────────────────────────────────────────────────
  const files: FileRow[] = EXPECTED_FILES.map((f) => ({
    path: f.path,
    note: f.note,
    present: existsSync(join(root, f.path)),
  }))

  // ── pnpm workspace 설정 ───────────────────────────────────────────────────
  // 두 가지를 본다. 둘 다 없으면 `pnpm install`이 실패하고 `pnpm dev`도 함께 죽는다
  // (pnpm이 run 전에 install 상태를 확인하며 자동 install을 돌린다).
  // - `allowBuilds`: pnpm 10부터 의존성 build script를 기본 차단하고 11은 그것을 에러로 낸다
  //   (`ERR_PNPM_IGNORED_BUILDS`).
  // - `packages`: pnpm 9는 이 파일이 있으면 workspace 루트로 보고, 없으면
  //   `ERROR packages field missing or empty`로 즉시 중단한다.
  // npm 프로젝트에는 해당 없다 — lockfile로 판별한다.
  const isPnpmProject = existsSync(join(root, 'pnpm-lock.yaml'))
  let pnpmWorkspace: PnpmWorkspaceInfo = {
    relevant: false,
    allowBuildsDeclared: false,
    packagesDeclared: false,
    filePresent: false,
  }
  if (isPnpmProject) {
    let yaml: string | null = null
    try {
      yaml = await readFile(join(root, 'pnpm-workspace.yaml'), 'utf-8')
    } catch {
      // 파일 없음 → 두 항목 모두 미선언
    }
    pnpmWorkspace = {
      relevant: true,
      filePresent: yaml !== null,
      allowBuildsDeclared: yaml !== null && /^allowBuilds:/m.test(yaml),
      packagesDeclared: yaml !== null && /^packages:/m.test(yaml),
    }
  }

  // ── package.json 스크립트 ────────────────────────────────────────────────
  const scripts: ScriptRow[] = EXPECTED_SCRIPTS.map((sc) => ({
    ...sc,
    expected: sc.command,
    actual: pkgJson?.scripts?.[sc.name] ?? null,
  }))

  // ── 권장 의존성 ──────────────────────────────────────────────────────────
  // node_modules 존재가 아니라 **선언** 여부를 본다 — 선언하지 않은 패키지는 import가
  // (pnpm 등 엄격한 해석에서) 깨지므로, 설치본이 우연히 있어도 "쓸 수 있는 상태"가 아니다.
  const recommendedDeps: DepRow[] = RECOMMENDED_DEPS.map((d) => ({
    ...d,
    declared: d.pkg in deps,
  }))

  // ── 적용 가능한 마이그레이션 ──────────────────────────────────────────────
  // 항목 헤더가 명시한 패키지의 설치 버전을 각각 대조한다(패키지 독립 버전이라 core 하나로 통일 불가).
  const resolveCache = new Map<string, { version: string | null; relevant: boolean }>()
  const migrations = await readApplicableMigrations(async (pkg) => {
    const cached = resolveCache.get(pkg)
    if (cached) return cached
    const version =
      installed.get(pkg) ?? (await readInstalledVersion(root, pkg)) ?? cleanRange(deps[pkg])
    // relevant: 설치돼 있거나(node_modules) 의존성으로 선언된 패키지만 이 소비자와 관련 있다.
    const resolved = { version, relevant: version !== null || pkg in deps }
    resolveCache.set(pkg, resolved)
    return resolved
  })

  // ── AGENTS.md 관리 영역 상태 ──────────────────────────────────────────────
  const agentsMd = await diagnoseAgentsMd(root, pkgJson?.name ?? null)

  // ── 에이전트 스킬 설치 상태 ───────────────────────────────────────────────
  const skills = await diagnoseSkills(root)

  return {
    project: pkgJson?.name ?? null,
    isBstageProject,
    versions,
    files,
    layout: await diagnoseLayout(root),
    pnpmWorkspace,
    scripts,
    recommendedDeps,
    migrations,
    agentsMd,
    skills,
    latestChecked,
  }
}

/**
 * 템플릿 디렉토리 구조를 진단한다.
 *
 * 옛 구조의 템플릿 폴더 이름까지 모아 오는 이유: 변환 단계에서 "이 폴더가 페이지인지 위젯인지,
 * 페이지면 어느 경로인지"를 사람에게 물어야 하는데, 물어볼 목록을 만드는 건 감지 쪽 일이다.
 */
async function diagnoseLayout(root: string): Promise<LayoutInfo> {
  const legacyRoot = join(root, 'src', 'templates')

  let legacyTemplates: string[] = []
  let legacyPresent = false
  try {
    const dirents = await readdir(legacyRoot, { withFileTypes: true })
    legacyPresent = true
    legacyTemplates = dirents
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
      .map((d) => d.name)
      .sort()
  } catch {
    // 없으면 정상 — 이미 옮겼거나 처음부터 새 구조로 만든 프로젝트다.
  }

  return {
    legacyPresent,
    legacyTemplates,
    pagesPresent: existsSync(join(root, 'src', 'pages')),
    slotsPresent: existsSync(join(root, 'src', 'slots')),
  }
}

/**
 * 에이전트 스킬(`.claude/skills/`) 설치 상태를 진단한다.
 *
 * 비교 기준은 **실행 중인 CLI에 동봉된 최신 스킬 템플릿**이다. `npx @bstage-sdk/cli@latest doctor`로
 * 실행하면 항상 최신 스킬 대비로 진단된다(MIGRATION.md를 CLI 쪽에서 읽는 것과 같은 이유).
 */
async function diagnoseSkills(root: string): Promise<SkillRow[]> {
  // 디자인 가이드 타깃을 맞춰 비교해야 어드민 프로젝트가 오탐(stale)되지 않는다.
  const target = resolveProjectTarget(root)
  return Promise.all(
    BSTAGE_SKILLS.map(async (skill): Promise<SkillRow> => {
      let installed: string
      try {
        installed = await readFile(join(root, '.claude', 'skills', skill.name, 'SKILL.md'), 'utf-8')
      } catch {
        return { name: skill.name, status: 'missing' }
      }
      return { name: skill.name, status: installed === skill.content(target) ? 'ok' : 'stale' }
    }),
  )
}

/**
 * AGENTS.md 관리 영역 상태를 진단한다.
 * - missing: 파일 없음
 * - legacy: 관리 영역 마커 없음(마커 도입 전 파일) → 마이그레이션 스킬 reconcile 필요
 * - stale: 마커 있으나 관리 영역 버전이 낮음 → `skills install`로 갱신 가능
 * - ok: 최신
 *
 * legacy/stale이면 적용할 최신 관리 영역 블록을 함께 담아, 마이그레이션 스킬이 reconcile에 쓴다.
 */
async function diagnoseAgentsMd(root: string, pkgName: string | null): Promise<AgentsMdInfo> {
  let content: string
  try {
    content = await readFile(join(root, 'AGENTS.md'), 'utf-8')
  } catch {
    return { status: 'missing', managedBlock: null }
  }

  const status = agentsMdStatus(content)
  if (status === 'ok') return { status, managedBlock: null }

  // 프로젝트 정체성 보존(없으면 레포명 규칙으로 fallback).
  const parsed = parseAgentsIdentity(content)
  const projectName = parsed.projectName ?? pkgName ?? 'custom-templates'
  const space = parsed.space ?? projectName.split('-custom-templates-')[0] ?? projectName
  const target = resolveProjectTarget(root)
  return { status, managedBlock: renderManagedBlock({ space, projectName, target }) }
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

/**
 * CLI에 동봉된 MIGRATION.md에서 소비자가 아직 적용하지 않은 섹션을 추출한다.
 * 섹션 헤더는 `## → {패키지} {버전}`(예: `## → cli 0.43.0`, `## → core 0.32.0 · react 0.32.0`),
 * 레거시 `## → x.y.z` / `## x.y.z`(패키지명 없음)는 core 기준으로 해석한다. 하위 항목은 `### 제목` 형식.
 *
 * 패키지가 완전 독립 버전이므로 core 하나로 통일 비교할 수 없다. 항목이 명시한 패키지의
 * 설치 버전을 각각 대조해, **관련 있고(설치·선언됨) 설치본이 요구 버전보다 낮은** 패키지가
 * 하나라도 있으면 적용 대상으로 본다. 관련 없는 패키지만 있는 항목은 숨긴다.
 *
 * 가이드는 **실행 중인 CLI 버전과 함께** 동봉된다(build 시 repo docs/MIGRATION.md 복사).
 * 오래된 프로젝트의 node_modules에는 최신 가이드가 없으므로, 의도적으로 CLI 쪽을 읽는다.
 * 따라서 `npx @bstage-sdk/cli@latest doctor`가 항상 최신 가이드로 진단한다.
 */
async function readApplicableMigrations(
  resolve: (pkg: string) => Promise<{ version: string | null; relevant: boolean }>,
): Promise<MigrationEntry[]> {
  const md = await readBundledMigrationDoc()
  if (md === null) return []
  return selectApplicableMigrations(parseMigrationDoc(md), resolve)
}

/**
 * MIGRATION.md 본문을 항목 목록으로 파싱한다.
 *
 * @internal 디스크 접근과 분리해 테스트할 수 있게 노출. public API 아님.
 */
export function parseMigrationDoc(md: string): MigrationEntry[] {
  const lines = md.split('\n')
  // `## → ...` 또는 `## x.y.z`. 버전이 없는 `##`(산문 섹션 헤더)은 마이그레이션 항목으로 치지 않는다.
  const sectionRe = /^##\s+(?:→\s*)?(.+?)\s*$/
  const itemRe = /^###\s+(.+?)\s*$/

  const entries: MigrationEntry[] = []
  let current: MigrationEntry | null = null
  for (const line of lines) {
    const sec = sectionRe.exec(line)
    if (sec) {
      const requirements = parseMigrationRequirements(sec[1])
      // 버전 요구가 없으면 산문 섹션이므로 항목 수집을 멈춘다(current=null).
      current = requirements.length > 0 ? { label: sec[1].trim(), requirements, items: [] } : null
      if (current) entries.push(current)
      continue
    }
    if (current) {
      const item = itemRe.exec(line)
      if (item) {
        // 배지(`— 판단 · 선택`)는 제목에서 떼어 깔끔하게 표시
        current.items.push(item[1].replace(/\s*[—–-]\s*`.*$/, '').trim())
      }
    }
  }
  return entries
}

/**
 * 파싱된 항목 중 이 소비자에게 아직 적용되지 않은 것만 고른다.
 *
 * @internal 테스트용으로 노출. public API 아님.
 */
export async function selectApplicableMigrations(
  entries: MigrationEntry[],
  resolve: (pkg: string) => Promise<{ version: string | null; relevant: boolean }>,
): Promise<MigrationEntry[]> {
  const applicable: MigrationEntry[] = []
  for (const e of entries) {
    let applies = false
    for (const req of e.requirements) {
      const { version, relevant } = await resolve(req.pkg)
      if (!relevant) continue
      // 관련 있으나 버전 미상(workspace:* 등)이면 보수적으로 노출. 설치본이 더 낮아도 적용 대상.
      if (version === null || compareSemver(version, req.version) < 0) {
        applies = true
        break
      }
    }
    if (applies) applicable.push(e)
  }
  return applicable
}

/**
 * 섹션 헤더 텍스트에서 (패키지, 버전) 요구를 뽑는다.
 * `cli 0.43.0` → `{cli, 0.43.0}`, `core 0.32.0 · react 0.32.0` → 둘, 레거시 `0.44.0`(패키지명 없음) → core 기준.
 *
 * @internal 테스트용으로 노출. public API 아님.
 */
export function parseMigrationRequirements(text: string): MigrationRequirement[] {
  const reqs: MigrationRequirement[] = []
  const re = /(?:([a-z][a-z-]*)\s+)?(\d+\.\d+\.\d+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    reqs.push({ pkg: normalizeMigrationPkg(m[1]), version: m[2] })
  }
  return reqs
}

/**
 * 헤더의 짧은 패키지명(`cli`·`design`)을 정식 이름으로. 이름이 없으면(레거시) core 기준.
 * @internal 테스트용으로 노출. public API 아님.
 */
export function normalizeMigrationPkg(short: string | undefined): string {
  if (!short) return '@bstage-sdk/core'
  return short.startsWith('@') ? short : `@bstage-sdk/${short}`
}

/**
 * 동봉된 MIGRATION.md를 읽는다. 배포물에서는 CLI dist/ 옆에 복사되어 있고,
 * 소스 실행(dev) 시엔 repo의 docs/MIGRATION.md로 fallback한다. 못 찾으면 null.
 */
async function readBundledMigrationDoc(): Promise<string | null> {
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    join(here, 'MIGRATION.md'), // 배포물: dist/ 옆 (cli/dist/MIGRATION.md)
    join(here, '..', '..', '..', 'docs', 'MIGRATION.md'), // dev(dist): cli/dist → repo/docs
    join(here, '..', '..', '..', '..', 'docs', 'MIGRATION.md'), // dev(src): cli/src/commands → repo/docs
  ]
  for (const path of candidates) {
    try {
      return await readFile(path, 'utf-8')
    } catch {
      // 다음 후보
    }
  }
  return null
}

/**
 * `^1.2.3` / `~1.2.3` / `1.2.3` → `1.2.3`. 범위/태그면 null.
 * @internal 테스트용으로 노출. public API 아님.
 */
export function cleanRange(spec: string | undefined): string | null {
  if (!spec) return null
  const m = /(\d+\.\d+\.\d+)/.exec(spec)
  return m ? m[1] : null
}

/**
 * semver 비교. a<b → -1, a==b → 0, a>b → 1. prerelease는 무시(메이저/마이너/패치만).
 * @internal 테스트용으로 노출. public API 아님.
 */
export function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10))
  const pb = b.split('.').map((n) => parseInt(n, 10))
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d !== 0) return d < 0 ? -1 : 1
  }
  return 0
}

function printReport(r: DoctorReport): void {
  console.log('')
  console.log(`${pc.cyan(pc.bold('bstage doctor'))} ${pc.dim(`— ${r.project ?? '(이름 없음)'}`)}`)
  console.log('')

  if (!r.isBstageProject) {
    console.log(pc.yellow('이 디렉토리는 bstage 템플릿 프로젝트가 아닌 것 같습니다.'))
    console.log(pc.dim('  package.json에 @bstage-sdk/* 의존성이 없습니다.'))
    return
  }

  // ── 버전 ────────────────────────────────────────────────────────────────
  console.log(pc.bold('📦 SDK 버전'))
  if (!r.latestChecked) {
    console.log(pc.dim('  레지스트리 조회를 건너뛰어 설치 버전만 표시합니다.'))
  }
  // 이름 길이가 패키지마다 달라(bstage-cli ~ bstage-design) 폭을 실제 최대값으로 잡는다.
  const nameWidth = Math.max(12, ...r.versions.map((v) => v.pkg.replace('@bstage-sdk/', '').length))
  for (const v of r.versions) {
    const name = v.pkg.replace('@bstage-sdk/', '').padEnd(nameWidth)
    const inst = v.installed ?? '?'
    if (v.latest && v.installed) {
      const arrow = v.outdated ? pc.yellow(`→  ${v.latest}  (뒤처짐)`) : pc.green('(최신)')
      console.log(`  ${name} ${inst.padEnd(8)} ${arrow}`)
    } else {
      console.log(`  ${name} ${inst}`)
    }
  }
  console.log('')

  // ── init 기본 파일 (참고) ─────────────────────────────────────────────────
  // 누락 = 문제가 아니다. 프로젝트가 같은 목적을 다르게 달성했을 수 있다
  // (예: tsconfig `types:["vite/client"]`가 vite-env.d.ts를 대체, eslint 미사용).
  // 따라서 "차이"로만 보고하고, 적용 여부 판단은 변환 단계(스킬/사람)에 맡긴다.
  console.log(pc.bold('📁 init 기본 파일 (참고)'))
  const absent = r.files.filter((f) => !f.present)
  if (absent.length === 0) {
    console.log(pc.green('  ✓ init 기본 구성과 동일'))
  } else {
    console.log(pc.dim('  init 기본값과의 차이일 뿐 — 프로젝트가 다르게 처리 중이면 무시하세요.'))
    for (const f of r.files) {
      if (f.present) console.log(`  ${pc.green('✓')} ${f.path}`)
      else console.log(`  ${pc.dim('·')} ${f.path.padEnd(20)} ${pc.dim(`없음 (${f.note})`)}`)
    }
  }
  console.log('')

  // ── 템플릿 디렉토리 구조 ──────────────────────────────────────────────────
  // 위 "init 기본 파일"과 달리 이건 참고가 아니다. 옛 구조만 남아 있으면 빌드가 아예 멈춘다.
  console.log(pc.bold('🗂  템플릿 디렉토리'))
  if (r.layout.legacyPresent) {
    console.log(`  ${pc.yellow('→')} ${pc.yellow('src/templates/ 가 남아 있습니다 (옛 구조)')}`)
    console.log(pc.dim('      빌드 산출물 경로가 폴더 구조를 따라가도록 바뀌었습니다.'))
    console.log(pc.dim('      페이지 → src/pages/{경로}/  ·  위젯 → src/slots/{아무이름}/'))
    if (r.layout.legacyTemplates.length > 0) {
      console.log(pc.dim(`      옮겨야 할 템플릿: ${r.layout.legacyTemplates.join(', ')}`))
    }
    console.log(pc.dim('      변환: 에이전트에게 "bstage 마이그레이션" 요청'))
  } else if (!r.layout.pagesPresent && !r.layout.slotsPresent) {
    console.log(`  ${pc.dim('·')} src/pages/ · src/slots/ 둘 다 없음`)
  } else {
    console.log(pc.green('  ✓ src/pages/ · src/slots/ 구조'))
  }
  console.log('')

  // ── pnpm workspace 설정 ───────────────────────────────────────────────────
  if (r.pnpmWorkspace.relevant) {
    console.log(pc.bold('📦 pnpm workspace 설정'))
    if (r.pnpmWorkspace.allowBuildsDeclared) {
      console.log(pc.green('  ✓ pnpm-workspace.yaml에 allowBuilds 선언됨'))
    } else {
      console.log(`  ${pc.yellow('→')} ${pc.yellow('pnpm-workspace.yaml에 allowBuilds 없음')}`)
      console.log(
        pc.dim('      pnpm은 의존성 build script를 기본 차단하고, pnpm 11은 그것을 에러로 낸다'),
      )
      console.log(
        pc.dim('      → `pnpm install`이 ERR_PNPM_IGNORED_BUILDS로 실패하고 `pnpm dev`도 죽는다'),
      )
      console.log(pc.dim('      추가: pnpm-workspace.yaml에 `allowBuilds:` + `esbuild: true`'))
      console.log(pc.dim('      또는 `pnpm approve-builds`로 대화식 선택'))
    }
    // 파일이 없으면 pnpm 9도 workspace로 인식하지 않아 이 항목은 문제가 되지 않는다.
    if (r.pnpmWorkspace.filePresent && !r.pnpmWorkspace.packagesDeclared) {
      console.log(`  ${pc.yellow('→')} ${pc.yellow('pnpm-workspace.yaml에 packages 없음')}`)
      console.log(
        pc.dim('      pnpm 9는 이 파일이 있으면 workspace 루트로 보고 packages를 요구한다'),
      )
      console.log(pc.dim('      → pnpm 9에서 `ERROR packages field missing or empty`로 죽는다'))
      console.log(pc.dim("      추가: pnpm-workspace.yaml 맨 위에 `packages:` + `- '.'`"))
    } else if (r.pnpmWorkspace.packagesDeclared) {
      console.log(pc.green('  ✓ pnpm-workspace.yaml에 packages 선언됨'))
    }
    console.log('')
  }

  // ── package.json 스크립트 ─────────────────────────────────────────────────
  // 파일과 달리 "없으면 대체 수단이 있나"를 판단하기 어렵다 — 타입 게이트는 이 스크립트가 유일하다.
  console.log(pc.bold('🛠  package.json 스크립트'))
  const scriptIssues = r.scripts.filter((sc) => sc.actual !== sc.expected)
  if (scriptIssues.length === 0) {
    console.log(pc.green('  ✓ init 기본 구성과 동일'))
  } else {
    for (const sc of r.scripts) {
      if (sc.actual === sc.expected) {
        console.log(`  ${pc.green('✓')} ${sc.name}`)
        continue
      }
      if (sc.actual === null) {
        console.log(`  ${pc.yellow('→')} ${sc.name} ${pc.yellow('없음')}`)
      } else {
        console.log(
          `  ${pc.yellow('→')} ${sc.name} ${pc.yellow('다름')} ${pc.dim(`— 현재 \`${sc.actual}\``)}`,
        )
        if (sc.actual.includes('--noEmit') && !sc.actual.includes('-p ')) {
          console.log(
            pc.dim(
              '      주의: solution-style tsconfig에서 `tsc --noEmit`은 아무 파일도 검사하지 않습니다.',
            ),
          )
        }
      }
      console.log(pc.dim(`      ${sc.why}`))
      console.log(pc.dim(`      권장: "${sc.name}": "${sc.expected}"`))
    }
  }
  console.log('')

  // ── 권장 의존성 ───────────────────────────────────────────────────────────
  // 버전이 전부 최신이어도 "아직 안 넣은 의존성"은 마이그레이션 항목으로 안 잡힌다(항목은 버전 대조).
  console.log(pc.bold('🧱 권장 의존성'))
  if (r.recommendedDeps.every((d) => d.declared)) {
    console.log(pc.green('  ✓ 모두 선언됨'))
  } else {
    for (const d of r.recommendedDeps) {
      if (d.declared) {
        console.log(`  ${pc.green('✓')} ${d.pkg}`)
        continue
      }
      console.log(`  ${pc.yellow('→')} ${d.pkg} ${pc.yellow('미선언')} ${pc.dim(`— ${d.note}`)}`)
      console.log(pc.dim(`      ${d.why}`))
      console.log(pc.dim(`      추가: npm i ${d.pkg} (프로젝트 패키지 매니저로)`))
    }
  }
  console.log('')

  // ── 마이그레이션 ────────────────────────────────────────────────────────
  console.log(pc.bold('📖 적용 가능한 마이그레이션'))
  if (r.migrations.length === 0) {
    console.log(pc.dim('  해당 항목 없음.'))
  } else {
    for (const m of r.migrations) {
      console.log(`  ${pc.cyan(`→ ${m.label}`)}`)
      for (const item of m.items) console.log(`    • ${item}`)
    }
  }
  console.log('')

  // ── AGENTS.md 관리 영역 ───────────────────────────────────────────────────
  console.log(pc.bold('📝 AGENTS.md'))
  switch (r.agentsMd.status) {
    case 'ok':
      console.log(pc.green('  ✓ 관리 영역 최신'))
      break
    case 'missing':
      console.log(pc.dim('  · 파일 없음 — bstage 프로젝트라면 init/마이그레이션으로 생성하세요.'))
      break
    case 'stale':
      console.log(
        pc.yellow('  → 관리 영역이 오래됨') +
          pc.dim(' — `bstage skills install`로 갱신(자유 영역은 보존).'),
      )
      break
    case 'legacy':
      console.log(
        pc.yellow('  → 레거시 포맷(관리 영역 마커 없음)') +
          pc.dim(
            ' — `bstage skills install`로 스킬을 먼저 설치한 뒤, `bstage-migrate` 스킬로 reconcile(SDK 영역 교체 + 사용자 내용 보존).',
          ),
      )
      break
  }
  console.log('')

  // ── 에이전트 스킬 ─────────────────────────────────────────────────────────
  console.log(pc.bold('🧩 에이전트 스킬 (.claude/skills/)'))
  const skillsNeedWork = r.skills.filter((s) => s.status !== 'ok')
  if (skillsNeedWork.length === 0) {
    console.log(pc.green('  ✓ 모든 스킬 최신'))
  } else {
    for (const s of r.skills) {
      if (s.status === 'ok') console.log(`  ${pc.green('✓')} ${s.name}`)
      else if (s.status === 'missing')
        console.log(`  ${pc.yellow('→')} ${s.name.padEnd(16)} ${pc.yellow('미설치')}`)
      else console.log(`  ${pc.yellow('→')} ${s.name.padEnd(16)} ${pc.yellow('구버전/수정됨')}`)
    }
    console.log(
      pc.dim(
        '  아래에서 자동 동기화합니다 — bstage-* 스킬만 덮어쓰며, 그 외 사용자 스킬은 건드리지 않습니다.',
      ),
    )
  }
  console.log('')

  // ── 다음 단계 ────────────────────────────────────────────────────────────
  // 실제 작업 신호는 버전 드리프트·마이그레이션 항목·AGENTS.md 관리 영역 드리프트.
  // init 기본 파일 차이는 참고일 뿐이고, 스킬 드리프트는 리포트 직후 자동 동기화되므로
  // 사용자 작업 신호에 넣지 않는다.
  const agentsNeedsWork = r.agentsMd.status === 'legacy' || r.agentsMd.status === 'stale'
  const hasWork = r.versions.some((v) => v.outdated) || r.migrations.length > 0 || agentsNeedsWork
  if (hasWork) {
    console.log(
      pc.dim(
        '다음 단계: 마이그레이션 스킬을 실행해 위 항목을 프로젝트에 맞춰 적용하세요.\n' +
          '  상세 가이드: SDK 문서의 MIGRATION.md (위 항목별 적용 절차)',
      ),
    )
  } else {
    console.log(pc.green('✓ 최신 상태입니다. 마이그레이션이 필요 없습니다.'))
    if (absent.length > 0) {
      console.log(pc.dim('  (위 init 기본 파일 차이는 선택 사항입니다.)'))
    }
    if (r.recommendedDeps.some((d) => !d.declared)) {
      console.log(pc.dim('  (위 권장 의존성은 버전과 무관합니다 — 쓸 거면 따로 추가하세요.)'))
    }
  }
  console.log('')
}
