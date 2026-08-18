import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// ── 경로 프리픽스 ─────────────────────────────────────────────────────
/** bstage 내부 경로 프리픽스 */
export const BSTAGE_INTERNAL_PREFIX = '/__bstage__'
/** 로그인 페이지 경로 */
export const LOGIN_PATH = `${BSTAGE_INTERNAL_PREFIX}/login`
/** 게이트웨이 프록시 경로 프리픽스 */
export const PROXY_PATH_PREFIX = '/__proxy__'
/** 인증 프록시 경로 프리픽스 */
export const AUTH_PATH_PREFIX = '/__auth__'

// ── 인증 모드 ──────────────────────────────────────────────────────────
/**
 * 인증 모드. 같은 SDK CLI 안에서 유저 플랫폼/어드민 플랫폼 두 종류 로그인을
 * 모두 다룬다. 호스트·경로·쿠키 이름이 전부 달라서 모드로 분기한다.
 */
export type AuthMode = 'user' | 'admin'

// ── 쿠키 ──────────────────────────────────────────────────────────────
/** 유저 액세스 토큰 쿠키 이름 (유저 플랫폼 쪽) */
export const ACCESS_TOKEN_COOKIE = 'bmf_bstage_access_token'
/** 어드민 액세스 토큰 쿠키 이름 (어드민 플랫폼 쪽) */
export const ADMIN_ACCESS_TOKEN_COOKIE = 'bmf_mybstage_admin_access_token'

/** 쿠키에서 유저 액세스 토큰 값을 추출하는 정규식 */
export const ACCESS_TOKEN_RE = new RegExp(`${ACCESS_TOKEN_COOKIE}=([^;]+)`)
/** 쿠키에서 어드민 액세스 토큰 값을 추출하는 정규식 */
export const ADMIN_ACCESS_TOKEN_RE = new RegExp(`${ADMIN_ACCESS_TOKEN_COOKIE}=([^;]+)`)

/** 모드별 쿠키 이름 */
export const ACCESS_TOKEN_COOKIE_BY_MODE: Record<AuthMode, string> = {
  user: ACCESS_TOKEN_COOKIE,
  admin: ADMIN_ACCESS_TOKEN_COOKIE,
}

/** 모드별 쿠키 추출 정규식 */
export const ACCESS_TOKEN_RE_BY_MODE: Record<AuthMode, RegExp> = {
  user: ACCESS_TOKEN_RE,
  admin: ADMIN_ACCESS_TOKEN_RE,
}

// ── 헤더 ──────────────────────────────────────────────────────────────
/** 테넌트 식별 요청 헤더 */
export const TENANT_ID_HEADER = 'x-bstage-tenant-id'

// ── 호스트 ─────────────────────────────────────────────────────────────
/*
 * 아래 세 맵은 **게이트 없이 바로 닿는 phase만** 담는다(real·sandbox).
 *
 * dev·qa는 사내 전용이라 호스트를 코드에 두지 않고 소비자가 `.env`로 공급한다
 * (`dev/resolveHosts.ts`). CF Access 자격증명을 뺀 것과 같은 이유다 — 패키지
 * 번들과 소스맵에 그대로 실려 나가고, 저장소가 공개되면 내부 환경 구성이 드러난다.
 */

/** phase별 게이트웨이 호스트 */
export const GATEWAY_HOSTS: Record<string, (tenantId: string) => string> = {
  real: (id) => `${id}.bstage.in`,
  // sandbox는 real식 — 테넌트 도메인이 곧 게이트웨이(공용 게이트웨이 호스트 아님)
  sandbox: (id) => `${id}.sandstage.in`,
}

/** phase별 유저 인증 서버 호스트 (테넌트별로 분리됨) */
export const AUTH_HOSTS: Record<string, (tenantId: string) => string> = {
  real: (id) => `${id}.bstage.in`,
  // sandbox는 real식 — 게이트웨이와 동일한 테넌트 도메인이 인증 호스트
  sandbox: (id) => `${id}.sandstage.in`,
}

/**
 * phase별 어드민 인증 서버 호스트.
 * 어드민은 모든 테넌트가 공통 호스트(account.*)를 쓴다.
 */
export const ADMIN_AUTH_HOSTS: Record<string, () => string> = {
  real: () => 'account.mybstage.in',
  // sandbox는 real식 — phase 세그먼트 없는 단일 account 호스트
  sandbox: () => 'account.mysandstage.in',
}

