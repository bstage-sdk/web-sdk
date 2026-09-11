import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PORTAL_HOSTS } from '../constants.js'
import {
  allowedPortalOrigins,
  loadLink,
  normalizePortalUrl,
  resolvePortalUrl,
  saveLink,
} from './config.js'
import { ExitCode } from './output.js'

async function tmp() {
  return mkdtemp(join(tmpdir(), 'bstage-cfg-'))
}

const SANDBOX_PORTAL = `https://${PORTAL_HOSTS.sandbox}`

function linkTo(portalUrl: string) {
  return {
    portalUrl,
    organizationId: 'o',
    spaceId: 's',
    repoId: 'r',
    surface: 'USER' as const,
  }
}

describe('링크', () => {
  it('.bstage/project.json에 저장하고 읽는다', async () => {
    const cwd = await tmp()
    const link = {
      portalUrl: 'https://a.example',
      organizationId: 'org1',
      spaceId: 'sp1',
      repoId: 'r1',
      surface: 'USER' as const,
    }
    await saveLink(cwd, link)
    expect(JSON.parse(await readFile(join(cwd, '.bstage', 'project.json'), 'utf-8'))).toEqual(link)
    expect(await loadLink(cwd, {})).toEqual(link)
  })

  it('환경변수 5종이 모두 있으면 파일 없이 링크를 구성한다', async () => {
    const cwd = await tmp()
    const env = {
      BSTAGE_PORTAL_URL: 'https://a.example',
      BSTAGE_ORG: 'org1',
      BSTAGE_SPACE: 'sp1',
      BSTAGE_REPO: 'r1',
      BSTAGE_SURFACE: 'ADMIN',
    }
    expect(await loadLink(cwd, env)).toEqual({
      portalUrl: 'https://a.example',
      organizationId: 'org1',
      spaceId: 'sp1',
      repoId: 'r1',
      surface: 'ADMIN',
    })
  })

  it('파일도 환경변수도 없으면 null', async () => {
    expect(await loadLink(await tmp(), {})).toBeNull()
  })
})

describe('resolvePortalUrl — phase 매핑', () => {
  it('--portal 이 최우선', async () => {
    expect(await resolvePortalUrl('https://x.example/', await tmp(), {})).toBe('https://x.example')
  })
  it('BSTAGE_PORTAL_URL 이 링크 파일보다 우선', async () => {
    const cwd = await tmp()
    await saveLink(cwd, { ...linkTo(SANDBOX_PORTAL) })
    expect(
      await resolvePortalUrl(undefined, cwd, { BSTAGE_PORTAL_URL: 'https://env.example' }),
    ).toBe('https://env.example')
    expect(await resolvePortalUrl(undefined, cwd, {})).toBe(SANDBOX_PORTAL)
  })
  it('아무것도 없으면 phase 매핑 — 기본 sandbox', async () => {
    expect(await resolvePortalUrl(undefined, await tmp(), {})).toBe(
      `https://${PORTAL_HOSTS.sandbox}`,
    )
  })
  it('--phase real 이면 real 포털', async () => {
    expect(await resolvePortalUrl(undefined, await tmp(), {}, 'real')).toBe(
      `https://${PORTAL_HOSTS.real}`,
    )
  })
  it('.env 의 VITE_BSTAGE_PHASE 를 읽는다', async () => {
    const cwd = await tmp()
    await writeFile(join(cwd, '.env'), 'VITE_BSTAGE_PHASE=real\n')
    expect(await resolvePortalUrl(undefined, cwd, {})).toBe(`https://${PORTAL_HOSTS.real}`)
  })
  it('사내 phase 는 VITE_BSTAGE_PORTAL_HOST 로 받고, 없으면 throw', async () => {
    const cwd = await tmp()
    expect(
      await resolvePortalUrl(
        undefined,
        cwd,
        { VITE_BSTAGE_PORTAL_HOST: 'portal.dev.internal' },
        'qa',
      ),
    ).toBe('https://portal.dev.internal')
    await expect(resolvePortalUrl(undefined, cwd, {}, 'qa')).rejects.toThrow(
      /VITE_BSTAGE_PORTAL_HOST/,
    )
  })
})

describe('normalizePortalUrl — 스킴 검증', () => {
  it('https 는 후행 슬래시만 떼고 그대로', () => {
    expect(normalizePortalUrl('https://portal.example/')).toBe('https://portal.example')
    expect(normalizePortalUrl('https://portal.example/base/')).toBe('https://portal.example/base')
  })

  it.each([['http://localhost:5173'], ['http://127.0.0.1:8080/base']])(
    '로컬(%s)은 http 를 허용한다',
    (url) => {
      expect(normalizePortalUrl(url)).toBe(url)
    },
  )

  it.each([['http://portal.example'], ['ftp://portal.example'], ['file:///tmp/x']])(
    '로컬이 아닌 %s 는 PRECONDITION',
    (url) => {
      expect(() => normalizePortalUrl(url)).toThrowError(/https/)
      try {
        normalizePortalUrl(url)
      } catch (err) {
        expect(err).toMatchObject({ code: 2 })
      }
    },
  )

  it('resolvePortalUrl 도 http 주소를 막는다', async () => {
    await expect(resolvePortalUrl('http://portal.example', await tmp(), {})).rejects.toMatchObject({
      code: 2,
    })
    await expect(
      resolvePortalUrl(undefined, await tmp(), { BSTAGE_PORTAL_URL: 'http://portal.example' }),
    ).rejects.toMatchObject({ code: 2 })
  })
})

