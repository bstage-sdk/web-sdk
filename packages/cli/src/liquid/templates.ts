import type { KindReport } from '../project/detectKind.js'
import type { LiquidSurface } from './render.js'

/** 프리뷰 목록의 항목 하나. */
export interface PreviewTemplate {
  /** `user/home` 형식 — 라우트 경로이자 목록 표시 이름 */
  id: string
  type: LiquidSurface
  /** type 뒤의 나머지 — `home`·`events/summer` */
  name: string
  /** 빌더 규약(`public/{user|admin}/{name}` 깊이 1) 밖이면 true — 포털이 무시한다 */
  ignored: boolean
}

export interface PreviewInventory {
  templates: PreviewTemplate[]
  /**
   * user·admin 밖이라 프리뷰가 렌더조차 할 수 없는 template.liquid (루트 기준 상대 경로).
   * 목록에는 경고로만 보여 준다.
   */
  unreachable: string[]
}

const SURFACES = new Set<string>(['user', 'admin'])

/** `public/user/events/summer/template.liquid` → `user/events/summer`. 규약 밖이면 null. */
function idFromIgnoredPath(path: string): string | null {
  if (!path.startsWith('public/') || !path.endsWith('/template.liquid')) return null

  const middle = path.slice('public/'.length, -'/template.liquid'.length)
  const segments = middle.split('/')
  if (segments.length < 2 || !SURFACES.has(segments[0])) return null
  return middle
}

/**
 * `detectProjectKind` 결과를 프리뷰가 쓰는 목록으로 바꾼다.
 *
 * 규약 밖 파일을 버리지 않고 함께 싣는 것이 요점이다 — 포털은 무시하지만 작성자는 화면에서
 * 그 사실을 알아야 하고, user·admin 아래라면 렌더까지는 보여 줄 수 있다.
 */
export function collectPreviewTemplates(report: KindReport): PreviewInventory {
  const valid = report.liquidTemplates.map((id) => toTemplate(id, false))

  const nested: PreviewTemplate[] = []
  const unreachable: string[] = []
  for (const path of report.ignoredLiquid) {
    const id = idFromIgnoredPath(path)
    if (id === null) unreachable.push(path)
    else nested.push(toTemplate(id, true))
  }

  return {
    templates: [...valid, ...nested].sort((a, b) => a.id.localeCompare(b.id)),
    unreachable: [...unreachable].sort(),
  }
}

function toTemplate(id: string, ignored: boolean): PreviewTemplate {
  const [type, ...rest] = id.split('/')
  return { id, type: type as LiquidSurface, name: rest.join('/'), ignored }
}

/** 특정 surface의 항목만 — 목록 페이지가 쓴다. */
export function templatesOf(inventory: PreviewInventory, type: LiquidSurface): PreviewTemplate[] {
  return inventory.templates.filter((t) => t.type === type)
}
