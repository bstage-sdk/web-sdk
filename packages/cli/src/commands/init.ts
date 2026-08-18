import * as p from '@clack/prompts'
import pc from 'picocolors'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { resolve, join } from 'node:path'

import { agentsMd } from '../templates/agentsMd.js'
import { claudeMd } from '../templates/claudeMd.js'
import { env } from '../templates/env.js'
import { packageJson } from '../templates/packageJson.js'
import { readme } from '../templates/readme.js'
import { tsconfig, tsconfigApp, tsconfigNode } from '../templates/tsconfig.js'
import { viteConfig } from '../templates/viteConfig.js'
import { indexHtml } from '../templates/indexHtml.js'
import { pnpmWorkspace } from '../templates/pnpmWorkspace.js'
import { gitignore } from '../templates/gitignore.js'
import { huskyPreCommit } from '../templates/huskyPreCommit.js'
import { checkSecretsScript } from '../templates/checkSecretsScript.js'
import { eslintConfig } from '../templates/eslintConfig.js'
import { BSTAGE_SKILLS } from '../templates/skills.js'
import { mainTsx } from '../templates/src/mainTsx.js'
import { appTsx } from '../templates/src/appTsx.js'
import { indexCss } from '../templates/src/indexCss.js'
import { viteEnvDts } from '../templates/src/viteEnvDts.js'
import { clientTs } from '../templates/src/clientTs.js'
import { templateTsx } from '../templates/src/templateTsx.js'
import { slotsReadme } from '../templates/slotsReadme.js'
import type { DesignTarget } from '../templates/designGuide.js'

interface InitOptions {
  yes?: boolean
  space?: string
  target?: string
  template?: string
  phase?: string
  pm?: string
}

type Phase = 'dev' | 'qa' | 'real' | 'sandbox'
const PHASES: readonly Phase[] = ['dev', 'qa', 'real', 'sandbox'] as const

/**
 * 첫 템플릿의 target. 프로젝트 전체를 가르지 않는다 — 스캐폴드는 유저·어드민이 같고,
 * 갈리는 건 생성되는 `template.tsx`가 선언하는 `target`뿐이다.
 * 한 레포에 두 종류를 섞어도 되며, 이후 템플릿은 각자 `target`을 적는다.
 */
const TARGETS: readonly DesignTarget[] = ['user', 'admin'] as const

