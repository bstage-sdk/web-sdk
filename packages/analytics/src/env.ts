import type { Env } from './types.js'
import { VERSION } from './version.js'

export function readEnv(): Env {
  return {
    ua: navigator.userAgent,
    lang: navigator.language,
    screen: { w: screen.width, h: screen.height },
    viewport: { w: innerWidth, h: innerHeight },
    timezone: timezone(),
    sdkVer: VERSION,
  }
}

function timezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? ''
  } catch {
    return ''
  }
}
