export const MASK_MAX = 2000

export function mask(text: string): string {
  return text
    .slice(0, MASK_MAX)
    .replace(
      /([?&#](?:access_token|refresh_token|id_token|token|key|apikey|api_key|password|passwd|secret|code|auth|session|sig|signature|state|ticket|otp|invite)=)[^&\s#]+/gi,
      '$1***',
    )
    .replace(/\bBearer\s+[\w.-]+/gi, 'Bearer ***')
    .replace(/\beyJ[\w-]{6,}\.[\w-]+\.[\w-]+/g, '***')
    .replace(/(\/\/)[^/@\s:]+:[^/@\s]+@/g, '$1***:***@')
}

export function maskUrl(url: string | undefined): string | undefined {
  return url ? mask(url) : undefined
}