export async function initCommand(options: InitOptions): Promise<void> {
  p.intro(`${pc.cyan(pc.bold('bstage init'))} ${pc.dim('— b.stage Template Project Setup')}`)

  // ─── 인터랙티브 프롬프트 ───
  let space: string
  let templateName: string
  let packageManager: 'npm' | 'pnpm'
  let phase: Phase
  let target: DesignTarget
  let appId = ''
  let appSecret = ''
  let tenantId = ''

  if (options.yes) {
    const targetOpt = options.target ?? 'user'
    if (!TARGETS.includes(targetOpt as DesignTarget)) {
      p.log.error(`--target 값은 ${TARGETS.join(' | ')} 중 하나여야 합니다.`)
      p.outro(pc.red('중단되었습니다.'))
      process.exit(1)
    }
    target = targetOpt as DesignTarget
    if (!options.space) {
      p.log.error('--yes 모드에서는 --space가 필수입니다.')
      p.outro(pc.red('중단되었습니다.'))
      process.exit(1)
    }
    const slugPattern = /^[a-zA-Z][a-zA-Z0-9-]*$/
    if (!slugPattern.test(options.space)) {
      p.log.error(
        `${pc.red('--space')} 값은 영문자로 시작해야 하며, 영문, 숫자, 하이픈만 사용할 수 있습니다.`,
      )
      p.outro(pc.red('중단되었습니다.'))
      process.exit(1)
    }
    space = options.space
    const templateOpt = resolveTemplateName(space, options.template)
    if (!ELEMENT_NAME_RE.test(templateOpt)) {
      p.log.error(
        `${pc.red('--template')} 값은 Custom Element 스펙을 따라야 합니다: 소문자 시작, 하이픈 1개 이상, 소문자·숫자·하이픈만.`,
      )
      p.outro(pc.red('중단되었습니다.'))
      process.exit(1)
    }
    templateName = templateOpt
    packageManager = (options.pm as 'npm' | 'pnpm') ?? 'npm'
    const phaseOpt = options.phase ?? 'sandbox'
    if (!PHASES.includes(phaseOpt as Phase)) {
      p.log.error(`--phase 값은 ${PHASES.join(' | ')} 중 하나여야 합니다.`)
      p.outro(pc.red('중단되었습니다.'))
      process.exit(1)
    }
    phase = phaseOpt as Phase
  } else {
    target = (await p.select({
      message: '첫 번째 템플릿은 어느 플랫폼용인가요? (레포에 두 종류를 섞을 수 있습니다)',
      options: [
        { value: 'user', label: 'user (b.stage 유저 플랫폼)' },
        { value: 'admin', label: 'admin (b.stage 어드민 플랫폼)' },
      ],
      initialValue: options.target === 'admin' ? 'admin' : 'user',
    })) as DesignTarget
    if (p.isCancel(target)) return cancelled()

    space = (await p.text({
      message: '템플릿을 적용할 Space ID를 입력해 주세요.',
      validate: validateSlug('Space ID는 필수입니다.'),
    })) as string
    if (p.isCancel(space)) return cancelled()

    phase = (await p.select({
      message: '템플릿을 배포할 환경을 선택해 주세요.',
      options: [
        { value: 'sandbox', label: 'sandbox', hint: '기본' },
        { value: 'real', label: 'real' },
        { value: 'dev', label: 'dev', hint: '사내 전용 — .env에 호스트·CF Access 자격증명 필요' },
        { value: 'qa', label: 'qa', hint: '사내 전용 — .env에 호스트·CF Access 자격증명 필요' },
      ],
      initialValue: 'sandbox',
    })) as Phase
    if (p.isCancel(phase)) return cancelled()

    templateName = (await p.text({
      message: `첫 번째 템플릿 이름을 입력해 주세요. ${pc.dim(`(예: ${space}-hello — 하이픈 필수)`)}`,
      placeholder: resolveTemplateName(space, undefined),
      validate: validateElementName,
    })) as string
    if (p.isCancel(templateName)) return cancelled()

    packageManager = (await p.select({
      message: '사용할 패키지 매니저를 선택해 주세요.',
      options: [
        { value: 'npm', label: 'npm' },
        { value: 'pnpm', label: 'pnpm' },
      ],
      initialValue: 'npm',
    })) as 'npm' | 'pnpm'
    if (p.isCancel(packageManager)) return cancelled()

    // API 인증 설정 (선택). 게이트웨이는 유저단 API만 열려 있어 어드민 템플릿은 아직 쓸 곳이 없지만,
    // 한 레포에 두 종류가 섞일 수 있으므로 target으로 가르지 않는다.
    const configureAuth = await p.confirm({
      message: 'b.stage 파트너스에서 발급받은 API 키가 있으신가요? (없어도 시작할 수 있어요)',
      initialValue: false,
    })
    if (p.isCancel(configureAuth)) return cancelled()

    if (configureAuth) {
      p.log.info(pc.dim('API 인증 설정 (선택)'))

      appId = ((await p.text({
        message: '파트너 콘솔에서 발급받은 APP-ID를 입력해 주세요.',
      })) ?? '') as string
      if (p.isCancel(appId)) return cancelled()

      appSecret = ((await p.text({
        message: '파트너 콘솔에서 발급받은 Secret 값을 입력해 주세요.',
      })) ?? '') as string
      if (p.isCancel(appSecret)) return cancelled()

      // APP-ID(bsa_)와 Secret(bsp_)을 반대로 입력한 경우 경고 — 입력은 막지 않는다.
      warnIfCredentialsSwapped(appId, appSecret)

      tenantId = space
    }
  }

  // ─── 프로젝트명 결정 ───
  const projectName = `${space}-custom-templates-${phase}`

  const projectDir = resolve(process.cwd(), projectName)
  if (existsSync(projectDir)) {
    p.log.error(
      `${pc.red(projectDir)} 디렉토리가 이미 존재합니다. 해당 디렉토리를 정리한 뒤 다시 실행해 주세요.`,
    )
    p.outro(pc.red('중단되었습니다.'))
    process.exit(1)
  }

  const s = p.spinner()

  // ─── SDK 패키지 최신 버전 조회 ───
  s.start('SDK 최신 버전 조회 중...')
  let sdkVersions: {
    cli: string
    core: string
    react: string
    design: string
  }
  try {
    const [cli, core, react, design] = await Promise.all([
      fetchLatestVersion('@bstage-sdk/cli'),
      fetchLatestVersion('@bstage-sdk/core'),
      fetchLatestVersion('@bstage-sdk/react'),
      fetchLatestVersion('@bstage-sdk/design'),
    ])
    sdkVersions = { cli, core, react, design }
    s.stop(`SDK 버전 확정 — cli@${cli}, core@${core}, react@${react}, design@${design}`)
  } catch (err) {
    s.stop(pc.red('SDK 최신 버전 조회 실패'))
    p.log.error(
      (err instanceof Error ? err.message : String(err)) +
        `\n  ${pc.dim('네트워크 연결과 registry.npmjs.org 접근이 가능한지 확인해 주세요.')}`,
    )
    p.outro(pc.red('중단되었습니다.'))
    process.exit(1)
  }

  s.start('프로젝트 파일 생성 중...')

  // 디렉토리 구조 생성
  //
  // src/pages와 src/slots를 둘 다 만든다. 페이지는 폴더 경로가 곧 배포 경로이고,
  // 위젯은 slot 옵션이 자리를 정한다 — 어느 쪽인지가 위치로 드러나야 한다.
  const dirs = [
    '',
    'src',
    '.husky',
    'src/shared',
    `src/pages/${templateName}`,
    'src/slots',
    ...BSTAGE_SKILLS.map((s) => `.claude/skills/${s.name}`),
  ]
  for (const dir of dirs) {
    mkdirSync(join(projectDir, dir), { recursive: true })
  }

  // 파일 생성. 유저·어드민 스캐폴드가 같아졌고, 갈리는 건 template.tsx가 선언하는 target뿐이다.
  const envFiles: [string, string][] = [
    // .env(실제 값)는 커밋되지 않음(.gitignore). .env.example은 커밋되어 팀원 세팅 안내.
    [
      '.env',
      env({
        phase,
        appId: appId || 'YOUR_APP_ID',
        appSecret: appSecret || 'YOUR_APP_SECRET',
        tenantId: tenantId || 'YOUR_TENANT_ID',
      }),
    ],
    [
      '.env.example',
      env({
        phase,
        appId: 'YOUR_APP_ID',
        appSecret: 'YOUR_APP_SECRET',
        tenantId: 'YOUR_TENANT_ID',
      }),
    ],
  ]

  const files: [string, string][] = [
    ['AGENTS.md', agentsMd({ space, projectName, target })],
    ['CLAUDE.md', claudeMd()],
    ['README.md', readme({ projectName, packageManager })],
    ['package.json', packageJson({ projectName, target, sdkVersions })],
    ['tsconfig.json', tsconfig()],
    ['tsconfig.app.json', tsconfigApp()],
    ['tsconfig.node.json', tsconfigNode()],
    ['vite.config.ts', viteConfig()],
    ...envFiles,
    ['index.html', indexHtml()],
    // pnpm은 의존성 build script를 막고 그걸 에러로 낸다 → 허용 목록이 없으면 install이 실패한다.
    ...((packageManager === 'pnpm' ? [['pnpm-workspace.yaml', pnpmWorkspace()]] : []) as [
      string,
      string,
    ][]),
    ['.gitignore', gitignore()],
    ['.husky/pre-commit', huskyPreCommit()],
    ['.husky/check-secrets.mjs', checkSecretsScript()],
    ['eslint.config.js', eslintConfig()],
    ['src/main.tsx', mainTsx()],
    // 화면은 App.tsx가 갖는다 — main.tsx에 컴포넌트를 두면 export 없는 파일이 되어 lint가 막는다.
    ['src/App.tsx', appTsx({ hasApiKey: !!appId })],
    ['src/index.css', indexCss()],
    ['src/vite-env.d.ts', viteEnvDts()],
    ['src/shared/client.ts', clientTs()],
    [`src/pages/${templateName}/template.tsx`, templateTsx({ name: templateName })],
    // 빈 디렉토리는 git이 추적하지 않아 커밋하면 src/slots가 사라진다. 안내를 겸해 README를 둔다.
    ['src/slots/README.md', slotsReadme()],
    ...BSTAGE_SKILLS.map(
      (s) => [`.claude/skills/${s.name}/SKILL.md`, s.content(target)] as [string, string],
    ),
  ]

  for (const [filePath, content] of files) {
    writeFileSync(join(projectDir, filePath), content, 'utf-8')
  }

  s.stop('프로젝트 파일 생성 완료')

  // ─── git init ───
  s.start('Git 초기화 중...')
  try {
    execSync('git init', { cwd: projectDir, stdio: 'ignore' })
    execSync('git add -A', { cwd: projectDir, stdio: 'ignore' })
    execSync('git commit -m "init: bstage 템플릿 프로젝트 초기화"', {
      cwd: projectDir,
      stdio: 'ignore',
    })
    s.stop('Git 초기화 완료')
  } catch {
    s.stop(pc.yellow('Git 초기화 건너뜀 (git이 설치되지 않았을 수 있습니다)'))
  }

  // ─── 의존성 설치 ───
  s.start(`의존성 설치 중... (${packageManager} install)`)
  try {
    const installCmd = packageManager === 'pnpm' ? 'pnpm install' : 'npm install'
    execSync(installCmd, { cwd: projectDir, stdio: 'ignore', env: { ...process.env } })
    s.stop('의존성 설치 완료')
  } catch {
    s.stop(pc.yellow('의존성 설치 실패 — 직접 설치해 주세요'))
  }

  // ─── 완료 메시지 ───
  const runCmd = packageManager === 'pnpm' ? 'pnpm dev' : 'npm run dev'
  // 유저·어드민 개발 서버가 같아졌다 — 어드민만 서브도메인·별도 포트로 띄우던 셸이 없어졌다.
  const label = target === 'admin' ? '어드민 템플릿 프로젝트' : '프로젝트'
  p.outro(`${pc.green(`${label}가 생성되었습니다!`)}

  다음 단계:
  ${pc.cyan(`cd ${projectName}`)}
  ${pc.cyan(runCmd)}
  ${pc.dim('# 브라우저: http://localhost:5173')}`)
}

