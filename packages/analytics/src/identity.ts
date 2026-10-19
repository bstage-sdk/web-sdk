import type { Consent, User } from './types.js'
import { cookieStore, type Store } from './store.js'
import { uuid } from './uuid.js'

export const BID_NAME = '_bsa_bid'
export const SID_NAME = '_bsa_sid'
export const BID_AGE = 365 * 24 * 60 * 60
export const IDLE_MAX = 30 * 60 * 1000

export interface IdSnapshot {
  bId?: string
  sId?: string
  tabSId: string
  user?: User
  consent: Consent
  startedAt?: number
}

interface Session {
  id: string
  startedAt: number
  seenAt: number
}

export class Identity {
  private tabSIdValue: string | undefined
  private granted = false
  private user: User = {}

  constructor(
    private readonly store: Store = cookieStore,
    private readonly now: () => number = Date.now,
  ) {}

  private get tabSId(): string {
    return (this.tabSIdValue ??= uuid())
  }

  get consent(): Consent {
    return { analytics: this.granted }
  }

  setConsent(analytics: boolean): void {
    const granted = analytics === true
    this.granted = granted
    if (granted) return
    this.store.remove(BID_NAME)
    this.store.remove(SID_NAME)
    this.user = {}
  }

  identify(userId: string, props?: User['props']): void {
    this.user = props ? { id: userId, props } : { id: userId }
  }

  touch(): IdSnapshot {
    const base = { tabSId: this.tabSId, consent: this.consent }
    if (!this.granted) return base

    const session = this.rollSession()
    return {
      ...base,
      bId: this.browserId(),
      sId: session.id,
      startedAt: session.startedAt,
      user: this.user.id ? this.user : undefined,
    }
  }

  peek(): IdSnapshot {
    const base = { tabSId: this.tabSId, consent: this.consent }
    if (!this.granted) return base
    const session = this.parse(this.store.get(SID_NAME))
    return {
      ...base,
      bId: this.store.get(BID_NAME) ?? undefined,
      sId: session?.id,
      startedAt: session?.startedAt,
      user: this.user.id ? this.user : undefined,
    }
  }

  private browserId(): string {
    const saved = this.store.get(BID_NAME)
    if (saved) return saved
    const issued = uuid()
    this.store.set(BID_NAME, issued, BID_AGE)
    return issued
  }

  private rollSession(): Session {
    const at = this.now()
    const prev = this.parse(this.store.get(SID_NAME))
    const next =
      prev && at - prev.seenAt <= IDLE_MAX
        ? { ...prev, seenAt: at }
        : { id: uuid(), startedAt: at, seenAt: at }

    this.store.set(SID_NAME, `${next.id}|${next.startedAt}|${next.seenAt}`, IDLE_MAX / 1000)
    return next
  }

  private parse(raw: string | null): Session | null {
    if (!raw) return null
    const [id, startedAt, seenAt] = raw.split('|')
    if (!id || !startedAt || !seenAt) return null
    const s = Number(startedAt)
    const v = Number(seenAt)
    return Number.isFinite(s) && Number.isFinite(v) ? { id, startedAt: s, seenAt: v } : null
  }
}
