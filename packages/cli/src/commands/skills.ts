import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import pc from 'picocolors'
import { BSTAGE_SKILLS } from '../templates/skills.js'
import { renderManagedBlock } from '../templates/agentsMd.js'
import type { DesignTarget } from '../templates/designGuide.js'
import { resolveProjectTarget } from '../constants.js'
import { huskyPreCommit } from '../templates/huskyPreCommit.js'
import { checkSecretsScript } from '../templates/checkSecretsScript.js'
import {
  agentsMdStatus,
  parseAgentsIdentity,
  swapManagedBlock,
} from '../templates/agentsMdRegion.js'

export interface SkillsInstallOptions {
  dir: string
}

/**
 * `bstage skills install` — 에이전트용 스킬을 현재 프로젝트의 `.claude/skills/`에 설치한다.
 *
 * - 새 프로젝트는 `bstage init`이 이미 스캐폴드하지만, 기존 프로젝트는 이 명령으로 받는다.
 * - SDK 버전업 후 다시 실행하면 최신 스킬로 동기화된다(덮어쓰기).
 * - 스킬 목록은 `templates/skills.ts` 레지스트리가 단일 소스.
 */
export async function skillsInstallCommand(options: SkillsInstallOptions): Promise<void> {
  const root = process.cwd()
  const baseDir = options.dir || '.claude/skills'

  // 디자인 가이드 타깃: package.json의 bstage.target
  const target: DesignTarget = resolveProjectTarget(root)

  console.log(pc.cyan(`[bstage] 스킬 설치: ${baseDir}/`) + pc.dim(` (디자인 타깃: ${target})`))
  console.log(
    pc.dim(
      '  SDK가 소유하는 자산입니다. 같은 이름의 기존 SKILL.md는 덮어쓰여 최신으로 동기화됩니다.',
    ),
  )

  for (const skill of BSTAGE_SKILLS) {
    const dir = join(root, baseDir, skill.name)
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'SKILL.md')
    const action = existsSync(file) ? '갱신' : '생성'
    writeFileSync(file, skill.content(target), 'utf-8')
    console.log(pc.green(`  ✓ ${skill.name} (${action})`))
  }

  console.log(
    pc.dim(
      `  ${BSTAGE_SKILLS.length}개 스킬 설치 완료. Claude Code가 ${baseDir}/ 의 스킬을 자동 인식합니다.`,
    ),
  )

  syncAgentsMd(root, target)
  installGuardHook(root)
}

/**
 * AGENTS.md의 SDK 관리 영역을 최신 템플릿으로 동기화한다(스킬과 동일하게 SDK 소유 자산).
 *
 * - 마커가 있으면 관리 영역만 결정론적으로 치환하고 자유 영역(사용자 내용)은 보존한다.
 * - 마커가 없는 레거시 파일은 SDK/사용자 내용이 섞여 있어 판단이 필요하므로 건드리지 않고,
 *   `bstage-migrate` 스킬로 reconcile하도록 안내만 한다.
 */
function syncAgentsMd(root: string, target: DesignTarget): void {
  const file = join(root, 'AGENTS.md')
  if (!existsSync(file)) {
    console.log(pc.dim('  · AGENTS.md 없음 — `bstage init` 또는 마이그레이션으로 생성하세요.'))
    return
  }

  const content = readFileSync(file, 'utf-8')
  const status = agentsMdStatus(content)
  if (status === 'legacy') {
    console.log(
      pc.yellow('  ! AGENTS.md가 레거시 포맷입니다(관리 영역 마커 없음).') +
        pc.dim(' `bstage-migrate` 스킬로 reconcile하세요 — skills install은 건드리지 않습니다.'),
    )
    return
  }

  // 프로젝트 정체성은 기존 파일에서 보존(없으면 package.json·레포명 규칙으로 fallback).
  const parsed = parseAgentsIdentity(content)
  const projectName = parsed.projectName ?? readPkgName(root) ?? 'custom-templates'
  const space = parsed.space ?? projectName.split('-custom-templates-')[0] ?? projectName

  const swapped = swapManagedBlock(content, renderManagedBlock({ space, projectName, target }))
  if (swapped === null) {
    // 마커 판정과 어긋나는 예외 상황 — 안전하게 건드리지 않는다.
    console.log(pc.dim('  · AGENTS.md 관리 영역을 찾지 못해 건너뜁니다.'))
    return
  }
  if (swapped === content) {
    console.log(pc.green('  ✓ AGENTS.md (관리 영역 최신)'))
    return
  }
  writeFileSync(file, swapped, 'utf-8')
  console.log(pc.green('  ✓ AGENTS.md (관리 영역 갱신, 자유 영역 보존)'))
}

