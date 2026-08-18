/**
 * `src/vite-env.d.ts` — `import.meta.env` 타입.
 *
 * phase(`VITE_BSTAGE_PHASE`) + BstageClient 인증 값(`VITE_BSTAGE_APP_*`).
 * 유저·어드민 템플릿이 같은 파일을 쓴다.
 */
export function viteEnvDts(): string {
  return `/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BSTAGE_PHASE: string
  readonly VITE_BSTAGE_APP_ID: string
  readonly VITE_BSTAGE_APP_SECRET: string
  readonly VITE_BSTAGE_TENANT_ID: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
`
}
