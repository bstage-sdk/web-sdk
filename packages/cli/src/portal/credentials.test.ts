import { chmod, mkdir, mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  credentialsPath,
  deleteCredential,
  listCredentialOrgs,
  listCredentials,
  loadCredential,
  resolveToken,
  saveCredential,
  UNKNOWN_ORG,
} from './credentials.js'

async function tmp() {
  return mkdtemp(join(tmpdir(), 'bstage-cred-'))
}

async function readRaw(env: { XDG_CONFIG_HOME: string }) {
  return JSON.parse(await readFile(credentialsPath(env), 'utf-8'))
}

describe('자격증명 저장', () => {
  it('XDG_CONFIG_HOME 아래 bstage/credentials.json에 0600으로 저장한다', async () => {
    const home = await tmp()
    const env = { XDG_CONFIG_HOME: home }
    await saveCredential(
      {
        portalUrl: 'https://portal.example',
        organizationId: 'org1',
        token: 'bsc_abc',
        savedAt: '2026-09-04T00:00:00Z',
      },
      env,
    )
    const p = credentialsPath(env)
    expect(p).toBe(join(home, 'bstage', 'credentials.json'))
    expect((await stat(p)).mode & 0o777).toBe(0o600)
    expect((await stat(join(home, 'bstage'))).mode & 0o777).toBe(0o700)
    expect((await loadCredential('https://portal.example', 'org1', env))?.token).toBe('bsc_abc')
  })

  it('포털 URL별로 따로 저장하고 후행 슬래시를 무시한다', async () => {
    const env = { XDG_CONFIG_HOME: await tmp() }
    await saveCredential({ portalUrl: 'https://a.example/', token: 'bsc_a', savedAt: '' }, env)
    await saveCredential({ portalUrl: 'https://b.example', token: 'bsc_b', savedAt: '' }, env)
    expect((await loadCredential('https://a.example', undefined, env))?.token).toBe('bsc_a')
    expect((await loadCredential('https://b.example/', undefined, env))?.token).toBe('bsc_b')
  })

  it('v2 스키마로 쓴다 — 포털 아래 조직별 항목', async () => {
    const env = { XDG_CONFIG_HOME: await tmp() }
    await saveCredential(
      {
        portalUrl: 'https://a.example',
        organizationId: 'org1',
        token: 'bsc_a',
        savedAt: '2026-09-10T00:00:00Z',
        permission: 'deploy',
        allSpaces: true,
        spaceIds: [],
        expiresAt: '2026-10-10T00:00:00Z',
      },
      env,
    )
    expect(await readRaw(env)).toEqual({
      version: 2,
      tokens: {
        'https://a.example': {
          org1: {
            token: 'bsc_a',
            savedAt: '2026-09-10T00:00:00Z',
            permission: 'deploy',
            allSpaces: true,
            spaceIds: [],
            expiresAt: '2026-10-10T00:00:00Z',
          },
        },
      },
    })
  })

  it('느슨한 모드(0644)의 기존 파일이 있어도 토큰은 0600 파일로만 쓰인다(임시 파일+rename)', async () => {
    const home = await tmp()
    const env = { XDG_CONFIG_HOME: home }
    const p = credentialsPath(env)
    await mkdir(join(home, 'bstage'), { recursive: true })
    await writeFile(p, '{}\n', { mode: 0o644 })
    await chmod(p, 0o644)
    await saveCredential(
      { portalUrl: 'https://portal.example', token: 'bsc_new', savedAt: '' },
      env,
    )
    expect((await stat(p)).mode & 0o777).toBe(0o600)
    expect((await loadCredential('https://portal.example', undefined, env))?.token).toBe('bsc_new')
    const leftovers = (await readdir(join(home, 'bstage'))).filter((f) => f.endsWith('.tmp'))
    expect(leftovers).toEqual([])
  })
})

