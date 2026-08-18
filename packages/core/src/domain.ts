/**
 * 슬롯 v2 카탈로그가 약속한 도메인 타입.
 *
 * **수동 정의(stub)가 정식 모양이다.** 핵심 필드만 약속하고 나머지는 열어 둔다 — SDK가 BE 스펙에서
 * 타입을 생성하던 방식은 걷어냈고, 정확한 응답 모양은 게이트웨이 API Reference Doc이 출처다.
 *
 * 호스트가 자기 BE 타입으로 정확하게 보강하려면 `SlotContextOverrides` declaration merging 사용.
 */

/**
 * 디지털 티켓 — `admin.digital-ticket-detail.form:after` 슬롯 context의 `ticket` 필드 타입.
 *
 * BE 응답(`shop` 서비스의 `ProductTicketResponse`)의 핵심 필드만 정의. 추가 필드는 인덱스 시그니처로 허용.
 *
 * 위젯 개발자는 이 타입을 의존하되 정확한 shape은 BE swagger 참조. 호스트는 자기 BE 타입과 매핑.
 */
export interface DigitalTicket {
  /** 상품 Id */
  id: number
  /** 상품 유형(기간형: SEASON_TICKET, 날짜형: DATE_TICKET, 회차형: DATETIME_TICKET) */
  productType: 'SEASON_TICKET' | 'DATE_TICKET' | 'DATETIME_TICKET' | string
  /** 기본 Product 정보(티켓명·썸네일·상품상세 등) */
  common: Record<string, unknown>
  /** 그 외 BE 응답 필드 — 정확한 타입은 BE swagger 참조 */
  [key: string]: unknown
}

/**
 * 콘텐츠 — `user.contents-detail.*` 슬롯 context의 `content` 필드 타입.
 *
 * BE 응답(`content` 서비스의 `ContentResponse`)의 핵심 필드만 정의. 추가 필드는 인덱스 시그니처로 허용.
 *
 * 느슨한 stub 패턴을 의도적으로 채택 — BE 스펙을 그대로 옮기면 호스트(유저 플랫폼)의 수기 BE 타입과
 * 구조가 어긋나 호스트마다 `SlotContextOverrides` 보강이 강제된다.
 * SDK 공개 타입은 위젯 개발자 참고용 모양이므로 핵심 필드만 약속하고, 호스트는 받은 객체를
 * 캐스팅 없이 그대로 넘긴다.
 *
 * `DigitalTicket`과 달리 인덱스 시그니처를 두지 않는다 — 호스트 BE 타입이 interface면
 * 인덱스 시그니처 있는 타입에 구조적 할당이 안 되기 때문(TS 규칙). 위젯이 핵심 필드 밖을
 * 읽을 때는 BE swagger를 참조해 직접 좁힌다.
 *
 * 포스트·미디어(임베드/VOD) 공통 베이스. 타입별 확장 필드(`embeddedMediaId`, `video` 등)는
 * `contentType`으로 분기 후 BE swagger를 참조해 좁힌다.
 */
export interface Content {
  /** 콘텐츠 Id */
  id: string
  /** 콘텐츠 유형(포스트: CONTENT_POST(_PAID), 미디어: CONTENT_MEDIA_EMBEDDED · CONTENT_MEDIA_VOD(_PAID)) */
  contentType: string
  /** 제목 */
  title: string
}

/**
 * 콘텐츠 섹션 정보 — `user.contents-section.list:*` 슬롯 context의 `section` 필드 타입.
 *
 * 섹션 목록 페이지(`/contents/section/{id}`)가 위젯에 알려주는 현재 섹션 식별 정보.
 * BE 엔티티가 아니라 호스트 페이지가 들고 있는 최소 정보만 약속한다.
 */
export interface ContentsSectionInfo {
  /** 섹션 Id */
  id: string
  /** 섹션 제목 */
  title: string
}

/**
 * 커뮤니티 보드 정보 — `user.community-board.feed:before` 슬롯 context의 `board` 필드 타입.
 *
 * 보드 화면이 위젯에 알려주는 현재 보드 식별 정보. 호스트 페이지가 들고 있는 최소 정보만 약속한다.
 */
export interface BoardInfo {
  /** 보드 Id */
  id: string
  /** 보드 제목 */
  title: string
}

/**
 * 커뮤니티 보드 포스트 정보 — `user.community-post-detail.*` 슬롯 context의 `post` 필드 타입.
 *
 * 보드 포스트는 콘텐츠 엔티티(`Content`)가 아니다 — `contentType`이 없고 제목도 보드 유형에
 * 따라 없을 수 있어 전용 약속을 둔다. 호스트 페이지가 들고 있는 최소 정보만 약속한다.
 */
export interface BoardPostInfo {
  /** 포스트 Id */
  id: string
  /** 포스트 제목 — 피드형 보드에서는 없을 수 있음 */
  title?: string
}

/**
 * 상품 — `user.product-detail.detail:after` 슬롯 context의 `product` 필드 타입.
 *
 * BE 응답(`shop` 서비스의 `ProductDetailResponse`)의 핵심 필드만 정의하는 느슨한 stub.
 * `Content`와 같은 이유로 인덱스 시그니처를 두지 않는다 — 호스트(유저 플랫폼) 수기 BE 타입이
 * interface면 인덱스 시그니처 있는 타입에 구조적 할당이 안 되기 때문. 호스트는 받은 객체를
 * override·캐스팅 없이 그대로 넘긴다. 핵심 필드 밖은 BE swagger 참조해 직접 좁힌다.
 */
export interface Product {
  /** 상품 Id */
  id: number
  /** 상품명 */
  name: string
  /** 상품 유형(PHYSICAL · DIGITAL · 티켓류 · 팝패스류 등) */
  productType: string
}
