interface EnvOptions {
  phase: string
  appId: string
  appSecret: string
  tenantId: string
}

/**
 * 환경변수 파일 내용. 인증 정보를 포함하므로 `.env`는 커밋하지 않는다(`.gitignore`).
 *
 * 인증 정보(appId/appSecret)는 `BstageClient`로 API를 호출할 때만 필요한 선택 항목이다.
 * API 없이 UI만 렌더하는 템플릿은 값을 채우지 않아도 된다.
 *
 * - `.env` — 실제 값(phase + 인증 정보). 로컬 개발용, 커밋 안 됨.
 * - `.env.example` — 실제 phase + 인증 정보 placeholder. 커밋되어 팀원이 복사해 채운다.
 */
export function env({ phase, appId, appSecret, tenantId }: EnvOptions): string {
  return `VITE_BSTAGE_PHASE=${phase}

# 인증 정보(선택) — BstageClient로 API를 호출할 때만 필요합니다.
# API 없이 UI만 렌더하는 템플릿은 값을 채우지 않아도 됩니다.
# .env는 커밋되지 않습니다(.gitignore). 값은 b.stage 파트너 콘솔에서 발급.
VITE_BSTAGE_APP_ID=${appId}
VITE_BSTAGE_APP_SECRET=${appSecret}
VITE_BSTAGE_TENANT_ID=${tenantId}

# CF Access 자격증명 — dev·qa phase로 개발할 때만 필요합니다.
# dev·qa는 사내 전용 환경이라 Cloudflare Access 게이트 뒤에 있고, 값이 없으면
# 로그인·API 프록시가 302로 막힙니다. 사내에서 쓴다면 CF Access 서비스 토큰을 발급받아 채우세요.
# sandbox·real은 게이트가 없어 설정이 필요 없습니다.
VITE_CF_ACCESS_CLIENT_ID=
VITE_CF_ACCESS_CLIENT_SECRET=

# 사내 전용 phase의 호스트 — dev·qa phase로 개발할 때만 필요합니다.
# 이 호스트들은 사내 환경이라 SDK에 들어 있지 않습니다. 값이 없으면 dev 서버가
# 뜨지 않고 어떤 값이 비었는지 알려줍니다. 값은 사내 문서를 참고하세요.
# sandbox·real은 호스트가 SDK에 있어 설정이 필요 없습니다.
VITE_BSTAGE_GATEWAY_HOST=
VITE_BSTAGE_AUTH_HOST=
`
}
