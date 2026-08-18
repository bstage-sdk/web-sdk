import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import pc from 'picocolors'

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
 * `bstage docs` — 설치된 SDK 문서 목록과 경로를 출력한다.
 * "이 SDK로 뭘 할 수 있나"의 단일 진입점. docs는 core 패키지에 동봉되어 배포된다.
 */
export async function docsCommand(): Promise<void> {
  const docsDir = join(process.cwd(), 'node_modules', '@bstage-sdk', 'core', 'docs')

  if (!existsSync(docsDir)) {
    console.log(pc.yellow('SDK 문서를 찾을 수 없습니다.'))
    console.log(pc.dim('  @bstage-sdk/core가 설치되어 있는지 확인하세요 (npm install 후 재시도).'))
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