describe('resolvePortalUrl — 포털 호스트 허용 목록', () => {
  it('허용 목록은 PORTAL_HOSTS 전 phase + BSTAGE_PORTAL_URL + --portal 을 담는다', async () => {
    const origins = allowedPortalOrigins(
      await tmp(),
      { BSTAGE_PORTAL_URL: 'https://env.example/base/' },
      'https://flag.example',
    )
    for (const host of Object.values(PORTAL_HOSTS))
      expect(origins.has(`https://${host}`)).toBe(true)
    expect(origins.has('https://env.example')).toBe(true)
    expect(origins.has('https://flag.example')).toBe(true)
    expect(origins.has('https://evil.example')).toBe(false)
  })

  it('링크 파일이 허용 목록 밖 오리진이면 PRECONDITION', async () => {
    const cwd = await tmp()
    await saveLink(cwd, linkTo('https://evil.example'))
    await expect(resolvePortalUrl(undefined, cwd, {})).rejects.toMatchObject({
      code: ExitCode.PRECONDITION,
      message: expect.stringContaining('허용 목록'),
    })
  })

  it('링크 파일이 PORTAL_HOSTS 오리진이면 그대로 쓴다', async () => {
    const cwd = await tmp()
    await saveLink(cwd, linkTo(`${SANDBOX_PORTAL}/base`))
    expect(await resolvePortalUrl(undefined, cwd, {})).toBe(`${SANDBOX_PORTAL}/base`)
  })

  it('--portal 은 허용 목록 밖 주소여도 그대로 신뢰한다(사용자가 직접 준 값)', async () => {
    const cwd = await tmp()
    await saveLink(cwd, linkTo('https://evil.example'))
    expect(await resolvePortalUrl('https://custom.example', cwd, {})).toBe('https://custom.example')
  })

  it('BSTAGE_TOKEN 이 있으면 링크 파일 주소는 허용 목록 안이라도 쓰지 않는다', async () => {
    const cwd = await tmp()
    await saveLink(cwd, linkTo(SANDBOX_PORTAL))
    await expect(
      resolvePortalUrl(undefined, cwd, { BSTAGE_TOKEN: 'bsc_ci' }),
    ).rejects.toMatchObject({
      code: ExitCode.PRECONDITION,
      message: expect.stringContaining('BSTAGE_TOKEN'),
    })
  })

  it('BSTAGE_TOKEN + BSTAGE_PORTAL_URL 은 통과한다', async () => {
    const cwd = await tmp()
    await saveLink(cwd, linkTo('https://evil.example'))
    expect(
      await resolvePortalUrl(undefined, cwd, {
        BSTAGE_TOKEN: 'bsc_ci',
        BSTAGE_PORTAL_URL: 'https://ci.example',
      }),
    ).toBe('https://ci.example')
  })

  it('.env 의 포털 호스트는 BSTAGE_TOKEN 이 없을 때만 허용 목록에 든다', async () => {
    const cwd = await tmp()
    await writeFile(join(cwd, '.env'), 'VITE_BSTAGE_PORTAL_HOST=portal.dev.internal\n')
    await saveLink(cwd, linkTo('https://portal.dev.internal'))
    expect(await resolvePortalUrl(undefined, cwd, {})).toBe('https://portal.dev.internal')
    await expect(
      resolvePortalUrl(undefined, cwd, { BSTAGE_TOKEN: 'bsc_ci' }),
    ).rejects.toMatchObject({ code: ExitCode.PRECONDITION })
  })

  it('BSTAGE_TOKEN 이 있으면 사내 phase 의 .env 매핑도 막는다', async () => {
    const cwd = await tmp()
    await writeFile(
      join(cwd, '.env'),
      'VITE_BSTAGE_PHASE=qa\nVITE_BSTAGE_PORTAL_HOST=portal.dev.internal\n',
    )
    await expect(
      resolvePortalUrl(undefined, cwd, { BSTAGE_TOKEN: 'bsc_ci' }),
    ).rejects.toMatchObject({
      code: ExitCode.PRECONDITION,
      message: expect.stringContaining('VITE_BSTAGE_PORTAL_HOST'),
    })
    // 공개 phase 매핑은 BSTAGE_TOKEN 이 있어도 그대로 쓸 수 있다
    expect(await resolvePortalUrl(undefined, cwd, { BSTAGE_TOKEN: 'bsc_ci' }, 'sandbox')).toBe(
      SANDBOX_PORTAL,
    )
  })

  it('allowLink: false 면 링크 파일을 아예 읽지 않는다', async () => {
    const cwd = await tmp()
    await saveLink(cwd, linkTo('https://evil.example'))
    expect(await resolvePortalUrl(undefined, cwd, {}, undefined, { allowLink: false })).toBe(
      SANDBOX_PORTAL,
    )
  })
})
