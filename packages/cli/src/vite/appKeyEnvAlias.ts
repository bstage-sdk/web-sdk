import { loadEnv, type Plugin, type UserConfig } from 'vite'
import { APP_KEY_VAR, LEGACY_APP_KEY_VAR } from '../constants.js'

/**
 * 앱 키 환경변수의 새 이름(`VITE_BSTAGE_APP_KEY`)과 옛 이름(`VITE_BSTAGE_APP_SECRET`)을 서로 이어 붙이는
 * `define` 항목을 만든다.
 *
 * 별칭 기간에는 소스와 `.env`가 다른 이름을 쓰는 조합이 실제로 생긴다 — 기존 프로젝트의 `client.ts`는
 * 옛 이름을 읽는데 포털의 환경변수 입력은 새 이름을 넣고, 반대로 새 스캐폴드에 옛 `.env`를 복사해
 * 오기도 한다. Vite는 `import.meta.env.X`를 빌드 시점에 문자열로 치환하므로 이 조합은 번들에
 * undefined가 박혀 배포 뒤 401로만 드러난다. 한쪽만 있으면 다른 이름으로도 같은 값이 읽히게 한다.
 *
 * - 둘 다 있으면 손대지 않는다(각자 실제 값). 둘 다 없으면 아무것도 정의하지 않는다(UI 전용 템플릿).
 * - 값은 `JSON.stringify`로 감싼다 — define은 코드 조각 치환이라 따옴표가 없으면 식별자가 된다.
 */
export function appKeyEnvDefine(env: Record<string, string | undefined>): Record<string, string> {
  const key = env[APP_KEY_VAR]?.trim()
  const legacy = env[LEGACY_APP_KEY_VAR]?.trim()
  if (key && !legacy) return { [`import.meta.env.${LEGACY_APP_KEY_VAR}`]: JSON.stringify(key) }
  if (legacy && !key) return { [`import.meta.env.${APP_KEY_VAR}`]: JSON.stringify(legacy) }
  return {}
}

/**
 * 프로젝트 env를 Vite와 같은 위치 규칙(`envDir` → `root` → cwd)으로 읽는다. `bstage build`의 인증 값
 * 점검과 같은 `loadEnv`라 CI가 `process.env`로 주입한 값도 반영된다. 프리셋과 dev 플러그인이 함께 쓴다.
 */
export function loadProjectEnv(config: UserConfig, mode: string): Record<string, string> {
  return loadEnv(mode, config.envDir ?? config.root ?? process.cwd(), 'VITE_')
}

/**
 * `appKeyEnvDefine`을 Vite 설정에 얹는 플러그인. `bstage build`(프리셋)와 `bstageDevPlugin`(dev 서버)이
 * 함께 쓴다.
 */
export function appKeyEnvAliasPlugin(): Plugin {
  return {
    name: 'bstage-app-key-env-alias',
    config(config, { mode }) {
      return { define: appKeyEnvDefine(loadProjectEnv(config, mode)) }
    },
  }
}
