/**
 * 슬롯 카탈로그 v2 — 재설계된 슬롯 시스템의 자리 정의.
 *
 * SSOT(단일 진실 원천):
 * - 이 객체가 새 모델의 자리·context 약속 SSOT.
 * - TypeScript는 `as const` 추론으로 키·context 필드를 자동 도출 (별도 codegen 없음).
 * - 관리도구은 이 객체를 import해서 운영자에게 보일 자리 목록·`description` 라벨을 구성한다.
 * - 호스트(유저 플랫폼/어드민 플랫폼)는 `<Slot id="...">`로 자리를 박을 때 키·context 모양을 강제받는다.
 *
 * 키 형식: `{target}.{page-or-app}.{anchor}`
 * - `target`: `user` · `admin`
 * - `page-or-app`: 페이지 ID(`shop-home`·`digital-ticket-detail`) 또는 `app-{region}`(`app-topbar`·`app-sidebar`)
 * - `anchor`: `{영역}:{before|after}` (예: `hero:after`·`form:after`)
 *
 * 명명 약속 세 줄:
 * - 단어 잇기: 대시(`-`)
 * - 부분 구분: 점(`.`)
 * - 위치 modifier: 콜론(`:`) — `:before` · `:after`만 허용
 *
 * 자세한 사양: `docs/SLOT_PROTOCOL.md`
 *
 * 버전 규칙: 자리 추가·context 타입 추가 같은 순수 additive 변경은 **patch** bump —
 * 0.x caret 범위(`^0.x.y` → 같은 minor 내)에서 소비자가 재설치만으로 새 자리를 받는다.
 * 기존 자리의 context 모양 변경·제거·동작 변경은 minor 이상.
 *
 * 옛 `SLOT_CATALOG`(4-part, 배열, `slotCatalog.ts`)와 공존한다 — 재설계 끝날 때까지 옛 슬롯은 옛 모양 그대로.
 *
 * @example
 * import { SLOT_CATALOG_V2, type SlotIdV2 } from '@bstage-sdk/core'
 * const ids = Object.keys(SLOT_CATALOG_V2) as SlotIdV2[]
 */