describe('자격증명 조회 — 조직 선택', () => {
  const env = async () => ({ XDG_CONFIG_HOME: await tmp() })

  it('한 포털에 두 조직을 저장하고 조직으로 골라 읽는다', async () => {
    const e = await env()
    await saveCredential(
      { portalUrl: 'https://p.example', organizationId: 'org1', token: 'bsc_1', savedAt: '' },
      e,
    )
    await saveCredential(
      { portalUrl: 'https://p.example', organizationId: 'org2', token: 'bsc_2', savedAt: '' },
      e,
    )
    expect((await loadCredential('https://p.example', 'org1', e))?.token).toBe('bsc_1')
    expect((await loadCredential('https://p.example', 'org2', e))?.token).toBe('bsc_2')
    expect(await listCredentialOrgs('https://p.example', e)).toEqual(['org1', 'org2'])
  })

  it('조직을 지정하지 않았을 때만 조직 미상(*) 항목으로 폴백한다', async () => {
    const e = await env()
    await saveCredential(
      { portalUrl: 'https://p.example', organizationId: 'org1', token: 'bsc_1', savedAt: '' },
      e,
    )
    await saveCredential({ portalUrl: 'https://p.example', token: 'bsc_any', savedAt: '' }, e)
    const c = await loadCredential('https://p.example', undefined, e)
    expect(c?.token).toBe('bsc_any')
    expect(c?.organizationId).toBe(UNKNOWN_ORG)
  })

  it('조직을 명시하면 다른 조직 토큰으로도 미상 항목으로도 폴백하지 않는다', async () => {
    const e = await env()
    await saveCredential(
      { portalUrl: 'https://p.example', organizationId: 'org1', token: 'bsc_1', savedAt: '' },
      e,
    )
    await saveCredential({ portalUrl: 'https://p.example', token: 'bsc_any', savedAt: '' }, e)
    expect(await loadCredential('https://p.example', 'org404', e)).toBeNull()
  })

  it('조직 항목이 없고 다른 조직 토큰이 하나뿐이어도 조직을 명시했으면 쓰지 않는다', async () => {
    const e = await env()
    await saveCredential(
      { portalUrl: 'https://p.example', organizationId: 'org1', token: 'bsc_1', savedAt: '' },
      e,
    )
    expect(await loadCredential('https://p.example', 'org404', e)).toBeNull()
    expect((await loadCredential('https://p.example', undefined, e))?.token).toBe('bsc_1')
  })

  it('조직 id 가 프로토타입 속성 이름이어도 항목으로 보지 않는다', async () => {
    const e = await env()
    await saveCredential(
      { portalUrl: 'https://p.example', organizationId: 'org1', token: 'bsc_1', savedAt: '' },
      e,
    )
    expect(await loadCredential('https://p.example', 'constructor', e)).toBeNull()
    expect(await deleteCredential('https://p.example', 'constructor', e)).toEqual([])
  })

  it('토큰이 여러 개인데 조직을 특정할 수 없으면 null — 후보는 listCredentialOrgs 로 안내한다', async () => {
    const e = await env()
    await saveCredential(
      { portalUrl: 'https://p.example', organizationId: 'org1', token: 'bsc_1', savedAt: '' },
      e,
    )
    await saveCredential(
      { portalUrl: 'https://p.example', organizationId: 'org2', token: 'bsc_2', savedAt: '' },
      e,
    )
    expect(await loadCredential('https://p.example', undefined, e)).toBeNull()
    expect(await loadCredential('https://p.example', 'org404', e)).toBeNull()
    expect(await listCredentialOrgs('https://p.example', e)).toEqual(['org1', 'org2'])
  })

  it('listCredentials 는 조직별 항목을 등급·스코프·만료와 함께 돌려준다', async () => {
    const e = await env()
    await saveCredential(
      {
        portalUrl: 'https://p.example',
        organizationId: 'org1',
        token: 'bsc_1',
        savedAt: '',
        permission: 'deploy',
        allSpaces: true,
        expiresAt: '2026-10-10T00:00:00Z',
      },
      e,
    )
    expect(await listCredentials('https://p.example', e)).toEqual([
      {
        portalUrl: 'https://p.example',
        organizationId: 'org1',
        token: 'bsc_1',
        savedAt: '',
        permission: 'deploy',
        allSpaces: true,
        expiresAt: '2026-10-10T00:00:00Z',
      },
    ])
  })

  it('저장된 것이 없으면 빈 목록', async () => {
    const e = await env()
    expect(await listCredentialOrgs('https://p.example', e)).toEqual([])
    expect(await listCredentials('https://p.example', e)).toEqual([])
  })
})

