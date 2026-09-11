import { describe, expect, it, vi } from 'vitest'
import type { PortalClient } from './client.js'
import type { Build } from './types.js'
import { waitForBuild } from './waitBuild.js'

function fakeClient(statuses: Build['status'][], logs: string[]) {
  let i = 0
  const build = (status: Build['status']): Build => ({
    id: 'b',
    spaceId: 's',
    surface: 'USER',
    stageRepoId: 'r',
    commitSha: 'c',
    status,
    requestedAt: '',
  })
  return {
    calls: 0,
    getBuild: async () => build(statuses[Math.min(i++, statuses.length - 1)]),
    getBuildLog: async () => logs[Math.min(i - 1, logs.length - 1)] ?? '',
  } as unknown as PortalClient & { calls: number }
}

describe('waitForBuild', () => {
  it('터미널 상태까지 폴링하고 로그 delta를 흘린다', async () => {
    const c = fakeClient(['QUEUED', 'RUNNING', 'SUCCEEDED'], ['', 'a\n', 'a\nb\n'])
    const deltas: string[] = []
    const b = await waitForBuild(c, 'o', 's', 'b', {
      intervalMs: 1,
      sleep: async () => {},
      onLog: (d) => deltas.push(d),
    })
    expect(b.status).toBe('SUCCEEDED')
    expect(deltas.join('')).toBe('a\nb\n')
  })

  it('타임아웃이면 FAILURE', async () => {
    const c = fakeClient(['RUNNING'], [''])
    await expect(
      waitForBuild(c, 'o', 's', 'b', { intervalMs: 1, timeoutMs: 0, sleep: async () => {} }),
    ).rejects.toMatchObject({ code: 1 })
  })

  it('서버 로그가 이전보다 짧아지면(재시작) 처음부터 다시 흘린다', async () => {
    const c = fakeClient(['RUNNING', 'RUNNING', 'SUCCEEDED'], ['a\nb\nc\n', 'x\n', 'x\ny\n'])
    const deltas: string[] = []
    const b = await waitForBuild(c, 'o', 's', 'b', {
      intervalMs: 1,
      sleep: async () => {},
      onLog: (d) => deltas.push(d),
    })
    expect(b.status).toBe('SUCCEEDED')
    expect(deltas.join('')).toContain('x\ny\n')
  })

  it('로그 조회 실패는 건너뛰고 재시작으로 오판하지 않는다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const statuses: Build['status'][] = ['RUNNING', 'RUNNING', 'SUCCEEDED']
    const logs: (string | null)[] = ['a\n', null, 'a\nb\n']
    let i = 0
    const build = (status: Build['status']): Build => ({
      id: 'b',
      spaceId: 's',
      surface: 'USER',
      stageRepoId: 'r',
      commitSha: 'c',
      status,
      requestedAt: '',
    })
    const c = {
      getBuild: async () => build(statuses[Math.min(i++, statuses.length - 1)]),
      getBuildLog: async () => {
        const entry = logs[Math.min(i - 1, logs.length - 1)]
        if (entry === null) throw new Error('일시적 네트워크 오류')
        return entry
      },
    } as unknown as PortalClient
    const deltas: string[] = []
    const b = await waitForBuild(c, 'o', 's', 'b', {
      intervalMs: 1,
      sleep: async () => {},
      onLog: (d) => deltas.push(d),
    })
    expect(b.status).toBe('SUCCEEDED')
    expect(deltas).toEqual(['a\n', 'b\n'])
    vi.restoreAllMocks()
  })
})
