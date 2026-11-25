import { readFile } from 'node:fs/promises'
import pc from 'picocolors'
import { blobFetch, putBlob, runPool, StorageDeniedError } from '../portal/blobTransfer.js'
import { recordBuiltinSync, expectedHeadFor, validateManifest } from '../portal/builtinState.js'
import { PortalError } from '../portal/client.js'
import { assertBuiltinLinked, resolveLinkedRepo } from '../portal/buildRepo.js'
import { cleanText, ExitCode, fail } from '../portal/output.js'
import { resolveContext, type PortalContext } from '../portal/resolveContext.js'
import {
  ENV_FILE_NAME,
  ENV_PLACEHOLDER_FILES,
  goLower,
  isEnvModeFile,
  scanSource,
  type SourceFile,
} from '../portal/sourceManifest.js'
import { bufferContainsPrivateKey, checkEnvFile, findEnvSecrets } from '../templates/envSecrets.js'
import type { StageRepo } from '../portal/types.js'

export interface PushOptions {
  message?: string
  force?: boolean
  /** deploy --push 가 부른 경우 — deploy 에는 --force 가 없으므로 안내 문구가 달라진다. */
  fromDeploy?: boolean
}

export interface PushDeps {
  cwd?: string
  env?: NodeJS.ProcessEnv
  fetch?: typeof fetch
  out?: (s: string) => void
}

export interface PushResult {
  versionId: string
  number: number
  unchanged: boolean
}

const PUT_CONCURRENCY = 4
const SHOW_SKIPPED = 5

/**
 * 서버가 준 버전 번호 — 양의 정수만 받아들인다(AWS Security Agent 6차 L). 문자열·제어 문자가 섞인 값은 터미널에 찍지 않는다.
 * 아니면 null.
 */
export function versionNumber(n: unknown): number | null {
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 1 ? n : null
}

/** 다시 처음부터 올리면 풀릴 수 있는 서버 오류 코드. */
const RESTARTABLE = new Set(['BLOB_MISSING', 'HASH_MISMATCH'])

function errCode(e: unknown): string | undefined {
  return e instanceof PortalError ? (e.details?.code as string | undefined) : undefined
}

// 값을 검사할 env 파일 — 이름 규칙(ENV_FILE_NAME)은 portal/sourceManifest.ts. AWS Security Agent 5차 M2: `_`·`-` 구분자(`.env_prod`·`.env-prod`)도 잡는다.
/** 이 경로가 값 검사 대상 env 파일인가(견본 `.env.example|sample|template` 은 아님). */
export function isEnvValueScanTarget(path: string): boolean {
  const base = goLower(path.slice(path.lastIndexOf('/') + 1))
  return ENV_FILE_NAME.test(base) && !ENV_PLACEHOLDER_FILES.has(base)
}

/** env 이름 파일의 줄 검사 바이트 상한. env 파일·`env.ts` 류가 이보다 클 일은 없다. */
export const MAX_ENV_SCAN_BYTES = 1024 * 1024

/**
 * 올릴 env 파일의 검사(templates/envSecrets.ts). pre-commit 가드보다 엄격한 상위 집합이다 — 가드(GitHub 흐름의 기존 훅)는 그대로 둔다.
 *  - `.env.{mode}` 류(isEnvModeFile): 모든 줄이 한 줄 `VITE_*=값` 이어야 하고 값이 자격 증명 모양·시크릿이 아니어야 한다
 *    (AWS Security Agent 6차, Ruling 24 S2).
 *  - 견본(`.env.example|sample|template`): 키는 자유, `VITE_` 가 아닌 키는 값이 비었거나 견본이어야 한다.
 *  - env 이름의 코드 파일(`env.ts` 등): 이전처럼 줄 단위 시크릿 검사(findEnvSecrets).
 *  - env 이름의 구조화 설정(`env.yaml`·`.env.json` 등)은 훑기에서 통째로 빠져 여기 오지 않는다(AWS Security Agent 8차 M, Ruling 27).
 * `.env`·`.env.local`·`.env.*.local` 은 훑기에서 이미 빠졌다. 값은 돌려주지 않는다(출력에 실리지 않게).
 */
