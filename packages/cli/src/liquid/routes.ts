import type { LiquidSurface } from './render.js'

/** 프리뷰 서버가 아는 경로 종류. 여기에 없는 경로는 404다. */
export type PreviewRoute =
  | { kind: 'index' }
  | { kind: 'list'; type: LiquidSurface }
  | { kind: 'template'; type: LiquidSurface; name: string }
  /** public/ 기준 상대 경로 */
  | { kind: 'asset'; path: string }
  /** 파일 변경 알림(SSE) */
  | { kind: 'reload' }

/** SSE 구독 경로. 템플릿 이름과 겹치지 않도록 접두사를 둔다. */
export const RELOAD_PATH = '/__bstage__/reload'

const SURFACES = new Set<string>(['user', 'admin'])

function isSurface(v: string): v is LiquidSurface {
  return SURFACES.has(v)
}

/**
 * URL 경로를 public/ 기준 세그먼트로 바꾼다. public/ 밖으로 나갈 수 있는 입력은 전부 거절한다
 * (`..`·`.`·빈 세그먼트·역슬래시·NUL). URL 디코딩을 **먼저** 하므로 `%2e%2e`도 여기서 걸린다.
 */
function toSegments(pathname: string): string[] | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    // 잘못된 퍼센트 인코딩
    return null
  }

  if (decoded.includes('\\') || decoded.includes('\0')) return null

  const segments = decoded.split('/').filter((s) => s.length > 0)
  if (segments.some((s) => s === '.' || s === '..')) return null
  return segments
}

/**
 * 경로 → 화면. 순수 함수다 — 디스크를 직접 보지 않고 `exists`(public/ 기준 상대 경로) 콜백으로만
 * 판단한다. `templates`는 `user/home` 형식이며 빌더 규약 밖 중첩 이름도 포함될 수 있다.
 *
 * 판정 순서가 규칙이다: reload → index → 목록 → 템플릿 → 정적 파일 → 404. 템플릿을 정적 파일보다
 * 먼저 보는 것은 `public/user/home/`에 놓인 파일이 템플릿 경로를 가리지 않게 하기 위해서다.
 */
export function resolveRoute(
  pathname: string,
  templates: string[],
  exists: (relativePath: string) => boolean,
): PreviewRoute | null {
  if (pathname === RELOAD_PATH) return { kind: 'reload' }

  const segments = toSegments(pathname)
  if (segments === null) return null
  if (segments.length === 0) return { kind: 'index' }

  const [first, ...rest] = segments
  if (rest.length === 0 && isSurface(first)) return { kind: 'list', type: first }

  const relativePath = segments.join('/')
  if (isSurface(first) && templates.includes(relativePath)) {
    return { kind: 'template', type: first, name: rest.join('/') }
  }

  if (exists(relativePath)) return { kind: 'asset', path: relativePath }

  return null
}
