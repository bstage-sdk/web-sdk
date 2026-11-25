import { createHash, randomBytes } from 'node:crypto'
import { lstat, mkdir, open, readFile, realpath, rename, rm } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import pc from 'picocolors'
import {
  BlobTooLargeError,
  blobFetch,
  checkBlobUrl,
  getBlob,
  runPool,
} from '../portal/blobTransfer.js'
import {
  hasPath,
  loadBuiltinState,
  recordBuiltinSync,
  validateManifest,
} from '../portal/builtinState.js'
import type { BuiltinManifestFile } from '../portal/client.js'
import { assertBuiltinLinked, resolveLinkedRepo } from '../portal/buildRepo.js'
import { cleanText, ExitCode, fail } from '../portal/output.js'
import { resolveContext } from '../portal/resolveContext.js'
import { versionNumber } from './push.js'
import {
  assertNoConflicts,
  goLower,
  isAllowedSourcePath,
  isScriptFile,
  loadInclude,
  SOURCE_LIMITS,
  scanSource,
  sha256File,
  validateSourcePath,
} from '../portal/sourceManifest.js'

export interface PullOptions {
  /** 받을 버전 — `v3`·`3`(번호) 또는 32자리 버전 ID. 없으면 최신. */
  at?: string
  yes?: boolean
}

export interface PullDeps {
  cwd?: string
  env?: NodeJS.ProcessEnv
  fetch?: typeof fetch
  out?: (s: string) => void
}

const GET_CONCURRENCY = 4
const LIST_LIMIT = 10

/** 경로 목록 — 서버가 준 값이 섞이므로 이스케이프·제어 문자를 지우고 긴 값은 자른다(AWS Security Agent 2차 L1). */
function listLines(items: string[]): string {
  const shown = items.slice(0, LIST_LIMIT).map((p) => `  - ${cleanText(p, 300)}`)
  const more = items.length > LIST_LIMIT ? [`  … 외 ${items.length - LIST_LIMIT}개`] : []
  return [...shown, ...more].join('\n')
}

/** 로컬 파일 해시. 없으면 null, 심볼릭 링크·일반 파일이 아니면 'unsafe'. */
async function localFile(abs: string): Promise<{ hash: string } | null | 'unsafe'> {
  let st
  try {
    st = await lstat(abs)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw e
  }
  if (!st.isFile()) return 'unsafe'
  return { hash: await sha256File(abs) }
}

/**
 * 서버 manifest 도 push 와 같은 한도로 본다(AWS Security Agent 4차) — 파일 수·파일 하나·전체 크기를 넘거나
 * 크기가 정수가 아니면 받기 전에 멈춘다(디스크·메모리를 채우지 않게).
 */
function checkManifestLimits(files: BuiltinManifestFile[]): void {
  const mib = (n: number) => `${Math.round(n / 1024 / 1024)}MiB`
  if (files.length > SOURCE_LIMITS.maxFiles) {
    fail(
      ExitCode.FAILURE,
      `받을 파일이 너무 많습니다(${files.length}개, 최대 ${SOURCE_LIMITS.maxFiles}개) — 받지 않습니다`,
    )
  }
  let total = 0
  for (const f of files) {
    if (!Number.isSafeInteger(f.size) || f.size < 0) {
      fail(ExitCode.FAILURE, `파일 크기가 올바르지 않습니다: ${cleanText(f.path)} — 받지 않습니다`)
    }
    if (f.size > SOURCE_LIMITS.maxFileBytes) {
      fail(
        ExitCode.FAILURE,
        `너무 큰 파일이 있습니다: ${cleanText(f.path)} (최대 ${mib(SOURCE_LIMITS.maxFileBytes)}) — 받지 않습니다`,
      )
    }
    total += f.size
  }
  if (total > SOURCE_LIMITS.maxTotalBytes) {
    fail(
      ExitCode.FAILURE,
      `받을 파일의 전체 크기가 너무 큽니다(최대 ${mib(SOURCE_LIMITS.maxTotalBytes)}) — 받지 않습니다`,
    )
  }
}

const VERSION_ID_RE = /^[0-9a-f]{32}$/
const VERSION_NO_RE = /^v?([1-9][0-9]{0,8})$/i
const VERSIONS_PAGE = 100
// `--at <n>` 를 찾으려 넘기는 쪽 수 상한 — 서버가 같은 쪽을 되풀이해도 끝나게 한다(AWS Security Agent 5차 L).
const VERSIONS_MAX_PAGES = 100

/**
 * `--at` 값을 버전 ID 로 바꾼다. 32자리 ID 는 그대로, `v3`·`3` 은 버전 기록(번호 내림차순)을
 * 그 번호부터 한 쪽씩 넘겨 찾는다. 형식이 틀리면 사전조건(2), 기록에 없으면 실패(1).
 */
