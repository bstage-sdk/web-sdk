import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import pc from 'picocolors'
import { ExitCode } from '../portal/output.js'

/**
 * 문서별 한 줄 설명. 읽기 순서이기도 하다(여기 등록된 순서대로 표시).
 * 실제 표시는 설치된 docs 디렉토리에 존재하는 파일만 — 목록과 배포물이 어긋나도
 * 빈 항목을 만들지 않는다. 미등록 .md는 뒤에 이름만 덧붙인다.
 */
const DOC_ORDER: [string, string][] = [
  ['GETTING_STARTED.md', '빠른 시작 가이드'],
  ['API_REFERENCE.md', 'createTemplate, hooks, BstageClient, PlatformBridge API'],
  ['I18N.md', '다국어 훅 + bstage i18n pull (번역 코드젠) 워크플로'],
  ['DESIGN_TOKENS.md', '디자인 토큰 (색·타이포·그림자) 사용 가이드 (user/admin)'],
  ['SLOT_PROTOCOL.md', '슬롯 시스템 v1 프로토콜 (3-part 키·context 단방향)'],
  ['SLOT_CATALOG_V2.md', 'v2 슬롯 카탈로그 (키·anchor·context 계약)'],
  ['SLOT_CATALOG.md', '슬롯 목록, 이벤트 인터페이스, resourceId 의미'],
  ['SLOT_SYSTEM.md', '슬롯 시스템 설계, 런타임 흐름'],
  ['BUILD_SYSTEM.md', '빌드 파이프라인, 산출물 경로 규칙'],
  ['DEV_SERVER.md', '로컬 개발 서버, 인증 프록시'],
  ['INIT.md', 'bstage init 명령 상세'],
  ['MIGRATION.md', '버전 사이 마이그레이션 가이드 (bstage doctor 연계)'],
  ['SDK_ARCHITECTURE.md', '패키지 구조, 설계 결정'],
]

/**
 * core 패키지에 동봉된 docs 의 위치(cwd 기준). 테스트가 같은 경로를 만들어야 하므로 내보낸다 —
 * 문자열을 양쪽에 적어 두면 공개 스냅샷이 소스만 치환하고 테스트는 내부 이름을 든 채 남는다.
 */
export const CORE_DOCS_SEGMENTS = ['node_modules', '@bstage-sdk', 'core', 'docs'] as const

/**
 * `bstage docs` — 설치된 SDK 문서 목록과 경로를 출력한다.
 * "이 SDK로 뭘 할 수 있나"의 단일 진입점. docs는 core 패키지에 동봉되어 배포된다.
 */
export async function docsCommand(): Promise<void> {
  const docsDir = join(process.cwd(), ...CORE_DOCS_SEGMENTS)

  if (!existsSync(docsDir)) {
    // 사전조건 미충족(2)으로 끝낸다 — 스킬이 "종료 코드로 갈래를 잡으라"고 안내하므로 0으로 끝내면
    // 에이전트가 문서를 읽은 것으로 착각하고 다음 단계로 넘어간다. 스캐폴드로 만든 프로젝트는
    // cli가 core를 함께 끌어와 이 경로가 있지만, `.liquid` 파일만 둔 레포처럼 SDK 의존이 없는
    // 곳에서는 없다.
    console.log(pc.yellow('SDK 문서를 찾을 수 없습니다.'))
    console.log(pc.dim('  @bstage-sdk/core가 설치되어 있는지 확인하세요 (npm install 후 재시도).'))
    console.log(
      pc.dim(
        '  SDK 의존이 없는 레포에는 이 경로가 없습니다 — liquid 규약·데이터는 bstage-liquid 스킬을 보세요.',
      ),
    )
    process.exitCode = ExitCode.PRECONDITION
    return
  }

  const present = new Set(readdirSync(docsDir).filter((f) => f.endsWith('.md')))
  const ordered = DOC_ORDER.filter(([f]) => present.has(f))
  // 등록되지 않은 .md(README 등)도 빠짐없이 뒤에 노출
  const known = new Set(DOC_ORDER.map(([f]) => f))
  const extras = [...present].filter((f) => !known.has(f)).sort()

  console.log('')
  console.log(pc.bold('bstage SDK 문서'))
  console.log(pc.dim(`  ${docsDir}`))
  console.log('')
  for (const [file, desc] of ordered) {
    console.log(`  ${pc.cyan(file.padEnd(22))} ${pc.dim(desc)}`)
  }
  for (const file of extras) {
    console.log(`  ${pc.cyan(file.padEnd(22))}`)
  }
  console.log('')
  console.log(
    pc.dim('파일을 열어 상세 내용을 확인하세요. 커맨드 도움말은 `bstage <command> --help`.'),
  )
  console.log('')
}
