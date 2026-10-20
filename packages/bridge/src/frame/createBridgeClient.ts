import { createBridgeFetch } from './createBridgeFetch.js'
import { bridgeRuntime } from './runtime.js'
import type { BridgeClient, BridgeClientConfig, RuntimeGlobal } from './types.js'

/** srcdoc 부트스트랩이 상수로 설치하는 설정의 전역 이름. */
export const BRIDGE_CONFIG_GLOBAL = '__bstage_bridge_config__'

export interface CreateBridgeClientOptions extends Partial<BridgeClientConfig> {
  /** 프레임 전역. 기본 `globalThis`(테스트용). */
  readonly global?: RuntimeGlobal
}

/**
 * 프레임 브리지 클라이언트를 만들고 `globalThis.__bstage_bridge__`에 설치한다.
 * 이미 설치돼 있으면 그 인스턴스를 돌려준다.
 *
 * 세션·hostOrigin을 생략하면 srcdoc 부트스트랩이 심은 `__bstage_bridge_config__`를 읽는다.
 * 보통은 부트스트랩이 직접 호출하므로 템플릿 코드가 부를 일은 없다.
 */
export function createBridgeClient(options: CreateBridgeClientOptions = {}): BridgeClient {
  const g = (options.global ?? globalThis) as RuntimeGlobal & {
    [BRIDGE_CONFIG_GLOBAL]?: Partial<BridgeClientConfig>
  }
  const installed = g[BRIDGE_CONFIG_GLOBAL] ?? {}
  const session = options.session ?? installed.session
  const hostOrigin = options.hostOrigin ?? installed.hostOrigin
  if (typeof session !== 'string' || typeof hostOrigin !== 'string') {
    throw new TypeError('[bstage-bridge] session과 hostOrigin이 필요합니다')
  }
  return bridgeRuntime(g, createBridgeFetch, { session, hostOrigin })
}
