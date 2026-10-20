import { Tracker } from './tracker.js'
import type { EventParams, User } from './types.js'

import { VERSION } from './version.js'

export { VERSION }
export {
  NAME_MAX,
  TEXT_MAX,
  ATTR_MAX,
  UTM_MAX,
  EVENT_MAX,
  PARAM_LIMIT,
  checkParams,
  RESERVED,
  checkName,
  sizeOf,
} from './limits.js'
export { LOG_PATH, logUrl } from './config.js'
export { BATCH_MAX, FLUSH_WAIT } from './batch.js'
export { BODY_MAX } from './transport.js'
export { MAX_HELD, MAX_AGE, RETRY_MAX, backoff, trim } from './queue.js'
export type { Held } from './queue.js'
export { ROUTE_EVENT } from './route.js'
export { CLICK_ATTR, SECTION_ATTR, EVENT_ATTR, PARAM_PREFIX, readEvent } from './click.js'
export type { EventNode } from './click.js'
export {
  ITEM_ATTR,
  ITEM_NAME_ATTR,
  ITEM_INDEX_ATTR,
  IMPRESSION_OPT,
  readImpression,
} from './impression.js'
export type { ImpressionNode } from './impression.js'
export { DEPTHS } from './scroll.js'
export { MASK_MAX, mask } from './mask.js'
export { BID_NAME, SID_NAME, IDLE_MAX } from './identity.js'
export type { IdSnapshot } from './identity.js'
export type {
  LogBatch,
  ServerFields,
  User,
  Env,
  Size,
  Consent,
  Bridge,
  Event,
  Page,
  EventParams,
  ReservedName,
  LoadType,
  PageViewParams,
  ClickParams,
  ImpressionParams,
  ImpressionOpt,
  ScrollDepthParams,
  InitConfig,
} from './types.js'

const tracker = new Tracker()

export function init(config: Parameters<Tracker['init']>[0] = {}): void {
  tracker.init(config)
}

export function identify(userId: string, props?: User['props']): void {
  tracker.identify(userId, props)
}

export function send(name: string, params?: EventParams): void {
  tracker.send(name, params)
}

export function setConsent(analytics: boolean): void {
  tracker.setConsent(analytics)
}

export function ids() {
  return tracker.ids()
}

export function flush(): void {
  tracker.flush()
}

export function destroy(): void {
  tracker.destroy()
}

export function events() {
  return tracker.events()
}

export function queue() {
  return tracker.queue()
}