async function fetchLatestVersion(packageName: string): Promise<string> {
  const res = await fetch(`https://registry.npmjs.org/${packageName}`, {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) {
    throw new Error(`${packageName} 레지스트리 조회 실패 (HTTP ${res.status})`)
  }
  const data = (await res.json()) as { 'dist-tags'?: { latest?: string } }
  const latest = data['dist-tags']?.latest
  if (!latest) {
    throw new Error(`${packageName}의 latest 버전을 찾을 수 없습니다`)
  }
  return latest
}

function validateSlug(requiredMessage?: string) {
  return (v: string | undefined) => {
    if (!v?.trim()) return requiredMessage
    if (!/^[a-zA-Z][a-zA-Z0-9-]*$/.test(v.trim()))
      return '영문자로 시작해야 하며, 영문, 숫자, 하이픈만 사용할 수 있습니다.'
  }
}

/** Custom Element 스펙: 소문자로 시작 + 최소 1개 하이픈 + 소문자·숫자·하이픈만. */
const ELEMENT_NAME_RE = /^[a-z][a-z0-9-]*-[a-z0-9-]*$/

/**
 * 첫 템플릿 이름을 정한다. 명시값이 있으면 그대로, 없으면 space에서 파생한다.
 *
 * **space를 소문자로 내린다.** space 검증(`slugPattern`)은 대문자를 허용하는데 Custom Element
 * 스펙(`ELEMENT_NAME_RE`)은 소문자만 받는다. 내리지 않으면 `--space MySpace`가 파생 기본값
 * `MySpace-hello`에서 막혀, 사용자가 적지도 않은 `--template` 탓으로 보이는 오류가 난다.
 *
 * @internal 테스트용으로 노출. public API 아님.
 */
export function resolveTemplateName(space: string, option: string | undefined): string {
  return option ?? `${space.toLowerCase()}-hello`
}

function validateElementName(v: string | undefined): string | undefined {
  if (!v?.trim()) return '템플릿 이름은 필수입니다.'
  if (!ELEMENT_NAME_RE.test(v.trim())) {
    return 'Custom Element 스펙: 소문자 시작 + 하이픈 1개 이상 + 소문자/숫자/하이픈만.'
  }
}

/** 파트너 콘솔이 발급하는 인증 값의 접두사 규약. */
const APP_ID_PREFIX = 'bsa_'
const APP_SECRET_PREFIX = 'bsp_'

/**
 * APP-ID(`bsa_`)와 Secret(`bsp_`)을 서로 반대로 입력한 경우를 감지해 경고한다.
 * 명백한 swap(APP-ID가 `bsp_`로, Secret이 `bsa_`로 시작)만 검사하며, 입력을 막지는 않는다.
 * 정상 접두사·빈값은 조용히 통과한다.
 */
function warnIfCredentialsSwapped(appId: string, appSecret: string): void {
  if (!appId.startsWith(APP_SECRET_PREFIX) && !appSecret.startsWith(APP_ID_PREFIX)) return
  p.log.warn(
    `APP-ID와 Secret이 서로 바뀐 것 같습니다.\n` +
      `  APP-ID는 "${APP_ID_PREFIX}", Secret은 "${APP_SECRET_PREFIX}"로 시작합니다.\n` +
      `  파트너 콘솔에서 발급받은 값을 다시 확인해 주세요.`,
  )
}

function cancelled(): void {
  p.outro(pc.red('취소되었습니다.'))
  process.exit(0)
}
