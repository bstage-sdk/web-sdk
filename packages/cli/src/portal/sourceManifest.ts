import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import ignore, { type Ignore } from 'ignore'

// 서버(internal/srcmanifest)와 같은 한도. 서버 값이 바뀌면 같이 고친다.
export const SOURCE_LIMITS = {
  maxFiles: 5000,
  maxTotalBytes: 100 * 1024 * 1024,
  maxFileBytes: 10 * 1024 * 1024,
  maxPathBytes: 512,
} as const

export interface SourceFile {
  path: string
  sha256: string
  size: number
  exec: boolean
  abs: string
}

export interface ScanResult {
  files: SourceFile[]
  /** 항상 제외한 경로(예약 폴더·로컬 비밀 파일)와 심볼릭 링크 등. 폴더는 끝에 `/`. push 출력에 보여 준다. */
  skipped: string[]
  /** 서버가 거부할 경로. 조용히 빼지 않고 push 가 명확한 메시지로 막는다. */
  invalid: { path: string; reason: string }[]
  /**
   * 올릴 파일 종류(isAllowedSourceName)가 아니고 `.bstageinclude` 에도 없어 올리지 않은 파일(AWS Security Agent 6차, Ruling 24).
   * push 출력에 보여 준다.
   */
  notAllowed: string[]
  /**
   * env 이름의 비 dotenv·비 코드 파일(isEnvStructuredConfig — `env.yaml`·`.env.json`·`.env.production.txt`·`.env.prod.md` 등). 값 검사를 하지 않고
   * 언제나 올리지 않는다(AWS Security Agent 8차 M, Ruling 27). `.bstageinclude` 로도 되살릴 수 없다. push 출력에 보여 준다.
   */
  envConfigs: string[]
}

const RESERVED_DIRS = new Set(['.git', 'node_modules', '.bstage'])
// `bstage pull` 이 옮기기 전에 쓰는 임시 파일(pull.ts) — 중단돼 남았으면 올리지 않는다.
const PULL_TEMP = /^\.bstage-pull-[0-9a-f]+\.tmp$/
// 짝 없는 서로게이트 = UTF-8 로 인코딩할 수 없는 문자열(서버의 utf8.ValidString 에 해당).
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/
const BAD_CHAR = /[\\:\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}]/u

/**
 * Go 의 strings.ToLower(코드포인트별 단순 매핑)와 같게 소문자로 바꾼다.
 * JS toLowerCase 는 `İ`(U+0130)를 2 코드포인트로 늘리지만 Go 는 `i` 한 글자로 바꾼다 — 서버와 어긋나지 않게 맞춘다.
 */
export function goLower(s: string): string {
  let out = ''
  for (const ch of s) {
    if (ch === '\u0130') out += 'i'
    else {
      const l = ch.toLowerCase()
      out += [...l].length === 1 ? l : ch
    }
  }
  return out
}

/** env 파일 이름 — `env` 가 `.`·`_`·`-` 로 나뉜 조각으로 들어 있다(`.env.production`·`.env_prod`·`prod.env`). `environment.ts` 는 아니다. */
export const ENV_FILE_NAME = /(^|[._-])env([._-]|$)/i

/** 값을 넣지 않는 견본 파일 — 값 검사를 하지 않고 그대로 올린다. */
export const ENV_PLACEHOLDER_FILES = new Set(['.env.example', '.env.sample', '.env.template'])

