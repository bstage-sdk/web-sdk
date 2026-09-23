import pc from 'picocolors'
import type { DoctorReport } from './report.js'

/** 버전 표. latest 조회를 건너뛴 경우(토큰 없음) 설치 버전만 보여준다. */
function printVersions(r: DoctorReport): void {
  console.log(pc.bold('📦 SDK 버전'))
  if (!r.latestChecked) {
    console.log(pc.dim('  레지스트리 조회를 건너뛰어 설치 버전만 표시합니다.'))
  }
  // 이름 길이가 패키지마다 달라(bstage-cli ~ bstage-design) 폭을 실제 최대값으로 잡는다.
  const nameWidth = Math.max(12, ...r.versions.map((v) => v.pkg.replace('@bstage-sdk/', '').length))
  for (const v of r.versions) {
    const name = v.pkg.replace('@bstage-sdk/', '').padEnd(nameWidth)
    const inst = v.installed ?? '?'
    if (v.latest && v.installed) {
      const arrow = v.outdated ? pc.yellow(`→  ${v.latest}  (뒤처짐)`) : pc.green('(최신)')
      console.log(`  ${name} ${inst.padEnd(8)} ${arrow}`)
    } else {
      console.log(`  ${name} ${inst}`)
    }
  }
  console.log('')
}

/**
 * init 기본 파일 (참고).
 *
 * 누락 = 문제가 아니다. 프로젝트가 같은 목적을 다르게 달성했을 수 있다
 * (예: tsconfig `types:["vite/client"]`가 vite-env.d.ts를 대체, eslint 미사용).
 * 따라서 "차이"로만 보고하고, 적용 여부 판단은 변환 단계(스킬/사람)에 맡긴다.
 */
function printFiles(r: DoctorReport): void {
  console.log(pc.bold('📁 init 기본 파일 (참고)'))
  const absent = r.files.filter((f) => !f.present)
  if (absent.length === 0) {
    console.log(pc.green('  ✓ init 기본 구성과 동일'))
  } else {
    console.log(pc.dim('  init 기본값과의 차이일 뿐 — 프로젝트가 다르게 처리 중이면 무시하세요.'))
    for (const f of r.files) {
      if (f.present) console.log(`  ${pc.green('✓')} ${f.path}`)
      else console.log(`  ${pc.dim('·')} ${f.path.padEnd(20)} ${pc.dim(`없음 (${f.note})`)}`)
    }
  }
  console.log('')
}

/**
 * 템플릿 디렉토리 구조.
 * 위 "init 기본 파일"과 달리 이건 참고가 아니다. 옛 구조만 남아 있으면 빌드가 아예 멈춘다.
 */
function printLayout(r: DoctorReport): void {
  console.log(pc.bold('🗂  템플릿 디렉토리'))
  if (r.layout.legacyPresent) {
    console.log(`  ${pc.yellow('→')} ${pc.yellow('src/templates/ 가 남아 있습니다 (옛 구조)')}`)
    console.log(pc.dim('      빌드 산출물 경로가 폴더 구조를 따라가도록 바뀌었습니다.'))
    console.log(pc.dim('      페이지 → src/pages/{경로}/  ·  위젯 → src/slots/{아무이름}/'))
    if (r.layout.legacyTemplates.length > 0) {
      console.log(pc.dim(`      옮겨야 할 템플릿: ${r.layout.legacyTemplates.join(', ')}`))
    }
    console.log(pc.dim('      변환: 에이전트에게 "bstage 마이그레이션" 요청'))
  } else if (!r.layout.pagesPresent && !r.layout.slotsPresent) {
    console.log(`  ${pc.dim('·')} src/pages/ · src/slots/ 둘 다 없음`)
  } else {
    console.log(pc.green('  ✓ src/pages/ · src/slots/ 구조'))
  }
  console.log('')
}

