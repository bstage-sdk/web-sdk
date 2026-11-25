import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  assertNoConflicts,
  goLower,
  isAllowedSourcePath,
  isScriptFile,
  isEnvStructuredConfig,
  scanSource,
  SOURCE_LIMITS,
  validateSourcePath,
} from './sourceManifest.js'

// 서버 internal/srcmanifest/manifest_test.go 의 TestValidatePath_Rejects/Accepts 와 같은 표 — 둘을 함께 고친다.
const REJECTS = [
  '',
  '../a',
  'a/../b',
  '/a',
  'a//b',
  'a/./b',
  'a/',
  'a\x00',
  'a\nb',
  'a\x7f',
  'a\\b',
  '.git/config',
  'x/.git/config',
  'node_modules/a',
  'x/node_modules/y',
  '.bstage/project.json',
  'x/.bstage/a',
  '.env',
  '.env.local',
  '.env.production.local',
  'web/.env',
  'web/.env.local',
  'web/.env.staging.local',
  'a'.repeat(513),
  '\ud800',
  '.GIT/config',
  '.Git/hooks/pre-commit',
  'Node_Modules/a',
  'x/.BSTAGE/x',
  '.ENV',
  '.Env.Local',
  'web/.ENV.Staging.LOCAL',
  'a\u202eb',
  'a\u0085',
  'a\u200bb',
  '.g\u200bit/x',
  'a\u2028b',
  'a\u2029b',
  'a\u2066b',
  'a\u200fb',
  'a\u061cb',
  'a\ufeffb',
  'a\u2060b',
  'a\u0080',
  'a\ue000b',
  'a:b.ts',
  'C:/x',
  'dir./x',
  'dir /x',
  'x.',
  'x ',
  '가'.repeat(171), // 513 바이트
]
const ACCEPTS = [
  'src/App.tsx',
  '.env.example',
  '.env.development',
  'a/b.c',
  'a'.repeat(512),
  '한글/파일.ts',
  '.gitignore',
  'node_modules_x/a',
]

describe('validateSourcePath (서버 ValidatePath 미러)', () => {
  it.each(REJECTS)('거부: %j', (p) => {
    expect(validateSourcePath(p)).toEqual(expect.any(String))
  })
  it.each(ACCEPTS)('허용: %j', (p) => {
    expect(validateSourcePath(p)).toBeNull()
  })
})

// 서버 TestLocalSecretNameRule_EverySegment 와 같은 표 — 로컬 비밀 이름 규칙은 모든 세그먼트(폴더 포함)에 적용된다.
describe('validateSourcePath — 로컬 비밀 이름은 모든 세그먼트에', () => {
  it.each([
    '.env.local/db',
    'sub/.env/x',
    '.env/a.ts',
    'a/.ENV.Production.Local/b/c.json',
    'x/.env.local/y',
  ])('거부: %j', (p) => {
    expect(validateSourcePath(p)).toBe('로컬 비밀 파일은 저장할 수 없습니다')
  })
  it.each(['.env.example/a.ts', '.env.development/x', 'env/.env.example'])('허용: %j', (p) => {
    expect(validateSourcePath(p)).toBeNull()
  })
})

// AWS Security Agent 2차 H1(Ruling 21) — 자격 증명 파일·폴더는 이름만으로 언제나 빼고, pull 에서도 거부한다.
const CREDENTIAL_NAMES = [
  'server.pem',
  'tls.KEY',
  'cert.p12',
  'cert.PFX',
  'id_rsa',
  'id_rsa.pub',
  'id_dsa',
  'ID_ECDSA',
  'id_ed25519',
  'id_ed25519.pub',
  '.npmrc',
  '.netrc',
  '.git-credentials',
  '.pgpass',
  'credentials',
  'terraform.tfstate',
  'terraform.tfstate.backup',
  'secrets.json',
  'Secrets.yaml',
  // AWS Security Agent 3차 L2
  '.terraformrc',
  '.envrc',
  // AWS Security Agent 5차 M2
  '.env_local',
  'env-local',
  '.env_prod_local',
  'ENV_LOCAL',
  'release.jks',
  'app.keystore',
  'AuthKey_ABC123.p8',
  'putty.ppk',
  'backup.gpg',
  'key.asc',
  'prod.secrets',
  'app-secrets.json',
  'appsecrets.json',
  'App.Secrets.JSON',
  // AWS Security Agent 6차 H
  'server.crt',
  'ca.CER',
  'cert.der',
  'chain.p7b',
  'chain.p7c',
  'store.jceks',
  'vault.kdbx',
  'client.ovpn',
  '.htpasswd',
  '.pypirc',
  '.dockercfg',
  'kubeconfig',
  'kubeconfig.yaml',
  // AWS Security Agent 18차 M
  '.yarnrc.yml',
  '.yarnrc',
  'bunfig.toml',
  'credentials.json',
  'token.json',
  'tokens.json',
  'auth.json',
  'client_secret.json',
  'client_secret_123-abc.apps.googleusercontent.com.json',
  'service-account.json',
  'service-account-prod.json',
  'service_account_key.json',
  'gcp-credentials.json',
  'aws_credentials.json',
  'google-token.json',
  'oauth_token.json',
  'my-proj-firebase-adminsdk-x1y2z.json',
  'application_default_credentials.json',
]
const CREDENTIAL_DIRS = ['.aws', '.ssh', '.gnupg', '.docker', '.AWS', '.kube', '.KUBE']

