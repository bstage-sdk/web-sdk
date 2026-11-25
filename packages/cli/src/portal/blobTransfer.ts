import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { lookup as dnsLookup } from 'node:dns/promises'
import { BlockList, isIPv4, isIPv6, type LookupFunction } from 'node:net'
import { Agent, fetch as undiciFetch, type Dispatcher } from 'undici'
import type { MissingBlob } from './client.js'

/** 객체 저장소가 서명 URL 을 거부했다(만료·서명 불일치). 다시 시작해야 한다. */
export class StorageDeniedError extends Error {
  constructor() {
    super('업로드 주소가 만료되었거나 거부되었습니다 — 다시 실행하세요')
    this.name = 'StorageDeniedError'
  }
}

/** 호스트 이름 → 주소들. 기본은 시스템 DNS(`dns.lookup(host, {all:true})`). */
export type BlobResolver = (host: string) => Promise<{ address: string; family: number }[]>

/** 테스트만 쓰는 명시 옵션 — 환경변수·CLI 플래그로는 켤 수 없다(실행 경로에서 넘기는 곳이 없다). */
export interface BlobUrlPolicy {
  /** true 면 http·사설/루프백 주소를 허용한다(로컬 가짜 저장소 테스트용). URL 모양 검사는 그대로. */
  allowUnsafeUrlForTest?: boolean
  /** 테스트용 이름 해석기. 없으면 시스템 DNS. */
  resolver?: BlobResolver
}

/** 이름이 내부 주소(루프백·사설·링크로컬·CGNAT·ULA·미지정)로 풀렸다. 다시 시도하지 않는다. */
export class BlockedAddressError extends Error {
  readonly code = 'EBSTAGE_BLOCKED_ADDRESS'
  constructor(reason = '내부 주소로 풀리는 이름입니다') {
    super(reason)
    this.name = 'BlockedAddressError'
  }
}

// 루프백·사설·링크로컬·CGNAT·미지정 대역(AWS Security Agent 2차 M1). 서버가 준 서명 URL 로 내부망·메타데이터 주소를 치지 않게 한다.
// 4차: IETF 예약(192.0.0.0/24)·벤치마크(198.18.0.0/15)·멀티캐스트(224.0.0.0/4)·예약(240.0.0.0/4, 브로드캐스트 포함)도 막는다.
const BLOCKED = new BlockList()
BLOCKED.addSubnet('0.0.0.0', 8, 'ipv4')
BLOCKED.addSubnet('10.0.0.0', 8, 'ipv4')
BLOCKED.addSubnet('100.64.0.0', 10, 'ipv4')
BLOCKED.addSubnet('127.0.0.0', 8, 'ipv4')
BLOCKED.addSubnet('169.254.0.0', 16, 'ipv4')
BLOCKED.addSubnet('172.16.0.0', 12, 'ipv4')
BLOCKED.addSubnet('192.0.0.0', 24, 'ipv4')
BLOCKED.addSubnet('192.168.0.0', 16, 'ipv4')
BLOCKED.addSubnet('198.18.0.0', 15, 'ipv4')
BLOCKED.addSubnet('224.0.0.0', 4, 'ipv4')
BLOCKED.addSubnet('240.0.0.0', 4, 'ipv4')
BLOCKED.addAddress('::', 'ipv6')
BLOCKED.addAddress('::1', 'ipv6')
BLOCKED.addSubnet('fc00::', 7, 'ipv6')
BLOCKED.addSubnet('fe80::', 10, 'ipv6')
BLOCKED.addSubnet('ff00::', 8, 'ipv6')
// 품은 IPv4 를 알 수 없는 변환 대역은 통째로 막는다: NAT64 지역용(64:ff9b:1::/48 — 접두 길이마다 위치가 다르다),
// Teredo(2001::/32 — 클라이언트 주소가 뒤집혀 들어 있다).
BLOCKED.addSubnet('64:ff9b:1::', 48, 'ipv6')
BLOCKED.addSubnet('2001::', 32, 'ipv6')
// 5차: 전역 라우팅이 되지 않는 나머지 IPv6 대역(IANA special-purpose) — 사이트 로컬(폐기됐지만 내부망에서 아직 쓰임)·폐기(discard)·
// IETF 프로토콜 할당(2001::/23 — ORCHID 2001:10::/28·ORCHIDv2 2001:20::/28 포함)·문서용(2001:db8::/32, 3fff::/20).
BLOCKED.addSubnet('fec0::', 10, 'ipv6')
BLOCKED.addSubnet('100::', 64, 'ipv6')
BLOCKED.addSubnet('2001::', 23, 'ipv6')
BLOCKED.addSubnet('2001:10::', 28, 'ipv6')
BLOCKED.addSubnet('2001:20::', 28, 'ipv6')
BLOCKED.addSubnet('2001:db8::', 32, 'ipv6')
BLOCKED.addSubnet('3fff::', 20, 'ipv6')

