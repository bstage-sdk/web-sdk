import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import pc from 'picocolors'
import { ExitCode, fail } from '../../portal/output.js'
import { checkSecretsScript } from '../../templates/checkSecretsScript.js'
import { huskyPreCommit } from '../../templates/huskyPreCommit.js'

/** 설치 결과. `installed: false`면 호출부가 경고를 내야 한다 — 조용한 건너뜀은 가드가 있다고 믿게 만든다. */
export interface GuardResult {
  installed: boolean
  reason?: string
}

/** git이 훅을 실행하려면 실행 비트가 필요하다. 훅 파일에만 쓴다. */
const HOOK_MODE = 0o755

/** 쓰기 실패를 어느 경로에서 멈췄는지 드러나는 메시지로 바꿔 종료한다. */
function writeOrFail(file: string, content: string, mode?: number): void {
  try {
    writeFileSync(file, content, 'utf-8')
    // 기존 파일에 쓸 때 writeFileSync는 mode를 무시하므로 항상 따로 맞춘다.
    if (mode !== undefined) chmodSync(file, mode)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    fail(ExitCode.FAILURE, `${file} 쓰기 실패: ${message}`)
  }
}

/** 디렉터리 생성 실패도 같은 규칙으로 — 훅 디렉터리를 못 만들면 그 아래 쓰기가 전부 깨진다. */
function mkdirOrFail(dir: string): void {
  try {
    mkdirSync(dir, { recursive: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    fail(ExitCode.FAILURE, `${dir} 쓰기 실패: ${message}`)
  }
}

/**
 * package.json에 husky devDep + `prepare: husky`를 멱등 보강한다.
 * 반환값은 "파일을 고쳤는가" — 고쳤으면 install 후 훅이 활성화된다는 안내가 필요하다.
 * 파싱 실패는 null(호출부가 건너뛴다) — 사용자 package.json을 추측해 고치지 않는다.
 */
function ensureHuskyInPkg(pkgPath: string): boolean | null {
  // 읽기·파싱만 감싼다 — 쓰기 실패까지 여기서 삼키면 "파싱 실패"로 둔갑해 원인을 잃는다.
  let nextJson: string | null
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
      scripts?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    // 입력을 제자리에서 바꾸지 않는다 — 새 객체를 만들어 쓴다.
    const devDependencies = { ...pkg.devDependencies }
    const scripts = { ...pkg.scripts }
    if (!devDependencies.husky) devDependencies.husky = '^9.1.7'
    if (!scripts.prepare) scripts.prepare = 'husky'
    else if (!scripts.prepare.includes('husky')) scripts.prepare = `${scripts.prepare} && husky`

    const changed =
      devDependencies.husky !== pkg.devDependencies?.husky ||
      scripts.prepare !== pkg.scripts?.prepare
    nextJson = changed ? JSON.stringify({ ...pkg, scripts, devDependencies }, null, 2) + '\n' : null
  } catch {
    return null
  }

  if (nextJson === null) return false
  writeOrFail(pkgPath, nextJson)
  return true
}

/**
 * 가드가 **실제로 실행되는** 줄이 있는지 — 문장 시작이 `node`/`npx` 호출이고 대상이 정확히
 * `.husky/check-secrets.mjs`(선택적 `./`)인 줄만 인정한다. 주석(`#`), `echo "..."` 같은 인용,
 * `false && node ...` 같은 단락 평가, `tools/noop-check-secrets.mjs` 같은 다른 경로는 가드가
 * 아니다 — 파일명이 보이기만 하는 판정은 비활성 훅을 "설치됨"으로 보고한다.
 */
const ACTIVE_GUARD_LINE = /^[ \t]*(?:node|npx)\s+(?:\.\/)?\.husky\/check-secrets\.mjs(?:\s|$)/m

/** pre-commit 훅 — 기존 훅이 있으면 덮지 않고 가드 실행 라인만 추가한다. */
function ensurePreCommitHook(huskyDir: string, out: (s: string) => void): void {
  const hookFile = join(huskyDir, 'pre-commit')
  const body = huskyPreCommit()
  if (!existsSync(hookFile)) {
    writeOrFail(hookFile, body, HOOK_MODE)
    out(pc.green('  ✓ .husky/pre-commit (생성)'))
    return
  }
  const cur = readFileSync(hookFile, 'utf-8')
  if (ACTIVE_GUARD_LINE.test(cur)) {
    // 실행 비트만 보정한다(내용은 사용자 것).
    chmodSync(hookFile, HOOK_MODE)
    out(pc.green('  ✓ .husky/pre-commit (가드 존재)'))
    return
  }
  writeOrFail(hookFile, cur + (cur.endsWith('\n') ? '' : '\n') + body, HOOK_MODE)
  out(pc.green('  ✓ .husky/pre-commit (가드 라인 추가)'))
}

/**
 * pre-commit 시크릿 가드(husky)를 기존 프로젝트에 설치한다(마이그레이션 경로).
 * 스캐폴드 `bstage init`과 동일한 가드를 기존 프로젝트에도 적용한다.
 */
export function installGuardHook(root: string, out: (s: string) => void): GuardResult {
  const pkgPath = join(root, 'package.json')
  if (!existsSync(pkgPath)) return { installed: false, reason: 'package.json 없음' }

  const pkgChanged = ensureHuskyInPkg(pkgPath)
  if (pkgChanged === null) return { installed: false, reason: 'package.json 파싱 실패' }

  const huskyDir = join(root, '.husky')
  mkdirOrFail(huskyDir)

  // 자립 가드 스크립트 — SDK 소유 자산이므로 항상 최신으로 덮어쓴다.
  // 실행 비트는 주지 않는다: 훅이 `node`로 실행하므로 필요 없다.
  const scriptFile = join(huskyDir, 'check-secrets.mjs')
  const scriptExisted = existsSync(scriptFile)
  writeOrFail(scriptFile, checkSecretsScript())
  out(pc.green(`  ✓ .husky/check-secrets.mjs (${scriptExisted ? '갱신' : '생성'})`))

  ensurePreCommitHook(huskyDir, out)

  if (pkgChanged) {
    out(
      pc.dim('  · husky를 package.json에 추가했습니다 — install 후 pre-commit 훅이 활성화됩니다.'),
    )
  }
  return { installed: true }
}