// 자격 증명 파일·폴더(AWS Security Agent 2차 H1, Ruling 21) — 무시 파일과 상관없이 언제나 빼고, pull 에서도 거부한다.
// 서버 규칙(.env·.env.local·.env.*.local)보다 넓다 — 서버는 이번 판에서 바꾸지 않는다.
const SECRET_EXACT = new Set([
  '.env',
  '.env.local',
  '.npmrc',
  '.netrc',
  '.git-credentials',
  '.pgpass',
  'credentials',
  '.terraformrc',
  '.envrc',
  // 폴더
  '.aws',
  '.ssh',
  '.gnupg',
  '.docker',
  '.kube',
  // AWS Security Agent 6차 H — 인증서·비밀번호·레지스트리·클러스터 자격 증명
  '.htpasswd',
  '.pypirc',
  '.dockercfg',
  // AWS Security Agent 18차 M — 패키지 관리자 토큰(npmAuthToken)·OAuth/클라우드 자격 증명 JSON
  '.yarnrc',
  '.yarnrc.yml',
  '.bunfig.toml',
  'bunfig.toml',
  'credentials.json',
  'token.json',
  'tokens.json',
  'auth.json',
  'oauth.json',
  'client_secret.json',
  'service-account.json',
  'serviceaccount.json',
  'firebase-adminsdk.json',
  'application_default_credentials.json',
])
const SECRET_SUFFIXES = [
  '.pem',
  '.key',
  '.p12',
  '.pfx',
  '.tfstate',
  '.tfstate.backup',
  // AWS Security Agent 3차 L2 — 키 저장소·서명 키·암호화 파일
  '.jks',
  '.keystore',
  '.p8',
  '.ppk',
  '.gpg',
  '.asc',
  '.secrets',
  'secrets.json',
  // AWS Security Agent 6차 H — 인증서·키 저장소·암호 관리자·VPN 설정
  '.crt',
  '.cer',
  '.der',
  '.p7b',
  '.p7c',
  '.jceks',
  '.kdbx',
  '.ovpn',
  // AWS Security Agent 18차 M — `*-credentials.json`·`*_token.json`·`*-adminsdk-*.json` 등
  '-credentials.json',
  '_credentials.json',
  '.credentials.json',
  '-token.json',
  '_token.json',
]
const SECRET_PREFIXES = [
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  'secrets.',
  'kubeconfig',
  // AWS Security Agent 18차 M — Google OAuth 클라이언트 비밀·서비스 계정 키 파일 이름 관례
  'client_secret',
  'service-account',
  'service_account',
]

/**
 * 로컬 비밀 이름 — 대소문자 무관, 파일·폴더 모두에 쓴다(경로의 어느 세그먼트든).
 * `.env`·`.env.local`·`.env.*.local`, 개인 키·인증서(`*.pem`·`*.key`·`*.p12`·`*.pfx`·`id_rsa*` 등),
 * 자격 증명 파일(`.npmrc`·`.netrc`·`.git-credentials`·`.pgpass`·`credentials`·`.terraformrc`·`.envrc`), terraform 상태(`*.tfstate`),
 * 키 저장소·서명 키·암호화 파일(`*.jks`·`*.keystore`·`*.p8`·`*.ppk`·`*.gpg`·`*.asc`·`*.secrets`), `secrets.*`·`*secrets.json`,
 * 인증서·암호 관리자·VPN(`*.crt`·`*.cer`·`*.der`·`*.p7b`·`*.p7c`·`*.jceks`·`*.kdbx`·`*.ovpn`), `.htpasswd`·`.pypirc`·`.dockercfg`·`kubeconfig*`,
 * 패키지 관리자 토큰(`.yarnrc`·`.yarnrc.yml`·`bunfig.toml`), 자격 증명 JSON(`credentials.json`·`token.json`·`*-credentials.json`·`*_token.json`·`client_secret*`·`service-account*`·`*-adminsdk-*.json` 등),
 * 자격 증명 폴더(`.aws`·`.ssh`·`.gnupg`·`.docker`·`.kube`). `.bstageinclude` 로도 되살릴 수 없다. `.env.{mode}` 는 여기서 빼지 않는다 — push 가 값을 검사한다.
 */
export function isLocalSecretName(name: string): boolean {
  const b = goLower(name)
  if (SECRET_EXACT.has(b)) return true
  if (b.startsWith('.env.') && b.endsWith('.local')) return true
  // AWS Security Agent 5차 M2 — `.env_local`·`env-local`·`.env_prod_local` 처럼 구분자가 `_`·`-` 인 로컬 파일도 `.env.local` 과 같다.
  if (ENV_FILE_NAME.test(b) && /[._-]local$/.test(b) && !ENV_PLACEHOLDER_FILES.has(b)) return true
  if (SECRET_SUFFIXES.some((s) => b.endsWith(s))) return true
  // Firebase 서비스 계정 키 기본 이름: `<project>-firebase-adminsdk-<id>.json`
  if (b.endsWith('.json') && b.includes('-adminsdk-')) return true
  return SECRET_PREFIXES.some((p) => b.startsWith(p))
}