describe('v1 파일 호환', () => {
  async function withV1() {
    const home = await tmp()
    const env = { XDG_CONFIG_HOME: home }
    await mkdir(join(home, 'bstage'), { recursive: true })
    await writeFile(
      credentialsPath(env),
      JSON.stringify({
        'https://p.example': { token: 'bsc_old', savedAt: '2026-01-01T00:00:00Z' },
      }) + '\n',
      { mode: 0o600 },
    )
    return env
  }

  it('v1 파일을 읽으면 조직 미상(*) 항목으로 마이그레이션해 그대로 동작한다', async () => {
    const env = await withV1()
    const c = await loadCredential('https://p.example', undefined, env)
    expect(c?.token).toBe('bsc_old')
    expect(c?.organizationId).toBe(UNKNOWN_ORG)
    expect(await resolveToken('https://p.example', env)).toBe('bsc_old')
    expect(await listCredentialOrgs('https://p.example', env)).toEqual([UNKNOWN_ORG])
  })

  it('레거시 미상 항목이 그 포털의 유일한 항목이면 조직을 지정해도 그것을 쓴다', async () => {
    const env = await withV1()
    expect((await loadCredential('https://p.example', 'org1', env))?.token).toBe('bsc_old')
  })

  it('조직 항목이 하나라도 생기면 레거시 미상 항목은 다른 조직에 쓰이지 않는다', async () => {
    const env = await withV1()
    await saveCredential(
      { portalUrl: 'https://p.example', organizationId: 'org1', token: 'bsc_1', savedAt: '' },
      env,
    )
    expect(await loadCredential('https://p.example', 'org404', env)).toBeNull()
  })

  it('토큰이 없는 손상된 항목은 무시한다', async () => {
    const home = await tmp()
    const env = { XDG_CONFIG_HOME: home }
    await mkdir(join(home, 'bstage'), { recursive: true })
    await writeFile(
      credentialsPath(env),
      JSON.stringify({
        version: 2,
        tokens: {
          'https://p.example': {
            org1: { savedAt: '' },
            org2: { token: '', savedAt: '' },
            org3: { token: 'bsc_3', savedAt: '' },
          },
        },
      }) + '\n',
      { mode: 0o600 },
    )
    expect(await listCredentialOrgs('https://p.example', env)).toEqual(['org3'])
    expect(await loadCredential('https://p.example', 'org1', env)).toBeNull()
  })

  it('v1 파일에 조직을 알고 저장하면 v2로 쓰고 레거시 미상 항목은 지운다', async () => {
    const env = await withV1()
    await saveCredential(
      { portalUrl: 'https://p.example', organizationId: 'org1', token: 'bsc_new', savedAt: '' },
      env,
    )
    const raw = await readRaw(env)
    expect(raw.version).toBe(2)
    expect(Object.keys(raw.tokens['https://p.example'])).toEqual(['org1'])
    expect((await loadCredential('https://p.example', 'org1', env))?.token).toBe('bsc_new')
  })

  it('조직 미상으로 저장하면 다른 조직 항목은 건드리지 않는다', async () => {
    const env = { XDG_CONFIG_HOME: await tmp() }
    await saveCredential(
      { portalUrl: 'https://p.example', organizationId: 'org1', token: 'bsc_1', savedAt: '' },
      env,
    )
    await saveCredential({ portalUrl: 'https://p.example', token: 'bsc_any', savedAt: '' }, env)
    expect(await listCredentialOrgs('https://p.example', env)).toEqual([UNKNOWN_ORG, 'org1'])
  })
})

