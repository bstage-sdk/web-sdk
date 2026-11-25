import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { PORTAL_HOSTS } from '../constants.js'
import { saveLink } from '../portal/config.js'
import { saveCredential } from '../portal/credentials.js'

// 올리기·받기·배포 테스트가 함께 쓰는 가짜 포털 + 가짜 객체 저장소. 테스트 전용 — 번들에 들어가지 않는다.
export const PORTAL = `https://${PORTAL_HOSTS.sandbox}`
export const STORAGE = 'https://storage.invalid'

export const sha = (s: string | Buffer): string => createHash('sha256').update(s).digest('hex')

export interface FakeFile {
  path: string
  content: string
  exec?: boolean
}

export interface FakeOptions {
  source?: 'builtin' | 'github'
  /** 서버 head. */
  head?: { id: string; number: number }
  /** 서버가 이미 가진 blob 해시(missing 에서 빠진다). */
  have?: string[]
  /** manifest 로 줄 파일(받기). */
  files?: FakeFile[]
  /** complete 가 줄 오류(한 번 쓰면 사라진다). */
  completeErrors?: { status: number; body: unknown }[]
  /** PUT 응답 상태. */
  putStatus?: number
  /** 업로드 시작이 항상 HEAD_MOVED 로 답한다(force 여도 — 동시 저장 시험). */
  alwaysMoved?: boolean
  /** 내려받는 본문을 바꿔 보낸다(해시 불일치 시험). */
  corruptBody?: boolean
  /** 버전 기록(`GET .../code/versions`, 번호 내림차순으로 준다). */
  versions?: { id: string; number: number }[]
  /** 업로드 시작이 이 오류로 답한다. */
  beginError?: { status: number; body: unknown }
  /** manifest 응답의 versionId 를 이 값으로 바꾼다(요청 버전 일치 시험). */
  manifestVersionId?: string
  /** manifest 의 받기 주소를 바꾼다(주소 검사 시험). */
  fileUrl?: (path: string) => string
  /** manifest 파일 목록을 바꿔 보낸다(한도 시험). */
  manifestPatch?: (files: Record<string, unknown>[]) => Record<string, unknown>[]
  /** 내려받는 본문을 이것으로 보낸다(크기 초과 시험). */
  bodyOverride?: Buffer
  /** manifest·complete 응답의 number 를 이 값으로 바꾼다(번호 검증 시험). */
  numberOverride?: unknown
}

export interface FakeCall {
  method: string
  path: string
  body?: any
}