// ── 올릴 파일 종류(AWS Security Agent 6차, Ruling 24) ──────────────────────────────────────────────
// 비밀 이름 목록(isLocalSecretName)은 끝없이 늘어나므로 1차 관문을 "허용 목록"으로 바꾼다: 소스·자산 확장자와
// 정해진 설정 파일 이름만 올리고, 나머지는 프로젝트 루트의 `.bstageinclude`(gitignore 문법)에 적었을 때만 올린다.
// isLocalSecretName 은 2차 관문으로 남고 `.bstageinclude` 보다 우선한다(개인 키·`.env.local` 은 적어도 못 올린다).
// 소스맵(`.map`)은 빌드 산출물이고 원본·주석을 그대로 담을 수 있어 기본 목록에서 뺐다 — 필요하면 `.bstageinclude`.

/** 기본으로 올리는 바이너리 자산 확장자(개인 키 검사는 이 확장자도 바이트로 훑는다 — push.privateKeyFindings). */
export const BINARY_ASSET_EXTENSIONS: ReadonlySet<string> = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.avif',
  '.ico',
  '.bmp',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.mp3',
  '.mp4',
  '.webm',
  '.ogg',
  '.wav',
  '.pdf',
])

const ALLOWED_EXTENSIONS: ReadonlySet<string> = new Set([
  // 코드·텍스트
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.jsonc',
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.html',
  '.htm',
  '.liquid',
  '.md',
  '.mdx',
  '.txt',
  '.yml',
  '.yaml',
  '.toml',
  '.xml',
  '.svg',
  '.vue',
  '.svelte',
  '.graphql',
  '.gql',
  '.lock',
  '.webmanifest',
  // 자산
  ...BINARY_ASSET_EXTENSIONS,
])

const ALLOWED_BASENAMES: ReadonlySet<string> = new Set([
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  '.gitignore',
  '.bstageignore',
  '.bstageinclude',
  '.editorconfig',
  '.prettierrc',
  '.prettierignore',
  '.eslintrc',
  '.eslintrc.json',
  '.eslintrc.cjs',
  '.nvmrc',
  '.node-version',
  'agents.md',
  'claude.md',
])
/**
 * 이름 앞부분만 보는 허용 규칙. 확장자 조건이 붙는다(AWS Security Agent — `readme.cmd`·`env.bat` 같은 스크립트가
 * 이름 접두사로 통과하던 문제): README·LICENSE·CHANGELOG 는 확장자가 없거나 허용 목록 확장자, `vite.config.*` 는 JS·TS 계열만.
 */
const ALLOWED_BASENAME_PATTERNS: readonly RegExp[] = [/^tsconfig.*\.json$/]
const DOC_BASENAME = /^(readme|license|changelog)/
const VITE_CONFIG_EXTENSIONS: ReadonlySet<string> = new Set([
  '.ts',
  '.js',
  '.mjs',
  '.cjs',
  '.mts',
  '.cts',
])

/**
 * 실행·스크립트 확장자 — Windows cmd·PowerShell·셸·설치 파일이 그대로 실행할 수 있어, pull 은 허용 목록·`.bstageinclude`
 * 와 상관없이 쓰지 않고, push 는 `.bstageinclude` 에 적었을 때만 올린다. `.js` 는 소스라 뺀다.
 */
export const SCRIPT_EXTENSIONS: ReadonlySet<string> = new Set([
  '.bat',
  '.cmd',
  '.ps1',
  '.psm1',
  '.vbs',
  '.vbe',
  '.wsf',
  '.wsh',
  '.exe',
  '.com',
  '.scr',
  '.msi',
  '.dll',
  '.so',
  '.dylib',
  '.sh',
  '.bash',
  '.zsh',
  '.fish',
  '.command',
  '.app',
  '.jar',
  '.lnk',
  '.reg',
  '.hta',
  '.cpl',
])

/** 실행·스크립트 확장자(SCRIPT_EXTENSIONS)인가. */
export function isScriptFile(base: string): boolean {
  return SCRIPT_EXTENSIONS.has(extensionOf(base))
}
/** husky 훅(`.husky/pre-commit` 등) — 확장자가 없지만 템플릿 프로젝트에 들어 있다. */
const HUSKY_HOOKS: ReadonlySet<string> = new Set([
  'pre-commit',
  'pre-push',
  'commit-msg',
  'prepare-commit-msg',
  'post-commit',
  'post-checkout',
  'post-rewrite',
  'pre-rebase',
])

/** 마지막 `.` 부터의 확장자(소문자). 앞 점 하나뿐인 이름(`.gitignore`)은 확장자가 없다. */
export function extensionOf(base: string): string {
  const b = goLower(base)
  const i = b.lastIndexOf('.')
  return i <= 0 ? '' : b.slice(i)
}