async function resolveVersionRef(
  ctx: Awaited<ReturnType<typeof resolveContext>>,
  repoId: string,
  at: string,
): Promise<{ id: string; number?: number }> {
  const ref = at.trim()
  if (VERSION_ID_RE.test(ref)) return { id: ref }
  const m = VERSION_NO_RE.exec(ref)
  if (!m) {
    fail(
      ExitCode.PRECONDITION,
      `--at 은 v3 · 3 같은 버전 번호나 32자리 버전 ID 로 적으세요: ${ref}`,
    )
  }
  const want = Number(m[1])
  const { organizationId: org, spaceId: space } = ctx.link
  let before = want + 1
  for (let pages = 0; ; pages++) {
    if (pages >= VERSIONS_MAX_PAGES) {
      return fail(
        ExitCode.FAILURE,
        `버전 기록을 ${VERSIONS_MAX_PAGES}쪽까지 넘겼지만 v${want} 를 찾지 못했습니다. 32자리 버전 ID 로 지정하세요`,
      )
    }
    const page = await ctx.client.listVersions(org, space, repoId, { before, limit: VERSIONS_PAGE })
    const hit = page.find((v) => v.number === want)
    if (hit && VERSION_ID_RE.test(hit.id)) return { id: hit.id, number: want }
    const lowest = Math.min(...page.map((v) => v.number))
    if (page.length === 0 || !(lowest > want) || page.length < VERSIONS_PAGE) break
    if (lowest >= before) {
      return fail(
        ExitCode.FAILURE,
        '버전 기록 조회가 더 나아가지 않습니다(같은 쪽이 되풀이됨). 잠시 뒤 다시 시도하거나 32자리 버전 ID 로 지정하세요',
      )
    }
    before = lowest
  }
  return fail(
    ExitCode.FAILURE,
    `v${want} 버전을 찾지 못했습니다. 콘솔의 버전 기록에서 번호를 확인하세요`,
  )
}

/**
 * pull 이 어떤 경우에도 쓰지 않는 CI·배포·자동화 도구 설정 — 이름을 하나씩 늘리지 않고 접두·어간 규칙으로 막는다
 * (AWS Security Agent 8차 H·9차 L·10차: `compose.override.yml`·`Taskfile.dist.yml` 처럼 목록 밖 변형이 도구에 자동 로드됐다).
 * 파일 이름(소문자, 어느 폴더든)이 아래 접두사로 시작하면 거부한다. 점으로 시작하는 이름(`.github/`·`.gitlab-ci*`·`.drone*`·
 * `.devcontainer/`·`.circleci/`·`.husky/` 등)은 pullHardRefusal 이 먼저 모두 거부하지만, 규칙이 스스로 읽히도록 함께 적는다.
 */
const TOOL_CONFIG_PREFIXES: readonly string[] = [
  // 컨테이너·로컬 오케스트레이션
  'compose.',
  'docker-compose',
  'dockerfile',
  'containerfile',
  '.devcontainer',
  'tilt', // tiltfile·tilt-settings.json
  'skaffold',
  'vagrantfile',
  // 태스크 러너
  'taskfile.',
  'makefile',
  'gnumakefile',
  'justfile',
  'procfile',
  // 배포 플랫폼
  'vercel.',
  'netlify.',
  'railway.',
  'nixpacks.',
  'serverless.',
  'pulumi.',
  // CI
  'jenkinsfile',
  'azure-pipelines',
  'bitbucket-pipelines',
  'cloudbuild',
  'appveyor',
  '.gitlab-ci',
  '.drone',
  // AWS Security Agent 21차 M — 워커·git 훅·감시·런타임 관리자·태스크 러너·JVM 빌드 설정(다음 명령이 그 안의 명령을 실행한다).
  // 평범한 소스·자산 이름과 겹치는 어간(turbo·nx·moon·pipeline·flake …)은 아래 TOOL_CONFIG_NAMES 에 정확한 이름으로 둔다.
  'wrangler.',
  'lefthook',
  'nodemon.',
  'mise.',
  'rtx.',
  'lerna.',
  'rush.',
  'devbox.',
  'gradlew',
  'build.gradle',
  'settings.gradle',
  'earthfile',
  'pre-commit',
  'overcommit',
  'bunfig.',
  'gulpfile.',
  'gruntfile.',
  'jakefile.',
]

/** 접두사로 막으면 평범한 소스까지 걸리는 이름은 정확히 — `app.yaml`(App Engine)은 막되 `app.ts` 는 받는다. */
const TOOL_CONFIG_NAMES: ReadonlySet<string> = new Set(
  [
    'fly.toml',
    'render',
    'heroku',
    'app',
    'buildspec',
    'codemagic',
    'bitrise',
    'wercker',
    // AWS Security Agent 21차 M
    'turbo.json',
    'turbo.jsonc',
    'nx.json',
    'project.json',
    'moon',
    'pom.xml',
    'build.sbt',
    'build.xml',
    'pipelines',
    'pipeline',
    'garden',
    'workspace.bazel',
    'module.bazel',
    'build.bazel',
    'flake.nix',
    'shell.nix',
    'default.nix',
    'devenv.nix',
    'cargo.toml',
    'build.rs',
    'deno.json',
    'deno.jsonc',
  ]
    .flatMap((stem) => (stem.includes('.') ? [stem] : [`${stem}.yml`, `${stem}.yaml`]))
    .concat(['cdk.json']),
)

/** 확장자로 막는 인프라 정의 — Terraform(`*.tf`·`*.tfvars`, JSON 변형 포함). */
const TOOL_CONFIG_SUFFIXES: readonly string[] = ['.tf', '.tfvars', '.tf.json', '.tfvars.json']

/** 도구가 자동으로 읽어 실행·배포할 수 있는 설정 파일 이름인가(소문자 basename). */
export function isToolConfigName(base: string): boolean {
  return (
    TOOL_CONFIG_PREFIXES.some((p) => base.startsWith(p)) ||
    TOOL_CONFIG_NAMES.has(base) ||
    TOOL_CONFIG_SUFFIXES.some((x) => base.endsWith(x))
  )
}