export const SLOT_CATALOG_V2 = {
  // 어드민 — 디지털 티켓 상세 (PoC 한계가 알려진 영역. 결정-016)
  'admin.digital-ticket-detail.form:after': {
    description: '디지털 티켓 상세 본문 아래',
    context: {
      ticket: { type: 'DigitalTicket', required: true },
    },
  },

  // 유저 — 콘텐츠 홈 (결정-018에 1차 명시. curation은 신설, contents-section은 옛 contents.home.contents.before/after 이전)
  'user.contents-home.curation:after': {
    description: '콘텐츠 홈 — 큐레이션 섹션 아래',
    context: {},
  },
  'user.contents-home.contents-section:before': {
    description: '콘텐츠 홈 — 콘텐츠 섹션 묶음 위',
    context: {},
  },
  'user.contents-home.contents-section:after': {
    description: '콘텐츠 홈 — 콘텐츠 섹션 묶음 아래',
    context: {},
  },

  // 유저 — 콘텐츠 상세 (포스트·미디어 두 렌더러가 같은 자리 키를 공유)
  'user.contents-detail.body:before': {
    description: '콘텐츠 상세 — 본문 위',
    context: {
      content: { type: 'Content', required: true },
    },
  },
  'user.contents-detail.body:after': {
    description: '콘텐츠 상세 — 본문 아래',
    context: {
      content: { type: 'Content', required: true },
    },
  },
  'user.contents-detail.comments:before': {
    description: '콘텐츠 상세 — 댓글 섹션 위',
    context: {
      content: { type: 'Content', required: true },
    },
  },

  // 유저 — 콘텐츠 큐레이션 목록
  // list:after는 미도입 — 페이지 끝 자리가 전역 footer 영역(user.app-footer.*)과 겹침 (결정-021과 동일 사유)
  'user.contents-curation.list:before': {
    description: '콘텐츠 큐레이션 목록 — 목록 위',
    context: {},
  },

  // 유저 — 콘텐츠 섹션 목록 (list:after 미도입 — 큐레이션과 동일 사유)
  'user.contents-section.list:before': {
    description: '콘텐츠 섹션 목록 — 목록 위',
    context: {
      section: { type: 'ContentsSectionInfo', required: true },
    },
  },

  // 유저 — 스토리 홈 (feed:after 미도입 — 무한스크롤 끝 + footer 인접)
  'user.story-home.feed:before': {
    description: '스토리 홈 — 피드 영역 위',
    context: {},
  },

  // 유저 — 스토리 피드 상세
  'user.story-feed-detail.post:before': {
    description: '스토리 피드 상세 — 포스트 영역 위',
    context: {
      content: { type: 'Content', required: true },
    },
  },
  'user.story-feed-detail.comments:before': {
    description: '스토리 피드 상세 — 댓글 섹션 위 (본문 아래)',
    context: {
      content: { type: 'Content', required: true },
    },
  },

  // 유저 — POP 홈 (단일 페이지·단일 자리 — 조건부 섹션이 많아 항상 렌더되는 구독 목록 기준)
  'user.pop-home.list:before': {
    description: 'POP 홈 — 구독 목록 위',
    context: {},
  },

  // 유저 — 커뮤니티 보드 (커뮤니티 홈(/community)과 보드 상세가 같은 화면이라 한 키 공유)
  'user.community-board.feed:before': {
    description: '커뮤니티 보드 — 피드 목록 위',
    context: {
      board: { type: 'BoardInfo', required: true },
    },
  },

  // 유저 — 커뮤니티 포스트 상세 (보드 포스트는 콘텐츠 엔티티가 아니라 Content 대신 전용 약속 사용)
  'user.community-post-detail.post:before': {
    description: '커뮤니티 포스트 상세 — 포스트 영역 위',
    context: {
      post: { type: 'BoardPostInfo', required: true },
    },
  },
  'user.community-post-detail.comments:before': {
    description: '커뮤니티 포스트 상세 — 댓글 섹션 위 (본문 아래)',
    context: {
      post: { type: 'BoardPostInfo', required: true },
    },
  },

  // 유저 — 라운지 (메인과 다른 전용 컴포넌트라 라운지 전용 페이지 키. 멀티 인스턴스 — 매핑은 모든 라운지 공통)
  // 라운지 커뮤니티: 홈(/lounge/[h]/community)·보드 상세가 같은 컴포넌트라 한 키 공유 (메인 community 패턴)
  'user.lounge-community.feed:before': {
    description: '라운지 커뮤니티 — 피드 목록 위',
    context: {
      board: { type: 'BoardInfo', required: true },
    },
  },
  // 라운지 콘텐츠
  'user.lounge-contents.section:before': {
    description: '라운지 콘텐츠 — 섹션 묶음 위',
    context: {},
  },
  // 라운지 스토리 (홈·/story/feed 같은 컴포넌트)
  'user.lounge-story.feed:before': {
    description: '라운지 스토리 — 피드 영역 위',
    context: {},
  },

  // 유저 — 샵 홈 (SectionPage 공유 → 호스트가 주입 지점으로 격리. 콘텐츠 홈 성격이라 context 없음)
  // 고정 섹션 묶음 + 실제 footer라 콘텐츠 홈처럼 before/after 둘 다 둠 (무한스크롤 아님 — list/feed의 :after 미도입 사유 해당 없음)
  'user.shop-home.section:before': {
    description: '샵 홈 — 섹션 묶음 위',
    context: {},
  },
  'user.shop-home.section:after': {
    description: '샵 홈 — 섹션 묶음 아래 (footer 위)',
    context: {},
  },

  // 유저 — 상품 상세 (Physical·Digital·PopPass·Ticket 4개 렌더러 공통 — 컨테이너 레벨 자리)
  'user.product-detail.detail:after': {
    description: '상품 상세 — 본문 아래',
    context: {
      product: { type: 'Product', required: true },
    },
  },

  // 유저 — 마이홈 (프로필 카드와 메뉴 목록 사이. 설정성 하위 페이지는 제외)
  'user.my-home.menu:before': {
    description: '마이홈 — 메뉴 목록 위 (프로필 아래)',
    context: {},
  },
} as const

