import { APP_KEY_VAR, LEGACY_APP_KEY_VAR } from '../constants.js'

/**
 * 빌드 시점 인증 값 점검.
 *
 * `bstage build`는 Vite 빌드라서 `import.meta.env.VITE_BSTAGE_*`가 **빌드 시점에 문자열로
 * 치환**된다. 즉 `.env`가 없거나 값이 placeholder면 그 상태가 그대로 번들에 박히고, 배포한
 * 뒤에야 401로 드러난다. 배포 전에 잡을 수 있는 유일한 지점이 빌드 시점이라 여기서 점검한다.
 *
 * "QA 키를 리얼에 썼다" 같은 환경 불일치는 여기서 감지할 수 없다 — 키 포맷(`bsa_`/`bsp_`)은
 * ID·시크릿 구분일 뿐 발급 환경을 담지 않는다. 그 계열은 문서 체크리스트의 몫이다
 * (`docs/GETTING_STARTED.md` 배포 전 점검).
 */

/**
 * BstageClient가 모든 요청에 붙이는 앱 ID 헤더 이름.
 * 번들에 이 문자열이 있으면 BstageClient가 실제로 포함됐다는 뜻이다(안 쓰면 트리셰이킹으로 사라진다).
 * `packages/core/src/client/BstageClient.ts`의 헤더 이름과 함께 갱신한다. 앱 키 헤더는 값이 없으면
 * 생략되므로 마커로 쓸 수 없다 — appId 헤더에 같은 처리를 넣으면 이 점검이 조용히 꺼진다.
 */
const CLIENT_MARKER = 'X-BSTAGE-APP-ID'

/** 파트너 콘솔 발급 값의 접두사 규약. core `BstageClient`와 동일 규칙. */
const APP_ID_PREFIX = 'bsa_'
const APP_KEY_PREFIX = 'bsp_'

export { APP_KEY_VAR, LEGACY_APP_KEY_VAR }

/**
 * 점검 대상 환경변수 — BstageClient 생성에 필요한 값. 앱 키는 새 이름과 옛 이름이 둘 다 후보이고,
 * 점검은 그 둘을 **한 값**으로 본다(`resolveAppKey`).
 */
export const CREDENTIAL_ENV_VARS = [
  'VITE_BSTAGE_APP_ID',
  APP_KEY_VAR,
  LEGACY_APP_KEY_VAR,
  'VITE_BSTAGE_TENANT_ID',
] as const

export interface CredentialIssue {
  /** error: 배포하면 확실히 실패한다. warn: 의심스럽지만 동작할 수도 있다. */
  level: 'error' | 'warn'
  /** 어떤 환경변수 이야기인지. 값 자체는 절대 담지 않는다(로그에 시크릿을 남기지 않기 위해). */
  varName: string
  message: string
}

/**
 * 번들이 BstageClient를 포함하는지 판정한다.
 *
 * `bstage init`은 `src/shared/client.ts`를 항상 스캐폴드하지만 `template.tsx`의 import는
 * 주석 처리돼 있다. 따라서 "소스에 참조가 있는가"로 판정하면 API를 쓰지 않는 UI 전용
 * 템플릿까지 경고가 뜬다. 번들을 보면 트리셰이킹 결과가 곧 답이라 오탐이 없다.
 */
export function usesBstageClient(bundle: Buffer): boolean {
  return bundle.includes(CLIENT_MARKER)
}

/**
 * 값이 자리표시자인지 판정한다. `bstage init`이 심는 `YOUR_APP_ID` 계열과, 손으로 채운
 * `xxx`·`example` 계열을 함께 잡는다. `.husky/check-secrets.mjs`의 자리표시자 규칙과 같은 힌트를 쓴다.
 */
export function isPlaceholderValue(value: string): boolean {
  const upper = value.toUpperCase()
  return ['YOUR', 'EXAMPLE', 'PLACEHOLDER', 'XXX'].some((hint) => upper.includes(hint))
}

/**
 * 소스가 `import.meta.env.{VAR}`로 참조하는 인증 변수를 찾는다.
 *
 * env 값은 **소스가 참조할 때만** 번들에 영향을 준다. cli 0.40.1 이전 스캐폴드는 `client.ts`에
 * 키를 리터럴로 박았고 그 전환은 마이그레이션에서 `선택`이라, 옛 프로젝트는 `.env`가 없는 게
 * 정상이다. 참조를 세지 않고 env만 보면 그런 프로젝트에 "값이 없다"고 잘못 경고하게 된다.
 *
 * `import.meta.env.` 접두사까지 요구해 `.d.ts` 타입 선언·주석·문서 문자열과 섞이지 않게 한다.
 */
export function collectReferencedVars(sources: string[]): Set<string> {
  const referenced = new Set<string>()
  for (const source of sources) {
    for (const varName of CREDENTIAL_ENV_VARS) {
      if (source.includes(`import.meta.env.${varName}`)) referenced.add(varName)
    }
  }
  return referenced
}

/**
 * 인증 값이 배포 가능한 상태인지 검사한다.
 *
 * @param env Vite가 빌드에 쓰는 것과 같은 방식으로 해석된 env(`loadEnv`) — `.env` 파일뿐 아니라
 *   CI가 `process.env`로 주입한 값도 빌드에 반영되므로, 파일만 읽으면 오탐이 난다.
 * @param referenced 소스가 실제로 참조하는 변수(`collectReferencedVars`). 참조하지 않는 변수는
 *   번들에 아무 영향이 없으므로 검사하지 않는다.
 */
