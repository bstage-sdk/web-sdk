/**
 * impression(노출) 자동 계측. 게스트가 붙인 DOM 속성만 보고 대상을 찾아
 * 임계 면적·체류 시간을 채운 노출 1건마다 이벤트 1건을 낸다.
 */
import { readSection } from './click.js'
import { ATTR_MAX, TEXT_MAX, clip } from './limits.js'
import { mask } from './mask.js'
import type { ImpressionOpt, ImpressionParams } from './types.js'

/** 게스트가 붙이는 속성. `ITEM_ATTR`이 유일한 필수 속성이고 나머지 둘은 선택이다 */
export const ITEM_ATTR = 'data-log-item'
export const ITEM_NAME_ATTR = 'data-log-item-name'
export const ITEM_INDEX_ATTR = 'data-log-item-index'

/** 이전 구현과 같은 임계값이라 지표를 비교할 수 있다 */
export const IMPRESSION_OPT: ImpressionOpt = {
  threshold: 0.5,
  duration: 2000,
  rootMargin: '0px',
}

/** `readImpression`이 쓰는 DOM 표면. `Element`가 이 형태를 만족한다 */
export interface ImpressionNode {
  getAttribute(name: string): string | null
  closest(selector: string): { getAttribute(name: string): string | null } | null
}

export function readImpression(node: ImpressionNode): ImpressionParams | null {
  const itemId = node.getAttribute(ITEM_ATTR)?.trim()
  if (!itemId) return null
  return {
    // ⛔ `click.ts`의 reader를 그대로 쓴다 — 같은 키여야 `params.section`으로 조인해 CTR이 나온다
    section: readSection(node),
    // ⚠️ `itemId`는 마스킹하지 않는다 — 조인 키라 값이 바뀌면 지표가 끊긴다. 길이 상한만 건다
    itemId: clip(itemId, ATTR_MAX, ITEM_ATTR),
    itemName: readName(node),
    itemIndex: readIndex(node),
  }
}

function readName(node: ImpressionNode): string | undefined {
  const name = node.getAttribute(ITEM_NAME_ATTR)?.replace(/\s+/g, ' ').trim()
  if (!name) return undefined
  // ⛔ 마스킹이 먼저, 절삭이 나중이다 — 먼저 자르면 매칭이 실패하는데 비밀은 50자 안에 남는다
  return mask(name).slice(0, TEXT_MAX)
}

/** 명시 속성일 때만 싣는다 — 가상 스크롤에서는 그려진 순서가 실제 위치와 다르다 */
function readIndex(node: ImpressionNode): number | undefined {
  const raw = node.getAttribute(ITEM_INDEX_ATTR)
  if (raw === null || raw.trim() === '') return undefined
  const index = Number(raw)
  return Number.isInteger(index) && index >= 0 ? index : undefined
}

/** ⛔ 좁힌 뒤의 값만 봉투(`LogBatch.impressionOpt`)와 발화 기준 양쪽에 쓴다 — 어긋나면 안 된다 */
export function resolveOpt(over?: Partial<ImpressionOpt>): ImpressionOpt {
  const opt = { ...IMPRESSION_OPT }
  if (typeof over?.threshold === 'number' && Number.isFinite(over.threshold)) {
    opt.threshold = Math.min(1, Math.max(0, over.threshold))
  }
  if (typeof over?.duration === 'number' && Number.isFinite(over.duration)) {
    opt.duration = Math.max(0, over.duration)
  }
  if (typeof over?.rootMargin === 'string' && over.rootMargin.trim() !== '') {
    opt.rootMargin = over.rootMargin
  }
  return opt
}

/** 체류 시간 판정과 1회 규칙. 매번 발화하면 상한 없는 이벤트 소스가 된다 */
export class ImpressionGate<T> {
  private readonly fired = new Set<string>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(
    private readonly duration: number,
    private readonly emit: (value: T) => void,
  ) {}

  enter(key: string, value: T): void {
    if (this.fired.has(key) || this.timers.has(key)) return
    if (this.duration <= 0) {
      this.fire(key, value)
      return
    }
    this.timers.set(
      key,
      setTimeout(() => this.fire(key, value), this.duration),
    )
  }

  leave(key: string): void {
    const timer = this.timers.get(key)
    if (timer === undefined) return
    clearTimeout(timer)
    this.timers.delete(key)
  }

  /** 라우트 전환. 발화 이력과 대기 중인 체류를 전부 되돌린다 */
  reset(): void {
    this.stop()
    this.fired.clear()
  }

  /** 대기 중인 체류만 취소한다. 발화 이력은 남는다 */
  stop(): void {
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
  }

  private fire(key: string, value: T): void {
    this.timers.delete(key)
    this.fired.add(key)
    this.emit(value)
  }
}