/** 카탈로그에 등록된 슬롯 id 유니온. `<Slot id>` 타입 검사에 쓰임. */
export type SlotIdV2 = keyof typeof SLOT_CATALOG_V2

/** 카탈로그 한 항목의 모양. */
export type SlotCatalogEntryV2 = (typeof SLOT_CATALOG_V2)[SlotIdV2]

import type {
  BoardInfo,
  BoardPostInfo,
  Content,
  ContentsSectionInfo,
  DigitalTicket,
  Product,
} from '../domain.js'

/**
 * SDK 기본 — 카탈로그 id별 context 타입 매핑.
 *
 * 도메인 타입이 SDK에 BE swagger 기반으로 들어오면 여기 항목 추가. 호스트가 자기 도메인 타입으로
 * 덮어쓰려면 `SlotContextOverrides` declaration merging 사용.
 *
 * 외부 위젯 개발자가 SDK에서 `SlotContextOf<Id>`로 가져가면 자동으로 이 매핑이 적용됨.
 */
export interface SlotContextMap {
  'admin.digital-ticket-detail.form:after': { ticket: DigitalTicket }
  'user.contents-detail.body:before': { content: Content }
  'user.contents-detail.body:after': { content: Content }
  'user.contents-detail.comments:before': { content: Content }
  'user.contents-section.list:before': { section: ContentsSectionInfo }
  'user.story-feed-detail.post:before': { content: Content }
  'user.story-feed-detail.comments:before': { content: Content }
  'user.community-board.feed:before': { board: BoardInfo }
  'user.community-post-detail.post:before': { post: BoardPostInfo }
  'user.community-post-detail.comments:before': { post: BoardPostInfo }
  'user.lounge-community.feed:before': { board: BoardInfo }
  'user.product-detail.detail:after': { product: Product }
}

/**
 * 호스트가 자기 도메인 타입으로 context 필드 타입을 덮어쓰는 지점 (escape hatch).
 *
 * SDK 기본(`SlotContextMap`)을 호스트가 자기 모양으로 바꾸고 싶을 때.
 *
 * @example
 * // 호스트(어드민 플랫폼) 코드 어딘가에
 * declare module '@bstage-sdk/core' {
 *   interface SlotContextOverrides {
 *     'admin.digital-ticket-detail.form:after': {
 *       ticket: import('./types').DigitalTicket
 *     }
 *   }
 * }
 */
export interface SlotContextOverrides {}

/**
 * 주어진 슬롯 id에 대응하는 context 객체의 타입.
 *
 * 분기 우선순위:
 * 1. 호스트가 `SlotContextOverrides`를 보강했으면 그 타입
 * 2. SDK `SlotContextMap`에 매핑이 있으면 그 타입
 * 3. 없으면 카탈로그가 선언한 필드 이름만 강제 (값 `unknown`)
 *
 * 호스트 측 자리 컴포넌트의 `context` props와 위젯 측 `useSlotContext` 반환 타입에 쓰임.
 */
export type SlotContextOf<Id extends SlotIdV2> = Id extends keyof SlotContextOverrides
  ? SlotContextOverrides[Id]
  : Id extends keyof SlotContextMap
    ? SlotContextMap[Id]
    : { [K in keyof (typeof SLOT_CATALOG_V2)[Id]['context']]: unknown }