export function checkCredentials(
  env: Record<string, string | undefined>,
  referenced: Set<string>,
): CredentialIssue[] {
  const appId = referenced.has('VITE_BSTAGE_APP_ID') ? env.VITE_BSTAGE_APP_ID?.trim() : undefined
  const appKeys = resolveAppKeys(env, referenced)

  // 점검할 (이름, 값). 참조하지 않는 변수는 번들에 아무 영향이 없으므로 검사하지 않는다.
  const targets: Array<{ varName: string; value: string | undefined }> = [
    ...(referenced.has('VITE_BSTAGE_APP_ID')
      ? [{ varName: 'VITE_BSTAGE_APP_ID', value: appId }]
      : []),
    ...appKeys,
    ...(referenced.has('VITE_BSTAGE_TENANT_ID')
      ? [{ varName: 'VITE_BSTAGE_TENANT_ID', value: env.VITE_BSTAGE_TENANT_ID?.trim() }]
      : []),
  ]

  const presenceIssues = targets.flatMap(({ varName, value }): CredentialIssue[] => {
    if (!value) {
      return [
        {
          level: 'error',
          varName,
          message: '값이 없습니다 — 번들에 undefined가 박혀 배포 후 401이 납니다.',
        },
      ]
    }
    if (isPlaceholderValue(value)) {
      return [
        {
          level: 'error',
          varName,
          message: '자리표시자가 그대로입니다 — 파트너 콘솔에서 발급받은 값으로 바꾸세요.',
        },
      ]
    }
    return []
  })

  // 값이 온전할 때만 형식을 본다(비었거나 자리표시자면 위에서 이미 보고했다).
  const usableAppId = appId && !isPlaceholderValue(appId) ? appId : undefined
  const usableAppKeys = appKeys.filter(
    (k): k is { varName: string; value: string } => !!k.value && !isPlaceholderValue(k.value),
  )

  // swap은 접두사 경고보다 구체적인 진단이라 따로 잡고, 잡히면 접두사 경고는 생략한다
  // (같은 사실을 두 번 말하면 어느 쪽이 원인인지 흐려진다).
  const swappedKey = usableAppKeys.find((k) => k.value.startsWith(APP_ID_PREFIX))
  const swapped = usableAppId?.startsWith(APP_KEY_PREFIX) || swappedKey !== undefined
  if (swapped) {
    const keyLabel = shortName(swappedKey?.varName ?? appKeys[0]?.varName ?? APP_KEY_VAR)
    return [
      ...presenceIssues,
      {
        level: 'error',
        varName: 'VITE_BSTAGE_APP_ID',
        message: `APP_ID와 ${keyLabel}가 서로 바뀐 것 같습니다 — APP_ID는 "${APP_ID_PREFIX}", ${keyLabel}는 "${APP_KEY_PREFIX}"로 시작해야 합니다.`,
      },
    ]
  }

  const prefixWarnings: CredentialIssue[] = [
    ...(usableAppId && !usableAppId.startsWith(APP_ID_PREFIX)
      ? [
          {
            level: 'warn' as const,
            varName: 'VITE_BSTAGE_APP_ID',
            message: `"${APP_ID_PREFIX}"로 시작하지 않습니다 — 파트너 콘솔 발급 값이 맞는지 확인하세요.`,
          },
        ]
      : []),
    ...usableAppKeys
      .filter((k) => !k.value.startsWith(APP_KEY_PREFIX))
      .map(
        (k): CredentialIssue => ({
          level: 'warn',
          varName: k.varName,
          message: `"${APP_KEY_PREFIX}"로 시작하지 않습니다 — 파트너 콘솔 발급 값이 맞는지 확인하세요.`,
        }),
      ),
  ]

  return [...presenceIssues, ...prefixWarnings]
}

/**
 * 소스가 읽는 앱 키 변수마다 번들에 실릴 값을 해석한다.
 *
 * 이름은 둘(새 `APP_KEY`·옛 `APP_SECRET`)이지만 값은 하나다. 빌드의 env 별칭(`appKeyEnvDefine`)은
 * **소스가 읽는 이름이 비었을 때만** 다른 이름의 값을 채우므로, 점검도 같은 순서로 본다 — 읽는 이름의
 * 값이 우선, 다른 이름은 폴백. 두 이름을 다 읽는 소스(마이그레이션 도중)는 각각 따로 점검한다.
 * 소스가 앱 키를 읽지 않으면 빈 배열.
 */
function resolveAppKeys(
  env: Record<string, string | undefined>,
  referenced: Set<string>,
): Array<{ varName: string; value: string | undefined }> {
  return [APP_KEY_VAR, LEGACY_APP_KEY_VAR]
    .filter((varName) => referenced.has(varName))
    .map((varName) => {
      const other = varName === APP_KEY_VAR ? LEGACY_APP_KEY_VAR : APP_KEY_VAR
      return { varName, value: env[varName]?.trim() || env[other]?.trim() || undefined }
    })
}

/** `VITE_BSTAGE_APP_KEY` → `APP_KEY`처럼 메시지용 짧은 이름. */
function shortName(varName: string): string {
  return varName.replace(/^VITE_BSTAGE_/, '')
}