type Include = Awaited<ReturnType<typeof loadInclude>>

/**
 * 서버를 믿지 않는 pull 의 절대 거부(AWS Security Agent 8차 H·M, Ruling 25) — `.bstageinclude` 와 상관없이 쓰지도 지우지도 않는다.
 *  - 경로의 어느 조각이든 점으로 시작하면(`.github/`·`.vscode/`·`.husky/`·`.npmrc`·`.bstageinclude`·`.bstageignore`·`.gitignore`·`.env*` 등)
 *  - CI·배포·자동화 도구 설정(isToolConfigName — `compose.*`·`docker-compose*`·`Dockerfile*`·`Taskfile.*`·`Makefile*`·`*.tf` 등 접두·어간 규칙)
 *  - 실행·스크립트 확장자(`.bat`·`.cmd`·`.ps1`·`.sh`·`.exe` 등 — isScriptFile)
 * 거부하면 사유, 아니면 null.
 */
export function pullHardRefusal(path: string): string | null {
  const segs = path.split('/')
  if (segs.some((s) => s.startsWith('.'))) {
    return '점(.)으로 시작하는 파일·폴더는 받지 않습니다(설정·훅·CI 파일 — 필요하면 콘솔에서 내용을 확인하고 직접 만드세요)'
  }
  const base = goLower(segs[segs.length - 1]!)
  if (isToolConfigName(base)) {
    return 'CI·자동화 설정 파일은 받지 않습니다'
  }
  if (isScriptFile(base)) {
    return '실행·스크립트 파일(.bat·.cmd·.ps1·.sh·.exe 등)은 받지 않습니다'
  }
  return null
}

/**
 * 서버 경로를 받을지 — 절대 거부(pullHardRefusal) 다음, push 와 같은 허용 목록(isAllowedSourcePath) + 로컬 `.bstageinclude`.
 * 받지 않으면 사유, 받으면 null. `.bstageinclude` 는 로컬 파일만 읽는다 — pull 은 그 파일을 쓰지 않는다(점 경로).
 */
export function pullRefusal(path: string, include: Include): string | null {
  const hard = pullHardRefusal(path)
  if (hard) return hard
  if (!isAllowedSourcePath(path) && !(include?.ignores(path) ?? false)) {
    return '받는 파일 종류가 아닙니다(필요하면 .bstageinclude 에 적으세요)'
  }
  return null
}

/** package.json 의 scripts — 이름 → 명령. JSON 이 아니거나 scripts 가 객체가 아니면 null. scripts 가 없으면 빈 맵. */
function scriptsOf(text: string): Map<string, string> | null {
  let j: unknown
  try {
    j = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof j !== 'object' || j === null || Array.isArray(j)) return null
  const s = (j as Record<string, unknown>).scripts
  if (s === undefined) return new Map()
  if (typeof s !== 'object' || s === null || Array.isArray(s)) return null
  return new Map(
    Object.entries(s as Record<string, unknown>).map(([k, v]) => [
      k,
      typeof v === 'string' ? v : JSON.stringify(v),
    ]),
  )
}

/**
 * 받은 package.json 에서 바뀐 scripts 항목(Ruling 25) — `install`·`prepare` 같은 스크립트는 다음 설치·실행 때 돈다.
 * 받는 것은 막지 않고, 추가·변경·삭제된 항목을 사람이 볼 수 있게 줄로 돌려준다(서버 값은 cleanText 로 정리).
 */
export function changedScripts(before: string | null, after: string): string[] {
  const next = scriptsOf(after)
  if (next === null) return ['scripts 를 읽을 수 없습니다 — 파일을 직접 확인하세요']
  const prev = (before === null ? new Map<string, string>() : scriptsOf(before)) ?? new Map()
  const lines: string[] = []
  for (const [k, v] of next) {
    if (prev.get(k) === v) continue
    lines.push(
      `${cleanText(k, 80)}: ${cleanText(v, 200)}${prev.has(k) ? ' (바뀜)' : ' (새로 생김)'}`,
    )
  }
  for (const k of prev.keys()) {
    if (!next.has(k)) lines.push(`${cleanText(k, 80)}: (지워짐)`)
  }
  return lines
}

const META_FIELDS = ['packageManager', 'bin', 'engines', 'workspaces'] as const

/**
 * 받은 package.json 에서 바뀐 실행 관련 필드 — `packageManager`(corepack 이 다른 도구를 내려받아 실행)·`bin`(설치 때 PATH 에 걸리는 실행 파일)·
 * `engines`·`workspaces`(설치 범위). 막지 않고 바뀐 필드를 줄로 돌려준다(서버 값은 cleanText 로 정리).
 */
export function changedPackageMeta(before: string | null, after: string): string[] {
  const read = (text: string): Record<string, unknown> | null => {
    try {
      const j: unknown = JSON.parse(text)
      return typeof j === 'object' && j !== null && !Array.isArray(j)
        ? (j as Record<string, unknown>)
        : null
    } catch {
      return null
    }
  }
  const next = read(after)
  // 읽을 수 없는 JSON 은 scripts·의존성 알림이 이미 알린다.
  if (next === null) return []
  const prev = (before === null ? {} : read(before)) ?? {}
  const show = (v: unknown) => cleanText(typeof v === 'string' ? v : JSON.stringify(v), 200)
  const lines: string[] = []
  for (const f of META_FIELDS) {
    const a = prev[f]
    const b = next[f]
    if (JSON.stringify(a) === JSON.stringify(b)) continue
    lines.push(
      b === undefined
        ? `${f}: (지워짐)`
        : `${f}: ${show(b)}${a === undefined ? ' (새로 생김)' : ' (바뀜)'}`,
    )
  }
  return lines
}

