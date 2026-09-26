import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Command } from 'commander'
import { aiDoctorCommand, aiInstallCommand, aiUpdateCommand } from './commands/ai.js'
import { buildCommand, type BuildOptions } from './commands/build.js'
import { deployCommand } from './commands/deploy.js'
import { devCommand } from './commands/dev.js'
import { initCommand } from './commands/init.js'
import { i18nPullCommand } from './commands/i18n.js'
import { doctorCommand } from './commands/doctor.js'
import { linkCommand } from './commands/link.js'
import { listCommand } from './commands/list.js'
import { logsCommand } from './commands/logs.js'
import { loginCommand } from './commands/login.js'
import { logoutCommand } from './commands/logout.js'
import { publishCommand } from './commands/publish.js'
import { rollbackCommand } from './commands/rollback.js'
import { skillsInstallCommand } from './commands/skills.js'
import { docsCommand } from './commands/docs.js'
import { whoamiCommand } from './commands/whoami.js'
import { runCommand } from './portal/output.js'

/** 빌드 산출물 옆 package.json에서 버전을 읽는다. 하드코딩 금지(릴리즈마다 자동 반영). */
function readVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    return JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf-8')).version || '0.0.0'
  } catch {
    return '0.0.0'
  }
}

const program = new Command()
  .name('bstage')
  .description('b.stage 서드파티 템플릿 SDK CLI — 템플릿 개발·빌드·로컬 서버·마이그레이션')
  .version(readVersion(), '-v, --version', '버전 출력')

program
  .command('init')
  .description('새 bstage 템플릿 프로젝트 생성')
  .option('-y, --yes', '기본값으로 비인터랙티브 실행')
  .option('--space <space>', 'Space 이름')
  .option('--target <target>', '스캐폴드 대상 (user, admin)', 'user')
  .option('--kind <kind>', '프로젝트 종류 (sdk: React 컴포넌트, liquid: liquid 템플릿)', 'sdk')
  // 기본값을 두지 않는다 — 미지정 시 init이 파생한다(sdk는 `{space}-hello`, liquid는 `hello`).
  // 여기에 'hello'를 두면 하이픈이 없어 Custom Element 검증에 걸려 sdk `--yes`가 항상 실패했다.
  .option('--template <template>', '첫 번째 템플릿 이름 (기본: sdk {space}-hello, liquid hello)')
  .option('--phase <phase>', '배포 환경 (dev, qa, real, sandbox)', 'sandbox')
  .option('--pm <pm>', '패키지 매니저 (npm, pnpm)', 'npm')
  .action(initCommand)

program
  .command('build')
  .description(
    '템플릿을 IIFE 번들로 빌드 (페이지는 경로별, 위젯은 슬롯별 디렉토리) — liquid 레포는 검증만',
  )
  .option('--json', '검증 결과를 JSON으로 출력 (liquid 레포 전용)')
  // options만 넘긴다 — commander는 2번째 인자로 Command를 주는데 buildCommand의 deps 자리다.
  .action((options: BuildOptions) => buildCommand(options))

program.command('docs').description('설치된 SDK 문서 목록·경로 출력').action(docsCommand)

program
  .command('doctor')
  .description(
    'SDK 버전·보일러플레이트 드리프트 진단 (진단 + SDK 소유 스킬 자동 동기화; package.json·훅은 건드리지 않음)',
  )
  .option('--json', '구조화 출력 (스킬·CI용)')
  .action(doctorCommand)

program
  .command('dev')
  .description('인증 프록시 포함 로컬 개발 서버 (liquid 레포는 liquidjs 프리뷰)')
  .option('-p, --port <port>', 'Dev server port', '5173')
  .option(
    '--phase <phase>',
    'Target phase (dev, qa, real, sandbox). 생략 시 .env의 VITE_BSTAGE_PHASE, 그것도 없으면 sandbox',
  )
  .action((o) => runCommand(() => devCommand(o)))

const ai = program.command('ai').description('에이전트용 스킬·AGENTS.md 설치·동기화·진단')
ai.command('install')
  .description('스킬(.claude/skills)·AGENTS.md·CLAUDE.md 설치 및 최신화 + pre-commit 시크릿 가드')
  .option('--dir <dir>', '스킬 디렉터리', '.claude/skills')
  .option('--kind <kind>', '프로젝트 종류(sdk|liquid) — 자동 판정이 안 될 때')
  .action((o) => runCommand(() => aiInstallCommand(o)))
