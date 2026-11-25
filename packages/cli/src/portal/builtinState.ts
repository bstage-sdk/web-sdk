import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { BuiltinManifest, BuiltinManifestFile } from './client.js'
import { linkPath, type ProjectLink } from './config.js'
import { cleanText, ExitCode, fail } from './output.js'
import { assertNoConflicts, validateSourcePath } from './sourceManifest.js'

const SHA256_RE = /^[0-9a-f]{64}$/
const VERSION_ID_RE = /^[0-9a-f]{32}$/

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * 서버 manifest 를 쓰기 전에 모양을 엄격히 본다(AWS Security Agent 8차 L). 버전 ID 는 32자리 hex, 파일마다 path 는 문자열,
 * sha256 은 64자리 소문자 hex, size 는 0 이상의 안전한 정수, url 은 문자열, exec 은 있으면 불리언이어야 한다.
 * 하나라도 어기면 manifest 전체를 버리고 멈춘다 — 일부만 걸러 쓰지 않는다. 검증한 새 객체를 돌려준다.
 */
export function validateManifest(raw: unknown): BuiltinManifest {
  const bad = (why: string): never =>
    fail(
      ExitCode.FAILURE,
      `서버 응답의 파일 목록이 올바르지 않습니다(${why}) — 받거나 올리지 않습니다`,
    )
  if (!isRecord(raw)) return bad('목록이 객체가 아님')
  if (typeof raw.versionId !== 'string' || !VERSION_ID_RE.test(raw.versionId)) {
    return bad('버전 ID')
  }
  if (!Array.isArray(raw.files)) return bad('files 가 배열이 아님')
  const files: BuiltinManifestFile[] = []
  for (const [i, f] of raw.files.entries()) {
    if (!isRecord(f)) return bad(`${i}번째 항목이 객체가 아님`)
    const { path, sha256, size, url, exec } = f
    if (typeof path !== 'string') return bad(`${i}번째 항목의 path`)
    const at = cleanText(path, 200)
    if (typeof sha256 !== 'string' || !SHA256_RE.test(sha256)) return bad(`${at} 의 sha256`)
    if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0) {
      return bad(`${at} 의 size`)
    }
    if (typeof url !== 'string') return bad(`${at} 의 url`)
    if (exec !== undefined && typeof exec !== 'boolean') return bad(`${at} 의 exec`)
    files.push({ path, sha256, size, url, exec: exec === true })
  }
  return { versionId: raw.versionId, number: raw.number as number, files }
}

/**
 * 내장 저장소 동기화 상태. push·pull 이 끝나면 마지막 head 의 파일 해시를 `.bstage/builtin-manifest.json` 에
 * 남긴다 — pull 의 "로컬에서 고친 파일" 판정과 deploy 의 "올리지 않은 변경" 셈에 쓴다.
 * 링크의 `builtinHead` 는 push 의 기대 head 다.
 */
export interface BuiltinManifestState {
  repoId: string
  versionId: string
  /** path → sha256 */
  files: Record<string, string>
}

export function builtinManifestPath(cwd: string): string {
  return join(cwd, '.bstage', 'builtin-manifest.json')
}

/**
 * 저장된 기준. 다른 레포의 것이거나 깨졌으면 null — 로컬 수정 판정에 낡은 기준을 쓰지 않는다.
 * 경로가 서버 규칙(validateSourcePath·assertNoConflicts)을 어기거나 해시가 64자리 소문자 sha256 이 아니면
 * 기준 전체를 버린다 — 손으로 고친 기준 파일이 `.git/config` 같은 파일을 pull 의 "서버에서 지워진 파일"로 지우게 하지 않는다
 * (AWS Security Agent 2차 L2).
 */
export async function loadBuiltinState(
  cwd: string,
  repoId: string,
): Promise<BuiltinManifestState | null> {
  try {
    const s = JSON.parse(
      await readFile(builtinManifestPath(cwd), 'utf-8'),
    ) as Partial<BuiltinManifestState>
    if (s.repoId !== repoId || typeof s.versionId !== 'string') return null
    if (!s.files || typeof s.files !== 'object' || Array.isArray(s.files)) return null
    const entries = Object.entries(s.files as Record<string, unknown>)
    for (const [path, hash] of entries) {
      if (validateSourcePath(path) !== null) return null
      if (typeof hash !== 'string' || !SHA256_RE.test(hash)) return null
    }
    assertNoConflicts(entries.map(([path]) => path)) // 충돌이면 throw → 아래 catch 에서 null
    // 프로토타입 없는 객체로 옮긴다 — 경로로 찾을 때 `toString`·`constructor`·`__proto__` 가 상속 멤버를 돌려주지 않게
    // (AWS Security Agent 6차 L). defineProperty 라 `__proto__` 도 그냥 키가 된다.
    const files: Record<string, string> = Object.create(null) as Record<string, string>
    for (const [path, hash] of entries) {
      Object.defineProperty(files, path, {
        value: hash,
        enumerable: true,
        writable: true,
        configurable: true,
      })
    }
    return { repoId, versionId: s.versionId, files }
  } catch {
    return null
  }
}

/** 기대 head: 링크 파일 값 → (CI 환경변수 링크처럼 값이 없으면) 같은 레포의 저장된 기준. */
export async function expectedHeadFor(cwd: string, link: ProjectLink): Promise<string | null> {
  if (link.builtinHead) return link.builtinHead
  return (await loadBuiltinState(cwd, link.repoId))?.versionId ?? null
}

/**
 * 임시 파일에 쓰고 옮긴다. 임시 이름은 무작위이고 `wx`(이미 있으면 실패 — 미리 깔아 둔 심볼릭 링크를 따라가지 않는다)·
 * 0600 으로 만든다. 실패하면 임시 파일을 지운다(AWS Security Agent 2차 M3).
 */
async function writeAtomic(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${randomBytes(6).toString('hex')}`
  try {
    await writeFile(tmp, text, { flag: 'wx', mode: 0o600 })
    await rename(tmp, path)
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => {})
    throw e
  }
}

/** push·pull 이 끝난 뒤 링크의 builtinHead 와 기준 manifest 를 함께 갱신한다. */
export async function recordBuiltinSync(
  cwd: string,
  repoId: string,
  versionId: string,
  files: Record<string, string>,
): Promise<void> {
  const state: BuiltinManifestState = { repoId, versionId, files }
  await writeAtomic(builtinManifestPath(cwd), JSON.stringify(state, null, 2) + '\n')
  // 링크는 파일이 있을 때만 고친다 — CI 환경변수 링크는 파일을 만들지 않는다.
  let link: ProjectLink
  try {
    link = JSON.parse(await readFile(linkPath(cwd), 'utf-8')) as ProjectLink
  } catch {
    return
  }
  if (link.repoId !== repoId) return
  await writeAtomic(
    linkPath(cwd),
    JSON.stringify({ ...link, builtinHead: versionId }, null, 2) + '\n',
  )
}

/** 기준 파일 목록에 이 경로가 자기 키로 있는가 — 상속 멤버(`toString` 등)는 없는 것으로 본다(AWS Security Agent 6차 L). */
export function hasPath(files: Record<string, string>, path: string): boolean {
  return Object.prototype.hasOwnProperty.call(files, path)
}
