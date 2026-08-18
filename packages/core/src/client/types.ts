import type { FetchFunction } from '../http/types.js'

/** {@link BstageClient} 생성 옵션. */
export interface BstageConfig {
  /** 파트너 콘솔에서 발급받은 앱 식별자. */
  appId: string
  /** 파트너 콘솔에서 발급받은 앱 시크릿. */
  appSecret: string
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
