import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { agentsMd, claudeMd, skillsFor } from '@bstage-sdk/ai-toolkit'
import type { DesignTarget } from '@bstage-sdk/ai-toolkit'

import { env } from '../../templates/env.js'
import { packageJson } from '../../templates/packageJson.js'
import { readme } from '../../templates/readme.js'
import { tsconfig, tsconfigApp, tsconfigNode } from '../../templates/tsconfig.js'
import { viteConfig } from '../../templates/viteConfig.js'
import { indexHtml } from '../../templates/indexHtml.js'
import { pnpmWorkspace } from '../../templates/pnpmWorkspace.js'
import { gitignore } from '../../templates/gitignore.js'
import { huskyPreCommit } from '../../templates/huskyPreCommit.js'
import { checkSecretsScript } from '../../templates/checkSecretsScript.js'
import { eslintConfig } from '../../templates/eslintConfig.js'
import { mainTsx } from '../../templates/src/mainTsx.js'
import { appTsx } from '../../templates/src/appTsx.js'
import { indexCss } from '../../templates/src/indexCss.js'
import { viteEnvDts } from '../../templates/src/viteEnvDts.js'
import { clientTs } from '../../templates/src/clientTs.js'
import { templateTsx } from '../../templates/src/templateTsx.js'
import { slotsReadme } from '../../templates/slotsReadme.js'

/** `scaffoldSdk`에 넘기는 프로젝트 맥락. 프롬프트·네트워크 조회가 끝난 뒤의 확정값이다. */
export interface SdkScaffoldInput {
  space: string
  projectName: string
  templateName: string
  target: DesignTarget
  phase: 'dev' | 'qa' | 'real' | 'sandbox'
  packageManager: 'npm' | 'pnpm'
  /** 빈 문자열 허용 — 인증 설정을 건너뛴 경우 placeholder로 대체된다. */
  appId: string
  appKey: string
  tenantId: string
  sdkVersions: { cli: string; core: string; react: string; design: string }
}

export interface ScaffoldFile {
  /** 프로젝트 루트 기준 상대 경로(posix) */
  path: string
  content: string
}

/** git이 실행하는 훅 파일 — 실행 비트가 없으면 훅이 조용히 건너뛰어진다. */
const EXECUTABLE_PATHS: ReadonlySet<string> = new Set(['.husky/pre-commit'])

export interface Scaffold {
  dirs: string[]
  files: ScaffoldFile[]
}

/**
 * `bstage init`(sdk 경로)이 만들 디렉터리·파일 목록을 조립한다. 순수 함수 — 디스크·네트워크·
 * 프롬프트를 건드리지 않으므로 목록 자체를 테스트로 고정할 수 있다.
 *
 * 산출물에 `.env`(실제 API 키)가 들어간다 — 호출부는 이 반환값을 로그·에러 메시지에 찍지 않는다.
 */
export function scaffoldSdk(input: SdkScaffoldInput): Scaffold {
  return { dirs: buildDirs(input), files: buildFiles(input) }
}

/**
 * 쓰기 실패를 **어느 경로에서 멈췄는지** 드러나는 메시지로 바꿔 던진다.
 * 수십 개 파일을 순서대로 쓰므로, raw 스택만 나오면 부분 생성된 디렉터리에서 어디까지 됐는지 모른다.
 * 안내 출력·종료는 호출부(`init`)가 자기 방식으로 한다.
 */
function rethrowWithPath(path: string, err: unknown): never {
  const message = err instanceof Error ? err.message : String(err)
  throw new Error(`${path} 쓰기 실패: ${message}`)
}

/**
 * 조립된 목록을 디스크에 쓴다. 디렉터리를 먼저 만들고(`recursive`), 파일은 상위 디렉터리가
 * `dirs`에 없더라도 스스로 보장한다.
 */
export function writeScaffold(projectDir: string, scaffold: Scaffold): void {
  for (const dir of scaffold.dirs) {
    const full = join(projectDir, dir)
    try {
      mkdirSync(full, { recursive: true })
    } catch (err) {
      rethrowWithPath(full, err)
    }
  }
  for (const file of scaffold.files) {
    const full = join(projectDir, file.path)
    try {
      mkdirSync(dirname(full), { recursive: true })
      writeFileSync(full, file.content, 'utf-8')
      if (EXECUTABLE_PATHS.has(file.path)) chmodSync(full, 0o755)
    } catch (err) {
      rethrowWithPath(full, err)
    }
  }
}