describe('validateSourcePath — 자격 증명 이름(H1)', () => {
  it.each(
    [...CREDENTIAL_NAMES, 'Credentials', '.ENVRC', ...CREDENTIAL_DIRS].flatMap((n) => [
      n,
      `web/${n}`,
      `a/b/${n}`,
    ]),
  )('거부: %j', (p) => {
    expect(validateSourcePath(p)).toBe('로컬 비밀 파일은 저장할 수 없습니다')
  })
  it.each([...CREDENTIAL_DIRS.map((d) => `${d}/config`), '.ssh/id_rsa', 'x/.docker/config.json'])(
    '폴더 안도 거부: %j',
    (p) => {
      expect(validateSourcePath(p)).toBe('로컬 비밀 파일은 저장할 수 없습니다')
    },
  )
  it.each([
    'src/keyboard.ts',
    'src/token.ts',
    'tokens.css',
    'design-tokens.json',
    'auth.ts',
    'src/credentials.json.d.ts',
    'src/credentials.ts',
    'my-credentials',
    'src/pem.ts',
    'id.ts',
    'secret.ts',
    '.env.production',
    'web/.env.staging',
    'keystore.ts',
    'kube/deploy.yaml',
    'envrc.md',
    '.env_prod',
    '.env-staging',
    'environment.local',
    'local.ts',
  ])('허용: %j', (p) => {
    expect(validateSourcePath(p)).toBeNull()
  })
})

describe('goLower (Go strings.ToLower 와 같은 매핑)', () => {
  it('İ 는 i 한 글자로, 일반 문자는 그대로 소문자로', () => {
    expect(goLower('\u0130')).toBe('i')
    expect(goLower('ABC가')).toBe('abc가')
    expect(validateSourcePath('.G\u0130T/x')).toEqual(expect.any(String))
    expect(() => assertNoConflicts(['\u0130.ts', 'i.ts'])).toThrow('대소문자')
  })
})

describe('assertNoConflicts', () => {
  it('대소문자만 다른 중복·정확히 같은 경로는 에러', () => {
    expect(() => assertNoConflicts(['A.ts', 'a.ts'])).toThrow('대소문자')
    expect(() => assertNoConflicts(['a.ts', 'a.ts'])).toThrow('대소문자')
  })
  it('파일과 폴더 이름 충돌은 에러(대소문자 무관), 이름만 비슷하면 통과', () => {
    expect(() => assertNoConflicts(['a', 'a/b'])).toThrow('겹칩니다')
    expect(() => assertNoConflicts(['x/A', 'x/a/b'])).toThrow('겹칩니다')
    expect(() => assertNoConflicts(['a', 'a.b', 'c/d'])).not.toThrow()
  })
})

const sha = (s: string) => createHash('sha256').update(s).digest('hex')

