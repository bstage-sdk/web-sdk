/**
 * 플랫폼 UI에서 서드파티 템플릿을 배치할 수 있는 슬롯 목록.
 *
 * SSOT(단일 진실 원천):
 * - 이 배열이 슬롯 정의의 SSOT이며, `TemplateSlot` 유니온은 여기서 파생된다.
 * - 관리도구는 이 배열을 import하여 "배치 가능한 슬롯" UI를 구성한다.
 * - 플랫폼(유저 플랫폼/어드민 플랫폼)은 키 집합을 `config-latest.json`의 키로 소비한다.
 *
 * 슬롯 키 네이밍 규칙: `{area}.{page}.{section}.{position}`
 * - `area`: 최상위 메뉴 (`contents`, `shop`, `my`, `home`, `community`, ...)
 * - `page`: 페이지 역할명 (`home` = 메뉴 랜딩, `detail` = 상세, `curation` = 큐레이션 리스트 등)
 *   - 유저 플랫폼의 `components/pages/{area}/{page}/` 디렉토리 관례와 일치
 * - `section`: 페이지 내 섹션. 유저 플랫폼 컴포넌트명에서 소문자 축약으로 파생
 *   - 예: `ContentsSection` → `contents`, `ShowSection` → `show`, `Tags` → `tags`
 *   - area와 section이 같을 수 있음 (메뉴의 주 섹션이 메뉴 이름을 그대로 가지는 자연스러운 경우)
 * - `position`: `before` / `after`
 *
 * `target` 필드:
 * - `'user'`: 유저 유저 플랫폼에 렌더되는 슬롯. `config-latest.json`이 소스.
 * - `'admin'`: 어드민 어드민 플랫폼에 렌더되는 슬롯. `admin-config-latest.json`이 소스.
 * - 관리도구는 `getSlotsByTarget()`으로 필터하여 각 플랫폼의 배치 UI를 구성한다.
 *
 * 슬롯 추가 절차:
 * 1. 이 배열에 엔트리 추가 → SDK minor 버전 bump
 * 2. 플랫폼(유저 플랫폼 또는 어드민 플랫폼) 해당 페이지에 `SlotTemplateProvider` + `SlotWidget` 배선
 * 3. 관리도구는 SDK 버전 업그레이드 후 자동으로 새 슬롯이 목록에 노출됨
 */
export const SLOT_CATALOG = [
  {
    key: 'contents.home.contents.before',
    target: 'user',
    page: 'contents.home',
    section: 'contents',
    position: 'before',
    description: '콘텐츠 홈 — 콘텐츠 섹션 위 (Curation/Tags/Show 아래)',
  },
  {
    key: 'contents.home.contents.after',
    target: 'user',
    page: 'contents.home',
    section: 'contents',
    position: 'after',
    description: '콘텐츠 홈 — 콘텐츠 섹션 아래 (Footer 위)',
  },
  {
    key: 'products.digital-ticket.form-additional.after',
    target: 'admin',
    page: 'products.digital-ticket',
    section: 'form-additional',
    position: 'after',
    description: '디지털 티켓 생성/수정 — 추가 설정 스텝 아래',
  },
  {
    key: 'shop.order-item.ticket.after',
    target: 'user',
    page: 'shop.order-item',
    section: 'ticket',
    position: 'after',
    description: '주문 아이템 — 디지털 티켓 정보 아래',
  },
  // 어드민 메뉴 슬롯 — 서브메뉴
  {
    key: 'admin.nav.my-stage.menu.after',
    target: 'admin',
    page: 'admin.nav',
    section: 'my-stage',
    position: 'after',
    description: '내 홈페이지 서브메뉴 하단',
  },
  {
    key: 'admin.nav.contents.menu.after',
    target: 'admin',
    page: 'admin.nav',
    section: 'contents',
    position: 'after',
    description: '콘텐츠 서브메뉴 하단',
  },
  {
    key: 'admin.nav.products.menu.after',
    target: 'admin',
    page: 'admin.nav',
    section: 'products',
    position: 'after',
    description: '상품 서브메뉴 하단',
  },
  {
    key: 'admin.nav.orders.menu.after',
    target: 'admin',
    page: 'admin.nav',
    section: 'orders',
    position: 'after',
    description: '주문 서브메뉴 하단',
  },
  {
    key: 'admin.nav.settlement.menu.after',
    target: 'admin',
    page: 'admin.nav',
    section: 'settlement',
    position: 'after',
    description: '정산 서브메뉴 하단',
  },
  {
    key: 'admin.nav.operation.menu.after',
    target: 'admin',
    page: 'admin.nav',
    section: 'operation',
    position: 'after',
    description: '회원 서브메뉴 하단',
  },
  {
    key: 'admin.nav.settings.menu.after',
    target: 'admin',
    page: 'admin.nav',
    section: 'settings',
    position: 'after',
    description: '설정 서브메뉴 하단',
  },
  // 어드민 메뉴 슬롯 — 대메뉴
  {
    key: 'admin.nav.menu.after',
    target: 'admin',
    page: 'admin.nav',
    section: 'menu',
    position: 'after',
    description: '대메뉴 목록 하단 (새 메뉴 그룹)',
  },
] as const

/** @internal 목록 엔트리 타입. 외부 소비자는 `typeof SLOT_CATALOG[number]`로 파생 가능. */
type SlotCatalogEntry = (typeof SLOT_CATALOG)[number]

/** @internal 슬롯이 렌더될 플랫폼 대상. */
type SlotTarget = SlotCatalogEntry['target']

/**
 * 지정한 `target`에 해당하는 슬롯만 필터하여 반환한다.
 *
 * 관리도구가 유저·어드민 플랫폼별 배치 UI를 각각 구성할 때 사용한다.
 *
 * @example
 * const userSlots = getSlotsByTarget('user')
 * const adminSlots = getSlotsByTarget('admin')
 */
export function getSlotsByTarget(target: SlotTarget): readonly SlotCatalogEntry[] {
  return SLOT_CATALOG.filter((s) => s.target === target)
}

/**
 * 템플릿이 렌더링될 플랫폼 UI 위치 (슬롯 키).
 *
 * 키 형식: `{area}.{page}.{section}.{position}` — 네이밍 규칙은 `SLOT_CATALOG` 주석 참조.
 *
 * 템플릿이 어느 슬롯에 배치될지는 관리도구가 결정하며,
 * 이 타입은 유저 플랫폼이 `customSlots` 키를 타입 안전하게 다루기 위해 제공한다.
 */
export type TemplateSlot = SlotCatalogEntry['key']

/**
 * @internal `config-latest.json`에 기록되는 슬롯 엔트리.
 * forward-compat: 알 수 없는 필드는 무시된다. 향후 `variant`, `meta` 등이 추가될 수 있다.
 */
interface SlotEntry {
  /** 템플릿 번들(`template.js`)의 절대 URL */
  templateUrl: string
}

/**
 * `config-latest.json`의 루트 형태 — 슬롯 키 → 엔트리 배열.
 *
 * - 키는 목록에 정의된 `TemplateSlot`만 유효
 * - 런타임에서는 알 수 없는 키도 허용된다
 *   (`loadTemplatesBySlots`가 로드 시도 후 실패하면 경고만 남기고 계속 진행)
 */
export type CustomSlots = Partial<Record<TemplateSlot, SlotEntry[]>>