ai.command('update')
  .description('설치된 스킬·AGENTS.md만 최신화(없는 파일은 만들지 않음)')
  .option('--dir <dir>', '스킬 디렉터리', '.claude/skills')
  .option('--kind <kind>', '프로젝트 종류(sdk|liquid) — 자동 판정이 안 될 때')
  .action((o) => runCommand(() => aiUpdateCommand(o)))
ai.command('doctor')
  .description('스킬·AGENTS.md 최신 여부 진단(파일 수정 없음)')
  .option('--dir <dir>', '스킬 디렉터리', '.claude/skills')
  .option('--kind <kind>', '프로젝트 종류(sdk|liquid) — 자동 판정이 안 될 때')
  .option('--json', 'JSON 출력')
  .action((o) => runCommand(() => aiDoctorCommand(o)))

const skills = program.command('skills').description('에이전트용 스킬 유틸')
skills
  .command('install')
  .description(
    '(deprecated → bstage ai install) 에이전트용 스킬을 .claude/skills/에 설치·동기화 (기존 프로젝트용)',
  )
  .option('--dir <dir>', '설치 위치', '.claude/skills')
  .action((o) => runCommand(() => skillsInstallCommand(o)))

const i18n = program.command('i18n').description('다국어(번역) 유틸')
i18n
  .command('pull')
  .description('플랫폼 번역 사전을 CDN에서 받아 타입 생성 + 로컬 캐시')
  .option('--phase <phase>', '대상 phase (real, qa, dev)', 'real')
  .option('--target <target>', '번역 시스템 (user, admin)', 'user')
  .option('--tier <tier>', '번역 tier (inhouse, mnetplus, hiand)', 'inhouse')
  .option('--ref <locale>', '타입 원문 기준 로케일', 'ko')
  .option('--out <file>', '생성 타입 파일 경로', 'src/bstage-i18n.ts')
  .action(i18nPullCommand)

program
  .command('login')
  .description('포털 CLI 토큰 등록 (포털 설정 > CLI 토큰에서 발급)')
  .option(
    '--phase <phase>',
    '포털 환경 (real, sandbox, dev, qa). 생략 시 .env의 VITE_BSTAGE_PHASE, 그것도 없으면 sandbox',
  )
  .option(
    '--portal <url>',
    '포털 주소 직접 지정 (phase 매핑보다 우선, BSTAGE_PORTAL_URL). 링크 파일·.env 의 주소는 허용 목록 안일 때만 쓰이므로 목록 밖 포털은 이 옵션으로 지정한다',
  )
  .option(
    '--token <token>',
    '붙여 넣기 경로 — CI용 (BSTAGE_TOKEN). 생략 시 브라우저 승인(디바이스 코드)',
  )
  .option('--org <id>', '붙여 넣은 토큰의 조직 (BSTAGE_ORG). 디바이스 승인 경로에서는 불필요')
  .option('--no-browser', '브라우저를 열지 않고 코드·주소만 출력')
  .option('--json', '구조화 출력')
  .action((o) =>
    runCommand(() =>
      loginCommand({ ...o, noBrowser: o.browser === false }, { cliVersion: readVersion() }),
    ),
  )

program
  .command('logout')
  .description('저장된 포털 자격증명 삭제 (기본: 그 포털의 모든 조직)')
  .option('--phase <phase>', '포털 환경')
  .option('--portal <url>', '포털 주소 직접 지정 (허용 목록 밖 포털은 이 옵션으로)')
  .option('--org <id>', '이 조직 토큰만 삭제')
  .action((o) => runCommand(() => logoutCommand(o)))

program
  .command('link')
  .description('이 디렉터리를 포털 조직·스테이지·레포에 연결 (.bstage/project.json)')
  .option('--phase <phase>', '포털 환경 (생략 시 .env의 VITE_BSTAGE_PHASE → sandbox)')
  .option('--portal <url>', '포털 주소 직접 지정 (허용 목록 밖 포털은 이 옵션으로)')
  .option('--org <id>', '조직 ID')
  .option('--space <id>', '스테이지(스페이스) ID')
  .option('--repo <id|owner/repo>', '연결 레포')
  .option('-y, --yes', '프롬프트 없이 (후보가 유일하거나 옵션으로 지정돼야 함)')
  .option('--json', '구조화 출력 (--yes 와 함께)')
  .action((o) => runCommand(() => linkCommand(o)))

