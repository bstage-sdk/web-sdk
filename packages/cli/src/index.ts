import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Command } from 'commander'
import { buildCommand } from './commands/build.js'
import { devCommand } from './commands/dev.js'
import { initCommand } from './commands/init.js'
import { i18nPullCommand } from './commands/i18n.js'
import { doctorCommand } from './commands/doctor.js'
import { skillsInstallCommand } from './commands/skills.js'
import { docsCommand } from './commands/docs.js'

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
  // 기본값을 두지 않는다 — 미지정 시 init이 `{space}-hello`로 파생한다(resolveTemplateName).
  // 여기에 'hello'를 두면 하이픈이 없어 Custom Element 검증에 걸려 `--yes`가 항상 실패했다.
  .option('--template <template>', '첫 번째 템플릿 이름 (기본: {space}-hello)')
  .option('--phase <phase>', '배포 환경 (dev, qa, real, sandbox)', 'sandbox')
  .option('--pm <pm>', '패키지 매니저 (npm, pnpm)', 'npm')
  .action(initCommand)

program
  .command('build')
  .description('템플릿을 IIFE 번들로 빌드 (페이지는 경로별, 위젯은 슬롯별 디렉토리)')
  .action(buildCommand)

program.command('docs').description('설치된 SDK 문서 목록·경로 출력').action(docsCommand)

program
  .command('doctor')
  .description('SDK 버전·보일러플레이트 드리프트 진단 (감지만, 파일 수정 없음)')
  .option('--json', '구조화 출력 (스킬·CI용)')
  .action(doctorCommand)

program
  .command('dev')
  .description('인증 프록시 포함 로컬 개발 서버 실행')
  .option('-p, --port <port>', 'Dev server port', '5173')
  .option(
    '--phase <phase>',
    'Target phase (dev, qa, real, sandbox). 생략 시 .env의 VITE_BSTAGE_PHASE, 그것도 없으면 sandbox',
  )
  .action(devCommand)

const skills = program.command('skills').description('에이전트용 스킬 유틸')
skills
  .command('install')
  .description('에이전트용 스킬을 .claude/skills/에 설치·동기화 (기존 프로젝트용)')
  .option('--dir <dir>', '설치 위치', '.claude/skills')
  .action(skillsInstallCommand)

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

program.addHelpText(
  'after',
  `
예시:
  $ bstage init                  새 템플릿 프로젝트 생성
  $ bstage dev                   로컬 개발 서버 (인증 프록시)
  $ bstage build                 IIFE 번들 빌드 (dist/{경로} · dist/{슬롯})
  $ bstage doctor                SDK 버전·드리프트 진단
  $ bstage skills install        에이전트 스킬 설치/동기화
  $ bstage i18n pull             플랫폼 번역 받기 + 타입 생성

문서:
  $ bstage docs                  설치된 SDK 문서 목록·경로
  커맨드별 상세는 \`bstage <command> --help\``,
)

program.parse()
