import type {
  BridgeEventMap,
  BridgeHostEventType,
  BridgeInit,
  BridgeTranslations,
  MemberState,
  SlotState,
  ThemeState,
} from '../protocol/messages.js'
import type { BridgePolicy } from './policy.js'
import type { BridgeInitInput } from './types.js'

/**
 * 프레임으로 나가는 값의 허용 목록. init과 `send()` 이벤트가 같은 규칙을 쓴다 — 호스트 코드가
 * 실수로 회원 id·이메일·토큰이 든 객체를 넘겨도 정해진 필드만 복사해 내보낸다.
 */

function obj(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

export function sanitizeTheme(value: unknown): ThemeState {
  return { dark: obj(value).dark === true }
}

export function sanitizeMember(value: unknown): MemberState {
  const m = obj(value)
  return {
    signedIn: m.signedIn === true,
    ...(typeof m.nickname === 'string' ? { nickname: m.nickname } : {}),
  }
}

export function sanitizeSlot(value: unknown): SlotState | undefined {
  const s = obj(value)
  return typeof s.id === 'string' ? { id: s.id, context: s.context } : undefined
}

/** 문자열 값만 남긴 사전(프로토타입 키 제외). 객체가 아니면 undefined. */
export function sanitizeTranslations(value: unknown): BridgeTranslations | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  return Object.freeze(
    Object.fromEntries(
      Object.entries(value as Record<string, unknown>).filter(
        ([k, v]) => typeof v === 'string' && k !== '__proto__',
      ),
    ) as Record<string, string>,
  )
}

/** 이벤트 payload를 허용 필드만으로 다시 만든다. 필수 필드가 없으면 TypeError. */
export function sanitizeEvent<E extends BridgeHostEventType>(
  type: E,
  payload: unknown,
): BridgeEventMap[E] {
  const p = obj(payload)
  switch (type) {
    case 'theme':
      return sanitizeTheme(p) as BridgeEventMap[E]
    case 'member':
      return sanitizeMember(p) as BridgeEventMap[E]
    case 'visibility':
      return { visible: p.visible === true } as BridgeEventMap[E]
    case 'slot.context': {
      const slot = sanitizeSlot(p)
      if (!slot) throw new TypeError('[bstage-bridge] slot.context에는 id가 필요합니다')
      return slot as BridgeEventMap[E]
    }
    case 'locale': {
      if (typeof p.locale !== 'string') {
        throw new TypeError('[bstage-bridge] locale 이벤트에는 locale이 필요합니다')
      }
      const translations = sanitizeTranslations(p.translations)
      return { locale: p.locale, ...(translations ? { translations } : {}) } as BridgeEventMap[E]
    }
    default:
      throw new TypeError(`[bstage-bridge] 알 수 없는 이벤트: ${String(type)}`)
  }
}

/** 호스트 옵션에서 init payload를 만든다(허용 필드만). */
export function buildInit(
  init: BridgeInitInput,
  hostOrigin: string,
  partnerOrigins: readonly string[],
  policy: BridgePolicy,
): BridgeInit {
  const slot = init.slot ? sanitizeSlot(init.slot) : undefined
  const translations = sanitizeTranslations(init.translations)
  return Object.freeze({
    placementId: String(init.placementId),
    surface: init.surface,
    phase: String(init.phase),
    spaceId: String(init.spaceId),
    hostOrigin,
    gatewayBase: `${hostOrigin}/gw`,
    gatewayPrefixes: policy.gatewayPrefixes,
    locale: String(init.locale),
    theme: sanitizeTheme(init.theme),
    ...(slot ? { slot } : {}),
    member: sanitizeMember(init.member),
    limits: {
      maxBodyBytes: policy.maxBodyBytes,
      maxRequestsPerMinute: policy.maxRequestsPerMinute,
    },
    partnerOrigins,
    ...(translations ? { translations } : {}),
  })
}

/** 정제된 이벤트를 init 스냅샷에 반영한 새 객체(재핸드셰이크 때 최신 값을 주기 위해). */
export function applyEvent<E extends BridgeHostEventType>(
  init: BridgeInit,
  type: E,
  payload: BridgeEventMap[E],
): BridgeInit {
  switch (type) {
    case 'locale': {
      const p = payload as BridgeEventMap['locale']
      const { translations: _drop, ...rest } = init
      return Object.freeze({
        ...rest,
        locale: p.locale,
        ...(p.translations ? { translations: p.translations } : {}),
      })
    }
    case 'member':
      return Object.freeze({ ...init, member: payload as BridgeEventMap['member'] })
    case 'theme':
      return Object.freeze({ ...init, theme: payload as BridgeEventMap['theme'] })
    case 'slot.context':
      return Object.freeze({ ...init, slot: payload as BridgeEventMap['slot.context'] })
    default:
      return init
  }
}
