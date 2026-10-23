import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  REPORT_COUNT_MAX,
  REPORT_FRAME_MAX_LENGTH,
  REPORT_MAX_FRAMES,
  REPORT_MESSAGE_MAX_LENGTH,
  REPORTS_PER_SESSION,
} from '../protocol/messages.js'
import { validateReport } from '../host/validators.js'
import {
  installErrorReport,
  type ErrorReportConfig,
  type ErrorReportGlobal,
} from './errorReport.js'

/**
 * 프레임 에러 수집기. 손 검증은 에러 한 번을 내 보는 정도라 정규화(스택 줄·자르기)·dedupe·세션 상한·
 * 리스너 해제·count 누적은 여기서만 확인된다. 보낸 payload가 호스트 검증기를 통과하는지도 같이 본다.
 */

const CONFIG: ErrorReportConfig = {
  maxReports: REPORTS_PER_SESSION,
  maxMessageLength: REPORT_MESSAGE_MAX_LENGTH,
  maxFrames: REPORT_MAX_FRAMES,
  maxFrameLength: REPORT_FRAME_MAX_LENGTH,
  maxCount: REPORT_COUNT_MAX,
  flushDelayMs: 1000,
}

type Handler = (ev: unknown) => void

function setup() {
  const listeners = new Map<string, Set<Handler>>()
  const g: ErrorReportGlobal = {
    addEventListener: ((type: string, fn: Handler) => {
      const set = listeners.get(type) ?? new Set<Handler>()
      set.add(fn)
      listeners.set(type, set)
    }) as ErrorReportGlobal['addEventListener'],
    removeEventListener: ((type: string, fn: Handler) => {
      listeners.get(type)?.delete(fn)
    }) as ErrorReportGlobal['removeEventListener'],
    setTimeout: ((fn: () => void, ms: number) => setTimeout(fn, ms)) as never,
  }
  const request = vi.fn(async (_type: string, _payload: unknown) => ({}))
  const record = installErrorReport(g, { request: request as never }, CONFIG)
  const fire = (type: string, ev: unknown) => listeners.get(type)?.forEach((fn) => fn(ev))
  const count = (type: string) => listeners.get(type)?.size ?? 0
  const sent = () => request.mock.calls.map((c) => c[1] as Record<string, unknown>)
  return { g, request, record, fire, count, sent }
}

function errorWith(message: string, stack: string) {
  return { message, stack }
}

const V8_STACK = [
  'TypeError: Cannot read properties of undefined (reading x)',
  '    at render (https://cdn.example.com/t/abc/template.js:10:5)',
  '    at https://cdn.example.com/t/abc/template.js:20:7',
  '',
].join('\n')

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('정규화', () => {
  it('error 이벤트 — ev.error의 message·스택 프레임 줄만, 첫 줄(메시지)은 프레임이 아니다', () => {
    const { fire, request, sent } = setup()
    fire('error', { message: 'Uncaught TypeError', error: errorWith('Cannot read x', V8_STACK) })
    expect(request).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(request).toHaveBeenCalledWith('report', {
      kind: 'error',
      message: 'Cannot read x',
      frames: [
        'at render (https://cdn.example.com/t/abc/template.js:10:5)',
        'at https://cdn.example.com/t/abc/template.js:20:7',
      ],
      count: 1,
    })
    expect(() => validateReport(sent()[0])).not.toThrow()
  })

  it('Firefox·Safari 스택(`f@url:l:c`)도 프레임으로 읽는다', () => {
    const { fire, sent } = setup()
    fire('error', {
      error: errorWith(
        'boom',
        'render@https://cdn.example.com/t.js:1:2\n@https://cdn.example.com/t.js:3:4',
      ),
    })
    vi.advanceTimersByTime(1000)
    expect(sent()[0].frames).toEqual([
      'render@https://cdn.example.com/t.js:1:2',
      '@https://cdn.example.com/t.js:3:4',
    ])
  })

  it('메시지 줄은 @·:줄:열이 들어 있어도 프레임이 아니다 — 프레임 형식에만 맞춘다', () => {
    const { fire, sent } = setup()
    fire('error', {
      error: errorWith(
        'contact a@b.com or c@d.io:1:2',
        [
          'Error: contact a@b.com or c@d.io:1:2',
          'second line of message user@example.com',
          'at render (https://cdn.example.com/t.js:10:5)',
          'global code@https://cdn.example.com/t.js:3:4',
          'https://cdn.example.com/t.js:7:8',
        ].join('\n'),
      ),
    })
    vi.advanceTimersByTime(1000)
    expect(sent()[0].frames).toEqual([
      'at render (https://cdn.example.com/t.js:10:5)',
      'global code@https://cdn.example.com/t.js:3:4',
      'https://cdn.example.com/t.js:7:8',
    ])
  })

  it('ev.error가 없으면(교차 origin "Script error." 등) ev.message와 filename:lineno:colno를 쓴다', () => {
    const { fire, sent } = setup()
    fire('error', { message: 'Script error.', filename: '', lineno: 0, colno: 0, error: null })
    fire('error', {
      message: 'oops',
      filename: 'https://cdn.example.com/t.js',
      lineno: 3,
      colno: 9,
    })
    vi.advanceTimersByTime(1000)
    expect(sent()).toEqual([
      { kind: 'error', message: 'Script error.', frames: [], count: 1 },
      {
        kind: 'error',
        message: 'oops',
        frames: ['at https://cdn.example.com/t.js:3:9'],
        count: 1,
      },
    ])
  })

  it('unhandledrejection — Error면 message·stack, 아니면 문자열로', () => {
    const { fire, sent } = setup()
    fire('unhandledrejection', { reason: errorWith('nope', V8_STACK) })
    fire('unhandledrejection', { reason: 'plain' })
    fire('unhandledrejection', { reason: undefined })
    fire('unhandledrejection', {
      reason: {
        toString() {
          throw new Error('x')
        },
      },
    })
    vi.advanceTimersByTime(1000)
    expect(sent().map((p) => [p.kind, p.message])).toEqual([
      ['rejection', 'nope'],
      ['rejection', 'plain'],
      ['rejection', 'undefined'],
      ['rejection', ''],
    ])
    sent().forEach((p) => expect(() => validateReport(p)).not.toThrow())
  })

  it('상한으로 자른다 — message 300자, frames 10개·각 200자', () => {
    const { fire, sent } = setup()
    const frames = Array.from(
      { length: 15 },
      (_, i) => `    at f${i} (https://cdn.example.com/${'p'.repeat(300)}.js:${i}:1)`,
    )
    fire('error', { error: errorWith('m'.repeat(1000), ['Error: m', ...frames].join('\n')) })
    vi.advanceTimersByTime(1000)
    const p = sent()[0] as { message: string; frames: string[] }
    expect(p.message).toHaveLength(300)
    expect(p.frames).toHaveLength(10)
    expect(p.frames.every((f) => f.length === 200)).toBe(true)
    expect(() => validateReport(p)).not.toThrow()
  })

  it('record 직접 호출(엔트리 load 실패)', () => {
    const { record, sent } = setup()
    record('load', 'template entry failed to load', '')
    vi.advanceTimersByTime(1000)
    expect(sent()).toEqual([
      { kind: 'load', message: 'template entry failed to load', frames: [], count: 1 },
    ])
  })
})