function printPnpmWorkspace(r: DoctorReport): void {
  if (!r.pnpmWorkspace.relevant) return
  console.log(pc.bold('📦 pnpm workspace 설정'))
  if (r.pnpmWorkspace.allowBuildsDeclared) {
    console.log(pc.green('  ✓ pnpm-workspace.yaml에 allowBuilds 선언됨'))
  } else {
    console.log(`  ${pc.yellow('→')} ${pc.yellow('pnpm-workspace.yaml에 allowBuilds 없음')}`)
    console.log(
      pc.dim('      pnpm은 의존성 build script를 기본 차단하고, pnpm 11은 그것을 에러로 낸다'),
    )
    console.log(
      pc.dim('      → `pnpm install`이 ERR_PNPM_IGNORED_BUILDS로 실패하고 `pnpm dev`도 죽는다'),
    )
    console.log(pc.dim('      추가: pnpm-workspace.yaml에 `allowBuilds:` + `esbuild: true`'))
    console.log(pc.dim('      또는 `pnpm approve-builds`로 대화식 선택'))
  }
  // 파일이 없으면 pnpm 9도 workspace로 인식하지 않아 이 항목은 문제가 되지 않는다.
  if (r.pnpmWorkspace.filePresent && !r.pnpmWorkspace.packagesDeclared) {
    console.log(`  ${pc.yellow('→')} ${pc.yellow('pnpm-workspace.yaml에 packages 없음')}`)
    console.log(pc.dim('      pnpm 9는 이 파일이 있으면 workspace 루트로 보고 packages를 요구한다'))
    console.log(pc.dim('      → pnpm 9에서 `ERROR packages field missing or empty`로 죽는다'))
    console.log(pc.dim("      추가: pnpm-workspace.yaml 맨 위에 `packages:` + `- '.'`"))
  } else if (r.pnpmWorkspace.packagesDeclared) {
    console.log(pc.green('  ✓ pnpm-workspace.yaml에 packages 선언됨'))
  }
  console.log('')
}