export function fake(opts: FakeOptions = {}) {
  const calls: FakeCall[] = []
  const puts: { url: string; headers: Record<string, string>; size: number }[] = []
  const head = opts.head ?? { id: 'a'.repeat(32), number: 1 }
  const completeErrors = [...(opts.completeErrors ?? [])]
  const blobs = new Map((opts.files ?? []).map((f) => [f.path, Buffer.from(f.content)]))
  const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s })
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(input))
    const method = init?.method ?? 'GET'
    if (u.origin === STORAGE) {
      if (method === 'PUT') {
        puts.push({
          url: String(input),
          headers: (init?.headers ?? {}) as Record<string, string>,
          size: (init!.body as Buffer).length,
        })
        return new Response('', { status: opts.putStatus ?? 200 })
      }
      const body = blobs.get(decodeURIComponent(u.pathname.slice(1)))
      if (body && opts.bodyOverride) return new Response(new Uint8Array(opts.bodyOverride))
      return body ? new Response(opts.corruptBody ? Buffer.from('evil') : body) : j({}, 404)
    }
    const path = u.pathname
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, path, body })
    if (path.endsWith('/repos'))
      return j({
        repos: [
          {
            id: 'r1',
            surface: 'USER',
            owner: 'a',
            repo: 'w',
            defaultBranch: 'main',
            ...(opts.source === 'builtin'
              ? { source: 'builtin', name: '내 템플릿', headSha: head.id, headNumber: head.number }
              : opts.source === 'github'
                ? { source: 'github' }
                : {}),
          },
        ],
      })
    if (path.endsWith('/code/versions') && method === 'GET') {
      const before = Number(u.searchParams.get('before') ?? 0)
      const limit = Number(u.searchParams.get('limit') ?? 50)
      const list = [...(opts.versions ?? [])]
        .sort((a, b) => b.number - a.number)
        .filter((v) => !before || v.number < before)
        .slice(0, limit)
      return j({ versions: list })
    }
    if (path.endsWith('/code/uploads') && method === 'POST' && opts.beginError) {
      return j(opts.beginError.body, opts.beginError.status)
    }
    if (path.endsWith('/code/uploads') && method === 'POST') {
      if (opts.alwaysMoved || (!body.force && body.expectedHead !== head.id)) {
        return j({ error: 'moved', code: 'HEAD_MOVED', head: head.id, number: head.number }, 409)
      }
      const have = new Set(opts.have ?? [])
      const seen = new Set<string>()
      const missing = []
      for (const f of body.files as { sha256: string }[]) {
        if (have.has(f.sha256) || seen.has(f.sha256)) continue
        seen.add(f.sha256)
        missing.push({
          sha256: f.sha256,
          putUrl: `${STORAGE}/put/${f.sha256}?sig=SECRETSIG`,
          headers: { 'x-amz-checksum-sha256': 'chk', 'Content-Type': 'application/octet-stream' },
        })
      }
      return j({ uploadId: 'u'.repeat(32), missing, expiresAt: '2030-01-01T00:00:00Z' })
    }
    if (path.endsWith('/complete')) {
      const e = completeErrors.shift()
      if (e) return j(e.body, e.status)
      return j({
        versionId: 'b'.repeat(32),
        number: 'numberOverride' in opts ? opts.numberOverride : head.number + 1,
      })
    }
    if (path.endsWith('/code/manifest')) {
      const files: Record<string, unknown>[] = (opts.files ?? []).map((f) => ({
        path: f.path,
        sha256: sha(f.content),
        size: Buffer.byteLength(f.content),
        exec: f.exec ?? false,
        url: opts.fileUrl
          ? opts.fileUrl(f.path)
          : `${STORAGE}/${encodeURIComponent(f.path)}?sig=SECRETSIG`,
      }))
      const asked = new URL(String(input)).searchParams.get('version')
      const askedNo = asked ? opts.versions?.find((v) => v.id === asked)?.number : undefined
      return j({
        versionId: opts.manifestVersionId ?? asked ?? head.id,
        number: 'numberOverride' in opts ? opts.numberOverride : (askedNo ?? head.number),
        files: opts.manifestPatch ? opts.manifestPatch(files) : files,
      })
    }
    return j({ error: path }, 404)
  }) as unknown as typeof fetch
  return { fetch: fetchFn, calls, puts, head }
}

/**
 * 테스트 프로젝트 폴더. 링크 파일의 `source` 는 기본 builtin(`bstage link` 가 남기는 값) — null 이면 적지 않는다(옛 링크 파일).
 */
export async function project(
  files: Record<string, string> = {},
  builtinHead?: string,
  linkSource: 'builtin' | 'github' | null = 'builtin',
) {
  const cwd = await mkdtemp(join(tmpdir(), 'builtin-'))
  // 자격증명은 프로젝트 밖에 둔다 — 안에 두면 훑기에 걸린다.
  const env = { XDG_CONFIG_HOME: await mkdtemp(join(tmpdir(), 'builtin-cred-')) }
  await saveCredential({ portalUrl: PORTAL, token: 'bsc_x', savedAt: '' }, env)
  await saveLink(cwd, {
    portalUrl: PORTAL,
    organizationId: 'o',
    spaceId: 's',
    repoId: 'r1',
    surface: 'USER',
    ...(linkSource ? { source: linkSource } : {}),
    ...(builtinHead ? { builtinHead } : {}),
  })
  for (const [p, c] of Object.entries(files)) {
    await mkdir(dirname(join(cwd, p)), { recursive: true })
    await writeFile(join(cwd, p), c)
  }
  return { cwd, env }
}