const DEP_SECTIONS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
  'overrides',
  'resolutions',
] as const

const LOCKFILE_NAMES: ReadonlySet<string> = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'npm-shrinkwrap.json',
  'bun.lockb',
])

/** 잠금 파일 이름인가(소문자로 접어 견준다). */
export function isLockfile(path: string): boolean {
  return LOCKFILE_NAMES.has(goLower(path.slice(path.lastIndexOf('/') + 1)))
}

function depsOf(text: string): Map<string, string> | null {
  let j: unknown
  try {
    j = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof j !== 'object' || j === null || Array.isArray(j)) return null
  const m = new Map<string, string>()
  for (const sec of DEP_SECTIONS) {
    const v = (j as Record<string, unknown>)[sec]
    if (v === undefined) continue
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      m.set(`${sec}\u0000${k}`, typeof val === 'string' ? val : JSON.stringify(val))
    }
  }
  return m
}

/**
 * 받은 package.json 에서 바뀐 의존성(dependencies·devDependencies·optionalDependencies·peerDependencies·overrides·resolutions) —
 * 설치하면 서버가 고른 패키지가 내려받아져 실행될 수 있다. 막지 않고 추가·변경·삭제된 패키지 이름을 줄로 돌려준다.
 */
export function changedDependencies(before: string | null, after: string): string[] {
  const next = depsOf(after)
  if (next === null) return ['의존성을 읽을 수 없습니다 — 파일을 직접 확인하세요']
  const prev = (before === null ? new Map<string, string>() : depsOf(before)) ?? new Map()
  const label = (key: string) => {
    const [sec, name] = key.split('\u0000') as [string, string]
    return `${sec}.${cleanText(name, 120)}`
  }
  const lines: string[] = []
  for (const [k, v] of next) {
    if (prev.get(k) === v) continue
    lines.push(`${label(k)}: ${cleanText(v, 200)}${prev.has(k) ? ' (바뀜)' : ' (새로 생김)'}`)
  }
  for (const k of prev.keys()) {
    if (!next.has(k)) lines.push(`${label(k)}: (지워짐)`)
  }
  return lines
}

/** 경로를 NFC 로 — macOS 는 NFD, 다른 곳은 NFC 로 같은 이름을 다르게 적는다(AWS Security Agent). */
export function nfcPath(p: string): string {
  return p.normalize('NFC')
}

/** 견주기용 키 — NFC + 소문자. 이 키가 같으면 같은 파일로 본다(대소문자·정규화를 가리지 않는 파일 시스템). */
export function foldPath(p: string): string {
  return nfcPath(goLower(nfcPath(p)))
}

export interface DeletionPlan {
  /** 서버에서 지워진 기준 경로(대소문자를 접어도 서버 목록에 없는 것) — 로컬이 그대로면 지울 후보. */
  deleted: string[]
  /** 대소문자만 바뀐 이름 — 서버 경로 → 지난 기준 경로. 지우지 않고 그 자리에서 이름만 바꾼다. */
  caseRenames: Map<string, string>
}

/**
 * 지울 파일 계획(AWS Security Agent 7차 H). 대소문자를 가리지 않는 파일 시스템(macOS·Windows)에서는 `README.md` →
 * `readme.md` 가 같은 파일이다 — 경로를 그대로 견주면 방금 받은 파일을 지운다. 그래서 서버 목록(받지 않은 경로 포함)의
 * 어느 경로와도 소문자가 같은 기준 경로는 절대 지울 후보로 넣지 않고, 대소문자만 다르면 이름 바꾸기로 따로 돌려준다.
 */
export function planDeletions(baseFiles: Record<string, string>, incoming: string[]): DeletionPlan {
  const exact = new Set(incoming.map(nfcPath))
  const byLower = new Map<string, string>()
  for (const p of incoming) byLower.set(foldPath(p), nfcPath(p))
  const deleted: string[] = []
  const caseRenames = new Map<string, string>()
  for (const path of Object.keys(baseFiles)) {
    if (exact.has(nfcPath(path))) continue
    const to = byLower.get(foldPath(path))
    if (to !== undefined) {
      if (!caseRenames.has(to)) caseRenames.set(to, path)
      continue
    }
    deleted.push(path)
  }
  return { deleted, caseRenames }
}

/** 지우기 직전 마지막 확인 — 쓰거나 남길 경로와 소문자가 같은 경로는 빼고 돌려준다. */
export function safeDeletes<T extends { path: string }>(
  dels: T[],
  protectedPaths: Iterable<string>,
): T[] {
  const keep = new Set<string>()
  for (const p of protectedPaths) keep.add(foldPath(p))
  return dels.filter((d) => !keep.has(foldPath(d.path)))
}

/** 같은 파일(대소문자를 가리지 않는 파일 시스템에서 이름만 다른 두 경로)인가. */
async function sameInode(a: string, b: string): Promise<boolean> {
  try {
    const [x, y] = await Promise.all([lstat(a), lstat(b)])
    return x.dev === y.dev && x.ino === y.ino
  } catch {
    return false
  }
}

