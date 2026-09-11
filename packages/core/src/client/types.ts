import type { FetchFunction } from '../http/types.js'

/** {@link BstageClient} 생성 옵션. */
export interface BstageConfig {
  /** 파트너 콘솔에서 발급받은 앱 식별자. */
  appId: string
  /**
   * 파트너 콘솔에서 발급받은 앱 키(APP KEY). 게이트웨이 `X-BSTAGE-APP-KEY` 헤더로 나간다.
   *
   * **브라우저에 노출되는 값이다** — `VITE_` 환경변수로 번들에 평문으로 실리고 요청 헤더에서도
   * 보인다. 비밀값이 아니며, 접근 범위는 게이트웨이가 앱 단위로 제어한다.
   * `appKey`·`appSecret` 중 하나는 있어야 하고, 둘 다 있으면 `appKey`가 우선한다.
   */
  appKey?: string
  /**
   * `appKey`의 옛 이름. 값은 같다(비밀값이 아니다).
   *
   * @deprecated `appKey`를 쓰세요. 기존 프로젝트 호환용 별칭이며 **0.4.0**(공개 배포판 `@bstage-sdk/core`
   * 기준)에서 제거된다. 다른 배포 라인은 제거 전 MIGRATION 문서에 먼저 고지한다. 둘 다 주면 `appKey`가 우선한다.
   */
  appSecret?: string
  /** 템플릿을 적용할 Space(테넌트) 식별자. */
  tenantId: string
  /**
   * 환경 라벨. **런타임 미사용** — 게이트웨이 base URL은 이 필드가 아니라 origin(`location.origin + /gw`)으로
   * 결정된다. 로컬 개발의 phase는 dev 서버(`bstage dev --phase` 또는 `VITE_BSTAGE_PHASE`)가 정하며,
   * 특정 게이트웨이를 직접 지정하려면 `baseUrl`을 쓴다. (예약 필드)
   */
  phase?: 'dev' | 'qa' | 'real' | 'sandbox'
  /** base URL 직접 지정. 미지정 시 resolveBaseUrl()로 자동 결정. */
  baseUrl?: string
  /** 요청 타임아웃 (ms). */
  timeout?: number
  /** 커스텀 fetch 함수. 미지정 시 `globalThis.__bstage_fetch__` → `globalThis.fetch` 순으로 사용. */
  fetch?: FetchFunction
}
