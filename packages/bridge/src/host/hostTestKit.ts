/**
 * @internal createBridgeHost 테스트 공용 — 호스트 생성·요청 왕복 헬퍼. tsup entry에 없어 번들에 실리지 않는다.
 */
import { vi } from 'vitest'
import { createEnvelope, type BridgeEnvelope } from '../protocol/envelope.js'
import { createFakeLink, flush, HOST_ORIGIN, SESSION, type FakeLink } from '../testing.js'
import { createBridgeHost } from './createBridgeHost.js'
import type { BridgeHostHandlers, BridgeInitInput, CreateBridgeHostOptions } from './types.js'

export const INIT: BridgeInitInput = {
  placementId: 'pl-1',
  surface: 'page',
  phase: 'dev',
  spaceId: 'space-1',
  locale: 'ko',
  theme: { dark: false },
  member: { signedIn: true, nickname: 'neo' },
  partnerOrigins: ['https://partner.example.net', 'https://bad.example/path'],
}

export function okResponse(body = '{"a":1}', init: ResponseInit = {}) {
  return new Response(body, {
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'application/json', 'set-cookie': 'x=y', 'x-internal': '1' },
    ...init,
  })
}

export function setup(
  overrides: Partial<CreateBridgeHostOptions> = {},
  handlers: BridgeHostHandlers = {},
) {
  const link = createFakeLink()
  const fetchImpl = vi.fn(async () => okResponse())
  const host = createBridgeHost({
    iframe: link.iframe,
    session: SESSION,
    hostOrigin: HOST_ORIGIN,
    init: INIT,
    fetchImpl,
    handlers,
    ...overrides,
  })
  return { link, host, fetchImpl }
}

let seq = 0
/** 프레임이 보낸 것처럼 호스트에 요청을 넣고 응답 payload를 기다린다. */
export async function request(
  link: FakeLink,
  type: string,
  payload: Record<string, unknown>,
  session = SESSION,
) {
  seq += 1
  const id = `t-${seq}`
  link.parent.postMessage(createEnvelope('req', type, id, { ...payload, session }), HOST_ORIGIN)
  await flush(10)
  const res = link.toFrame
    .map((m) => m.message as BridgeEnvelope)
    .find((m) => m.kind === 'res' && m.id === id)
  return res?.payload as
    | { ok: true; data: any }
    | { ok: false; error: { code: string; message: string } }
    | undefined
}
