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
  OtpImpl,
  SessionImpl,
} from './types.js'
export {
  SESSION_PER_MINUTE,
  SESSION_PER_FRAME,
  OTP_SEND_PER_MINUTE,
  OTP_VERIFY_PER_MINUTE,
  LOGIN_BINDING_MS,
  hasAccountCapability,
  stripTokenKeys,
} from './accountSession.js'
export {
  STORAGE_MAX_KEYS,
  STORAGE_MAX_VALUE_LENGTH,
  STORAGE_MAX_KEY_LENGTH,
  type StorageBackend,
} from './storage.js'
export { createSession, createNonce, isValidSession } from '../protocol/session.js'
export { createSrcdoc, type CreateSrcdocOptions } from '../srcdoc/createSrcdoc.js'
export {
  IFRAME_ATTRIBUTES,
  BRIDGE_SURFACES,
  isBridgeSurface,
  REPORTS_PER_SESSION,
  ACCOUNT_SESSION_CAPABILITY,
  type BridgeSurface,
  type PageLocationState,
  type NavigateOptions,
  type OtpOp,
  type OtpPurpose,
  type SessionOp,
  type TemplateReport,
  type TemplateReportKind,
} from '../protocol/messages.js'
export {
  checkPath,
  MAX_DECODE_PASSES,
  type PathCheck,
  type PathCheckOptions,
} from './pathSafety.js'