/** IPv6 문자열을 16비트 8개로 펼친다(`::` 생략·끝의 점 표기 IPv4·zone 포함). 아니면 null. */
function ipv6Groups(addr: string): number[] | null {
  let a = addr.toLowerCase()
  const zone = a.indexOf('%')
  if (zone >= 0) a = a.slice(0, zone)
  // 끝의 점 표기 IPv4 를 16진 두 묶음으로.
  const dotted = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(a)
  if (dotted) {
    if (!isIPv4(dotted[2]!)) return null
    const o = dotted[2]!.split('.').map(Number)
    a = `${dotted[1]}${((o[0]! << 8) | o[1]!).toString(16)}:${((o[2]! << 8) | o[3]!).toString(16)}`
  }
  const parts = a.split('::')
  if (parts.length > 2) return null
  const parse = (p: string): number[] | null => {
    if (p === '') return []
    const out: number[] = []
    for (const g of p.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null
      out.push(parseInt(g, 16))
    }
    return out
  }
  const head = parse(parts[0]!)
  const tail = parts.length === 2 ? parse(parts[1]!) : []
  if (!head || !tail) return null
  if (parts.length === 1) return head.length === 8 ? head : null
  const fill = 8 - head.length - tail.length
  if (fill < 1) return null
  return [...head, ...Array<number>(fill).fill(0), ...tail]
}

