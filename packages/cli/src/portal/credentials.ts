import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { normalizePortalUrl } from './config.js'

/**
 * 포털 로그인 자격증명(토큰) 저장소.
 *
 * `$XDG_CONFIG_HOME/bstage/credentials.json`(없으면 `~/.config/...`)에 **포털 주소 → 조직 →
 * 토큰**으로 저장한다 — 디렉토리 0700, 파일 0600. 토큰 하나는 조직 하나에 묶이므로,
 * 조직을 넘나들려면 같은 포털에 토큰이 여러 개 필요하다. 포털 주소만 키로 쓰던 v1
 * 스키마는 두 번째 로그인이 첫 토큰을 덮어썼다.
 *
 * v1(`{ "<portal>": {token, savedAt} }`) 파일은 읽을 때 조직 미상(`"*"`) 항목으로
 * 마이그레이션해 그대로 동작하고, 쓸 때는 항상 v2로 저장한다.
 */

/** 조직을 알 수 없는 토큰(v1 마이그레이션·`organizationId` 없는 응답)이 들어가는 자리. */
export const UNKNOWN_ORG = '*'

export interface CredentialEntry {
  token: string
  savedAt: string
  /** 발급 시점의 토큰 등급·스코프·만료. 사람이 whoami로 확인하는 값이라 저장해 둔다. */
  permission?: string
  allSpaces?: boolean
  spaceIds?: string[]
  expiresAt?: string
}

export interface Credential extends CredentialEntry {
  portalUrl: string
  organizationId: string
}

/** 저장 입력 — `organizationId`가 없으면 조직 미상(`"*"`)으로 들어간다. */
export interface SaveCredentialInput extends CredentialEntry {
  portalUrl: string
  organizationId?: string
}

type Env = NodeJS.ProcessEnv

interface CredentialFile {
  version: 2
  /** 포털 주소 → 조직 id → 항목. */
  tokens: Record<string, Record<string, CredentialEntry>>
}

export function credentialsPath(env: Env = process.env): string {
  const base = env.XDG_CONFIG_HOME || join(homedir(), '.config')
  return join(base, 'bstage', 'credentials.json')
}

/** 프로토타입 속성(`constructor` 등)을 항목으로 착각하지 않게 자기 속성만 본다. */
function hasEntry(bucket: Record<string, CredentialEntry>, org: string): boolean {
  return Object.prototype.hasOwnProperty.call(bucket, org)
}

function isEntry(v: unknown): v is CredentialEntry {
  if (!v || typeof v !== 'object') return false
  const token = (v as { token?: unknown }).token
  return typeof token === 'string' && token.length > 0
}

/** 항목이 아닌 값(손상·수기 편집)은 버린다 — 빈 버킷이 된 포털도 함께 지운다. */
function sanitize(tokens: Record<string, unknown>): CredentialFile['tokens'] {
  const buckets = Object.entries(tokens).map(([portal, bucket]) => {
    if (!bucket || typeof bucket !== 'object') return [portal, {}] as const
    const kept = Object.entries(bucket as Record<string, unknown>).filter(([, v]) => isEntry(v))
    return [portal, Object.fromEntries(kept) as Record<string, CredentialEntry>] as const
  })
  return Object.fromEntries(buckets.filter(([, bucket]) => Object.keys(bucket).length > 0))
}

/** v1(포털 → 항목)은 조직 미상 버킷으로 옮기고, 그 밖의 모양은 빈 파일로 본다. */
function migrate(raw: unknown): CredentialFile {
  if (!raw || typeof raw !== 'object') return { version: 2, tokens: {} }
  const obj = raw as Record<string, unknown>
  if (obj.version === 2 && obj.tokens && typeof obj.tokens === 'object') {
    return { version: 2, tokens: sanitize(obj.tokens as Record<string, unknown>) }
  }
  const tokens = Object.entries(obj)
    .filter(([, v]) => isEntry(v))
    .map(([portal, v]) => [portal, { [UNKNOWN_ORG]: v as CredentialEntry }] as const)
  return { version: 2, tokens: Object.fromEntries(tokens) }
}