/**
 * `.env.{mode}` 류 env 파일(값을 검사해 `VITE_` 공개 값만 올리는 파일)인가 — env 이름(ENV_FILE_NAME)이면서 확장자가
 * 코드·텍스트 허용 목록에 없다(`.env.production`·`.env_prod`·`prod.env`). `env.ts` 같은 코드 파일은 아니다.
 * 견본(`.env.example|sample|template`)도 여기에 든다 — push 가 견본 규칙으로 따로 본다.
 */
export function isEnvModeFile(base: string): boolean {
  return (
    ENV_FILE_NAME.test(base) && !ALLOWED_EXTENSIONS.has(extensionOf(base)) && !isScriptFile(base)
  )
}

/** env 이름 파일 중 코드 파일(템플릿이 쓰는 `env.ts`·`vite-env.d.ts`) 확장자 — 줄 단위 시크릿 검사를 그대로 받는다. */
const ENV_CODE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.mts',
  '.cts',
])

/**
 * 값 검사로 올릴 수 있는 평범한 dotenv 이름 — `.env`·`.env.{mode}`·`.env_{mode}`·`env.{mode}`·`env_{mode}`·`{x}.env`·`{x}.env.{mode}`.
 * mode 는 `[a-z0-9_-]+`(점 없음 — 추가 확장자가 붙으면 아니다)이고 `local` 이거나 `.local`·`_local` 로 끝나는 것은 제외한다.
 */
const PLAIN_DOTENV = /^(?:[a-z0-9_-]+\.)?\.?env(?:[._-][a-z0-9_-]+)?$/
/** 파일 형식 확장자로 읽히는 것(`.env.json`·`.env.txt`·`env.yaml`) — `.env.{mode}` 모양이어도 mode 가 아니라 확장자다. */
const ENV_FORMAT_EXTENSIONS: ReadonlySet<string> = new Set([
  '.json',
  '.jsonc',
  '.json5',
  '.yml',
  '.yaml',
  '.toml',
  '.xml',
  '.ini',
  '.properties',
  '.conf',
  '.cfg',
])
const ENV_LOCAL_MODE = /(?:^|[._-])local$/

/**
 * env 이름(ENV_FILE_NAME)이면서 올리지 않는 파일인가(AWS Security Agent 8차 M Ruling 27, PR #454 후속) — `env.yaml`·`.env.json`·
 * `.env.production.txt`·`.env.prod.md`·`prod.env.xml` 처럼 평범한 dotenv(PLAIN_DOTENV)도 코드 파일도 아닌 것 전부. 확장자가
 * 텍스트·구조화 형식이든 아니든 값 검사로 비밀을 못 잡으므로 `.bstageinclude` 로도 되살릴 수 없다. 견본(`.env.example|sample|template`)과
 * `env.ts`·`vite-env.d.ts` 같은 코드 파일(.ts .tsx .js .jsx .mjs .cjs .mts .cts)은 제외 대상이 아니다.
 */
export function isEnvStructuredConfig(base: string): boolean {
  const b = goLower(base)
  if (!ENV_FILE_NAME.test(b)) return false
  if (ENV_PLACEHOLDER_FILES.has(b)) return false
  if (ENV_CODE_EXTENSIONS.has(extensionOf(b))) return false
  const ext = extensionOf(b)
  if (ENV_FORMAT_EXTENSIONS.has(ext) || ALLOWED_EXTENSIONS.has(ext)) return true
  return !(PLAIN_DOTENV.test(b) && !ENV_LOCAL_MODE.test(b))
}

/**
 * 기본으로 올리는 파일인가(경로는 루트 기준 POSIX). 확장자·정해진 이름·`.husky/<훅>`·env 파일(isEnvModeFile)만.
 * 로컬 비밀 이름(isLocalSecretName)은 여기서 보지 않는다 — scanSource 가 먼저 뺀다.
 */
export function isAllowedSourcePath(rel: string): boolean {
  const segs = rel.split('/')
  const base = segs[segs.length - 1]!
  const lb = goLower(base)
  const ext = extensionOf(base)
  if (SCRIPT_EXTENSIONS.has(ext)) return false
  if (ALLOWED_EXTENSIONS.has(ext)) return true
  if (ALLOWED_BASENAMES.has(lb)) return true
  if (ALLOWED_BASENAME_PATTERNS.some((re) => re.test(lb))) return true
  if (lb.startsWith('vite.config.') && VITE_CONFIG_EXTENSIONS.has(ext)) return true
  if (DOC_BASENAME.test(lb) && ext === '') return true
  if (segs.length >= 2 && goLower(segs[segs.length - 2]!) === '.husky' && HUSKY_HOOKS.has(lb)) {
    return true
  }
  return isEnvModeFile(base)
}