program
  .command('list')
  .alias('ls')
  .description('이 레포의 배치(라이브 버전·게시 상태)와 최근 빌드')
  .option('--builds <n>', '표시할 빌드 수', '5')
  .option('--json', '구조화 출력')
  .action((o) => runCommand(() => listCommand(o)))

program
  .command('deploy')
  .description('push된 커밋을 포털에서 빌드하고 이 레포의 배치에 라이브 적용')
  .option('-y, --yes', '확인 없이 적용')
  .option('--placement <id|path|slotId>', '특정 배치만')
  .option('--skip-git-check', '더티 트리·브랜치·push 점검 생략')
  .option('--no-wait', '빌드만 시작하고 종료')
  .option('--json', '구조화 출력 (--yes 와 함께)')
  .action((o) => runCommand(() => deployCommand({ ...o, noWait: o.wait === false })))

program
  .command('rollback [buildId]')
  .description('이전 성공 빌드(또는 지정한 빌드)를 라이브로 재적용')
  .option('-y, --yes', '확인 없이 적용')
  .option('--placement <id|path|slotId>', '특정 배치만')
  .option('--json', '구조화 출력 (--yes 와 함께)')
  .action((id, o) => runCommand(() => rollbackCommand(id, o)))

program
  .command('publish <on|off>')
  .description('배치 게시 켜기/끄기 (라이브 버전은 유지)')
  .option('--placement <id|path|slotId>', '특정 배치만')
  .option('-y, --yes', '확인 없이')
  .option('--json', '구조화 출력 (--yes 와 함께)')
  .action((state, o) => runCommand(() => publishCommand(state, o)))

program
  .command('logs [buildId]')
  .description('빌드 로그 (생략 시 최근 빌드)')
  .option('-f, --follow', '진행 중이면 끝날 때까지 이어서 출력')
  .option('--json', '구조화 출력')
  .action((id, o) => runCommand(() => logsCommand(id, o)))

program
  .command('whoami')
  .description('현재 로그인 사용자·조직·스테이지 역할과 저장된 조직별 토큰')
  .option('--phase <phase>', '포털 환경')
  .option('--portal <url>', '포털 주소 직접 지정 (허용 목록 밖 포털은 이 옵션으로)')
  .option('--org <id>', '이 조직 토큰으로 조회 (BSTAGE_ORG)')
  .option('--json', '구조화 출력')
  .action((o) => runCommand(() => whoamiCommand(o)))

program.addHelpText(
  'after',
  `
예시:
  $ bstage init                  새 템플릿 프로젝트 생성
  $ bstage dev                   로컬 개발 서버 (인증 프록시 · liquid 레포는 liquidjs 프리뷰)
  $ bstage build                 IIFE 번들 빌드 (dist/{경로} · dist/{슬롯})
  $ bstage doctor                SDK 버전·드리프트 진단
  $ bstage ai install            에이전트 스킬·AGENTS.md 설치/최신화 (+ 시크릿 가드)
  $ bstage ai doctor             에이전트 자산 최신 여부 진단
  $ bstage i18n pull             플랫폼 번역 받기 + 타입 생성
  $ bstage login                  브라우저에서 승인해 로그인 (CI: --token 또는 BSTAGE_TOKEN)
  $ bstage link                   디렉터리를 포털 조직·스테이지·레포에 연결
  $ bstage list                   이 레포의 배치·최근 빌드 확인
  $ bstage deploy                 push된 커밋을 빌드해 이 레포의 배치에 라이브 적용
  $ bstage rollback                이전 성공 빌드로 라이브를 되돌림
  $ bstage publish off             게시 끄기 (라이브 버전 유지)
  $ bstage logs -f                최근 빌드 로그를 끝날 때까지 이어서 출력
  $ bstage whoami                 현재 로그인 사용자 확인
  $ bstage logout                 저장된 자격증명 삭제

종료 코드: 0 성공 · 1 실패 · 2 사전조건 · 3 인증 · 4 충돌 · 5 요청 제한

문서:
  $ bstage docs                  설치된 SDK 문서 목록·경로
  커맨드별 상세는 \`bstage <command> --help\``,
)

program.parse()