describe('scanSource', () => {
  let root: string
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'bstage-scan-'))
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })
  const put = async (rel: string, body = rel) => {
    const abs = join(root, ...rel.split('/'))
    await mkdir(join(abs, '..'), { recursive: true })
    await writeFile(abs, body)
    return abs
  }
  const paths = async () => (await scanSource(root)).files.map((f) => f.path)

  it('.gitignore 가 없어도 예약 폴더와 로컬 비밀 파일을 제외하고 skipped 에 알린다', async () => {
    await put('src/a.ts')
    await put('node_modules/x/index.js')
    await put('.git/config')
    await put('.bstage/project.json')
    await put('web/.bstage/x')
    await put('.env')
    await put('.env.local')
    await put('web/.env.prod.local')
    await put('web/.ENV.dev.LOCAL')
    const r = await scanSource(root)
    expect(r.files.map((f) => f.path)).toEqual(['src/a.ts'])
    expect(r.invalid).toEqual([])
    expect([...r.skipped].sort()).toEqual(
      [
        'node_modules/',
        '.git/',
        '.bstage/',
        'web/.bstage/',
        '.env',
        '.env.local',
        'web/.env.prod.local',
        'web/.ENV.dev.LOCAL',
      ].sort(),
    )
  })

  it('로컬 비밀 이름의 폴더(.env.local/ · sub/.env/)는 통째로 건너뛰고 skipped 에 / 를 붙여 알린다', async () => {
    await put('src/a.ts')
    await put('.env.local/db')
    await put('sub/.env/x')
    await put('sub/.ENV.prod.local/deep/y.json')
    await put('.env.example/ok.ts')
    const r = await scanSource(root)
    expect(r.files.map((f) => f.path).sort()).toEqual(['.env.example/ok.ts', 'src/a.ts'])
    expect([...r.skipped].sort()).toEqual(['.env.local/', 'sub/.ENV.prod.local/', 'sub/.env/'])
    expect(r.invalid).toEqual([])
  })

  it('자격 증명 파일(루트·하위)과 자격 증명 폴더는 무시 파일과 상관없이 빼고 skipped 에 알린다(H1)', async () => {
    await put('src/a.ts')
    await put('design-tokens.json')
    for (const n of CREDENTIAL_NAMES) {
      await put(n)
      await put(`web/deep/${n}`)
    }
    for (const d of CREDENTIAL_DIRS.filter((x) => x === goLower(x))) {
      await put(`${d}/config`)
      await put(`web/${d}/config`)
    }
    const r = await scanSource(root)
    expect(r.files.map((f) => f.path).sort()).toEqual(['design-tokens.json', 'src/a.ts'])
    expect(r.invalid).toEqual([])
    const want = [
      ...CREDENTIAL_NAMES.flatMap((n) => [n, `web/deep/${n}`]),
      ...CREDENTIAL_DIRS.filter((x) => x === goLower(x)).flatMap((d) => [`${d}/`, `web/${d}/`]),
    ]
    expect([...r.skipped].sort()).toEqual(want.sort())
  })

  it('예약 이름의 파일(worktree 의 .git 파일 등)은 invalid 가 아니라 skipped', async () => {
    await put('ok.ts')
    await put('.git', 'gitdir: /x/.git/worktrees/y\n')
    await put('sub/.git', 'gitdir: /x\n')
    await put('sub/node_modules', 'x')
    await put('.BSTAGE', 'x')
    const r = await scanSource(root)
    expect(r.files.map((f) => f.path)).toEqual(['ok.ts'])
    expect(r.invalid).toEqual([])
    expect([...r.skipped].sort()).toEqual(
      ['.BSTAGE', '.git', 'sub/.git', 'sub/node_modules'].sort(),
    )
  })

  it('중단된 pull 이 남긴 .bstage-pull-*.tmp 는 올리지 않고 skipped 에 알린다', async () => {
    await put('src/a.ts')
    await put('src/.bstage-pull-0a1b2c3d4e5f.tmp', 'half')
    await put('.bstage-pull-abcdef012345.tmp', 'half')
    await put('src/bstage-pull-x.tmp.ts') // 앞 점이 없으면 일반 파일
    const r = await scanSource(root)
    expect(r.files.map((f) => f.path)).toEqual(['src/a.ts', 'src/bstage-pull-x.tmp.ts'])
    expect([...r.skipped].sort()).toEqual(
      ['.bstage-pull-abcdef012345.tmp', 'src/.bstage-pull-0a1b2c3d4e5f.tmp'].sort(),
    )
  })

  it('읽을 수 없는 .gitignore(폴더 등)는 조용히 넘기지 않고 중단한다', async () => {
    await put('a.ts')
    await mkdir(join(root, '.gitignore'))
    await expect(scanSource(root)).rejects.toThrow(/\.gitignore/)
  })

  it('.env.example·.env.development 는 포함한다', async () => {
    await put('.env.example')
    await put('.env.development')
    expect(await paths()).toEqual(['.env.development', '.env.example'])
  })

  it('.gitignore 와 .bstageignore 패턴을 루트·하위 모두 적용한다', async () => {
    await put('.bstageinclude', '*.log\n') // .log 는 허용 목록 밖 — 무시 규칙만 보려고 넣는다
    await put('.gitignore', 'dist/\n*.log\n')
    await put('.bstageignore', 'secret.txt\n')
    await put('dist/out.js')
    await put('a.log')
    await put('secret.txt')
    await put('src/keep.ts')
    await put('src/.gitignore', 'gen.ts\n!x.log\n')
    await put('src/gen.ts')
    await put('src/x.log')
    await put('src/sub/gen.ts')
    expect(await paths()).toEqual([
      '.bstageignore',
      '.bstageinclude',
      '.gitignore',
      'src/.gitignore',
      'src/keep.ts',
      'src/x.log',
    ])
  })

  it('심볼릭 링크는 건너뛰고 skipped 에 넣는다', async () => {
    await put('real.ts')
    await symlink(join(root, 'real.ts'), join(root, 'link.ts'))
    await symlink(root, join(root, 'linkdir'))
    const r = await scanSource(root)
    expect(r.files.map((f) => f.path)).toEqual(['real.ts'])
    expect(r.skipped).toEqual(expect.arrayContaining(['link.ts', 'linkdir']))
  })

  it('sha256·크기·exec·abs 가 정확하고 경로에 역슬래시가 없다', async () => {
    const abs = await put('a/b/run.mjs', 'echo hi\n')
    await chmod(abs, 0o755)
    await put('a/b/plain.txt', 'hello')
    const r = await scanSource(root)
    expect(r.files).toEqual([
      {
        path: 'a/b/plain.txt',
        sha256: sha('hello'),
        size: 5,
        exec: false,
        abs: join(root, 'a', 'b', 'plain.txt'),
      },
      { path: 'a/b/run.mjs', sha256: sha('echo hi\n'), size: 8, exec: true, abs },
    ])
    expect(r.files.every((f) => !f.path.includes('\\'))).toBe(true)
  })

  it('서버가 거부할 경로는 조용히 건너뛰지 않고 invalid 로 돌려준다', async () => {
    await put('ok.ts')
    await put('a:b.ts')
    await put('dir./x.ts')
    const r = await scanSource(root)
    expect(r.files.map((f) => f.path)).toEqual(['ok.ts'])
    expect(r.invalid.map((i) => i.path).sort()).toEqual(['a:b.ts', 'dir./x.ts'])
    expect(r.invalid.every((i) => i.reason.length > 0)).toBe(true)
  })

  it('파일 10MiB 초과는 에러', async () => {
    await put('big.txt', 'x'.repeat(SOURCE_LIMITS.maxFileBytes + 1))
    await expect(scanSource(root)).rejects.toThrow(/big\.txt/)
  })

  it('정확히 10MiB 는 통과', async () => {
    await put('big.txt', 'x'.repeat(SOURCE_LIMITS.maxFileBytes))
    expect(await paths()).toEqual(['big.txt'])
  })

  it('합계 100MiB 초과는 에러', async () => {
    const body = 'x'.repeat(SOURCE_LIMITS.maxFileBytes)
    for (let i = 0; i < 11; i++) await put(`f${i}.txt`, body)
    await expect(scanSource(root)).rejects.toThrow(/100/)
  })

  it('파일 5000개 초과는 에러, 정확히 5000개는 통과', async () => {
    await mkdir(join(root, 'd'))
    await Promise.all(
      Array.from({ length: 5000 }, (_, i) => writeFile(join(root, 'd', `f${i}.ts`), '')),
    )
    expect((await scanSource(root)).files).toHaveLength(5000)
    await put('extra.ts')
    await expect(scanSource(root)).rejects.toThrow(/5000/)
  }, 60_000)

  // AWS Security Agent 6차(Ruling 24 S1) — 허용 목록 밖은 notAllowed, .bstageinclude 로만 올린다.
  it('허용 목록 밖의 파일은 notAllowed 로 빼고, .bstageinclude 에 맞으면 올린다', async () => {
    await put('src/a.ts')
    await put('tools/run.sh')
    await put('data.bin')
    await put('app.js.map')
    await put('.husky/pre-commit')
    await put('notes/.husky-like/pre-commit')
    let r = await scanSource(root)
    expect(r.files.map((f) => f.path)).toEqual(['.husky/pre-commit', 'src/a.ts'])
    expect([...r.notAllowed].sort()).toEqual(
      ['app.js.map', 'data.bin', 'notes/.husky-like/pre-commit', 'tools/run.sh'].sort(),
    )
    await put('.bstageinclude', 'tools/*.sh\n*.map\n')
    r = await scanSource(root)
    expect(r.files.map((f) => f.path)).toEqual([
      '.bstageinclude',
      '.husky/pre-commit',
      'app.js.map',
      'src/a.ts',
      'tools/run.sh',
    ])
    expect([...r.notAllowed].sort()).toEqual(['data.bin', 'notes/.husky-like/pre-commit'])
  })

  it('.bstageinclude 는 로컬 비밀 이름·무시 파일을 이기지 못한다', async () => {
    await put('src/a.ts')
    await put('.bstageinclude', '*\n')
    await put('.gitignore', 'build/\n')
    await put('build/out.bin')
    await put('id_rsa')
    await put('server.crt')
    await put('.env.local')
    await put('kubeconfig')
    const r = await scanSource(root)
    expect(r.files.map((f) => f.path)).toEqual(['.bstageinclude', '.gitignore', 'src/a.ts'])
    expect([...r.skipped].sort()).toEqual(['.env.local', 'id_rsa', 'kubeconfig', 'server.crt'])
    expect(r.notAllowed).toEqual([])
  })

  it('허용 목록 — 확장자는 대소문자 무관, 정해진 설정 파일 이름·env 파일 포함', async () => {
    for (const p of [
      'LOGO.PNG',
      'README',
      'LICENSE',
      'tsconfig.base.json',
      'vite.config.mts',
      '.nvmrc',
      '.node-version',
      '.prettierrc',
      '.eslintrc',
      '.editorconfig',
      'yarn.lock',
      '.env.production',
      '.env.example',
      'prod.env',
    ]) {
      expect(isAllowedSourcePath(p), p).toBe(true)
    }
    for (const p of ['run.sh', 'a.map', 'Dockerfile', 'x.bin', 'Makefile', '.htaccess']) {
      expect(isAllowedSourcePath(p), p).toBe(false)
    }
  })

  it('이름 접두사 규칙은 확장자 조건이 있다 — 스크립트·낯선 확장자는 막는다', () => {
    for (const p of [
      'README.md',
      'CHANGELOG',
      'CHANGELOG.md',
      'LICENSE.txt',
      'env.ts',
      'vite.config.mjs',
      'vite.config.cts',
    ]) {
      expect(isAllowedSourcePath(p), p).toBe(true)
    }
    for (const p of [
      'readme.cmd',
      'README.sh',
      'LICENSE.bat',
      'CHANGELOG.ps1',
      'README.v2',
      'vite.config.bat',
      'tsconfig.cmd',
      'env.bat',
      'env.cmd',
      'env.ps1',
      'src/env.exe',
      'x.sh',
      'x.PS1',
    ]) {
      expect(isAllowedSourcePath(p), p).toBe(false)
    }
    expect(isScriptFile('a.js')).toBe(false)
    expect(isScriptFile('A.CMD')).toBe(true)
  })

  it('scanSource — readme.cmd·env.bat 는 .bstageinclude 에 적어야 올린다', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bstage-scan-'))
    try {
      for (const f of ['readme.cmd', 'env.bat', 'README.md', 'env.ts'])
        await writeFile(join(dir, f), 'x')
      const a = await scanSource(dir)
      expect(a.files.map((f) => f.path)).toEqual(['README.md', 'env.ts'])
      expect([...a.notAllowed].sort()).toEqual(['env.bat', 'readme.cmd'])
      await writeFile(join(dir, '.bstageinclude'), 'readme.cmd\n')
      const b = await scanSource(dir)
      expect(b.files.map((f) => f.path)).toEqual([
        '.bstageinclude',
        'README.md',
        'env.ts',
        'readme.cmd',
      ])
      expect(b.notAllowed).toEqual(['env.bat'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

// AWS Security Agent 8차 M, Ruling 27 — env 이름의 구조화 설정 파일은 올리지 않는다.
describe('isEnvStructuredConfig', () => {
  it('env 이름 + 구조화 설정 확장자', () => {
    for (const b of [
      'env.yaml',
      'env.yml',
      '.env.json',
      'env.toml',
      '.env.production.json',
      'prod.env.xml',
      'ENV.JSON',
      '.env_prod.yaml',
      '.env.example.json',
      '.env.production.txt',
      '.env.prod.md',
      '.ENV.PRODUCTION.TXT',
      'env.production.yaml',
      '.env.production.foo',
      '.env.local.txt',
    ]) {
      expect(isEnvStructuredConfig(b), b).toBe(true)
    }
  })
  it('dotenv·코드 파일·env 이름이 아닌 설정은 아니다', () => {
    for (const b of [
      '.env.production',
      '.env.example',
      '.env.sample',
      '.env.template',
      '.env_prod',
      'prod.env',
      'env.ts',
      'env.d.ts',
      'vite-env.d.ts',
      'env.production.mjs',
      'environment.json',
      'config.yaml',
      'package.json',
    ]) {
      expect(isEnvStructuredConfig(b), b).toBe(false)
    }
  })
})
