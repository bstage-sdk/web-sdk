import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import pc from 'picocolors'
import { ExitCode, fail } from '../../portal/output.js'
import {
  GUARD_SCRIPT_REVISION,
  checkSecretsScript,
  readGuardRevision,
} from '../../templates/checkSecretsScript.js'
import { huskyPreCommit } from '../../templates/huskyPreCommit.js'
import { assertWritableInRoot, chmodNoFollow, writeFileNoFollow } from './safeWrite.js'

/** 설치 결과. `installed: false`면 호출부가 경고를 내야 한다 — 조용한 건너뜀은 가드가 있다고 믿게 만든다. */
export interface GuardResult {
  installed: boolean
  reason?: string
}

/** git이 훅을 실행하려면 실행 비트가 필요하다. 훅 파일에만 쓴다. */
const HOOK_MODE = 0o755

/** 쓰기 실패를 어느 경로에서 멈췄는지 드러나는 메시지로 바꿔 종료한다. 링크를 따라 루트 밖에 쓰지 않는다. */
function writeOrFail(root: string, file: string, content: string, mode?: number): void {
  assertWritableInRoot(root, file)
  try {
    writeFileNoFollow(file, content, mode)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    fail(ExitCode.FAILURE, `${file} 쓰기 실패: ${message}`)
  }
}

/** 실행 비트만 바로잡는다 — 내용은 사용자 것이라 다시 쓰지 않는다. */
function chmodOrFail(root: string, file: string, mode: number): void {
  assertWritableInRoot(root, file)
  try {
    chmodNoFollow(file, mode)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    fail(ExitCode.FAILURE, `${file} 권한 설정 실패: ${message}`)
  }
}

/** 디렉터리 생성 실패도 같은 규칙으로 — 훅 디렉터리를 못 만들면 그 아래 쓰기가 전부 깨진다. */
function mkdirOrFail(root: string, dir: string): void {
  assertWritableInRoot(root, dir)
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
  writeOrFail(dirname(pkgPath), pkgPath, nextJson)
  return true
}

/**
 * 가드가 **실제로 실행되는** 줄이 있는지 — 문장 시작이 `node`/`npx` 호출이고 대상이 정확히
 * `.husky/check-secrets.mjs`(선택적 `./`)인 줄만 인정한다. 주석(`#`), `echo "..."` 같은 인용,
 * `false && node ...` 같은 단락 평가, `tools/noop-check-secrets.mjs` 같은 다른 경로는 가드가
 * 아니다 — 파일명이 보이기만 하는 판정은 비활성 훅을 "설치됨"으로 보고한다.
 */
const ACTIVE_GUARD_LINE = /^[ \t]*(?:node|npx)\s+(?:\.\/)?\.husky\/check-secrets\.mjs(?:\s|$)/m

/** 첫 줄 shebang이 셸(sh/bash/zsh/dash)이 아니면 셸 문장을 붙일 수 없다. shebang이 없으면 husky 기본(sh)이다. */
const NON_SHELL_SHEBANG = /^#!(?!.*\b(?:sh|bash|zsh|dash)\b)/

/** 끼워 넣는 가드 줄 — 뒤에 `exit 0`이 와도 가드의 실패가 커밋을 막게 상태를 전파한다. */
function guardLine(body: string): string {
  const line = body.trimEnd()
  // 스캐폴드 훅 본문이 이미 정본 형태다 — 중복해서 붙이지 않는다(본문이 바뀌어도 전파는 보장).
  return line.includes('|| exit 1') ? line : `${line} || exit 1`
}

/** 가드 줄이 놓여야 하는 자리 — shebang 다음, 없으면 첫 줄. */
function guardSlot(lines: string[]): number {
  return lines[0]?.startsWith('#!') ? 1 : 0
}

/**
 * 이미 있는 가드 줄을 **그대로 둬도 되는가**. 셸 문법을 부분적으로 해석해 "실행되는 자리인지"를
 * 판정하려던 이전 방식은 함수 본문·`if false` 블록·`case` 가지처럼 불리지 않는 자리를 걸러내지 못했다
 * (셸 제어 흐름을 정규식으로 알 수 없다). 그래서 판정을 뒤집어, **우리가 놓는 자리에 우리가 놓는
 * 형태 그대로**일 때만 인정한다. 그 밖에는 전부 재배치한다 — 애매하면 다시 넣는 쪽이 안전하고,
 * 결과는 전파 형태의 가드 줄이 맨 위에 하나 생기는 것뿐이다.
 */
function hasEffectiveGuard(lines: string[], body: string): boolean {
  return lines[guardSlot(lines)] === guardLine(body)
}