describe('dedupe·상한', () => {
  it('같은 fingerprint(kind+숫자 뺀 message+첫 프레임)는 한 번만, 대기 중 반복은 count로 누적한다', () => {
    const { fire, request, sent } = setup()
    fire('error', { error: errorWith('id 1 failed', V8_STACK) })
    fire('error', { error: errorWith('id 22 failed', V8_STACK) })
    fire('error', { error: errorWith('id 333 failed', V8_STACK) })
    vi.advanceTimersByTime(1000)
    expect(request).toHaveBeenCalledTimes(1)
    expect(sent()[0]).toMatchObject({ message: 'id 1 failed', count: 3 })
    // 보낸 뒤의 반복은 다시 보내지 않는다(세션당 fingerprint 한 번).
    fire('error', { error: errorWith('id 4 failed', V8_STACK) })
    vi.advanceTimersByTime(1000)
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('kind나 첫 프레임이 다르면 다른 fingerprint다', () => {
    const { fire, request } = setup()
    fire('error', { error: errorWith('x', V8_STACK) })
    fire('unhandledrejection', { reason: errorWith('x', V8_STACK) })
    fire('error', { error: errorWith('x', 'Error: x\n    at other (https://c/x.js:1:1)') })
    vi.advanceTimersByTime(1000)
    expect(request).toHaveBeenCalledTimes(3)
  })

  it('count는 100에서 멈춘다', () => {
    const { fire, sent } = setup()
    for (let i = 0; i < 250; i += 1) fire('error', { error: errorWith('loop', V8_STACK) })
    vi.advanceTimersByTime(1000)
    expect(sent()[0].count).toBe(100)
  })

  it('세션당 서로 다른 fingerprint 5건까지만 보내고, 5건에 닿으면 리스너를 해제한다', () => {
    const { fire, request, count, record } = setup()
    expect(count('error')).toBe(1)
    expect(count('unhandledrejection')).toBe(1)
    for (let i = 0; i < 4; i += 1) fire('error', { error: errorWith(`e${'x'.repeat(i)}`, '') })
    expect(count('error')).toBe(1)
    fire('error', { error: errorWith('fifth', '') })
    expect(count('error')).toBe(0)
    expect(count('unhandledrejection')).toBe(0)
    record('load', 'sixth', '')
    vi.advanceTimersByTime(1000)
    expect(request).toHaveBeenCalledTimes(5)
  })

  it('request가 던지거나 거절돼도 수집기는 조용하다', () => {
    const { g } = setup()
    const throwing = installErrorReport(
      g,
      {
        request: (() => {
          throw new Error('closed')
        }) as never,
      },
      CONFIG,
    )
    const rejecting = installErrorReport(
      g,
      { request: (() => Promise.reject(new Error('x'))) as never },
      CONFIG,
    )
    expect(() => throwing('error', 'a', '')).not.toThrow()
    expect(() => rejecting('error', 'a', '')).not.toThrow()
    expect(() => vi.advanceTimersByTime(1000)).not.toThrow()
  })

  it('setTimeout이 없는 전역이면 바로 보낸다', () => {
    const request = vi.fn(async () => ({}))
    const record = installErrorReport({}, { request: request as never }, CONFIG)
    record('error', 'now', '')
    expect(request).toHaveBeenCalledWith('report', {
      kind: 'error',
      message: 'now',
      frames: [],
      count: 1,
    })
  })
})