/**
 * 서버 srcmanifest.ValidatePath 의 미러. 거부 사유(한국어)를 돌려주고 통과하면 null.
 * 표 테스트가 서버 테스트 케이스와 같다 — 한쪽을 바꾸면 다른 쪽도 바꾼다.
 */
export function validateSourcePath(p: string): string | null {
  if (p === '') return '빈 경로'
  if (Buffer.byteLength(p, 'utf8') > SOURCE_LIMITS.maxPathBytes) return '경로가 너무 깁니다'
  if (LONE_SURROGATE.test(p)) return 'UTF-8 이 아닌 경로'
  if (BAD_CHAR.test(p)) return '허용되지 않는 문자'
  const segs = p.split('/')
  for (const s of segs) {
    const l = goLower(s)
    if (l === '' || l === '.' || l === '..') return '빈 세그먼트 또는 . / .. 세그먼트'
    if (RESERVED_DIRS.has(l)) return `저장할 수 없는 폴더 ${s}`
    if (s.endsWith('.') || s.endsWith(' ')) return '끝이 . 또는 공백인 이름'
    // 로컬 비밀 이름은 파일·폴더 모두 거부한다(`.env.local/db` 같은 우회 방지) — 서버와 같다.
    if (isLocalSecretName(s)) return '로컬 비밀 파일은 저장할 수 없습니다'
  }
  return null
}

/** 대소문자만 다른 중복·파일/폴더 이름 충돌을 서버와 같이 거른다. 문제가 있으면 throw. */
export function assertNoConflicts(paths: string[]): void {
  const lower = new Set<string>()
  for (const p of paths) {
    const lp = goLower(p)
    if (lower.has(lp)) throw new Error(`대소문자만 다른 중복 경로가 있습니다: ${p}`)
    lower.add(lp)
  }
  for (const lp of lower) {
    for (let j = lp.lastIndexOf('/'); j > 0; j = lp.lastIndexOf('/', j - 1)) {
      if (lower.has(lp.slice(0, j)))
        throw new Error(`파일과 폴더 이름이 겹칩니다: ${lp.slice(0, j)}`)
    }
  }
}

export function sha256File(abs: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    createReadStream(abs)
      .on('error', reject)
      .on('data', (c) => h.update(c))
      .on('end', () => resolve(h.digest('hex')))
  })
}

interface IgnoreLayer {
  /** 이 규칙 파일이 있는 폴더(루트 기준 POSIX 상대경로, 루트는 ''). */
  base: string
  ig: Ignore
}

