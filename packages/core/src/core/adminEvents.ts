/**
 * 어드민 도메인 이벤트 카탈로그 (SSOT).
 *
 * 네이밍 컨벤션: `{domain}.{verb}.{when}`
 * - domain: 비즈니스 도메인 (ticket, product, ...)
 * - verb: 동작 (create, update, delete, ...)
 * - when: 발생 시점 (after)
 *   - `before` 훅은 플랫폼 UI가 비동기 응답을 대기해야 하므로 별도 설계 필요. 현재 미지원.
 *
 * 어드민 플랫폼이 `TemplateHandle.dispatch()`로 발행하고,
 * 템플릿이 `PlatformBridge.on()`으로 구독한다.
 *
 * 이벤트 추가 절차:
 * 1. 이 파일에 카탈로그 엔트리 + payload 인터페이스 추가
 * 2. `AdminDomainEventMap`에 타입 → payload 매핑 추가
 * 3. `PlatformEventMap`이 `AdminDomainEventMap`을 extends하므로 Bridge/Handle 타입 자동 반영
 */
export const ADMIN_EVENT_CATALOG = [
  {
    type: 'ticket.create.after',
    domain: 'ticket',
    description: '티켓 생성 완료 후 발행. 커스텀 UI가 후속 처리(QR 저장 등)를 수행할 수 있다.',
  },
] as const

/** @internal 카탈로그 엔트리 타입 */
type AdminEventCatalogEntry = (typeof ADMIN_EVENT_CATALOG)[number]

/** 어드민 도메인 이벤트 타입 유니온. 카탈로그에서 파생. */
export type AdminDomainEventType = AdminEventCatalogEntry['type']

/** @internal 카탈로그 엔트리의 도메인 유니온 */
type AdminEventDomain = AdminEventCatalogEntry['domain']

/**
 * 지정한 도메인에 해당하는 이벤트만 필터하여 반환한다.
 *
 * @example
 * const ticketEvents = getAdminEventsByDomain('ticket')
 */
export function getAdminEventsByDomain(
  domain: AdminEventDomain,
): readonly AdminEventCatalogEntry[] {
  return ADMIN_EVENT_CATALOG.filter((e) => e.domain === domain)
}

// ── Payload 스키마 ──

export interface TicketCreateAfterPayload {
  /** b.stage 티켓 ID */
  ticketId: string
  /** 티켓이 속한 상품 ID */
  productId: string
}

/** 어드민 도메인 이벤트 타입 → payload 매핑 */
export interface AdminDomainEventMap {
  'ticket.create.after': TicketCreateAfterPayload
}