/**
 * 호스트가 SDK 안에 들어 있는 phase인가.
 *
 * "게이트 뒤인가"와 같은 질문이라 CF Access 면제 판정도 이 함수를 쓴다
 * (`dev/proxyUtils.ts`). 두 곳에 따로 목록을 두면 한쪽만 고쳤을 때
 * 호스트는 `.env`에서 왔는데 CF 헤더는 안 붙는 식으로 어긋난다.
 */
export function isPublicPhase(phase: string): boolean {
  return phase in GATEWAY_HOSTS
}

/** phase별 API 경로 prefix */
export const PHASE_PATH_PREFIX: Record<string, string> = {
  dev: '/api',
  qa: '/api',
  real: '/gw',
  // sandbox는 real식 게이트웨이 프리픽스
  sandbox: '/gw',
}

// ── 인증 경로 ──────────────────────────────────────────────────────────
/**
 * 모드별 토큰 발급 경로.
 * - user: `/svc/account/api/v1/auth/token`
 * - admin: `/svc/api/v1/auth/token`
 */
export const AUTH_TOKEN_PATH_BY_MODE: Record<AuthMode, string> = {
  user: '/svc/account/api/v1/auth/token',
  admin: '/svc/api/v1/auth/token',
}

/** 모드별 토큰 리프레시 경로 */
export const AUTH_TOKEN_REFRESH_PATH_BY_MODE: Record<AuthMode, string> = {
  user: '/svc/account/api/v1/auth/token/refresh',
  admin: '/svc/api/v1/auth/token/refresh',
}

// ── 다국어 ──────────────────────────────────────────────────────────────
/**
 * 제품 지원 로케일 — core `LANGUAGES`(packages/core/src/i18n.ts)를 미러링.
 * core가 로케일을 추가/제거하면 여기도 함께 갱신한다.
 */
export const TRANSLATION_LANGUAGES = ['ko', 'en', 'ja', 'zh-CN', 'zh-TW', 'es', 'vi'] as const

/** 기본 번역 tier (서드파티 템플릿은 inhouse) */
export const DEFAULT_TRANSLATION_TIER = 'inhouse'

/**
 * 번역 CDN 호스트. Hub가 최신 번역을 받아오는 곳과 동일(인증·테넌트 불필요한 public CDN).
 * `bstage i18n pull`이 Hub를 거치지 않고 여기서 직접 받는다.
 */
export const TRANSLATION_CDN_ORIGIN = 'https://cdn.static.bstage.in'
/** CDN 내 번역 베이스 키 */
export const TRANSLATION_CDN_BASE_KEY = 'static/i18n'
/** CDN 버킷 프리픽스 — latest.json의 cdnPath에서 제거한다 */
export const TRANSLATION_CDN_BUCKET_PREFIX = 'cdn.bstage.in/'

/** 모드별 인증 서버 호스트를 반환한다. */
export function getAuthHost(mode: AuthMode, phase: string, tenantId: string): string | null {
  if (mode === 'admin') {
    const fn = ADMIN_AUTH_HOSTS[phase]
    return fn ? fn() : null
  }
  const fn = AUTH_HOSTS[phase]
  return fn ? fn(tenantId) : null
}

// ── 프로젝트 target ────────────────────────────────────────────────────
/** 프로젝트가 올라가는 플랫폼. 슬롯 v2 키의 첫 조각과 같은 어휘다. */
export type ProjectTarget = 'user' | 'admin'

/**
 * 이 프로젝트가 유저용인지 어드민용인지 판정한다.
 *
 * **프로젝트 단위다.** 한 레포에 유저·어드민 템플릿을 섞을 수 없다 — 페이지의 배포 경로가
 * `src/pages/` 폴더 구조라, 유저 `/settings`와 어드민 `/settings`가 같은 파일 자리를 두고
 * 부딪힌다. 그래서 판정을 템플릿이 아니라 프로젝트에 둔다.
 *
 * 우선순위:
 * 1. `package.json`의 `bstage.target` — `bstage init --target admin`이 적는다.
 * 2. 없으면 `user`.
 */
export function resolveProjectTarget(root: string): ProjectTarget {
  let pkg: { bstage?: { target?: string } }
  try {
    pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8'))
  } catch {
    // package.json 없음/파싱 실패 → 판단 근거 없음
    return 'user'
  }

  return pkg.bstage?.target === 'admin' ? 'admin' : 'user'
}