/**
 * 디렉토리 구조.
 *
 * src/pages와 src/slots를 둘 다 만든다. 페이지는 폴더 경로가 곧 배포 경로이고,
 * 위젯은 slot 옵션이 자리를 정한다 — 어느 쪽인지가 위치로 드러나야 한다.
 */
function buildDirs({ templateName }: SdkScaffoldInput): string[] {
  return [
    '',
    'src',
    '.husky',
    'src/shared',
    `src/pages/${templateName}`,
    'src/slots',
    ...skillsFor('sdk').map((s) => `.claude/skills/${s.name}`),
  ]
}

function file(path: string, content: string): ScaffoldFile {
  return { path, content }
}

/**
 * `.env`(실제 값)는 커밋되지 않고(.gitignore), `.env.example`은 커밋되어 팀원 세팅을 안내한다.
 * 값이 비어 있으면 placeholder로 채운다.
 */
function buildEnvFiles({ phase, appId, appKey, tenantId }: SdkScaffoldInput): ScaffoldFile[] {
  return [
    file(
      '.env',
      env({
        phase,
        appId: appId || 'YOUR_APP_ID',
        appKey: appKey || 'YOUR_APP_KEY',
        tenantId: tenantId || 'YOUR_TENANT_ID',
      }),
    ),
    file(
      '.env.example',
      env({ phase, appId: 'YOUR_APP_ID', appKey: 'YOUR_APP_KEY', tenantId: 'YOUR_TENANT_ID' }),
    ),
  ]
}

/** 이 프로젝트 종류(sdk)에 해당하는 스킬만 깐다 — liquid 전용 스킬은 들어가지 않는다. */
function buildSkillFiles({ target }: SdkScaffoldInput): ScaffoldFile[] {
  return skillsFor('sdk').map((s) =>
    file(`.claude/skills/${s.name}/SKILL.md`, s.content({ kind: 'sdk', target })),
  )
}

/** 유저·어드민 스캐폴드는 같다 — 갈리는 건 template.tsx가 선언하는 target뿐이다. */
function buildFiles(input: SdkScaffoldInput): ScaffoldFile[] {
  const { space, projectName, templateName, target, packageManager, appId, sdkVersions } = input
  return [
    file('AGENTS.md', agentsMd({ space, projectName, target, kind: 'sdk' })),
    file('CLAUDE.md', claudeMd()),
    file('README.md', readme({ projectName, packageManager })),
    file('package.json', packageJson({ projectName, target, sdkVersions })),
    file('tsconfig.json', tsconfig()),
    file('tsconfig.app.json', tsconfigApp()),
    file('tsconfig.node.json', tsconfigNode()),
    file('vite.config.ts', viteConfig()),
    ...buildEnvFiles(input),
    file('index.html', indexHtml()),
    // pnpm은 의존성 build script를 막고 그걸 에러로 낸다 → 허용 목록이 없으면 install이 실패한다.
    ...(packageManager === 'pnpm' ? [file('pnpm-workspace.yaml', pnpmWorkspace())] : []),
    file('.gitignore', gitignore()),
    file('.husky/pre-commit', huskyPreCommit()),
    file('.husky/check-secrets.mjs', checkSecretsScript()),
    file('eslint.config.js', eslintConfig()),
    file('src/main.tsx', mainTsx()),
    // 화면은 App.tsx가 갖는다 — main.tsx에 컴포넌트를 두면 export 없는 파일이 되어 lint가 막는다.
    file('src/App.tsx', appTsx({ hasApiKey: !!appId })),
    file('src/index.css', indexCss()),
    file('src/vite-env.d.ts', viteEnvDts()),
    file('src/shared/client.ts', clientTs()),
    file(`src/pages/${templateName}/template.tsx`, templateTsx({ name: templateName })),
    // 빈 디렉토리는 git이 추적하지 않아 커밋하면 src/slots가 사라진다. 안내를 겸해 README를 둔다.
    file('src/slots/README.md', slotsReadme()),
    ...buildSkillFiles(input),
  ]
}
