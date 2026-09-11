export type Surface = 'USER' | 'ADMIN'

export type BuildStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'TIMED_OUT' | 'CANCELED'

export const TERMINAL_STATUSES: ReadonlySet<BuildStatus> = new Set([
  'SUCCEEDED',
  'FAILED',
  'TIMED_OUT',
  'CANCELED',
])

export interface Build {
  id: string
  spaceId: string
  surface: Surface
  /**
   * 실제 API 응답에는 없는 필드다 — 과거 응답 호환과 테스트 픽스처를 위해 optional로 남긴다.
   * 레포 매칭은 `owner`/`repo`로 하고(`buildRepo.ts`의 `buildMatchesRepo`), 이 필드 단독으로
   * 필터링하지 않는다.
   */
  stageRepoId?: string
  /** 빌드를 만든 레포. `stageRepoId`가 없을 때 이 값으로 매칭한다. */
  owner?: string
  repo?: string
  commitSha: string
  commitMessage?: string
  status: BuildStatus
  failureReason?: string
  requestedAt: string
  artifacts?: { name: string; kind: 'sdk' | 'liquid' }[]
}

/** 포털 `placementView` — store.Placement + status·liveCommit·headSha. */
export interface Placement {
  id: string
  surface: Surface
  kind: 'PAGE' | 'SLOT'
  path?: string
  slotId?: string
  stageRepoId: string
  artifact?: string
  liveBuildId?: string
  /** 포털은 nil을 "게시 중"으로 읽는다 — undefined도 true로 취급할 것. */
  enabled?: boolean
  status: string
  liveCommit?: string
  headSha?: string
}

export interface StageRepo {
  id: string
  spaceId: string
  surface: Surface
  owner: string
  repo: string
  defaultBranch: string
}

export interface Me {
  user: { id: string; email: string; superAdmin?: boolean }
  memberships: {
    organizationId: string
    organizationRole?: string
    stageRoles?: Record<string, string>
  }[]
}

export interface Space {
  spaceId: string
  tier: string
}

/** `POST /cli/device/code` 응답 (RFC 8628 §3.2 이름 그대로, camelCase). */
export interface DeviceCodeResponse {
  deviceCode: string
  userCode: string
  verificationUri: string
  verificationUriComplete: string
  expiresIn: number
  interval: number
}

/**
 * 발급된 토큰 — 평문은 이 객체가 유일하다. 저장 직후 버린다.
 *
 * 토큰은 조직 하나에 묶인다. `allSpaces`면 그 조직의 모든 스테이지가 대상이라 `spaceIds`는
 * 빈 배열이다. 두 필드는 옛 포털 응답에는 없으므로 optional이다 — 없으면 조직 미상으로 본다.
 */
export interface IssuedToken {
  id: string
  prefix: string
  token: string
  permission: 'read' | 'build' | 'deploy'
  spaceIds: string[]
  allSpaces?: boolean
  organizationId?: string
  expiresAt: string
}

export type DevicePollResult =
  | { status: 'pending' }
  | { status: 'slow_down'; retryAfter?: number } // Retry-After(초) — 서버가 IP 캡으로 답한 경우 폴링 간격 하한
  | ({ status: 'ok' } & IssuedToken)

/** 배치의 사람이 읽는 이름 — 페이지는 경로, 슬롯은 슬롯 id. */
export function placementLabel(p: Placement): string {
  return p.kind === 'SLOT' ? (p.slotId ?? p.artifact ?? p.id) : (p.path ?? p.artifact ?? p.id)
}