/** 루트의 `.bstageinclude`(gitignore 문법). 없으면 null. 읽을 수 없으면 중단한다(무시 파일과 같다). */
export async function loadInclude(root: string): Promise<Ignore | null> {
  let text: string
  try {
    text = await readFile(join(root, '.bstageinclude'), 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw Object.assign(
      new Error(`.bstageinclude 파일을 읽을 수 없습니다: ${(e as Error).message}`),
      {
        cause: e,
      },
    )
  }
  return ignore().add(text)
}

async function loadLayer(dir: string, base: string): Promise<IgnoreLayer | null> {
  const ig = ignore()
  let any = false
  // .bstageignore 를 나중에 더해 같은 폴더에서는 우선한다.
  for (const name of ['.gitignore', '.bstageignore']) {
    let text: string
    try {
      text = await readFile(join(dir, name), 'utf8')
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue
      // 읽지 못한 규칙 파일을 무시하면 제외해야 할 파일이 올라간다 — 중단한다.
      const rel = base === '' ? name : `${base}/${name}`
      throw Object.assign(new Error(`${rel} 파일을 읽을 수 없습니다: ${(e as Error).message}`), {
        cause: e,
      })
    }
    ig.add(text)
    any = true
  }
  return any ? { base, ig } : null
}

// 깊은 폴더의 규칙이 이긴다(git 과 같음): 얕은 것부터 적용해 마지막으로 맞은 규칙이 결정한다.
function isIgnored(layers: IgnoreLayer[], rel: string, isDir: boolean): boolean {
  let ignored = false
  for (const { base, ig } of layers) {
    const sub = base === '' ? rel : rel.slice(base.length + 1)
    const r = ig.test(isDir ? `${sub}/` : sub)
    if (r.ignored) ignored = true
    else if (r.unignored) ignored = false
  }
  return ignored
}

/**
 * 프로젝트 폴더를 push 용 파일 목록으로 훑는다. `.gitignore`·`.bstageignore` 를 적용하고,
 * 서버가 항상 거부하는 경로(예약 폴더)와 로컬 비밀 이름(isLocalSecretName — `.env.local`·개인 키·자격 증명 파일과 폴더 등)은
 * 무시 파일이 없어도 뺀다.
 * 패턴으로 무시한 파일은 사용자가 정한 것이라 skipped 에 넣지 않는다.
 * 남은 파일 중 올릴 종류(isAllowedSourcePath)가 아니고 루트 `.bstageinclude` 에도 없는 것은 notAllowed 로 빼고 알린다
 * (AWS Security Agent 6차, Ruling 24). 로컬 비밀 이름은 그보다 먼저 빠지므로 `.bstageinclude` 로 되살릴 수 없다.
 * 한도 초과·대소문자 중복·파일/폴더 충돌은 서버와 같은 기준으로 미리 throw 한다.
 */
export async function scanSource(root: string): Promise<ScanResult> {
  const files: SourceFile[] = []
  const skipped: string[] = []
  const invalid: { path: string; reason: string }[] = []
  const notAllowed: string[] = []
  const envConfigs: string[] = []
  const include = await loadInclude(root)
  let total = 0

  async function walk(dirAbs: string, dirRel: string, parent: IgnoreLayer[]): Promise<void> {
    const layer = await loadLayer(dirAbs, dirRel)
    const layers = layer ? [...parent, layer] : parent
    const entries = (await readdir(dirAbs, { withFileTypes: true })).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )
    for (const ent of entries) {
      const rel = dirRel === '' ? ent.name : `${dirRel}/${ent.name}`
      const abs = join(dirAbs, ent.name)
      const st = await lstat(abs)
      // 예약 이름은 파일이든 폴더든 뺀다(git worktree·submodule 루트의 `.git` 은 파일이다).
      if (RESERVED_DIRS.has(goLower(ent.name))) {
        skipped.push(st.isDirectory() ? `${rel}/` : rel)
        continue
      }
      if (st.isSymbolicLink()) {
        skipped.push(rel)
        continue
      }
      if (st.isDirectory()) {
        // 로컬 비밀 이름의 폴더(`.env.local/`·`.ssh/`·`.aws/` 등)는 무시 파일과 상관없이 통째로 뺀다.
        if (isLocalSecretName(ent.name)) {
          skipped.push(`${rel}/`)
          continue
        }
        if (isIgnored(layers, rel, true)) continue
        await walk(abs, rel, layers)
        continue
      }
      if (!st.isFile()) {
        skipped.push(rel)
        continue
      }
      if (isLocalSecretName(ent.name) || PULL_TEMP.test(ent.name)) {
        skipped.push(rel)
        continue
      }
      if (isIgnored(layers, rel, false)) continue
      // env 이름의 구조화 설정은 허용 목록·`.bstageinclude` 와 상관없이 올리지 않는다(Ruling 27).
      if (isEnvStructuredConfig(ent.name)) {
        envConfigs.push(rel)
        continue
      }
      if (!isAllowedSourcePath(rel) && !(include?.ignores(rel) ?? false)) {
        notAllowed.push(rel)
        continue
      }
      const reason = validateSourcePath(rel)
      if (reason) {
        invalid.push({ path: rel, reason })
        continue
      }
      if (st.size > SOURCE_LIMITS.maxFileBytes) {
        throw new Error(`파일이 너무 큽니다(최대 10MiB): ${rel}`)
      }
      total += st.size
      if (total > SOURCE_LIMITS.maxTotalBytes) {
        throw new Error('파일 크기 합계가 너무 큽니다(최대 100MiB)')
      }
      if (files.length >= SOURCE_LIMITS.maxFiles) {
        throw new Error('파일이 너무 많습니다(최대 5000개)')
      }
      files.push({
        path: rel,
        sha256: await sha256File(abs),
        size: st.size,
        exec: (st.mode & 0o111) !== 0,
        abs,
      })
    }
  }

  await walk(root, '', [])
  assertNoConflicts(files.map((f) => f.path))
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return { files, skipped, invalid, notAllowed, envConfigs }
}