export class Impressions {
  private readonly gate: ImpressionGate<ImpressionParams>
  private io: IntersectionObserver | null = null
  private readonly mos = new Set<MutationObserver>()
  private roots = new WeakSet<Document | ShadowRoot>()
  private seen = new WeakSet<Element>()

  constructor(
    readonly opt: ImpressionOpt,
    emit: (params: ImpressionParams) => void,
  ) {
    this.gate = new ImpressionGate(opt.duration, emit)
  }

  /** 브라우저가 두 Observer를 지원하지 않으면 조용히 아무 것도 하지 않는다 */
  start(): void {
    if (this.io !== null) return
    this.io = makeObserver(this.opt, (entries) => this.onIntersect(entries))
    if (this.io === null) return
    this.walk(document)
  }

  /**
   * 라우트 전환. ⛔ 관찰을 통째로 다시 건다 — 발화 이력만 지우면 이미 화면에 있던 대상은
   * 교차 상태가 변하지 않아 IntersectionObserver가 다시 알려주지 않는다.
   */
  reset(): void {
    this.stop()
    this.start()
  }

  stop(): void {
    this.gate.reset()
    this.io?.disconnect()
    this.io = null
    for (const mo of this.mos) mo.disconnect()
    this.mos.clear()
    this.roots = new WeakSet()
    this.seen = new WeakSet()
  }

  private onIntersect(entries: IntersectionObserverEntry[]): void {
    for (const entry of entries) {
      const params = readImpression(entry.target)
      if (params === null) continue
      // ⛔ 구분자는 이스케이프로 쓴다 — 리터럴 NUL을 박으면 git이 파일을 바이너리로 보고
      // diff가 사라진다. 값에 들어갈 수 없는 문자라야 두 대상이 같은 키가 되지 않는다
      const key = `${params.section ?? ''}\u0000${params.itemId}`
      if (entry.isIntersecting && entry.intersectionRatio >= this.opt.threshold) {
        this.gate.enter(key, params)
      } else {
        this.gate.leave(key)
      }
    }
  }

  /** ⚠️ `start()`·`reset()`에서만 부른다 — mutation마다 전체를 훑으면 고객사 페이지가 무거워진다 */
  private walk(root: Document | ShadowRoot): void {
    this.register(root)
    this.scan(root)
  }

  /** 루트에 MutationObserver를 단다. 처음 보는 루트일 때만 true다 */
  private register(root: Document | ShadowRoot): boolean {
    if (this.roots.has(root)) return false
    this.roots.add(root)
    const mo = watch(root, (records) => this.onMutate(records))
    if (mo !== null) this.mos.add(mo)
    return true
  }

  private scan(root: Document | ShadowRoot): void {
    root.querySelectorAll('*').forEach((el) => this.consider(el))
  }

  /** 추가된 서브트리만 훑는다. 피드는 lazy load가 기본이라 이 경로가 주 경로다 */
  private onMutate(records: MutationRecord[]): void {
    for (const record of records) {
      record.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return
        this.consider(node)
        node.querySelectorAll('*').forEach((el) => this.consider(el))
      })
    }
  }

  /**
   * ⛔ `shadowRoot` 재귀를 빼지 말 것. 게스트 템플릿은 Shadow DOM에 마운트되고
   * `document.querySelectorAll`은 그 경계를 넘지 못한다 — 재귀가 없으면 게스트의 대상이
   * 하나도 관찰되지 않는다.
   *
   * ⛔ 처음 보는 루트만 훑는다. `register()` 없이 스캔하면 mutation마다 이미 등록된 루트를
   * 통째로 다시 훑어, shadow host를 반복 추가하는 마크업이 메인 스레드를 점유한다.
   */
  private consider(el: Element): void {
    if (el.shadowRoot !== null && this.register(el.shadowRoot)) this.scan(el.shadowRoot)
    if (this.seen.has(el) || !el.hasAttribute(ITEM_ATTR)) return
    this.seen.add(el)
    this.io?.observe(el)
  }
}

/** ⚠️ `rootMargin` 문법이 틀리면 생성자가 throw한다 — 고객사 페이지에 예외를 내지 않는다 */
function makeObserver(
  opt: ImpressionOpt,
  callback: IntersectionObserverCallback,
): IntersectionObserver | null {
  if (typeof IntersectionObserver === 'undefined') return null
  try {
    return new IntersectionObserver(callback, {
      rootMargin: opt.rootMargin,
      threshold: opt.threshold,
    })
  } catch {
    return new IntersectionObserver(callback, { threshold: opt.threshold })
  }
}

/** 지원하지 않는 환경에서는 정적 대상만 잡힌다 */
function watch(root: Document | ShadowRoot, callback: MutationCallback): MutationObserver | null {
  if (typeof MutationObserver === 'undefined') return null
  const mo = new MutationObserver(callback)
  mo.observe(root, { childList: true, subtree: true })
  return mo
}
