import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { builtinManifestPath, loadBuiltinState, recordBuiltinSync } from './builtinState.js'
import { linkPath, saveLink } from './config.js'

const sha = (s: string) => createHash('sha256').update(s).digest('hex')

async function setup() {
  const cwd = await mkdtemp(join(tmpdir(), 'bstate-'))
  await saveLink(cwd, {
    portalUrl: 'https://p.example',
    organizationId: 'o',
    spaceId: 's',
    repoId: 'r1',
    surface: 'USER',
  })
  return cwd
}

describe('recordBuiltinSync — 원자적 쓰기(AWS Security Agent 2차 M3)', () => {
  it('예전의 예측 가능한 임시 이름에 깔린 심볼릭 링크를 따라가지 않는다', async () => {
    const cwd = await setup()
    const outside = await mkdtemp(join(tmpdir(), 'bstate-out-'))
    const target = join(outside, 'victim')
    await writeFile(target, 'orig')
    await mkdir(join(cwd, '.bstage'), { recursive: true })
    for (const p of [builtinManifestPath(cwd), linkPath(cwd)]) {
      await symlink(target, `${p}.tmp-${process.pid}`)
    }

    await recordBuiltinSync(cwd, 'r1', 'v'.repeat(32), { 'a.txt': sha('A') })

    expect(await readFile(target, 'utf-8')).toBe('orig')
    const saved = JSON.parse(await readFile(builtinManifestPath(cwd), 'utf-8'))
    expect(saved).toEqual({ repoId: 'r1', versionId: 'v'.repeat(32), files: { 'a.txt': sha('A') } })
    expect(JSON.parse(await readFile(linkPath(cwd), 'utf-8')).builtinHead).toBe('v'.repeat(32))
    expect((await stat(builtinManifestPath(cwd))).mode & 0o777).toBe(0o600)
    // 무작위 임시 파일은 남지 않는다(미리 깔린 링크만 그대로).
    const left = (await readdir(join(cwd, '.bstage'))).filter((n) => n.includes('.tmp-'))
    expect(left.sort()).toEqual(
      [`builtin-manifest.json.tmp-${process.pid}`, `project.json.tmp-${process.pid}`].sort(),
    )
  })
})

describe('loadBuiltinState — 기준 검증(AWS Security Agent 2차 L2)', () => {
  async function withState(files: unknown) {
    const cwd = await setup()
    await writeFile(
      builtinManifestPath(cwd),
      JSON.stringify({ repoId: 'r1', versionId: 'x', files }),
    )
    return loadBuiltinState(cwd, 'r1')
  }

  it('정상 기준은 그대로 읽는다', async () => {
    expect((await withState({ 'a.txt': sha('A'), 'src/b.ts': sha('B') }))?.files).toEqual({
      'a.txt': sha('A'),
      'src/b.ts': sha('B'),
    })
  })

  it.each([
    ['.git/config', { '.git/config': sha('C') }],
    ['../x', { '../x': sha('C') }],
    ['/etc/passwd', { '/etc/passwd': sha('C') }],
    ['.env.local', { '.env.local': sha('C') }],
    ['.ssh/id_rsa', { '.ssh/id_rsa': sha('C') }],
    ['대소문자 중복', { 'a.txt': sha('A'), 'A.txt': sha('A') }],
    ['파일/폴더 충돌', { a: sha('A'), 'a/b': sha('B') }],
    ['대문자 해시', { 'a.txt': sha('A').toUpperCase() }],
    ['짧은 해시', { 'a.txt': 'abc' }],
    ['문자열 아닌 해시', { 'a.txt': 1 }],
    ['배열', [sha('A')]],
  ])('%s 가 있으면 null', async (_n, files) => {
    expect(await withState(files)).toBeNull()
  })
})
