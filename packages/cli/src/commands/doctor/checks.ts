import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

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
export interface RecommendedDep {
  pkg: string
  note: string
  why: string
}

export const RECOMMENDED_DEPS: RecommendedDep[] = [
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
export interface ExpectedScript {
  name: string
  command: string
  why: string
}

export const EXPECTED_SCRIPTS: ExpectedScript[] = [
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
export interface ExpectedFile {
  path: string
  note: string
  /** 이 중 하나라도 있으면 있는 것으로 본다(`public/user`·`public/admin`처럼 택일인 자리). */
  anyOf?: string[]
}

export const EXPECTED_FILES: ExpectedFile[] = [
  { path: 'tsconfig.app.json', note: 'tsconfig 분리 (app)' },
  { path: 'tsconfig.node.json', note: 'tsconfig 분리 (node)' },
  { path: 'eslint.config.js', note: 'ESLint flat config' },
  { path: 'src/vite-env.d.ts', note: 'Vite client 타입' },
  { path: 'src/App.tsx', note: 'dev 화면 분리 (없으면 lint 실패)' },
]

/**
 * liquid 레포의 기대 파일. sdk 표(tsconfig·eslint·vite)는 통째로 해당이 없다 —
 * liquid는 번들링하지 않으므로 빌드 도구 설정 파일이 아예 없다.
 *
 * sdk 표와 같은 규약을 따른다: `scaffoldLiquid`가 만드는 파일을 전부 적는 목록이 아니라,
 * **오래된 프로젝트에 없을 수 있어 감지해야 하는 부분집합**만 담는다. `.husky/pre-commit`·
 * `.husky/check-secrets.mjs`·`.npmrc`는 없어도 저작·배포가 막히지 않으므로 일부러 뺐다.
 */
export const LIQUID_EXPECTED_FILES: ExpectedFile[] = [
  {
    path: 'public/{user|admin}',
    note: '템플릿 루트 (포털 빌더가 이 아래만 패키징한다)',
    anyOf: ['public/user', 'public/admin'],
  },
  { path: 'AGENTS.md', note: '에이전트 가이드 (관리 영역 포함)' },
]

/**
 * liquid 레포의 기대 스크립트. `scaffoldLiquid.ts`의 `liquidPackageJson`과 함께 갱신한다.
 *
 * 여기도 부분집합이다 — 없으면 저작 흐름이 막히는 것만 담는다. `deploy`·`prepare`는
 * 편의 스크립트라(각각 `bstage deploy` 직접 실행·husky 설치) 빠져 있어도 진단하지 않는다.
 */
export const LIQUID_EXPECTED_SCRIPTS: ExpectedScript[] = [
  {
    name: 'dev',
    command: 'bstage dev',
    why: 'liquid 로컬 프리뷰 진입점이다 — 없으면 data.json으로 렌더해 볼 방법이 없다',
  },
  {
    name: 'build',
    command: 'bstage build',
    why: 'liquid는 번들을 만들지 않는다 — build는 문법·규약 검증이고, 없으면 CI가 오류를 못 잡는다',
  },
]

/**
 * liquid 레포의 권장 의존성은 없다. 서버가 렌더하므로 런타임 패키지를 설치하지 않고,
 * 저작 도구인 cli는 버전 표에서 따로 본다.
 */
export const LIQUID_RECOMMENDED_DEPS: RecommendedDep[] = []

/** kind별 진단 표 한 벌. `diagnose`가 골라 쓴다. */
export interface CheckTables {
  files: ExpectedFile[]
  scripts: ExpectedScript[]
  deps: RecommendedDep[]
}

export function tablesFor(kind: 'sdk' | 'liquid'): CheckTables {
  if (kind === 'liquid') {
    return {
      files: LIQUID_EXPECTED_FILES,
      scripts: LIQUID_EXPECTED_SCRIPTS,
      deps: LIQUID_RECOMMENDED_DEPS,
    }
  }
  return { files: EXPECTED_FILES, scripts: EXPECTED_SCRIPTS, deps: RECOMMENDED_DEPS }
}

export interface FileRow {
  path: string
  note: string
  present: boolean
}

/** 권장 의존성의 선언 상태. `declared`는 package.json의 의존성 구획 선언 여부다. */
export interface DepRow {
  pkg: string
  note: string
  why: string
  declared: boolean
}

export interface ScriptRow {
  name: string
  /** init이 넣는 명령. */
  expected: string
  why: string
  /** 프로젝트에 선언된 명령. 없으면 `null`. */
  actual: string | null
}

export interface PnpmWorkspaceInfo {
  /** pnpm 프로젝트인가 (`pnpm-lock.yaml` 존재). npm 프로젝트면 검사 대상이 아니다. */
  relevant: boolean
  /** `pnpm-workspace.yaml`에 `allowBuilds:`가 선언돼 있나. */
  allowBuildsDeclared: boolean
  /** `pnpm-workspace.yaml`에 `packages:`가 선언돼 있나. 없으면 pnpm 9에서 install이 죽는다. */
  packagesDeclared: boolean
  /** `pnpm-workspace.yaml` 자체가 있나. 없으면 두 항목 모두 미선언이지만 원인이 다르다. */
  filePresent: boolean
}

/**
 * 템플릿 디렉토리 구조 진단.
 *
 * `EXPECTED_FILES`는 "있어야 하는데 없는 파일"을 찾는 검사라 **"이제 있으면 안 되는 옛 구조"는
 * 잡지 못한다.** 산출물 경로가 폴더 구조를 따라가게 바뀌면서 `src/templates/`는 빌드 대상에서
 * 빠졌고, 그대로 둔 프로젝트는 `bstage build`가 엔트리를 하나도 못 찾고 멈춘다.
 */
export interface LayoutInfo {
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

/** 보일러플레이트 존재 여부. 내용 비교는 하지 않는다. */
export function diagnoseFiles(root: string, expected: ExpectedFile[]): FileRow[] {
  return expected.map((f) => ({
    path: f.path,
    note: f.note,
    present: (f.anyOf ?? [f.path]).some((candidate) => existsSync(join(root, candidate))),
  }))
}

/**
 * package.json 스크립트 대조. 존재 여부와 명령이 다른지를 함께 본다.
 */
export function diagnoseScripts(
  scripts: Record<string, string> | undefined,
  expected: ExpectedScript[],
): ScriptRow[] {
  return expected.map((sc) => ({
    ...sc,
    expected: sc.command,
    actual: scripts?.[sc.name] ?? null,
  }))
}

/**
 * 권장 의존성 선언 여부.
 *
 * node_modules 존재가 아니라 **선언** 여부를 본다 — 선언하지 않은 패키지는 import가
 * (pnpm 등 엄격한 해석에서) 깨지므로, 설치본이 우연히 있어도 "쓸 수 있는 상태"가 아니다.
 */
export function diagnoseRecommendedDeps(
  deps: Record<string, string>,
  recommended: RecommendedDep[],
): DepRow[] {
  return recommended.map((d) => ({ ...d, declared: d.pkg in deps }))
}

/**
 * pnpm workspace 설정을 본다. 두 가지를 보는데 둘 다 없으면 `pnpm install`이 실패하고
 * `pnpm dev`도 함께 죽는다(pnpm이 run 전에 install 상태를 확인하며 자동 install을 돌린다).
 * - `allowBuilds`: pnpm 10부터 의존성 build script를 기본 차단하고 11은 그것을 에러로 낸다
 *   (`ERR_PNPM_IGNORED_BUILDS`).
 * - `packages`: pnpm 9는 이 파일이 있으면 workspace 루트로 보고, 없으면
 *   `ERROR packages field missing or empty`로 즉시 중단한다.
 * npm 프로젝트에는 해당 없다 — lockfile로 판별한다.
 */
export async function diagnosePnpmWorkspace(root: string): Promise<PnpmWorkspaceInfo> {
  if (!existsSync(join(root, 'pnpm-lock.yaml'))) {
    return {
      relevant: false,
      allowBuildsDeclared: false,
      packagesDeclared: false,
      filePresent: false,
    }
  }

  let yaml: string | null = null
  try {
    yaml = await readFile(join(root, 'pnpm-workspace.yaml'), 'utf-8')
  } catch {
    // 파일 없음 → 두 항목 모두 미선언
  }
  return {
    relevant: true,
    filePresent: yaml !== null,
    allowBuildsDeclared: yaml !== null && /^allowBuilds:/m.test(yaml),
    packagesDeclared: yaml !== null && /^packages:/m.test(yaml),
  }
}

/**
 * 템플릿 디렉토리 구조를 진단한다.
 *
 * 옛 구조의 템플릿 폴더 이름까지 모아 오는 이유: 변환 단계에서 "이 폴더가 페이지인지 위젯인지,
 * 페이지면 어느 경로인지"를 사람에게 물어야 하는데, 물어볼 목록을 만드는 건 감지 쪽 일이다.
 */
export async function diagnoseLayout(root: string): Promise<LayoutInfo> {
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