async function envSecretFindings(files: SourceFile[]): Promise<string[]> {
  const found: string[] = []
  for (const f of files) {
    if (!isEnvValueScanTarget(f.path) && !isEnvPlaceholderPath(f.path)) continue
    const base = f.path.slice(f.path.lastIndexOf('/') + 1)
    const buf = await readFile(f.abs)
    // 줄 검사에 넣는 바이트 상한(AWS Security Agent PR #454) — 넘으면 훑지 않고 거부한다(검사를 건너뛰어 통과시키지 않는다).
    if (buf.byteLength > MAX_ENV_SCAN_BYTES) {
      found.push(
        `${f.path} — 파일이 너무 큼(최대 ${MAX_ENV_SCAN_BYTES / 1024}KiB, 검사하지 않고 거부)`,
      )
      continue
    }
    const text = buf.toString('utf8')
    if (isEnvModeFile(base)) {
      const mode = isEnvPlaceholderPath(f.path) ? 'placeholder' : 'mode'
      for (const x of checkEnvFile(text, mode)) {
        const key = x.key ? ` ${cleanText(x.key, 80)}` : ''
        found.push(`${f.path}:${x.line} —${key} (${x.reason})`)
      }
      continue
    }
    for (const x of findEnvSecrets(text)) {
      found.push(`${f.path}:${x.line} — ${cleanText(x.key, 80)}`)
    }
  }
  return found
}

function isEnvPlaceholderPath(path: string): boolean {
  return ENV_PLACEHOLDER_FILES.has(goLower(path.slice(path.lastIndexOf('/') + 1)))
}

/**
 * 개인 키 본문이 든 파일(AWS Security Agent 6차 H — GCP 서비스 계정 JSON 처럼 이름으로는 못 거르는 자격 증명).
 * 올릴 파일은 확장자와 상관없이 모두 바이트로 훑는다(7차 M — `key.ico`·`backup.woff` 처럼 자산 확장자에 숨긴 PEM 도).
 */
export async function privateKeyFindings(files: SourceFile[]): Promise<string[]> {
  const found: string[] = []
  for (const f of files) {
    if (bufferContainsPrivateKey(await readFile(f.abs))) found.push(f.path)
  }
  return found
}

/** 응답의 `paths` 를 사용자 안내에 붙인다(최대 몇 개만). */
function pathsHint(e: PortalError): string {
  const paths = e.details?.paths
  if (!Array.isArray(paths) || paths.length === 0) return ''
  // 서버가 준 값 — 이스케이프·제어 문자를 지우고 긴 값은 자른다(AWS Security Agent 2차 L1).
  const shown = paths.slice(0, 10).map((p) => `\n  - ${cleanText(p)}`)
  return `${shown.join('')}${paths.length > 10 ? `\n  … 외 ${paths.length - 10}개` : ''}`
}

/**
 * 내장 저장소로 올리는 본체 — `bstage push` 와 `deploy --push` 가 같이 쓴다.
 * 흐름: 훑기 → 업로드 시작(기대 head) → 서버에 없는 파일만 서명 PUT(동시 4) → complete → 기준 저장.
 * 서명 URL 은 어디에도 출력하지 않는다.
 */
