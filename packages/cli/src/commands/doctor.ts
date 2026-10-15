import { ExitCode, printJson } from '../portal/output.js'
import { diagnosePortal, portalNeedsWork } from './doctor/portal.js'
import { diagnose, type DoctorReport } from './doctor/report.js'
import { printReport } from './doctor/render.js'
import { autoSyncSkills } from './doctor/skills.js'

export interface DoctorOptions {
  json?: boolean
  /** 포털 진단 대상을 배치 하나로 좁힌다(id·경로·슬롯 id 정확 일치 — deploy와 같은 매칭). */
  placement?: string
}

/** 테스트용 주입점 — 포털 진단의 링크·자격증명·네트워크. */
export interface DoctorDeps {
  cwd?: string
  env?: NodeJS.ProcessEnv
  fetch?: typeof fetch
}

/**
 * `bstage doctor` — 마이그레이션 감지(결정론). 진단 자체는 파일을 일절 수정하지 않는다.
 *
 * 1) 버전 드리프트: 설치 버전 vs 레지스트리 latest
 * 2) 보일러플레이트 누락: 현재 init 산출 파일의 존재 여부
 * 3) 권장 의존성 미선언: 버전 대조로는 안 잡히는 축(예: `bstage-design`을 아직 안 넣은 프로젝트)
 * 4) 적용 가능한 마이그레이션: CLI 동봉 MIGRATION.md에서 항목이 명시한 패키지의 설치 버전보다 높은 섹션 추출
 * 5) SDK 소유 자산 드리프트: AGENTS.md 관리 영역 + 에이전트 스킬(.claude/skills/) 설치·동기화 상태
 * 6) 포털 배치 진단: 로그인·링크돼 있으면 이 레포 배치마다 포털이 판정한 문제(`doctor/portal.ts`)
 *
 * 종료 코드: 포털 진단에 error 심각도 항목이 있거나 진단 자체가 실패했으면(status `error`) 1,
 * 아니면 0(로컬 진단 결과·건너뜀·서버 미지원은 영향 없음).
 * `--placement`를 줬는데 링크·토큰이 없으면 2·3(runCommand가 처리).
 *
 * 실제 변환(코드 수정)은 마이그레이션 스킬/사람의 몫이다. 예외로 스킬 드리프트는
 * 판단이 필요 없는 결정론적 동기화(SDK 소유 자산 덮어쓰기, 사용자 파일 무접촉)이므로
 * 발견 즉시 `ai install`을 실행해 치유한다. `--json`은 순수 리포트 계약이라 제외.
 *
 * 구현은 `doctor/` 아래로 나뉘어 있다 — `report.ts`(타입·진단) · `render.ts`(출력) ·
 * `migrations.ts`(MIGRATION.md 파서) · `checks.ts`(파일·스크립트·의존성·pnpm) ·
 * `skills.ts`(스킬·AGENTS.md) · `portal.ts`·`renderPortal.ts`(포털 진단).
 */
export async function doctorCommand(options: DoctorOptions, deps: DoctorDeps = {}): Promise<void> {
  const root = deps.cwd ?? process.cwd()
  const [local, portal] = await Promise.all([
    diagnose(root),
    diagnosePortal(
      { placement: options.placement },
      { cwd: root, env: deps.env, fetch: deps.fetch },
    ),
  ])
  const report: DoctorReport = { ...local, portal }
  // process.exit 대신 exitCode — 아래 스킬 자동 동기화까지 마친 뒤 1로 끝나게 한다.
  if (portalNeedsWork(portal)) process.exitCode = ExitCode.FAILURE

  if (options.json) {
    printJson(report)
    return
  }

  printReport(report)
  await autoSyncSkills(root, report)
}