/**
 * pre-commit 시크릿 가드(husky)를 기존 프로젝트에 설치한다(마이그레이션 경로).
 *
 * - package.json에 husky devDep + `prepare: husky`를 멱등 보강한다 → 다음 install에서 훅 활성.
 * - `.husky/check-secrets.mjs`(자립 가드 스크립트)와 `.husky/pre-commit`(`node .husky/check-secrets.mjs`)을 작성한다. 기존 pre-commit이 있으면 덮지 않고 가드 라인만 추가.
 * - 스캐폴드 `bstage init`과 동일한 가드를 기존 프로젝트에도 적용한다.
 */
function installGuardHook(root: string): void {
  const pkgPath = join(root, 'package.json')
  if (!existsSync(pkgPath)) {
    console.log(pc.dim('  · package.json 없음 — pre-commit 가드 설치를 건너뜁니다.'))
    return
  }

  // 1) package.json에 husky devDep + prepare 보강 (멱등)
  let pkgChanged = false
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
      scripts?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    pkg.devDependencies ??= {}
    pkg.scripts ??= {}
    if (!pkg.devDependencies.husky) {
      pkg.devDependencies.husky = '^9.1.7'
      pkgChanged = true
    }
    if (!pkg.scripts.prepare) {
      pkg.scripts.prepare = 'husky'
      pkgChanged = true
    } else if (!pkg.scripts.prepare.includes('husky')) {
      pkg.scripts.prepare = `${pkg.scripts.prepare} && husky`
      pkgChanged = true
    }
    if (pkgChanged) {
      writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8')
    }
  } catch {
    console.log(pc.yellow('  ! package.json 파싱 실패 — pre-commit 가드 설치를 건너뜁니다.'))
    return
  }

  // 2) 가드 스크립트 + pre-commit 훅 작성
  const huskyDir = join(root, '.husky')
  mkdirSync(huskyDir, { recursive: true })

  // 2a) 자립 가드 스크립트 — SDK 소유 자산이므로 항상 최신으로 덮어쓴다.
  const scriptFile = join(huskyDir, 'check-secrets.mjs')
  const scriptExisted = existsSync(scriptFile)
  writeFileSync(scriptFile, checkSecretsScript(), 'utf-8')
  console.log(pc.green(`  ✓ .husky/check-secrets.mjs (${scriptExisted ? '갱신' : '생성'})`))

  // 2b) pre-commit 훅 — 기존 훅이 있으면 덮지 않고 가드 실행 라인만 추가
  const hookFile = join(huskyDir, 'pre-commit')
  const body = huskyPreCommit()
  if (!existsSync(hookFile)) {
    writeFileSync(hookFile, body, 'utf-8')
    console.log(pc.green('  ✓ .husky/pre-commit (생성)'))
  } else {
    const cur = readFileSync(hookFile, 'utf-8')
    if (cur.includes('check-secrets.mjs')) {
      console.log(pc.green('  ✓ .husky/pre-commit (가드 존재)'))
    } else {
      const sep = cur.endsWith('\n') ? '' : '\n'
      writeFileSync(hookFile, cur + sep + body, 'utf-8')
      console.log(pc.green('  ✓ .husky/pre-commit (가드 라인 추가)'))
    }
  }

  if (pkgChanged) {
    console.log(
      pc.dim('  · husky를 package.json에 추가했습니다 — install 후 pre-commit 훅이 활성화됩니다.'),
    )
  }
}

function readPkgName(root: string): string | null {
  try {
    return (
      (JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8')) as { name?: string }).name ??
      null
    )
  } catch {
    return null
  }
}
