export { createBridgeHost } from './createBridgeHost.js'
export {
  DEFAULT_POLICY,
  DEFAULT_GATEWAY_DENY_SEGMENTS,
  ALLOWED_REQUEST_HEADERS,
  HOST_ONLY_HEADERS,
  CREDENTIAL_HEADERS,
  ROUTING_HEADERS,
  ROUTING_HEADER_PREFIXES,
  MAX_PASS_THROUGH_HEADERS,
  normalizePinnedHeaders,
  ALLOWED_METHODS,
  MAX_PARTNER_ORIGINS,
  normalizePartnerOrigins,
  prepareFetch,
  resolveDestination,
  classifyDestination,
  isAllowedGatewayPath,
  resolvePolicy,
  type BridgePolicy,
  type DestinationContext,
  type Destination,
  type DestinationKind,
  type PreparedFetch,
} from './policy.js'
export type {
  BridgeDisposeReason,
  BridgeHost,
  BridgeHostHandlers,
  BridgeInitInput,
  CreateBridgeHostOptions,
  FrameWindow,
  HostFetch,
  HostWindow,
  IframeLike,
  MessageEventLike,
} from './types.js'
export { createSession, createNonce, isValidSession } from '../protocol/session.js'
export { createSrcdoc, type CreateSrcdocOptions } from '../srcdoc/createSrcdoc.js'
export {
  IFRAME_ATTRIBUTES,
  BRIDGE_SURFACES,
  isBridgeSurface,
  REPORTS_PER_SESSION,
  type BridgeSurface,
  type TemplateReport,
  type TemplateReportKind,
} from '../protocol/messages.js'
export {
  checkPath,
  MAX_DECODE_PASSES,
  type PathCheck,
  type PathCheckOptions,
} from './pathSafety.js'
