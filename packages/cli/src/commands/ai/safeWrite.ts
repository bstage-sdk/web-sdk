import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  ftruncateSync,
  lstatSync,
  openSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { ExitCode, fail } from '../../portal/output.js'

/** 경로의 lstat. 없으면 null — 심볼릭 링크 자체를 보기 위해 stat이 아니라 lstat이다. */
export function lstatOrNull(path: string): ReturnType<typeof lstatSync> | null {
  try {
    return lstatSync(path)
  } catch {
    return null
  }
}

/**
 * 쓰기 대상이 프로젝트 루트 안인지 문자열로 확인한다. `--dir`가 절대 경로나 `..`를 들고 오면
 * 루트 밖에 파일이 생긴다 — 계획 단계에서도 막지만 쓰기 직전이 마지막 관문이다.
 * 문자열 판정만으로는 부족하다(링크) — 실제 쓰기 전에 `assertWritableInRoot`가 실체를 본다.
 */
export function resolveInRoot(root: string, relative: string): string {
  const base = resolve(root)
  const target = resolve(base, relative)
  if (target === base || !target.startsWith(base + sep)) {
    fail(ExitCode.PRECONDITION, `스킬 디렉터리는 프로젝트 안이어야 합니다: ${relative}`)
  }
  return target
}

/** 가장 가까운 **실재하는** 조상(자기 자신 포함). */
function deepestExisting(path: string): string {
  let cur = path
  while (lstatOrNull(cur) === null) {
    const parent = dirname(cur)
    if (parent === cur) return cur
    cur = parent
  }
  return cur
}

/**
 * 쓰기 직전 실체 검사 — 대상 자체가 심볼릭 링크가 아니고, 실재하는 가장 깊은 조상의 realpath가
 * 루트의 realpath 안이어야 한다. 레포에 커밋된 링크(`.claude/skills -> ~/.ssh`, `.husky -> …`)는
 * 문자열 판정을 통과하고도 쓰기를 루트 밖으로 흘리기 때문이다.
 */
export function assertWritableInRoot(root: string, target: string): void {
  if (lstatOrNull(target)?.isSymbolicLink()) {
    fail(
      ExitCode.FAILURE,
      `${target} 이(가) 심볼릭 링크라 쓰지 않습니다 — 지운 뒤 다시 실행하세요.`,
    )
  }
  const realRoot = realpathSync(resolve(root))
  const anchor = realpathSync(deepestExisting(target))
  if (anchor !== realRoot && !anchor.startsWith(realRoot + sep)) {
    fail(
      ExitCode.FAILURE,
      `${target} 의 실제 위치가 프로젝트 루트 밖입니다(경로 중간에 링크가 있습니다) — 링크를 지운 뒤 다시 실행하세요.`,
    )
  }
}

/**
 * 링크를 따라가지 않는 쓰기. 경로 검사(`assertWritableInRoot`)와 실제 쓰기 사이에 대상이 링크로
 * 바뀌는 경쟁(같은 사용자의 다른 프로세스)은 이름 검사만으로 막지 못하므로, 여는 순간
 * `O_NOFOLLOW` 로 커널이 거부하게 한다(링크면 ELOOP). 권한도 같은 fd 에 맞춰 대상이 바뀔 틈을 없앤다.
 */
/**
 * 열린 fd 가 **하드 링크 없는 일반 파일**인지 확인한다. 심볼릭 링크는 `O_NOFOLLOW` 가 막지만
 * 하드 링크는 경로·realpath 로 구분되지 않는다 — `.husky/pre-commit` 이 사용자의 키 파일로 걸린
 * 하드 링크면 그 파일을 함께 바꾸게 된다. 디렉터리·FIFO 등도 여기서 거른다(FIFO 는 `O_NONBLOCK`
 * 이 없으면 열다가 멈춘다).
 */
function assertPlainFile(fd: number, file: string): void {
  const st = fstatSync(fd)
  if (!st.isFile()) {
    throw new Error(`${file} 이(가) 일반 파일이 아닙니다(디렉터리·FIFO 등) — 건드리지 않습니다.`)
  }
  if (st.nlink !== 1) {
    throw new Error(
      `${file} 에 하드 링크가 걸려 있습니다(nlink=${st.nlink}) — 링크된 다른 파일까지 바뀌므로 건드리지 않습니다.`,
    )
  }
}

export function writeFileNoFollow(file: string, content: string, mode?: number): void {
  // O_TRUNC 를 쓰지 않는다 — 여는 순간 잘려서 fstat 검사 전에 이미 피해가 난다. 검사 뒤 직접 자른다.
  const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK
  const target = mode ?? 0o644
  const fd = openSync(file, flags, target)
  try {
    assertPlainFile(fd, file)
    ftruncateSync(fd, 0)
    // fd 에 쓰는 writeFileSync 는 부분 쓰기를 내부에서 이어 쓴다(writeSync 한 번은 잘릴 수 있다).
    writeFileSync(fd, content, 'utf-8')
    // O_CREAT 의 mode 는 **기존 파일에는 무시되고** 새 파일에도 umask 가 깎는다. 느슨한 권한이
    // 남으면 가드 본문을 남이 갈아끼울 수 있으므로 항상 맞춘다.
    fchmodSync(fd, target)
  } finally {
    closeSync(fd)
  }
}

/**
 * 내용을 건드리지 않고 권한만 바꾼다. 읽기 전용으로 열어 `fchmod` 하므로 링크를 따라가지 않고,
 * 실행 비트만 바로잡으면 되는 자리에서 사용자 파일을 다시 쓰지 않는다(쓰다 끊기면 빈 파일이 남는다).
 */
export function chmodNoFollow(file: string, mode: number): void {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    assertPlainFile(fd, file)
    fchmodSync(fd, mode)
  } finally {
    closeSync(fd)
  }
}