export async function pushSource(
  ctx: PortalContext,
  repo: StageRepo,
  cwd: string,
  options: PushOptions,
  fetchFn: typeof fetch,
  log: (s: string) => void,
): Promise<PushResult> {
  // 서버의 source 와 링크 파일의 source 가 둘 다 builtin 일 때만 작업 폴더를 올린다(AWS Security Agent 8차 M, Ruling 26).
  if (repo.source !== 'builtin') {
    fail(ExitCode.FAILURE, 'GitHub 레포는 git push 를 쓰세요')
  }
  assertBuiltinLinked(ctx, repo)
  const { organizationId: org, spaceId: space } = ctx.link
  let expectedHead = ''
  if (!options.force) {
    let head = await expectedHeadFor(cwd, ctx.link)
    if (!head) {
      // 기준이 없는 첫 올리기: 서버가 비어 있을 때만 그 버전을 기준으로 삼는다(비어 있으면 덮을 것이 없다).
      const m = validateManifest((await ctx.client.getManifest(org, space, repo.id)) as unknown)
      if (m.files.length === 0) head = m.versionId
    }
    if (!head) {
      const how = options.fromDeploy
        ? 'bstage pull 또는 bstage push --force'
        : 'bstage pull 로 먼저 받거나 --force'
      fail(
        ExitCode.FAILURE,
        `이 폴더에서 아직 받거나 올린 적이 없고 서버에 이미 파일이 있어 기준 버전을 알 수 없습니다. ${how} 로 진행하세요(--force 는 서버의 현재 내용을 덮어쓰며 덮인 버전은 기록에 남습니다).`,
      )
    }
    expectedHead = head
  } else {
    log(
      pc.yellow(
        '--force: 서버의 현재 내용을 덮어씁니다. 덮인 버전은 버전 기록에 남습니다. 올리는 도중 다른 곳에서 저장하면 그래도 409 가 날 수 있습니다.',
      ),
    )
  }

  for (let attempt = 0; ; attempt++) {
    const scan = await scanSource(cwd)
    if (scan.invalid.length > 0) {
      const lines = scan.invalid.slice(0, 20).map((i) => `  - ${i.path}: ${i.reason}`)
      const more = scan.invalid.length > 20 ? `\n  … 외 ${scan.invalid.length - 20}개` : ''
      fail(
        ExitCode.FAILURE,
        `올릴 수 없는 경로가 있습니다. 이름을 바꾸거나 .bstageignore 에 넣고 다시 실행하세요:\n${lines.join('\n')}${more}`,
      )
    }
    const secrets = await envSecretFindings(scan.files)
    if (secrets.length > 0) {
      const lines = secrets.slice(0, 20).map((x) => `  - ${x}`)
      const more = secrets.length > 20 ? `\n  … 외 ${secrets.length - 20}개` : ''
      fail(
        ExitCode.FAILURE,
        `.env 파일에 올릴 수 없는 줄이 있어 올리지 않습니다(값은 표시하지 않음). .env.{mode} 에는 한 줄짜리 VITE_ 공개 값만 둘 수 있습니다 — 시크릿·그 밖의 값은 .env.local 로 옮기고 이 파일에서는 지우세요:\n${lines.join('\n')}${more}`,
      )
    }
    const keys = await privateKeyFindings(scan.files)
    if (keys.length > 0) {
      const lines = keys.slice(0, 20).map((x) => `  - ${x}`)
      const more = keys.length > 20 ? `\n  … 외 ${keys.length - 20}개` : ''
      fail(
        ExitCode.FAILURE,
        `개인 키가 든 파일이 있어 올리지 않습니다(값은 표시하지 않음). 이 파일을 프로젝트 밖으로 옮기거나 .bstageignore 에 넣으세요:\n${lines.join('\n')}${more}`,
      )
    }
    if (attempt === 0 && scan.envConfigs.length > 0) {
      const lines = scan.envConfigs.slice(0, 20).map((x) => `  - ${x}`)
      const more = scan.envConfigs.length > 20 ? `\n  … 외 ${scan.envConfigs.length - 20}개` : ''
      log(
        pc.yellow(
          `[bstage] env 이름의 설정 파일 ${scan.envConfigs.length}개는 비밀값이 들 수 있어 올리지 않습니다(.bstageinclude 로도 올릴 수 없음). 공개 값은 .env.{mode} 의 VITE_ 줄로 옮기세요:\n${lines.join('\n')}${more}`,
        ),
      )
    }
    if (attempt === 0 && scan.notAllowed.length > 0) {
      const head = scan.notAllowed.slice(0, SHOW_SKIPPED).join(', ')
      const rest = scan.notAllowed.length > SHOW_SKIPPED ? ' …' : ''
      log(
        pc.dim(
          `[bstage] 올리지 않은 파일 ${scan.notAllowed.length}개 — 필요하면 .bstageinclude 에 적으세요: ${head}${rest}`,
        ),
      )
    }
    if (attempt === 0 && scan.skipped.length > 0) {
      const head = scan.skipped.slice(0, SHOW_SKIPPED).join(', ')
      const rest = scan.skipped.length > SHOW_SKIPPED ? ' …' : ''
      log(pc.dim(`[bstage] 올리지 않고 건너뛴 경로 ${scan.skipped.length}개: ${head}${rest}`))
    }

    try {
      const session = await ctx.client.createUpload(org, space, repo.id, {
        expectedHead,
        message: options.message,
        force: options.force,
        files: scan.files.map(({ path, sha256, size, exec }) => ({ path, sha256, size, exec })),
      })
      const byHash = new Map(scan.files.map((f) => [f.sha256, f]))
      await runPool(session.missing, PUT_CONCURRENCY, async (m) => {
        const f = byHash.get(m.sha256)
        if (!f) throw new Error('서버가 요청한 파일이 목록에 없습니다. 다시 실행하세요')
        await putBlob(fetchFn, m, f.abs, f.size, f.sha256)
      })
      const res = await ctx.client.completeUpload(org, space, repo.id, session.uploadId)
      await recordBuiltinSync(
        cwd,
        repo.id,
        res.versionId,
        Object.fromEntries(scan.files.map((f) => [f.path, f.sha256])),
      )
      const unchanged = res.unchanged === true
      const no = versionNumber(res.number)
      if (no === null) {
        fail(
          ExitCode.FAILURE,
          '서버 응답의 버전 번호가 올바르지 않습니다. 콘솔의 버전 기록에서 저장 여부를 확인하세요',
        )
      }
      log(
        unchanged
          ? pc.green(`✓ 바뀐 내용이 없습니다 — v${no} 그대로입니다 (파일 ${scan.files.length}개)`)
          : pc.green(
              `✓ v${no} 저장 (파일 ${scan.files.length}개, 새로 올린 파일 ${session.missing.length}개)`,
            ),
      )
      return { versionId: res.versionId, number: no, unchanged }
    } catch (e) {
      if (e instanceof PortalError) {
        if (e.status === 409 && errCode(e) === 'HEAD_MOVED') {
          if (options.force) {
            fail(ExitCode.FAILURE, '동시에 다른 저장이 있었습니다 — 다시 실행하세요')
          }
          fail(
            ExitCode.FAILURE,
            `서버에 새 버전(v${versionNumber(e.details?.number) ?? '?'})이 있습니다. bstage pull 로 받은 뒤 다시 올리거나 --force 로 덮어쓰세요(덮인 버전은 기록에 남습니다)`,
          )
        }
        // 빈 목록인데 서버에는 파일이 있다 — 실수로 모두 지우지 않게 서버가 막았다(--force 면 허용).
        if (errCode(e) === 'EMPTY_UPLOAD') {
          fail(
            ExitCode.FAILURE,
            '올릴 파일이 없습니다(폴더가 비었거나 모두 무시 목록에 걸렸습니다). 서버 저장소의 모든 파일을 지우려는 것이라면 bstage push --force 로 올리세요(지운 버전은 기록에 남습니다).',
          )
        }
        // 파일이 올라오는 동안 바뀌었거나 업로드가 사라진 경우 — 한 번만 처음부터 다시 한다.
        if (attempt === 0 && RESTARTABLE.has(errCode(e) ?? '')) {
          log(pc.dim('[bstage] 올라온 파일이 서버 목록과 달라 처음부터 한 번 더 올립니다.'))
          continue
        }
        if (RESTARTABLE.has(errCode(e) ?? '')) {
          fail(ExitCode.FAILURE, `${e.message}${pathsHint(e)}`)
        }
      }
      if (e instanceof StorageDeniedError) fail(ExitCode.FAILURE, e.message)
      throw e
    }
  }
}

/** `bstage push [-m <메시지>] [--force]` — 이 폴더를 내장 저장소의 새 버전으로 올린다. */
export async function pushCommand(options: PushOptions, deps: PushDeps = {}): Promise<void> {
  const cwd = deps.cwd ?? process.cwd()
  const ctx = await resolveContext({ cwd, env: deps.env, fetch: deps.fetch })
  const repo = await resolveLinkedRepo(ctx)
  await pushSource(ctx, repo, cwd, options, deps.fetch ?? blobFetch, deps.out ?? console.log)
}