async function readCredentialFile(env: Env): Promise<CredentialFile> {
  try {
    return migrate(JSON.parse(await readFile(credentialsPath(env), 'utf-8')))
  } catch {
    return { version: 2, tokens: {} }
  }
}

async function writeCredentialFile(env: Env, data: CredentialFile): Promise<void> {
  const p = credentialsPath(env)
  await mkdir(dirname(p), { recursive: true, mode: 0o700 })
  await chmod(dirname(p), 0o700)
  // 원자적 쓰기: 같은 디렉터리의 임시 파일을 0600으로 만들어 내용을 다 쓴 뒤 rename한다.
  // 기존 파일에 곧장 쓰면 writeFile의 mode 옵션이 무시돼(이미 있는 파일에는 적용되지 않는다)
  // 느슨한 모드의 파일에 토큰이 먼저 들어가고 chmod가 뒤따르는 창이 생긴다 — rename은
  // 대상의 옛 모드를 물려받지 않으므로 그 창이 없다.
  const tmp = `${p}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 })
  await chmod(tmp, 0o600) // umask가 mode 옵션을 깎았을 수 있다
  await rename(tmp, p)
}

function entryOf(c: SaveCredentialInput): CredentialEntry {
  // undefined 필드는 JSON.stringify가 지운다 — 모르는 값은 키 자체가 남지 않는다.
  return {
    token: c.token,
    savedAt: c.savedAt,
    permission: c.permission,
    allSpaces: c.allSpaces,
    spaceIds: c.spaceIds,
    expiresAt: c.expiresAt,
  }
}

/**
 * 조직을 알고 저장하면 그 포털의 조직 미상 항목은 지운다 — 어느 조직 것인지 모르는 토큰이
 * 남아 있으면 조직을 지정하지 않은 조회를 계속 가로챈다. 필요하면 다시 로그인하면 된다.
 */
export async function saveCredential(
  c: SaveCredentialInput,
  env: Env = process.env,
): Promise<void> {
  const key = normalizePortalUrl(c.portalUrl)
  const org = c.organizationId || UNKNOWN_ORG
  const data = await readCredentialFile(env)
  const kept = Object.entries(data.tokens[key] ?? {}).filter(
    ([o]) => org === UNKNOWN_ORG || o !== UNKNOWN_ORG,
  )
  const bucket = { ...Object.fromEntries(kept), [org]: entryOf(c) }
  await writeCredentialFile(env, { version: 2, tokens: { ...data.tokens, [key]: bucket } })
}

async function bucketOf(portalUrl: string, env: Env): Promise<Record<string, CredentialEntry>> {
  return (await readCredentialFile(env)).tokens[normalizePortalUrl(portalUrl)] ?? {}
}

/**
 * 어느 항목을 쓸지 고른다.
 *
 * - 조직을 **명시했으면** 그 조직 항목만 쓴다. 다른 조직 토큰으로 대신하지 않는다 —
 *   조직이 다른 토큰은 어차피 포털이 거절하고, 그 사이 무엇이 잘못됐는지가 흐려진다.
 *   예외는 v1에서 마이그레이션된 레거시 항목 하나뿐인 경우다(그 파일은 조직을 담은 적이
 *   없으므로 그 토큰이 곧 그 사람의 유일한 토큰이다).
 * - 조직을 **주지 않았으면** 조직 미상 → 포털에 토큰이 하나뿐이면 그것 순으로 고른다.
 */
function pickOrg(bucket: Record<string, CredentialEntry>, organizationId?: string): string | null {
  const orgs = Object.keys(bucket)
  if (organizationId) {
    if (hasEntry(bucket, organizationId)) return organizationId
    return orgs.length === 1 && orgs[0] === UNKNOWN_ORG ? UNKNOWN_ORG : null
  }
  if (hasEntry(bucket, UNKNOWN_ORG)) return UNKNOWN_ORG
  return orgs.length === 1 ? orgs[0] : null
}

/**
 * 저장된 토큰 하나를 고른다. 고르지 못하면 null이다 — 호출자는 `listCredentialOrgs`로
 * 후보를 안내한다.
 */
export async function loadCredential(
  portalUrl: string,
  organizationId?: string,
  env: Env = process.env,
): Promise<Credential | null> {
  const bucket = await bucketOf(portalUrl, env)
  const picked = pickOrg(bucket, organizationId)
  if (!picked) return null
  return { portalUrl: normalizePortalUrl(portalUrl), organizationId: picked, ...bucket[picked] }
}

/** 이 포털에 토큰이 저장된 조직 id 목록(정렬). 조직 미상은 `"*"`로 들어 있다. */
export async function listCredentialOrgs(
  portalUrl: string,
  env: Env = process.env,
): Promise<string[]> {
  return Object.keys(await bucketOf(portalUrl, env)).sort()
}

/** 이 포털의 조직별 자격증명 전부 — whoami가 등급·스코프·만료를 보여줄 때 쓴다. */
export async function listCredentials(
  portalUrl: string,
  env: Env = process.env,
): Promise<Credential[]> {
  const bucket = await bucketOf(portalUrl, env)
  const key = normalizePortalUrl(portalUrl)
  return Object.keys(bucket)
    .sort()
    .map((organizationId) => ({ portalUrl: key, organizationId, ...bucket[organizationId] }))
}

/**
 * 조직을 주면 그 항목만, 주지 않으면 그 포털의 모든 조직 토큰을 지운다.
 * 지운 조직 id 목록을 돌려준다(없었으면 빈 배열).
 */
export async function deleteCredential(
  portalUrl: string,
  organizationId?: string,
  env: Env = process.env,
): Promise<string[]> {
  const data = await readCredentialFile(env)
  const key = normalizePortalUrl(portalUrl)
  const bucket = data.tokens[key]
  if (!bucket) return []
  // 조직을 지정한 삭제는 조회(pickOrg)와 같은 규칙으로 대상을 정하고, 레거시 "*" 항목이 함께
  // 있으면 그것도 지운다 — 조직을 모르는 토큰이라 그 조직의 것일 수 있고, 남겨두면 조직 항목이
  // 사라진 뒤 pickOrg 의 단일 항목 폴백으로 되살아나 로그아웃이 무효가 된다(agent #337 MEDIUM).
  const resolved = organizationId ? pickOrg(bucket, organizationId) : null
  const legacy = resolved && hasEntry(bucket, UNKNOWN_ORG) ? [UNKNOWN_ORG] : []
  const removed = organizationId
    ? resolved
      ? [...new Set([resolved, ...legacy])]
      : []
    : Object.keys(bucket).sort()
  if (removed.length === 0) return []
  const rest = Object.entries(bucket).filter(([org]) => !removed.includes(org))
  const tokens = Object.fromEntries(
    Object.entries(data.tokens)
      .filter(([portal]) => portal !== key)
      .concat(rest.length > 0 ? [[key, Object.fromEntries(rest)]] : []),
  )
  if (Object.keys(tokens).length === 0) {
    await rm(credentialsPath(env), { force: true })
  } else {
    await writeCredentialFile(env, { version: 2, tokens })
  }
  return removed
}

/** CI는 BSTAGE_TOKEN을 쓴다 — 저장된 자격증명 파일보다 우선한다. */
export async function resolveToken(
  portalUrl: string,
  env: Env = process.env,
  organizationId?: string,
): Promise<string | null> {
  if (env.BSTAGE_TOKEN) return env.BSTAGE_TOKEN
  return (await loadCredential(portalUrl, organizationId, env))?.token ?? null
}

/** 토큰 스코프의 사람이 읽는 표현 — 조직 전체면 스테이지를 나열하지 않는다. */
export function scopeLabel(allSpaces?: boolean, spaceIds: string[] = []): string {
  if (allSpaces) return '이 조직의 모든 스테이지'
  if (spaceIds.length === 0) return '스테이지 없음'
  return `스테이지 ${spaceIds.length}개 (${spaceIds.join(', ')})`
}

/** 조직 미상 토큰은 id 대신 그렇다고 적는다. */
export function orgLabel(organizationId: string): string {
  return organizationId === UNKNOWN_ORG ? '조직 미상' : organizationId
}