/** 대상이 프로젝트 폴더 안인지 — 경로 문자열과, 이미 있는 상위 폴더의 실제 위치(심볼릭 링크) 둘 다 본다. */
async function assertInside(rootReal: string, root: string, rel: string): Promise<string> {
  const abs = resolve(root, rel)
  if (!abs.startsWith(root + sep)) throw new Error(`프로젝트 폴더 밖 경로입니다: ${rel}`)
  let dir = dirname(abs)
  for (;;) {
    try {
      const real = await realpath(dir)
      if (real !== rootReal && !real.startsWith(rootReal + sep)) {
        throw new Error(`프로젝트 폴더 밖을 가리키는 폴더입니다: ${rel}`)
      }
      return abs
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
      const up = dirname(dir)
      if (up === dir) throw e
      dir = up
    }
  }
}

/**
 * `bstage pull [--at <v3|3|id>] [--yes]` — 내장 저장소의 head(또는 지정 버전)를 이 폴더로 받는다.
 * 서버에 없는 로컬 파일은 지우지 않는다. 서버가 안 바꾼 파일의 로컬 수정은 그대로 두고, 서버와 로컬이
 * 같은 파일을 바꿨을 때만 목록을 보여 주고 멈춘다(`--yes` 면 그 파일은 서버 버전으로 받는다).
 * 서버를 믿지 않는다(AWS Security Agent 8차, Ruling 25): 점으로 시작하는 경로(`.github/`·`.vscode/`·`.husky/`·`.bstageinclude`·
 * `.gitignore`·`.env*` 등)·CI 설정(`Jenkinsfile`·`Makefile` 등)·허용 목록(+ 로컬 `.bstageinclude`) 밖의 서버 경로는 쓰지도 지우지도
 * 않고 목록으로 알린다. 받은 파일은 언제나 0644 로 쓰고 실행 비트는 주지 않는다. package.json 의 scripts 가 바뀌면 알린다.
 */
