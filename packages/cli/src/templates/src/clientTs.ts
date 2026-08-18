export function clientTs(): string {
  return `import { BstageClient } from '@bstage-sdk/core'

// 인증 정보는 .env(커밋되지 않음)에서 주입됩니다.
// clone 후 .env.example을 .env로 복사해 값을 채우세요.
export const client = new BstageClient({
  appId: import.meta.env.VITE_BSTAGE_APP_ID,
  appSecret: import.meta.env.VITE_BSTAGE_APP_SECRET,
  tenantId: import.meta.env.VITE_BSTAGE_TENANT_ID,
})
`
}
