import { describe, expect, it } from 'vitest'
import { buildMatchesRepo, resolveLinkedRepo } from './buildRepo.js'
import type { PortalContext } from './resolveContext.js'
import type { Build, StageRepo } from './types.js'

const repo: StageRepo = {
  id: 'r1',
  spaceId: 's',
  surface: 'USER',
  owner: 'Acme',
  repo: 'widgets',
  defaultBranch: 'main',
}

const build = (overrides: Partial<Build> = {}): Build => ({
  id: 'b1',
  spaceId: 's',
  surface: 'USER',
  commitSha: 'abc1234',
  status: 'SUCCEEDED',
  requestedAt: '2026-09-01T00:00:00Z',
  ...overrides,
})

describe('buildMatchesRepo', () => {
  it('stageRepoId가 일치하면 매칭', () => {
    expect(buildMatchesRepo(build({ stageRepoId: 'r1' }), repo)).toBe(true)
  })

  it('stageRepoId가 없어도 owner/repo가 일치하면 매칭 (owner·repo 모두 대소문자 무시)', () => {
    expect(buildMatchesRepo(build({ owner: 'acme', repo: 'widgets' }), repo)).toBe(true)
    expect(buildMatchesRepo(build({ owner: 'acme', repo: 'Widgets' }), repo)).toBe(true)
  })

  it('owner는 같지만 repo가 다르면 매칭 실패', () => {
    expect(buildMatchesRepo(build({ owner: 'Acme', repo: 'other' }), repo)).toBe(false)
  })

  it('owner가 다르면 매칭 실패', () => {
    expect(buildMatchesRepo(build({ owner: 'other-org', repo: 'widgets' }), repo)).toBe(false)
  })

  it('stageRepoId가 있고 다르면 owner/repo가 같아도 매칭 실패(폴백 없음)', () => {
    expect(
      buildMatchesRepo(build({ stageRepoId: 'other', owner: 'acme', repo: 'web' }), repo),
    ).toBe(false)
  })
  it('owner/repo가 같아도 surface가 다르면 매칭 실패', () => {
    expect(
      buildMatchesRepo(
        build({ stageRepoId: undefined, owner: 'acme', repo: 'web', surface: 'ADMIN' }),
        repo,
      ),
    ).toBe(false)
  })
  it('owner/repo가 같아도 surface가 없으면 매칭 실패(fail-closed)', () => {
    expect(
      buildMatchesRepo(
        build({ stageRepoId: undefined, owner: 'acme', repo: 'web', surface: undefined as never }),
        repo,
      ),
    ).toBe(false)
  })
  it('owner/repo가 같아도 spaceId가 없거나 다르면 매칭 실패(fail-closed)', () => {
    expect(
      buildMatchesRepo(
        build({ stageRepoId: undefined, owner: 'acme', repo: 'web', spaceId: undefined as never }),
        repo,
      ),
    ).toBe(false)
    expect(
      buildMatchesRepo(
        build({ stageRepoId: undefined, owner: 'acme', repo: 'web', spaceId: 'other' }),
        repo,
      ),
    ).toBe(false)
  })
  it('stageRepoId도 owner/repo도 없으면 매칭 실패', () => {
    expect(buildMatchesRepo(build(), repo)).toBe(false)
  })
})

function fakeContext(repos: StageRepo[], repoId = 'r1'): PortalContext {
  return {
    client: {
      listRepos: async () => repos,
    } as unknown as PortalContext['client'],
    link: {
      portalUrl: 'https://sandbox.bstage.example',
      organizationId: 'org1',
      spaceId: 'sp1',
      repoId,
      surface: 'USER',
    },
  }
}

describe('resolveLinkedRepo', () => {
  it('링크의 repoId와 일치하는 StageRepo를 찾는다', async () => {
    const ctx = fakeContext([repo])
    await expect(resolveLinkedRepo(ctx)).resolves.toEqual(repo)
  })

  it('링크의 repoId가 목록에 없으면 PRECONDITION으로 끝낸다', async () => {
    const ctx = fakeContext([repo], 'missing')
    await expect(resolveLinkedRepo(ctx)).rejects.toMatchObject({ code: 2 })
  })
})
