/**
 * 전송 스키마. 필드명은 수집 서버와의 계약이라 바꾸지 않으며, 기존 envelope의 상위집합이라
 * 추가 필드는 그대로 통과한다.
 */

/** 계층 1 — 전송 envelope */
export interface LogBatch {
  /** 기존 파이프라인 호환값. 항상 2 */
  version: 2
  /** 수집 서버가 이 값으로 스페이스를 해석한다 */
  key: string
  /**
   * 영속 브라우저 ID. 비동의(익명) 모드에서는 발급·저장하지 않아 없으며,
   * 적재 파이프라인은 `consent.analytics`로 구분한다.
   */
  bId?: string
  /** 세션 ID (30분 슬라이딩). 익명 모드에서는 없다 — `bId`와 같은 이유다 */
  sId?: string
  /** 탭 세션 ID. 동의 여부와 무관하게 항상 채운다 — 익명 트래픽의 dedup 그룹핑 키다 */
  tabSId: string
  user?: User
  env: Env
  consent: Consent
  /** 앱→웹 브릿지 커스텀 필드 */
  bridge?: Bridge
  /**
   * impression 발화 임계값. **배치당 1회** 싣는다 — 이벤트마다 같은 상수를 반복하지 않는다.
   *
   * ⛔ **값을 버리지 말 것.** 고객사마다 임계값이 다르면 노출 수가 비교 불가능한 값이 되고,
   * 임계값을 바꾸면 그 시점 전후 시계열이 끊긴다. **설정 이력을 남기는 곳이 여기뿐이라**
   * 적재 측이 dimension 조인으로도 풀 수 없다.
   */
  impressionOpt?: ImpressionOpt
  /** 전송 시각. 수집 서버가 덮어쓴다 */
  sentAt: number
  /** 재전송 횟수. 영속 큐가 채우며 최초 전송에는 없거나 0이다 */
  retryCount?: number
  evts: Event[]
}

/**
 * 수집 서버가 채우는 필드 — SDK는 채우지 않는다. 고객사 앱에는 관련 헤더도 쿠키도 없어
 * `key`만 싣고 서버가 해석한다.
 */
export interface ServerFields {
  /** 서버가 채운다 */
  spaceId: string
}

export interface User {
  /** 고객사가 `identify(userId)`로 주입한다. 호출이 없으면 비로그인으로 간주한다 */
  id?: string
  type?: string
  props?: Record<string, unknown>
}

/** 실행 환경. User-Agent는 원문만 싣고 파싱하지 않는다 */
export interface Env {
  ua: string
  lang: string
  screen: Size
  viewport: Size
  timezone: string
  sdkVer: string
}

export interface Size {
  w: number
  h: number
}

/** 고객사가 `setConsent()`로 알려준다. SDK 기본값은 비동의(opt-in)다 */
export interface Consent {
  analytics: boolean
}

/** 앱→웹 브릿지가 주입하는 자유 필드 */
export type Bridge = Record<string, unknown>

/** 계층 2 — `evts[]` 원소 */
export interface Event {
  /** UUID. 적재 파이프라인의 중복 전송 방지 키다 */
  evtId: string
  ts: number
  /** snake_case, 40자 이하. 예약어는 `ReservedName` 참조 */
  name: string
  page: Page
  params?: EventParams
}

export interface Page {
  url: string
  path: string
  title?: string
  /** document.referrer 원문 */
  ref?: string
  /** SPA 라우트 전환 직전의 논리적 이전 경로 */
  logicalRef?: string
  /** 페이지 뷰 단위 식별자. `pageId` 사전 계약을 대체한다 */
  viewId: string
}

/**
 * custom event params는 자유 스키마라 타입 제약을 걸지 않는다.
 * 제한은 `limits.ts`의 런타임 상수·검증 유틸로만 표현한다.
 */
export type EventParams = Record<string, unknown>

/** 예약 이름의 단일 출처. `limits.ts`의 `RESERVED`가 이 타입에서 파생된다 */
export type ReservedName = 'page_view' | 'click' | 'impression' | 'scroll_depth' | 'runtime_error'

export type LoadType = 'navigate' | 'reload' | 'back_forward'

/*
 * 아래 params는 interface가 아니라 type alias다 — interface에는 인덱스 시그니처가 붙지 않아
 * `EventParams`에 대입되지 않는다.
 */

export type PageViewParams = {
  loadType: LoadType
  /** foreground 누적 시간(ms). `sessionDuration`과 의미가 달라 합산하지 않는다 */
  engagementTime?: number
  /** 세션 wall-clock 경과 시간(ms). `engagementTime`과 합산하지 않는다 */
  sessionDuration?: number
  /*
   * 유입 캠페인. `page.ts`의 `readUtm()`이 쿼리에서 뽑아 **실제로 싣고 있는** 값이며,
   * 여기 없으면 `emit()` 경계가 타입으로 좁혀지지 않는다(타입만 고치고 payload는 그대로가 된다).
   */
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  utm_term?: string
  utm_content?: string
}

export type ClickParams = {
  tag: string
  id?: string
  /** 50자 이하로 절삭한다 */
  text?: string
  href?: string
  x?: number
  y?: number
  section?: string
}

/**
 * 노출 1건. **`ClickParams`와 같은 규칙이다** — 관측된 사실 하나(`itemId`)만 required이고
 * 서술 필드는 전부 optional이다.
 *
 * ⛔ **`ratio`·`duration`을 되살리지 말 것.** 둘은 관측값이 아니라 발화 설정값이라
 * `LogBatch.impressionOpt`(배치당 1회)로 올렸다. 매 이벤트에 같은 상수를 싣던 원래 형태는
 * 정작 「무엇이 노출됐는가」를 담을 자리가 없었다.
 *
 * ⚠️ **대상 1건당 이벤트 1건이다**(B안). `items[]` 배열로 묶지 않는 이유는 값이 전부
 * Primitive여야 적재가 `params`를 컬럼으로 펼치든 map/JSON으로 두든 그대로 유효하기 때문이다.
 */
export type ImpressionParams = {
  /** `ClickParams.section`과 **같은 키**여야 조인해 CTR이 나온다 */
  section?: string
  itemId: string
  /** 50자 이하로 절삭한다 — `ClickParams.text`와 같다 */
  itemName?: string
  itemIndex?: number
}

/** `scroll_depth`의 params. 발화부가 인라인으로 넘기던 것을 `emit()` 경계용으로 이름 붙였다 */
export type ScrollDepthParams = {
  depth: number
}

/**
 * impression 발화 임계값. 세션 전역 설정이며 기본값은 `IMPRESSION_OPT`(`impression.ts`)다.
 */
export interface ImpressionOpt {
  /** 노출로 볼 면적 비율(0~1) */
  threshold: number
  /** 그 면적을 유지해야 하는 시간(ms) */
  duration: number
  /** IntersectionObserver의 `rootMargin` */
  rootMargin: string
}

/** 초기화 설정 — zero-config의 실체는 `key` 한 개다 */
export interface InitConfig {
  key: string
  /** 수집 서버 오리진 또는 상대 경로. 경로는 SDK가 붙이고 호스트가 이 값을 채운다 */
  endpoint: string
  /** `endpoint` 뒤에 붙는 수집 경로. 생략하면 `LOG_PATH`, 빈 문자열이면 `endpoint`를 그대로 쓴다 */
  path?: string
  /** impression 발화 임계값 덮어쓰기. 지정한 키만 기본값을 대체한다 */
  impression?: Partial<ImpressionOpt>
}