export async function pullCommand(options: PullOptions, deps: PullDeps = {}): Promise<void> {
  const cwd = deps.cwd ?? process.cwd()
  const out = deps.out ?? console.log
  // 서명 URL 받기는 검사·고정 dispatcher 를 쓰는 blobFetch(테스트는 deps.fetch).
  const fetchFn = deps.fetch ?? blobFetch
  const ctx = await resolveContext({ cwd, env: deps.env, fetch: deps.fetch })
  const repo = await resolveLinkedRepo(ctx)
  if (repo.source !== 'builtin') {
    fail(ExitCode.FAILURE, 'GitHub 레포는 git pull 을 쓰세요')
  }
  assertBuiltinLinked(ctx, repo)
  const { organizationId: org, spaceId: space } = ctx.link
  const wanted = options.at ? await resolveVersionRef(ctx, repo.id, options.at) : undefined
  const versionId = wanted?.id
  // 항목 모양(path·sha256·size·url)을 먼저 엄격히 본다 — 하나라도 틀리면 목록 전체를 버린다(AWS Security Agent 8차 L).
  const validated = validateManifest(
    (await ctx.client.getManifest(org, space, repo.id, versionId)) as unknown,
  )
  // 모든 경로를 NFC 로 맞춘다 — 이후 견주기·지우기 계획은 NFC 경로만 본다. NFC+소문자가 같은 두 경로가 오면 어느 쪽이 어느 파일인지
  // 알 수 없으므로 목록 전체를 버린다(AWS Security Agent).
  const manifest = {
    ...validated,
    files: validated.files.map((f) => ({ ...f, path: nfcPath(f.path) })),
  }
  const seenFold = new Map<string, string>()
  for (const f of manifest.files) {
    const k = foldPath(f.path)
    const other = seenFold.get(k)
    if (other !== undefined) {
      fail(
        ExitCode.FAILURE,
        `대소문자·유니코드 정규화만 다른 같은 경로가 있어 받지 않습니다: ${cleanText(other)} / ${cleanText(f.path)}`,
      )
    }
    seenFold.set(k, f.path)
  }
  // 요청한 버전이 맞는지 — 서버가 다른 버전을 주면 아무것도 쓰지도 저장하지도 않는다(AWS Security Agent 9차 L).
  if (wanted && goLower(String(manifest.versionId)) !== goLower(wanted.id)) {
    fail(ExitCode.FAILURE, '서버가 요청한 버전과 다른 버전을 보냈습니다 — 받지 않습니다')
  }
  if (wanted?.number !== undefined && manifest.number !== wanted.number) {
    fail(ExitCode.FAILURE, '서버가 요청한 버전 번호와 다른 번호를 보냈습니다 — 받지 않습니다')
  }
  // 서버가 준 버전 번호는 양의 정수만 — 그대로 터미널에 찍히므로 이스케이프가 섞인 값은 받지 않는다(AWS Security Agent 6차 L).
  const versionNo = versionNumber(manifest.number)
  if (versionNo === null) {
    fail(ExitCode.FAILURE, '서버 응답의 버전 번호가 올바르지 않습니다 — 받지 않습니다')
  }
  checkManifestLimits(manifest.files)

  // 서버가 준 경로도 믿지 않는다 — 하나라도 안전하지 않으면 아무것도 쓰지 않는다.
  const bad: string[] = []
  for (const f of manifest.files) {
    const reason = validateSourcePath(f.path)
    if (reason) bad.push(`${cleanText(f.path)}: ${reason}`)
    else {
      const urlReason = checkBlobUrl(f.url)
      if (urlReason) bad.push(`${cleanText(f.path)}: 받을 주소를 쓸 수 없습니다(${urlReason})`)
    }
  }
  try {
    assertNoConflicts(manifest.files.map((f) => f.path))
  } catch (e) {
    bad.push(cleanText((e as Error).message))
  }
  if (bad.length > 0) {
    fail(ExitCode.FAILURE, `안전하지 않은 경로가 있어 받지 않습니다:\n${listLines(bad)}`)
  }

  const root = resolve(cwd)
  const rootReal = await realpath(root)
  const saved = await loadBuiltinState(cwd, repo.id)
  // 받을 범위 — 절대 거부(점 경로·CI 설정) 다음 push 와 같은 허용 목록 + 로컬 `.bstageinclude`. 밖의 서버 경로는 쓰지 않고 알린다
  // (AWS Security Agent 7차 M·8차 H, Ruling 25). `.bstageinclude` 는 로컬 파일만 읽는다 — pull 은 쓰지 않는다.
  const include = await loadInclude(root).catch((e: Error) => fail(ExitCode.FAILURE, e.message))
  const refused: string[] = []
  const accepted: BuiltinManifestFile[] = []
  for (const f of manifest.files) {
    const why = pullRefusal(f.path, include)
    if (why) refused.push(`${f.path}: ${why}`)
    else accepted.push(f)
  }
  // 지울 후보·대소문자만 바뀐 이름은 서버 목록 전체(받지 않는 경로 포함)와 대소문자를 접어 견준다(AWS Security Agent 7차 H).
  // 지난 기준 경로도 NFC 로 맞춘다. 정규화하면 겹치는 기준 경로는 어느 쪽인지 알 수 없으니 둘 다 뺀다(지우지도 비교하지도 않는다).
  const baseFiles: Record<string, string> = Object.create(null) as Record<string, string>
  {
    const dup = new Set<string>()
    for (const [p, h] of Object.entries(saved?.files ?? {})) {
      const n = nfcPath(p)
      if (hasPath(baseFiles, n) || dup.has(n)) {
        delete baseFiles[n]
        dup.add(n)
      } else baseFiles[n] = h
    }
  }
  const plan = planDeletions(
    baseFiles,
    manifest.files.map((f) => f.path),
  )

  // 파일마다 세 값을 견준다: 기준(base = 마지막으로 받거나 올린 버전) · 서버 · 로컬.
  //  - 로컬 = 서버: 그대로(실행 비트만 다르면 권한만 맞춘다).
  //  - 서버 = 기준(서버가 안 바꿨다): 로컬 수정(지운 것 포함)을 그대로 둔다 — 새 기준이 서버라 다음 push 에 올라간다.
  //  - 서버 ≠ 기준, 로컬 = 기준(또는 기준에도 로컬에도 없음): 서버 것을 받는다.
  //  - 서버 ≠ 기준, 로컬 ≠ 기준, 로컬 ≠ 서버: 양쪽에서 바뀌었다 — 멈추고, --yes 면 서버 것을 받는다.
  // 대소문자만 바뀐 이름(`README.md` → `readme.md`)은 지난 이름의 로컬 파일·기준을 이 파일의 것으로 보고, 지우지 않고 이름만 바꾼다.
  const toWrite: { file: BuiltinManifestFile; abs: string }[] = []
  const conflicts: string[] = []
  const keptLocal: string[] = []
  const renames: { from: string; fromAbs: string; to: string; toAbs: string }[] = []
  let same = 0
  for (const file of accepted) {
    const abs = await assertInside(rootReal, root, file.path).catch((e: Error) =>
      fail(ExitCode.FAILURE, e.message),
    )
    let local = await localFile(abs)
    if (local === 'unsafe') {
      fail(
        ExitCode.FAILURE,
        `일반 파일이 아닌 항목(폴더·심볼릭 링크)과 겹칩니다: ${cleanText(file.path)}`,
      )
    }
    let baseKey = file.path
    const renamedFrom = plan.caseRenames.get(file.path)
    if (renamedFrom !== undefined) {
      const fromAbs = await assertInside(rootReal, root, renamedFrom).catch(() => null)
      const fromLocal = fromAbs ? await localFile(fromAbs) : null
      if (fromAbs && fromLocal !== null && fromLocal !== 'unsafe') {
        if (local === null) {
          // 대소문자를 가리는 파일 시스템 — 지난 이름만 있다.
          local = fromLocal
          baseKey = renamedFrom
          renames.push({ from: renamedFrom, fromAbs, to: file.path, toAbs: abs })
        } else if (await sameInode(abs, fromAbs)) {
          // 대소문자를 가리지 않는 파일 시스템 — 두 이름이 같은 파일이다.
          baseKey = renamedFrom
          renames.push({ from: renamedFrom, fromAbs, to: file.path, toAbs: abs })
        }
        // 두 이름이 서로 다른 파일로 다 있으면 지난 이름은 건드리지 않는다(지우지도 않는다).
      } else if (local === null) {
        baseKey = renamedFrom // 지난 이름을 로컬에서 지웠다 — 그 기준으로 판단한다
      }
    }
    const localHash = local?.hash ?? null
    // 내용이 같으면 그대로 둔다 — 로컬 권한도 건드리지 않는다(pull 은 실행 비트를 주지 않는다, Ruling 25).
    if (local !== null && localHash === file.sha256) {
      same++
      continue
    }
    // 기준은 프로토타입 없는 객체다(loadBuiltinState) — `toString`·`constructor` 같은 경로도 다른 경로와 같다(AWS Security Agent 6차 L).
    const base = hasPath(baseFiles, baseKey) ? baseFiles[baseKey] : undefined
    if (base !== undefined && file.sha256 === base) {
      keptLocal.push(file.path)
      continue
    }
    if (localHash !== null || base !== undefined) {
      if (localHash !== base) conflicts.push(file.path)
    }
    toWrite.push({ file, abs })
  }

  // 서버에서 지워진 파일: 지난 기준에 있었고 로컬이 그대로면 지운다. 고쳤다면 지우지 않는다(멈추고, --yes 면 남긴다).
  const toDelete: { path: string; abs: string }[] = []
  const keptModified: string[] = []
  for (const path of plan.deleted) {
    // 점 경로·CI 설정은 지우지도 않는다(옛 기준에 남아 있어도) — pull 은 그런 경로를 건드리지 않는다(Ruling 25).
    if (pullHardRefusal(path)) continue
    const baseHash = baseFiles[path]
    let abs: string
    try {
      abs = await assertInside(rootReal, root, path)
    } catch {
      continue // 기준 파일이 망가졌거나 밖을 가리키면 건드리지 않는다
    }
    const local = await localFile(abs)
    if (local === null || local === 'unsafe') continue
    if (local.hash === baseHash) toDelete.push({ path, abs })
    else keptModified.push(path)
  }

  if ((conflicts.length > 0 || keptModified.length > 0) && !options.yes) {
    const parts: string[] = []
    if (conflicts.length > 0) {
      parts.push(
        `서버와 로컬에서 모두 바뀐 파일 ${conflicts.length}개가 있습니다:\n${listLines(conflicts)}\n` +
          '(--yes 를 붙이면 이 파일은 서버 버전으로 받습니다. 이 파일의 로컬 변경은 사라집니다.\n' +
          ' 서버가 바꾸지 않은 파일의 로컬 수정은 --yes 여도 그대로 둡니다.)',
      )
    }
    if (keptModified.length > 0) {
      parts.push(
        `서버에서 지워졌지만 로컬에서 고친 파일 ${keptModified.length}개가 있습니다:\n${listLines(keptModified)}\n` +
          '(--yes 를 붙이면 이 파일은 지우지 않고 그대로 둡니다. 다음 push 에 다시 올라갑니다.)',
      )
    }
    fail(ExitCode.PRECONDITION, `중단했습니다.\n${parts.join('\n')}`)
  }

  // 다 내려받아 검증한 뒤에 옮긴다 — 중간에 실패해도 기존 파일은 그대로다.
  const temps: { tmp: string; abs: string }[] = []
  const scriptNotes: { path: string; lines: string[] }[] = []
  const depNotes: { path: string; lines: string[] }[] = []
  const metaNotes: { path: string; lines: string[] }[] = []
  const lockNotes: string[] = []
  const moving: { mid: string; fromAbs: string }[] = []
  try {
    await runPool(toWrite, GET_CONCURRENCY, async ({ file, abs }) => {
      // 목록의 크기까지만 읽는다 — 더 오면 끊는다(본문 전체를 메모리에 올리지 않게).
      const body = await getBlob(fetchFn, file.url, {}, file.size).catch((e: unknown) => {
        if (e instanceof BlobTooLargeError)
          throw new Error(
            `받은 파일이 목록과 다릅니다(해시 불일치 — 목록보다 큽니다): ${cleanText(file.path)}. 다시 실행하세요`,
          )
        throw e
      })
      if (
        body.length !== file.size ||
        createHash('sha256').update(body).digest('hex') !== file.sha256
      ) {
        throw new Error(
          `받은 파일이 목록과 다릅니다(해시 불일치): ${cleanText(file.path)}. 다시 실행하세요`,
        )
      }
      // package.json 은 받되 scripts 가 바뀌었으면 알린다 — 다음 설치·실행 때 도는 명령이다(Ruling 25).
      if (goLower(file.path.slice(file.path.lastIndexOf('/') + 1)) === 'package.json') {
        const before = await readFile(abs, 'utf8').catch(() => null)
        const lines = changedScripts(before, body.toString('utf8'))
        if (lines.length > 0) scriptNotes.push({ path: file.path, lines })
        const deps = changedDependencies(before, body.toString('utf8'))
        if (deps.length > 0) depNotes.push({ path: file.path, lines: deps })
        const meta = changedPackageMeta(before, body.toString('utf8'))
        if (meta.length > 0) metaNotes.push({ path: file.path, lines: meta })
      }
      if (isLockfile(file.path)) lockNotes.push(file.path)
      await mkdir(dirname(abs), { recursive: true })
      // mkdir 뒤에 다시 확인한다 — 폴더를 만드는 사이 바뀐 심볼릭 링크를 따라가지 않게.
      await assertInside(rootReal, root, file.path)
      const tmp = join(dirname(abs), `.bstage-pull-${randomBytes(6).toString('hex')}.tmp`)
      temps.push({ tmp, abs })
      // 받은 파일은 언제나 0644 — 서버의 exec 은 쓰지 않는다(AWS Security Agent 8차 M, Ruling 25). 권한은 새로 만든(wx) 임시 파일의
      // 열린 핸들로 맞춘다 — umask 와 상관없이, 경로를 다시 따라가지 않고(7차 L).
      const fh = await open(tmp, 'wx', 0o644)
      try {
        await fh.writeFile(body)
        await fh.chmod(0o644)
      } finally {
        await fh.close()
      }
    })
    // 대소문자만 바뀐 이름: 지난 이름 → 임시 이름 → 새 이름. 대소문자를 가리지 않는 파일 시스템에서도 이름이 바뀌게 두 번 옮긴다.
    for (const r of renames) {
      await mkdir(dirname(r.toAbs), { recursive: true })
      await assertInside(rootReal, root, r.from)
      await assertInside(rootReal, root, r.to)
      const mid = join(dirname(r.fromAbs), `.bstage-pull-${randomBytes(6).toString('hex')}.tmp`)
      await rename(r.fromAbs, mid)
      moving.push({ mid, fromAbs: r.fromAbs })
      await rename(mid, r.toAbs)
      moving.pop()
    }
    for (const t of temps) await rename(t.tmp, t.abs)
    // 마지막 확인: 서버 목록의 어느 경로와도 소문자가 같은 파일은 지우지 않는다(방금 받은 파일일 수 있다).
    for (const d of safeDeletes(
      toDelete,
      manifest.files.map((f) => f.path),
    )) {
      await rm(d.abs, { force: true })
    }
  } catch (e) {
    await Promise.all(temps.map((t) => rm(t.tmp, { force: true })))
    for (const m of moving) await rename(m.mid, m.fromAbs).catch(() => {})
    throw e
  }

  // 받지 않은 경로는 기준에 넣지 않는다 — 나중에 `.bstageinclude` 에 적으면 그때 새 파일로 받는다.
  await recordBuiltinSync(
    cwd,
    repo.id,
    manifest.versionId,
    Object.fromEntries(accepted.map((f) => [f.path, f.sha256])),
  )
  const extra = [
    conflicts.length > 0 ? `서버 버전으로 받은 파일 ${conflicts.length}개` : '',
    keptLocal.length > 0 ? `로컬 수정 유지 ${keptLocal.length}개` : '',
  ].filter(Boolean)
  out(
    pc.green(
      `✓ v${versionNo} 받음 (바뀐 파일 ${toWrite.length}개, 그대로 ${same}개${
        extra.length > 0 ? `, ${extra.join(', ')}` : ''
      })`,
    ),
  )
  if (keptLocal.length > 0) {
    out(
      pc.dim(
        `서버가 바꾸지 않은 파일의 로컬 수정 ${keptLocal.length}개는 그대로 두었습니다 — 다음 push 에 올라갑니다:\n${listLines(keptLocal)}`,
      ),
    )
  }

  if (renames.length > 0) {
    out(
      `서버에서 대소문자만 바뀐 파일 ${renames.length}개는 지우지 않고 이름만 바꿨습니다:\n${listLines(
        renames.map((r) => `${r.from} → ${r.to}`),
      )}`,
    )
  }
  if (refused.length > 0) {
    out(
      pc.yellow(
        `서버의 파일 ${refused.length}개는 받지 않았습니다(쓰지도 지우지도 않음). 필요하면 콘솔에서 내용을 확인하고 직접 만드세요:\n${listLines(refused)}`,
      ),
    )
  }
  for (const n of scriptNotes) {
    out(
      pc.yellow(
        `${cleanText(n.path)} 의 scripts 가 바뀌었습니다 — npm install·실행 전에 확인하세요:\n${listLines(n.lines)}`,
      ),
    )
  }
  for (const n of depNotes) {
    out(
      pc.yellow(
        `${cleanText(n.path)} 의 의존성이 바뀌었습니다 — 설치 전에 패키지 변경을 확인하세요:\n${listLines(n.lines)}`,
      ),
    )
  }
  for (const n of metaNotes) {
    out(
      pc.yellow(
        `${cleanText(n.path)} 의 packageManager·bin·engines·workspaces 가 바뀌었습니다 — 설치·실행 전에 확인하세요:\n${listLines(n.lines)}`,
      ),
    )
  }
  for (const p of lockNotes) {
    out(pc.yellow(`${cleanText(p)}: 잠금 파일이 바뀌었습니다 — 설치 전에 변경을 확인하세요`))
  }
  if (toDelete.length > 0) {
    out(
      `서버에서 지워진 파일 ${toDelete.length}개를 로컬에서도 지웠습니다:\n${listLines(toDelete.map((d) => d.path))}`,
    )
  }
  if (keptModified.length > 0) {
    out(
      pc.yellow(
        `서버에서 지워졌지만 로컬에서 고친 파일 ${keptModified.length}개는 그대로 두었습니다 — 다음 push 에 다시 올라갑니다:\n${listLines(keptModified)}`,
      ),
    )
  }
  if (options.at) {
    out(
      pc.dim(
        `v${versionNo} 는 옛 버전일 수 있습니다. 이 버전을 새 버전으로 올리려면 bstage push --force 를 쓰세요.`,
      ),
    )
  }

  // 서버에 없는 로컬 파일은 지우지 않고 알려만 준다. 훑기 실패(한도 등)는 pull 결과에 영향이 없다.
  try {
    const incoming = new Set(manifest.files.map((f) => foldPath(f.path)))
    const localOnly = (await scanSource(cwd)).files
      .map((f) => nfcPath(f.path))
      .filter((p) => !incoming.has(foldPath(p)))
    if (localOnly.length > 0) {
      out(
        pc.dim(
          `서버에 없는 로컬 파일 ${localOnly.length}개는 그대로 두었습니다(지우지 않습니다):\n${listLines(localOnly)}`,
        ),
      )
    }
  } catch {
    /* 안내용 */
  }
}