/**
 * 가드 줄을 shebang 바로 다음(없으면 맨 위)에 넣는다. 뒤쪽 `exit`를 찾아 그 앞에 끼우는 방식은
 * `exit 0 # done` 같은 변형에 빗나가 가드가 exit 뒤로 밀린다 — 맨 위는 어떤 모양의 훅에서도 먼저 실행된다.
 * 비활성 자리에 있던 기존 가드 줄은 지우고 다시 넣는다.
 */
function placeGuardLine(cur: string, body: string): string {
  const lines = cur.split('\n').filter((l) => !ACTIVE_GUARD_LINE.test(l))
  const line = guardLine(body)
  const slot = guardSlot(lines)
  const placed = [...lines.slice(0, slot), line, ...lines.slice(slot)]
  const text = placed.join('\n')
  return text.endsWith('\n') ? text : `${text}\n`
}

/**
 * pre-commit 훅 — 기존 훅이 있으면 덮지 않고 가드 실행 라인만 넣는다.
 * 반환값은 "가드가 실행되는 훅이 있는가" — 셸이 아닌 훅에는 넣지 못하므로 false.
 */
function ensurePreCommitHook(root: string, huskyDir: string, out: (s: string) => void): boolean {
  const hookFile = join(huskyDir, 'pre-commit')
  const body = huskyPreCommit()
  if (!existsSync(hookFile)) {
    writeOrFail(root, hookFile, body, HOOK_MODE)
    out(pc.green('  ✓ .husky/pre-commit (생성)'))
    return true
  }
  const cur = readFileSync(hookFile, 'utf-8')
  const lines = cur.split('\n')
  if (hasEffectiveGuard(lines, body)) {
    // 실행 비트만 보정한다 — 내용은 사용자 것이라 다시 쓰지 않는다(쓰다 끊기면 빈 훅이 남는다).
    chmodOrFail(root, hookFile, HOOK_MODE)
    out(pc.green('  ✓ .husky/pre-commit (가드 존재)'))
    return true
  }
  if (NON_SHELL_SHEBANG.test(cur)) {
    out(
      pc.yellow(
        '  ! .husky/pre-commit 이 셸 스크립트가 아니라 가드 줄을 넣지 못했습니다 — 훅에서 `node .husky/check-secrets.mjs` 를 직접 실행하도록 추가하세요.',
      ),
    )
    return false
  }
  const hadInactive = lines.some((l) => ACTIVE_GUARD_LINE.test(l))
  writeOrFail(root, hookFile, placeGuardLine(cur, body), HOOK_MODE)
  out(pc.green(`  ✓ .husky/pre-commit (가드 라인 ${hadInactive ? '재배치' : '추가'})`))
  return true
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
  mkdirOrFail(root, huskyDir)

  // 자립 가드 스크립트 — SDK 소유 자산이므로 **항상** 이 CLI의 본문으로 덮어쓴다. 설치본의 개정이
  // 더 높으면 프로젝트에 고정된 옛 CLI로 돌린 것이라 하향임을 경고하되, 파일이 적은 번호로 덮어쓰기를
  // 막지는 않는다 — 그 번호는 파일을 쓸 수 있는 누구나 적을 수 있어, 막으면 빈 스크립트로 가드를 끌 수 있다.
  // 실행 비트는 주지 않는다: 훅이 `node`로 실행하므로 필요 없다.
  const scriptFile = join(huskyDir, 'check-secrets.mjs')
  const scriptExisted = existsSync(scriptFile)
  const installedRev = scriptExisted ? readGuardRevision(readFileSync(scriptFile, 'utf-8')) : null
  writeOrFail(root, scriptFile, checkSecretsScript())
  if (installedRev !== null && installedRev > GUARD_SCRIPT_REVISION) {
    out(
      pc.yellow(
        `  ! .husky/check-secrets.mjs (rev ${installedRev} → ${GUARD_SCRIPT_REVISION}) — 이 CLI가 설치본보다 오래돼 가드를 옛 본문으로 되돌렸습니다. 최신 CLI(npx @bstage-sdk/cli@latest ai install)로 다시 실행하세요.`,
      ),
    )
  } else {
    out(pc.green(`  ✓ .husky/check-secrets.mjs (${scriptExisted ? '갱신' : '생성'})`))
  }

  const hooked = ensurePreCommitHook(root, huskyDir, out)

  if (pkgChanged) {
    out(
      pc.dim('  · husky를 package.json에 추가했습니다 — install 후 pre-commit 훅이 활성화됩니다.'),
    )
  }
  if (!hooked) return { installed: false, reason: 'pre-commit 훅이 셸 스크립트가 아님' }
  return { installed: true }
}