describe('자격증명 삭제', () => {
  it('조직을 지정하면 그 항목만 삭제한다', async () => {
    const env = { XDG_CONFIG_HOME: await tmp() }
    await saveCredential(
      { portalUrl: 'https://p.example', organizationId: 'org1', token: 'bsc_1', savedAt: '' },
      env,
    )
    await saveCredential(
      { portalUrl: 'https://p.example', organizationId: 'org2', token: 'bsc_2', savedAt: '' },
      env,
    )
    expect(await deleteCredential('https://p.example', 'org1', env)).toEqual(['org1'])
    expect(await listCredentialOrgs('https://p.example', env)).toEqual(['org2'])
    expect(await deleteCredential('https://p.example', 'org1', env)).toEqual([])
  })

  it('유일한 레거시 "*" 항목이 조직 요청에 쓰이고 있으면 조직 지정 삭제가 그 항목을 지운다', async () => {
    const env = { XDG_CONFIG_HOME: await tmp() }
    await saveCredential({ portalUrl: 'https://p.example', token: 'bsc_legacy', savedAt: '' }, env)
    expect(await loadCredential('https://p.example', 'orgX', env)).not.toBeNull()
    expect(await deleteCredential('https://p.example', 'orgX', env)).toEqual(['*'])
    expect(await loadCredential('https://p.example', 'orgX', env)).toBeNull()
  })

  it('레거시 "*" 항목과 조직 항목이 함께 있으면 조직 지정 삭제가 "*" 도 같이 지운다 — 로그아웃 뒤 폴백으로 살아남지 않게', async () => {
    const env = { XDG_CONFIG_HOME: await tmp() }
    await saveCredential({ portalUrl: 'https://p.example', token: 'bsc_legacy', savedAt: '' }, env)
    // v1 파일에서 마이그레이션된 "*" 는 조직을 알 수 없어 saveCredential 이 정리하지 못하는 경로를 흉내낸다
    const { writeFile, readFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const p = join(env.XDG_CONFIG_HOME, 'bstage', 'credentials.json')
    const data = JSON.parse(await readFile(p, 'utf8'))
    data.tokens['https://p.example'].orgX = {
      portalUrl: 'https://p.example',
      organizationId: 'orgX',
      token: 'bsc_x',
      savedAt: '',
    }
    await writeFile(p, JSON.stringify(data))
    expect(await deleteCredential('https://p.example', 'orgX', env).then((r) => r.sort())).toEqual([
      '*',
      'orgX',
    ])
    expect(await loadCredential('https://p.example', 'orgX', env)).toBeNull()
    expect(await listCredentialOrgs('https://p.example', env)).toEqual([])
  })

  it('조직을 지정하지 않으면 포털의 모든 조직 토큰을 지우고 지운 목록을 돌려준다', async () => {
    const env = { XDG_CONFIG_HOME: await tmp() }
    await saveCredential(
      { portalUrl: 'https://p.example', organizationId: 'org1', token: 'bsc_1', savedAt: '' },
      env,
    )
    await saveCredential(
      { portalUrl: 'https://p.example', organizationId: 'org2', token: 'bsc_2', savedAt: '' },
      env,
    )
    await saveCredential({ portalUrl: 'https://q.example', token: 'bsc_q', savedAt: '' }, env)
    expect(await deleteCredential('https://p.example', undefined, env)).toEqual(['org1', 'org2'])
    expect(await listCredentialOrgs('https://p.example', env)).toEqual([])
    expect((await loadCredential('https://q.example', undefined, env))?.token).toBe('bsc_q')
  })

  it('마지막 포털까지 지우면 파일 자체를 지운다', async () => {
    const env = { XDG_CONFIG_HOME: await tmp() }
    await saveCredential({ portalUrl: 'https://p.example', token: 'bsc_1', savedAt: '' }, env)
    expect(await deleteCredential('https://p.example', undefined, env)).toEqual([UNKNOWN_ORG])
    await expect(readFile(credentialsPath(env), 'utf-8')).rejects.toThrow()
  })
})

describe('resolveToken', () => {
  it('BSTAGE_TOKEN 환경변수가 파일보다 우선한다', async () => {
    const env = { XDG_CONFIG_HOME: await tmp(), BSTAGE_TOKEN: 'bsc_env' }
    await saveCredential(
      { portalUrl: 'https://a.example', organizationId: 'org1', token: 'bsc_file', savedAt: '' },
      env,
    )
    expect(await resolveToken('https://a.example', env)).toBe('bsc_env')
  })

  it('조직을 주면 그 조직 토큰을 돌려준다', async () => {
    const env = { XDG_CONFIG_HOME: await tmp() }
    await saveCredential(
      { portalUrl: 'https://a.example', organizationId: 'org1', token: 'bsc_1', savedAt: '' },
      env,
    )
    await saveCredential(
      { portalUrl: 'https://a.example', organizationId: 'org2', token: 'bsc_2', savedAt: '' },
      env,
    )
    expect(await resolveToken('https://a.example', env, 'org2')).toBe('bsc_2')
    expect(await resolveToken('https://a.example', env)).toBeNull()
  })
})
