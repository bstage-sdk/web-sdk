import { loadEnv } from 'vite'
import { GATEWAY_HOSTS, getAuthHost, isPublicPhase, type AuthMode } from '../constants.js'

/**
 * 사내 전용 phase(dev·qa)의 호스트를 공급하는 환경변수.
 *
 * 값을 SDK에 심지 않는 이유는 CF Access 자격증명과 같다 — 패키지 번들과 소스맵에
 * 그대로 실려 나가고, 저장소가 공개되면 내부 환경 구성이 드러난다.
 */
export const HOST_ENV_KEYS = {
  gateway: 'VITE_BSTAGE_GATEWAY_HOST',
  auth: 'VITE_BSTAGE_AUTH_HOST',
  adminAuth: 'VITE_BSTAGE_ADMIN_AUTH_HOST',
} as const

export interface DevHosts {
  /** 게이트웨이 호스트. */
  gateway(tenantId: string): string | null
  /** 인증 서버 호스트 — 플러그인 mode(user/admin)에 맞는 쪽. */
  auth(tenantId: string): string | null
}

/** mode에 필요한 인증 호스트 키. 어드민은 유저 호스트를, 유저는 어드민 호스트를 쓰지 않는다. */
function authKeyFor(mode: AuthMode): string {
  return mode === 'admin' ? HOST_ENV_KEYS.adminAuth : HOST_ENV_KEYS.auth
}

/**
 * 이 phase로 개발할 때 쓸 호스트를 정한다.
 *
 * real·sandbox는 공개 서비스라 호스트가 코드에 있고, 그 밖의 phase(dev·qa)는
 * `.env`에서 읽는다. 셸 환경변수를 `.env`보다 먼저 보는 것은 phase 해석·인증 값
 * 점검과 같은 순서다(CI 주입 우선) — 실은 `loadEnv`가 이미 `process.env`를 우선해
 * 병합하므로 아래 `process.env[key] ||`는 그 계약을 코드에 남겨두는 쪽에 가깝다.
 *
 * cwd를 인자로 받는 이유: 모듈 전역 캐시 + 호출 시점 `process.cwd()` 방식으로 두면
 * 테스트가 `process.chdir`을 강제당한다. 호출자(플러그인)가 `config.root`를 이미
 * 들고 있으므로 넘겨받는 편이 낫다.
 *
 * 값이 없으면 **throw 한다.** CF 자격증명은 없어도 요청은 나가고 302로 막혀서 한 번
 * 경고하면 됐지만, 호스트가 없으면 요청 자체를 만들 수 없다. 프록시 응답으로 400을
 * 돌려주면 터미널에는 아무것도 남지 않으므로 서버가 뜨기 전에 멈추는 편이 낫다.
 */
export function resolveDevHosts(phase: string, mode: AuthMode, cwd = process.cwd()): DevHosts {
  if (isPublicPhase(phase)) {
    const gatewayFn = GATEWAY_HOSTS[phase]
    return {
      gateway: (tenantId) => gatewayFn(tenantId),
      auth: (tenantId) => getAuthHost(mode, phase, tenantId),
    }
  }

  const fileEnv = loadEnv('development', cwd, '')
  const read = (key: string): string => (process.env[key] || fileEnv[key] || '').trim()

  const authKey = authKeyFor(mode)
  const gatewayHost = read(HOST_ENV_KEYS.gateway)
  const authHost = read(authKey)

  const missing: string[] = []
  if (!gatewayHost) missing.push(HOST_ENV_KEYS.gateway)
  if (!authHost) missing.push(authKey)

  if (missing.length > 0) {
    // 값 자체는 메시지에 담지 않는다 — 인증 값 점검(build/credentialCheck.ts)과 같은 규약.
    throw new Error(
      `${phase}는 사내 전용 환경이라 호스트가 SDK에 들어 있지 않습니다.\n` +
        `  설정되지 않은 값: ${missing.join(', ')}\n` +
        `  · 사내: 위 값을 .env에 설정하세요 (호스트 값은 사내 문서를 참고하세요)\n` +
        `  · 그 외: --phase sandbox 로 개발하세요 (설정이 필요 없습니다)`,
    )
  }

  return {
    gateway: () => gatewayHost,
    auth: () => authHost,
  }
}