/**
 * `config-latest.json`의 v2 모양 — 슬롯 id(3-part) → 엔트리 배열.
 *
 * 런타임에서는 알 수 없는 키도 허용된다(관리도구가 신버전을 선반영한 경우).
 * 옛 `CustomSlots`(4-part 키)와 한 객체에 섞어 `loadTemplatesBySlots`에 넘길 수 있다.
 */
export type CustomSlotsV2 = Partial<
  Record<SlotIdV2, ReadonlyArray<{ readonly templateUrl: string }>>
>

/**
 * 카탈로그에서 `target`별로 항목을 필터해 반환.
 *
 * 관리도구가 유저·어드민 자리 목록을 따로 구성할 때 사용한다.
 *
 * @example
 * const adminEntries = getSlotsByTargetV2('admin')
 * // [{ id: 'admin.digital-ticket-detail.form:after', description: ..., context: {...} }, ...]
 */
export function getSlotsByTargetV2(
  target: 'user' | 'admin',
): ReadonlyArray<{ readonly id: SlotIdV2 } & SlotCatalogEntryV2> {
  const entries = Object.entries(SLOT_CATALOG_V2) as Array<[SlotIdV2, SlotCatalogEntryV2]>
  return entries
    .filter(([id]) => id.startsWith(`${target}.`))
    .map(([id, entry]) => ({ id, ...entry }))
}

/**
 * 슬롯 id에서 콜론을 대신하는 구분자. 디렉토리 이름·URL 경로에 쓴다.
 *
 * 콜론을 그대로 못 쓰는 이유: Windows(NTFS)에서 예약 문자라 폴더 생성 자체가 실패한다.
 * macOS·Linux는 통과하므로 빌드가 윈도우에서만 깨진다.
 *
 * 대시 2개인 이유: 단어 잇기가 이미 대시 1개(`contents-home`)라, 1개로 치환하면
 * `contents-section:before`와 `contents-section-before`라는 이름의 anchor를 구분할 수 없다.
 * 2개는 명명 규칙상 나올 수 없는 조합이라 되돌리기가 명확하다.
 */
const SLOT_DIR_SEPARATOR = '--'

/**
 * 슬롯 id를 빌드 산출물 디렉토리 이름으로 바꾼다.
 *
 * `bstage build`가 `dist/{여기서 만든 이름}/template.js`로 위젯을 내보내고,
 * 관리도구는 그 이름을 다시 슬롯 id로 되돌려(`dirNameToSlotId`) 어느 자리인지 판단한다.
 * 양쪽이 같은 규칙을 써야 하므로 SDK가 함수로 들고 있는다.
 *
 * @example
 * slotIdToDirName('user.contents-home.curation:after')
 * // 'user.contents-home.curation--after'
 */
export function slotIdToDirName(id: string): string {
  return id.replace(':', SLOT_DIR_SEPARATOR)
}

/**
 * `slotIdToDirName`의 역변환. 디렉토리 이름에서 슬롯 id를 복원한다.
 *
 * 구분자가 없으면 입력을 그대로 돌려준다 — 슬롯 id가 아닌 이름(풀페이지 경로 등)을
 * 넘겼을 때 예외를 던지는 대신 무변환으로 두어, 호출자가 카탈로그 대조로 판단하게 한다.
 *
 * @example
 * dirNameToSlotId('user.contents-home.curation--after')
 * // 'user.contents-home.curation:after'
 */
export function dirNameToSlotId(dirName: string): string {
  return dirName.replace(SLOT_DIR_SEPARATOR, ':')
}

/** 주어진 문자열이 카탈로그에 등록된 슬롯 id인지 확인한다. 빌드 시점 오타 검증용. */
export function isSlotIdV2(value: string): value is SlotIdV2 {
  return Object.prototype.hasOwnProperty.call(SLOT_CATALOG_V2, value)
}
