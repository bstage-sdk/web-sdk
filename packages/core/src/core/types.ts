// ──────────────────────────────────────────────
// 템플릿 → 플랫폼 이벤트
// (템플릿이 발행하고, 플랫폼이 처리)
// ──────────────────────────────────────────────

export interface TemplateEventMap {
  /** 앱 내 경로 이동 */
  navigate: { path: string; params?: Record<string, string> }
  /** 이전 화면으로 돌아가기 */
  'go-back': {}
  /** 외부 URL을 새 탭/브라우저로 열기 */
  'open-external': { url: string }
  /** 토스트 메시지 표시 */
  toast: { message: string; duration?: number; variant?: 'info' | 'success' | 'error' }
  /** 네이티브 앱 브릿지 호출 요청 */
  'call-bridge': { type: string; payload?: unknown }
}

export type TemplateEventType = keyof TemplateEventMap

// ──────────────────────────────────────────────
// 플랫폼 → 템플릿 이벤트
// (플랫폼이 발행하고, 템플릿이 처리)
// ──────────────────────────────────────────────

import type { AdminDomainEventMap } from './adminEvents.js'

export interface SlotInitPayload {
  /** 현재 리소스 ID. 없으면 생성 모드, 있으면 수정 모드. */
  resourceId?: string
}

/**
 * 슬롯 v2 context 페이로드.
 *
 * 호스트가 마운트 시점에 한 번 dispatch한다. 위젯 측은 `useSlotContext()` hook으로 받는다.
 * 호스트 → 위젯 단방향 read-only (결정-016·022). 마운트 후 변경된 데이터는 위젯에 안 보내짐.
 *
 * 페이로드 모양은 슬롯 id에 따라 다름 — `SlotContextOf<Id>` 참조.
 * 타입 안전성은 호스트 측 자리 컴포넌트의 props 타입 + 위젯 측 `useSlotContext` generic으로 양쪽 강제.
 */
export type SlotContextPayload = Record<string, unknown>

/**
 * 어드민 어드민 플랫폼이 템플릿 마운트 직후 보내는 페이로드.
 *
 * **SDK는 더 이상 이 이벤트를 듣지 않는다.** 어드민 전용 어댑터가 사라지면서 수신부가 없어졌고,
 * 어드민 API는 게이트웨이가 열리면 `BstageClient`로 간다. 계약을 남겨 둔 이유는 플랫폼이
 * 아직 이 이벤트를 보내기 때문이다 — 타입을 지우면 플랫폼의 `dispatch` 호출이 타입에서 깨진다.
 * 플랫폼이 발신을 걷어내면 함께 제거한다.
 */
export interface AdminConnectPayload {
  fetcher: unknown
  apiBase: string
  baseUrl: string
}

export interface PlatformEventMap extends AdminDomainEventMap {
  'slot.init': SlotInitPayload
  'slot.context': SlotContextPayload
  'admin.connect': AdminConnectPayload
}

export type PlatformEventType = keyof PlatformEventMap

/**
 * 템플릿을 웹 컴포넌트로 등록하기 위한 옵션
 */
export interface TemplateOptions {
  /**
   * 템플릿 식별자이자 Custom Element 태그명.
   * Custom Element 스펙상 소문자로 시작하고 하이픈을 1개 이상 포함해야 합니다.
   * 예: `'bmf-hello'`, `'my-space-my-widget'`.
   */
  name: string
  /**
   * 이 템플릿이 들어갈 슬롯 id (위젯 전용).
   *
   * `src/slots/` 아래 템플릿은 이 값이 필수이고, `src/pages/` 아래 템플릿에는 쓸 수 없다.
   * `bstage build`가 카탈로그와 대조해 오타를 잡고, 이 값으로 산출물 디렉토리 이름을 정한다
   * (`slotIdToDirName`). 페이지의 배포 경로는 `src/pages/` 아래 폴더 구조가 정한다.
   *
   * 예: `'user.contents-home.curation:after'`
   */
  slot?: string
  type?: string
  shadow?: boolean
  framework?: string
}
