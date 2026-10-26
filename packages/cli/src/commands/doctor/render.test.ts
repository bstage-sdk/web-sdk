import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DoctorReport } from './report.js'
import { printReport } from './render.js'

afterEach(() => vi.restoreAllMocks())

describe('printReport', () => {
  it('템플릿 프로젝트로 보이지 않아도 콘솔 진단 절은 보인다(--json과 같은 내용)', () => {
    const out: string[] = []
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void out.push(a.join(' ')))
    printReport({
      project: 'x',
      isBstageProject: false,
      portal: {
        status: 'ok',
        placements: [
          { placementId: 'p1', path: '/todos', slotId: '', surface: 'USER', findings: [] },
        ],
      },
    } as unknown as DoctorReport)
    const text = out.join('\n')
    expect(text).toContain('콘솔 진단')
    expect(text).toContain('/todos')
  })
})