const v4From = (hi: number, lo: number): string => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`

/**
 * IPv6 가 품은 IPv4 를 꺼낸다(AWS Security Agent 4차). 없으면 null.
 * - `::ffff:0:0/96`(mapped)·`::/96`(compatible, `::`·`::1` 포함)·`::ffff:0:0:0/96`(translated)·`64:ff9b::/96`(NAT64): 끝 32비트
 * - `2002::/16`(6to4): 16~48 비트
 */
function embeddedIPv4(g: number[]): string | null {
  const zero = (from: number, to: number): boolean => g.slice(from, to).every((x) => x === 0)
  if (zero(0, 5) && g[5] === 0xffff) return v4From(g[6]!, g[7]!)
  if (zero(0, 6)) return v4From(g[6]!, g[7]!)
  if (zero(0, 4) && g[4] === 0xffff && g[5] === 0) return v4From(g[6]!, g[7]!)
  if (g[0] === 0x64 && g[1] === 0xff9b && zero(2, 6)) return v4From(g[6]!, g[7]!)
  if (g[0] === 0x2002) return v4From(g[1]!, g[2]!)
  return null
}

/** IP 리터럴(대괄호 없이) 하나가 막힌 대역인가. IPv4 를 품은 IPv6 는 그 IPv4 로도 본다. */
function blockedIP(addr: string): boolean {
  if (isIPv4(addr)) return BLOCKED.check(addr, 'ipv4')
  const g = isIPv6(addr) ? ipv6Groups(addr) : null
  if (!g) return true
  if (BLOCKED.check(addr, 'ipv6')) return true
  const v4 = embeddedIPv4(g)
  return v4 !== null && BLOCKED.check(v4, 'ipv4')
}

/** 주소 하나가 막힌 대역인가(IPv4·IPv6·IPv4 를 품은 IPv6). IP 가 아니면 막는다. */
export function isBlockedAddress(addr: string): boolean {
  return blockedIP(addr)
}

const systemResolver: BlobResolver = (host) => dnsLookup(host, { all: true, verbatim: true })

/**
 * 이름을 풀어 나온 주소 전부를 검사한다(AWS Security Agent 3차 L1). 하나라도 막힌 대역이거나 하나도 없으면
 * BlockedAddressError. 통과한 주소 목록을 돌려준다 — 연결은 이 주소로만 한다(pinnedLookup).
 */
export async function resolveBlobHost(
  host: string,
  resolver: BlobResolver = systemResolver,
): Promise<{ address: string; family: number }[]> {
  const list = await resolver(host)
  if (list.length === 0) throw new BlockedAddressError('주소를 찾을 수 없는 이름입니다')
  if (list.some((a) => isBlockedAddress(a.address))) throw new BlockedAddressError()
  return list.map((a) => ({ address: a.address, family: a.family }))
}

/**
 * 연결용 lookup — 연결하는 바로 그 시점에 이름을 풀어 검사하고(검사와 연결 사이에 DNS 가 바뀌는 rebinding 틈이 없다),
 * 검사한 주소만 돌려준다. TLS SNI·Host 는 원래 이름 그대로다(undici 가 hostname 으로 정한다).
 * allowUnsafe 는 테스트 전용(검사 없이 해석기 결과로 고정).
 */
export function pinnedLookup(resolver: BlobResolver, allowUnsafe: boolean): LookupFunction {
  return (hostname, options, callback) => {
    const run = allowUnsafe ? resolver(hostname) : resolveBlobHost(hostname, resolver)
    run.then(
      (list) => {
        const fam = options.family === 4 || options.family === 6 ? options.family : 0
        const pick = fam ? list.filter((a) => a.family === fam) : list
        if (pick.length === 0) {
          callback(new BlockedAddressError('주소를 찾을 수 없는 이름입니다'), '', 0)
          return
        }
        if (options.all) callback(null, pick)
        else callback(null, pick[0]!.address, pick[0]!.family)
      },
      (err: unknown) => callback(err as NodeJS.ErrnoException, '', 0),
    )
  }
}

let sharedDispatcher: Dispatcher | undefined

/** 서명 URL 요청용 dispatcher. 기본(실행 경로)은 시스템 DNS + 검사 lookup 을 쓰는 공유 Agent. */
function blobDispatcher(policy: BlobUrlPolicy): Dispatcher {
  if (!policy.resolver && !policy.allowUnsafeUrlForTest) {
    sharedDispatcher ??= new Agent({ connect: { lookup: pinnedLookup(systemResolver, false) } })
    return sharedDispatcher
  }
  return new Agent({
    connect: {
      lookup: pinnedLookup(
        policy.resolver ?? systemResolver,
        policy.allowUnsafeUrlForTest === true,
      ),
    },
  })
}

/**
 * 서명 URL 받기·올리기의 기본 fetch — dispatcher(검사·고정 lookup)를 쓰려고 undici 의 fetch 를 쓴다
 * (Node 내장 fetch 와 npm undici 의 버전이 달라도 어긋나지 않게).
 */
export const blobFetch = undiciFetch as unknown as typeof fetch

/**
 * 서명 URL 검사. 문제가 있으면 사유(URL 은 싣지 않는다 — 서명이 들어 있다), 통과하면 null.
 * https 만, `localhost`·루프백·사설·링크로컬·CGNAT IP 리터럴은 거부한다(URL 파서가 10진·16진 IPv4 표기를 정규화한 뒤 본다).
 * 이름(DNS)은 여기서 풀지 않는다 — 연결 시점에 pinnedLookup 이 풀어 검사하고 그 주소로 고정한다.
 */
export function checkBlobUrl(raw: string, policy: BlobUrlPolicy = {}): string | null {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return '주소 형식이 올바르지 않습니다'
  }
  if (policy.allowUnsafeUrlForTest) return null
  if (u.protocol !== 'https:') return 'https 주소가 아닙니다'
  const host = u.hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost')) return '내부 주소입니다'
  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
  if ((isIPv4(bare) || isIPv6(bare)) && blockedIP(bare)) return '내부 주소입니다'
  return null
}

function assertBlobUrl(what: string, raw: string, policy: BlobUrlPolicy): void {
  const reason = checkBlobUrl(raw, policy)
  if (reason)
    throw new Error(`서버가 준 ${what} 주소를 쓸 수 없습니다(${reason}) — 다시 실행하세요`)
}

/**
 * 서명 URL 에는 자격이 들어 있다 — 오류 메시지·로그에 URL 을 절대 싣지 않는다.
 * fetch 가 던진 원본(cause 에 주소가 있을 수 있음)은 버리고 코드만 남긴다.
 */
function blockedIn(err: unknown): BlockedAddressError | undefined {
  for (let e: unknown = err, i = 0; e && i < 5; e = (e as { cause?: unknown }).cause, i++) {
    if (e instanceof BlockedAddressError) return e
  }
  return undefined
}

function sanitizedNetworkError(what: string, err: unknown): Error {
  const blocked = blockedIn(err)
  if (blocked)
    return new Error(
      `서버가 준 ${what} 주소를 쓸 수 없습니다(${blocked.message}) — 다시 실행하세요`,
    )
  const code = (err as { cause?: { code?: string } }).cause?.code
  return new Error(
    `${what} 중 네트워크 오류${code ? ` (${code})` : ''} — 네트워크를 확인하고 다시 실행하세요`,
  )
}

async function withOneRetry(what: string, run: () => Promise<Response>): Promise<Response> {
  try {
    return await run()
  } catch (first) {
    if (blockedIn(first)) throw sanitizedNetworkError(what, first)
    try {
      return await run()
    } catch {
      throw sanitizedNetworkError(what, first)
    }
  }
}

/**
 * 파일 하나를 서명 PUT 으로 올린다. 헤더는 서버가 준 그대로(서명 대상) — 하나도 빼지 않는다. 리디렉트는 따라가지 않는다.
 * 연결은 검사한 주소로만 한다(dispatcher — 실행 경로의 fetchFn 은 blobFetch).
 */
export async function putBlob(
  fetchFn: typeof fetch,
  blob: MissingBlob,
  abs: string,
  size: number,
  sha256: string,
  policy: BlobUrlPolicy = {},
): Promise<void> {
  assertBlobUrl('업로드', blob.putUrl, policy)
  const body = await readFile(abs)
  // 목록을 만든 뒤 파일이 바뀌었다면 서버에 가기 전에 알린다(서명의 Content-Length·체크섬이 어긋난다).
  if (body.length !== size || createHash('sha256').update(body).digest('hex') !== sha256) {
    throw new Error(`올리는 동안 파일이 바뀌었습니다: ${abs}. 다시 실행하세요`)
  }
  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries(blob.headers ?? {})) {
    // Content-Length 는 본문 크기로 fetch 가 정한다(size 와 같음을 위에서 확인했다).
    if (k.toLowerCase() !== 'content-length') headers[k] = v
  }
  const dispatcher = blobDispatcher(policy)
  const res = await withOneRetry('업로드', () =>
    fetchFn(blob.putUrl, {
      method: 'PUT',
      headers,
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(120_000),
      dispatcher,
    } as RequestInit),
  )
  if (res.status === 403) throw new StorageDeniedError()
  if (!res.ok) throw new Error(`파일 업로드에 실패했습니다 (HTTP ${res.status})`)
}

/** 받는 본문이 목록(manifest)이 말한 크기보다 크다. 다시 시도하지 않는다. */
export class BlobTooLargeError extends Error {
  constructor() {
    super('받은 파일이 목록보다 큽니다')
    this.name = 'BlobTooLargeError'
  }
}

/**
 * 본문을 maxBytes 까지만 읽는다(AWS Security Agent 4차). 넘으면 더 읽지 않고 스트림을 끊는다 — 메모리에는
 * 최대 maxBytes+1 바이트만 남는다(넘친 조각은 버린다).
 */
async function readCapped(res: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(res.headers.get('content-length') ?? NaN)
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => {})
    throw new BlobTooLargeError()
  }
  if (!res.body) return Buffer.alloc(0)
  const reader = res.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => {})
      throw new BlobTooLargeError()
    }
    chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength))
  }
  return Buffer.concat(chunks, total)
}

/**
 * 서명 GET 으로 파일 하나를 받는다. maxBytes 가 있으면 그 크기까지만 읽고, 넘으면 BlobTooLargeError.
 * 해시 검증은 호출자 몫.
 */
export async function getBlob(
  fetchFn: typeof fetch,
  url: string,
  policy: BlobUrlPolicy = {},
  maxBytes?: number,
): Promise<Buffer> {
  assertBlobUrl('받기', url, policy)
  // 리디렉트는 따라가지 않는다 — 검사한 주소가 아닌 곳(내부망 등)으로 끌려가지 않게.
  const dispatcher = blobDispatcher(policy)
  const res = await withOneRetry('다운로드', () =>
    fetchFn(url, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(120_000),
      dispatcher,
    } as RequestInit),
  )
  if (res.status === 403)
    throw new Error('받기 주소가 만료되었거나 거부되었습니다 — 다시 실행하세요')
  if (!res.ok) throw new Error(`파일 다운로드에 실패했습니다 (HTTP ${res.status})`)
  if (maxBytes !== undefined) return readCapped(res, maxBytes)
  return Buffer.from(await res.arrayBuffer())
}

/** 동시 실행 수를 제한해 모든 항목을 처리한다. 하나라도 실패하면 첫 오류로 끝낸다. */
export async function runPool<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0
  let failed: unknown
  let hasFailed = false
  const worker = async (): Promise<void> => {
    while (!hasFailed && next < items.length) {
      const item = items[next++]!
      try {
        await fn(item)
      } catch (e) {
        if (!hasFailed) {
          hasFailed = true
          failed = e
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  if (hasFailed) throw failed
}
