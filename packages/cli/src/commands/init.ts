import * as p from '@clack/prompts'
import pc from 'picocolors'
import { existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { resolve } from 'node:path'

import { scaffoldSdk, writeScaffold, type Scaffold } from './init/scaffold.js'
import { scaffoldLiquid } from './init/scaffoldLiquid.js'
import { collectInitAnswers, type InitAnswers, type InitOptions } from './init/prompts.js'

export type { InitOptions } from './init/prompts.js'
// 기존 테스트·호출부가 이 경로에서 가져간다 — 구현은 프롬프트 모듈이 소유한다.
export { resolveTemplateName } from './init/prompts.js'

/** 로컬 미리보기 서버 기본 포트(`bstage dev`·vite 모두 같다). */
const DEV_PORT = 5173

export async function initCommand(options: InitOptions): Promise<void> {
  p.intro(`${pc.cyan(pc.bold('bstage init'))} ${pc.dim('— b.stage Template Project Setup')}`)

  // ─── 입력 수집 (옵션 또는 대화형 프롬프트) ───
  const answers = await collectInitAnswers(options)
  const { kind, space, packageManager, phase, target } = answers

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
  const scaffold = await buildScaffold(answers, projectName, s)

  s.start('프로젝트 파일 생성 중...')

  // 조립은 순수 함수가 하고 여기서는 쓰기만 한다 — 목록이 테스트로 고정된다
  // (scaffold.test.ts·scaffoldLiquid.test.ts). sdk 산출물에 .env(실제 API 키)가 들어가므로
  // 이 값을 로그에 찍지 않는다.
  try {
    writeScaffold(projectDir, scaffold)
  } catch (err) {
    // 메시지에 멈춘 경로가 들어 있다 — 부분 생성된 디렉터리를 어디부터 보면 되는지 알 수 있다.
    s.stop(pc.red('프로젝트 파일 생성 실패'))
    p.log.error(err instanceof Error ? err.message : String(err))
    p.outro(pc.red('중단되었습니다.'))
    process.exit(1)
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
  if (kind === 'liquid') {
    p.outro(`${pc.green('liquid 템플릿 프로젝트가 생성되었습니다!')}

  다음 단계:
  ${pc.cyan(`cd ${projectName}`)}
  ${pc.cyan(runCmd)}
  ${pc.dim(`# 브라우저: http://localhost:${DEV_PORT} — 템플릿 목록`)}
  ${pc.dim('# 배포 전에 포털에서 레포 연결·페이지 생성이 필요합니다 — bstage-onboarding 스킬 참조')}`)
    return
  }

  // 유저·어드민 개발 서버가 같아졌다 — 어드민만 서브도메인·별도 포트로 띄우던 셸이 없어졌다.
  const label = target === 'admin' ? '어드민 템플릿 프로젝트' : '프로젝트'
  p.outro(`${pc.green(`${label}가 생성되었습니다!`)}

  다음 단계:
  ${pc.cyan(`cd ${projectName}`)}
  ${pc.cyan(runCmd)}
  ${pc.dim(`# 브라우저: http://localhost:${DEV_PORT}`)}`)
}

type Spinner = ReturnType<typeof p.spinner>

/**
 * 최신 버전을 조회해 스캐폴드를 조립한다. **liquid는 cli 하나만 조회한다** — 의존하는 SDK
 * 패키지가 cli(저작 도구)뿐이라, core·react·design까지 조회하면 쓰지도 않는 버전 때문에
 * 실패할 수 있다.
 */
async function buildScaffold(
  answers: InitAnswers,
  projectName: string,
  s: Spinner,
): Promise<Scaffold> {
  const { kind, space, templateName, target, phase, packageManager, appId, appKey, tenantId } =
    answers

  if (kind === 'liquid') {
    s.start('cli 최신 버전 조회 중...')
    let cliVersion: string
    try {
      cliVersion = await fetchLatestVersion('@bstage-sdk/cli')
      s.stop(`cli 버전 확정 — cli@${cliVersion}`)
    } catch (err) {
      failVersionLookup(s, err, 'cli')
    }
    return scaffoldLiquid({ space, projectName, templateName, target, packageManager, cliVersion })
  }

  s.start('SDK 최신 버전 조회 중...')
  let sdkVersions: { cli: string; core: string; react: string; design: string }
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
    failVersionLookup(s, err)
  }
  return scaffoldSdk({
    space,
    projectName,
    templateName,
    target,
    phase,
    packageManager,
    appId,
    appKey,
    tenantId,
    sdkVersions,
  })
}

/** `label`은 실제로 조회한 대상이다 — liquid는 cli 하나만 물어보므로 SDK라고 적으면 거짓말이 된다. */
function failVersionLookup(s: Spinner, err: unknown, label = 'SDK'): never {
  s.stop(pc.red(`${label} 최신 버전 조회 실패`))
  p.log.error(
    (err instanceof Error ? err.message : String(err)) +
      `\n  ${pc.dim('네트워크 연결과 registry.npmjs.org 접근이 가능한지 확인해 주세요.')}`,
  )
  p.outro(pc.red('중단되었습니다.'))
  process.exit(1)
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