/** 스크립트 한 줄. 파일과 달리 "없으면 대체 수단이 있나"를 판단하기 어렵다. */
function printScriptRow(sc: DoctorReport['scripts'][number]): void {
  if (sc.actual === null) {
    console.log(`  ${pc.yellow('→')} ${sc.name} ${pc.yellow('없음')}`)
  } else {
    console.log(
      `  ${pc.yellow('→')} ${sc.name} ${pc.yellow('다름')} ${pc.dim(`— 현재 \`${sc.actual}\``)}`,
    )
    if (sc.actual.includes('--noEmit') && !sc.actual.includes('-p ')) {
      console.log(
        pc.dim(
          '      주의: solution-style tsconfig에서 `tsc --noEmit`은 아무 파일도 검사하지 않습니다.',
        ),
      )
    }
  }
  console.log(pc.dim(`      ${sc.why}`))
  console.log(pc.dim(`      권장: "${sc.name}": "${sc.expected}"`))
}

function printScripts(r: DoctorReport): void {
  console.log(pc.bold('🛠  package.json 스크립트'))
  const scriptIssues = r.scripts.filter((sc) => sc.actual !== sc.expected)
  if (scriptIssues.length === 0) {
    console.log(pc.green('  ✓ init 기본 구성과 동일'))
  } else {
    for (const sc of r.scripts) {
      if (sc.actual === sc.expected) {
        console.log(`  ${pc.green('✓')} ${sc.name}`)
        continue
      }
      printScriptRow(sc)
    }
  }
  console.log('')
}

/**
 * liquid 검증 — `bstage build`와 같은 결과를 doctor에서도 보여준다.
 *
 * liquid 레포에는 빌드 산출물이 없어 "빌드가 통과했다"는 신호가 없다. 진단에서 같이 보여주지
 * 않으면 문법 오류가 push될 때까지 아무 데서도 드러나지 않는다.
 */
function printLiquid(r: DoctorReport): void {
  if (r.liquid === null) return
  console.log(pc.bold('💧 liquid 검증'))
  const errors = r.liquid.issues.filter((i) => i.level === 'error')
  const warns = r.liquid.issues.filter((i) => i.level === 'warn')
  if (errors.length === 0 && warns.length === 0) {
    console.log(pc.green('  ✓ 규약·문법 이상 없음'))
  }
  for (const i of errors) console.log(`  ${pc.red('✗')} ${i.path}  ${pc.red(i.message)}`)
  for (const i of warns) console.log(`  ${pc.yellow('⚠')} ${i.path}  ${pc.dim(i.message)}`)
  if (errors.length > 0) {
    console.log(
      pc.dim('      고친 뒤 `bstage build`로 다시 확인하세요 — 포털 빌드도 같은 검사를 합니다.'),
    )
  }
  console.log('')
}

/** 버전이 전부 최신이어도 "아직 안 넣은 의존성"은 마이그레이션 항목으로 안 잡힌다(항목은 버전 대조). */
function printRecommendedDeps(r: DoctorReport): void {
  // 표가 비어 있으면(liquid) 절 자체를 내지 않는다 — "모두 선언됨"은 거짓 안심이다.
  if (r.recommendedDeps.length === 0) return
  console.log(pc.bold('🧱 권장 의존성'))
  if (r.recommendedDeps.every((d) => d.declared)) {
    console.log(pc.green('  ✓ 모두 선언됨'))
  } else {
    for (const d of r.recommendedDeps) {
      if (d.declared) {
        console.log(`  ${pc.green('✓')} ${d.pkg}`)
        continue
      }
      console.log(`  ${pc.yellow('→')} ${d.pkg} ${pc.yellow('미선언')} ${pc.dim(`— ${d.note}`)}`)
      console.log(pc.dim(`      ${d.why}`))
      console.log(pc.dim(`      추가: npm i ${d.pkg} (프로젝트 패키지 매니저로)`))
    }
  }
  console.log('')
}

function printMigrations(r: DoctorReport): void {
  console.log(pc.bold('📖 적용 가능한 마이그레이션'))
  if (r.migrations.length === 0) {
    console.log(pc.dim('  해당 항목 없음.'))
  } else {
    for (const m of r.migrations) {
      console.log(`  ${pc.cyan(`→ ${m.label}`)}`)
      for (const item of m.items) console.log(`    • ${item}`)
    }
  }
  console.log('')
}

function printAgentsMd(r: DoctorReport): void {
  console.log(pc.bold('📝 AGENTS.md'))
  switch (r.agentsMd.status) {
    case 'ok':
      console.log(pc.green('  ✓ 관리 영역 최신'))
      break
    case 'missing':
      console.log(pc.dim('  · 파일 없음 — bstage 프로젝트라면 init/마이그레이션으로 생성하세요.'))
      break
    case 'stale':
      console.log(
        pc.yellow('  → 관리 영역이 오래됨') +
          pc.dim(' — `bstage ai update`로 갱신(자유 영역은 보존).'),
      )
      break
    case 'legacy':
      console.log(
        pc.yellow('  → 레거시 포맷(관리 영역 마커 없음)') +
          pc.dim(
            ' — `bstage ai install`로 스킬을 먼저 설치한 뒤, `bstage-migrate` 스킬로 reconcile(SDK 영역 교체 + 사용자 내용 보존).',
          ),
      )
      break
  }
  console.log('')
}

function printSkills(r: DoctorReport): void {
  console.log(pc.bold('🧩 에이전트 스킬 (.claude/skills/)'))
  const skillsNeedWork = r.skills.filter((s) => s.status !== 'ok')
  if (r.skillsSkipped) {
    console.log(
      pc.yellow('  ! sdk와 liquid가 섞여 있어 스킬 검사를 건너뜁니다 — 하나만 남겨 주세요.'),
    )
  } else if (skillsNeedWork.length === 0) {
    console.log(pc.green('  ✓ 모든 스킬 최신'))
  } else {
    for (const s of r.skills) {
      if (s.status === 'ok') console.log(`  ${pc.green('✓')} ${s.name}`)
      else if (s.status === 'missing')
        console.log(`  ${pc.yellow('→')} ${s.name.padEnd(16)} ${pc.yellow('미설치')}`)
      else console.log(`  ${pc.yellow('→')} ${s.name.padEnd(16)} ${pc.yellow('구버전/수정됨')}`)
    }
    console.log(
      pc.dim(
        '  아래에서 자동 동기화합니다 — bstage-* 스킬만 덮어쓰며, 그 외 사용자 스킬은 건드리지 않습니다.',
      ),
    )
  }
  console.log('')
}

/**
 * 다음 단계.
 *
 * 실제 작업 신호는 버전 드리프트·마이그레이션 항목·AGENTS.md 관리 영역 드리프트.
 * init 기본 파일 차이는 참고일 뿐이고, 스킬 드리프트는 리포트 직후 자동 동기화되므로
 * 사용자 작업 신호에 넣지 않는다.
 */
function printNextSteps(r: DoctorReport): void {
  const agentsNeedsWork = r.agentsMd.status === 'legacy' || r.agentsMd.status === 'stale'
  // liquid 검증 error는 배포를 막는 문제다 — "최신 상태입니다"로 덮으면 안 된다.
  const liquidBroken = (r.liquid?.issues ?? []).some((i) => i.level === 'error')
  const hasWork =
    r.versions.some((v) => v.outdated) || r.migrations.length > 0 || agentsNeedsWork || liquidBroken
  if (liquidBroken) {
    console.log(
      pc.yellow('위 liquid 검증 오류를 먼저 고치세요 — 그대로 push하면 포털 빌드가 막힙니다.'),
    )
  }
  if (hasWork) {
    console.log(
      pc.dim(
        '다음 단계: 마이그레이션 스킬을 실행해 위 항목을 프로젝트에 맞춰 적용하세요.\n' +
          '  상세 가이드: SDK 문서의 MIGRATION.md (위 항목별 적용 절차)',
      ),
    )
  } else {
    console.log(pc.green('✓ 최신 상태입니다. 마이그레이션이 필요 없습니다.'))
    if (r.files.some((f) => !f.present)) {
      console.log(pc.dim('  (위 init 기본 파일 차이는 선택 사항입니다.)'))
    }
    if (r.recommendedDeps.some((d) => !d.declared)) {
      console.log(pc.dim('  (위 권장 의존성은 버전과 무관합니다 — 쓸 거면 따로 추가하세요.)'))
    }
  }
  console.log('')
}

/** 진단 리포트를 사람이 읽는 텍스트로 출력한다. */
export function printReport(r: DoctorReport): void {
  console.log('')
  console.log(`${pc.cyan(pc.bold('bstage doctor'))} ${pc.dim(`— ${r.project ?? '(이름 없음)'}`)}`)
  console.log('')

  if (!r.isBstageProject) {
    console.log(pc.yellow('이 디렉토리는 bstage 템플릿 프로젝트가 아닌 것 같습니다.'))
    console.log(pc.dim('  package.json에 @bstage-sdk/* 의존성이 없습니다.'))
    return
  }

  printVersions(r)
  printFiles(r)
  // 템플릿 디렉토리(src/pages·src/slots)는 sdk 레포의 개념이다. liquid 레포에는 그 자리에
  // 검증 결과를 놓는다 — 둘 다 "배포 전에 막아야 할 구조 문제"를 보는 절이다.
  if (r.liquid === null) printLayout(r)
  else printLiquid(r)
  printPnpmWorkspace(r)
  printScripts(r)
  printRecommendedDeps(r)
  printMigrations(r)
  printAgentsMd(r)
  printSkills(r)
  printNextSteps(r)
}
