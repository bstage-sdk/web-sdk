import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CORE_DOCS_SEGMENTS, docsCommand } from './docs.js'

/**
 * 스킬은 "명령의 종료 코드로 갈래를 잡으라"고 안내한다. 그래서 문서를 못 찾은 것을 0으로 끝내면
 * 에이전트가 문서를 읽은 것으로 보고 다음 단계로 넘어간다. SDK 의존 없이 `.liquid` 파일만 둔
 * 레포에서 실제로 이 경로를 타므로, 조용한 성공은 그 자체로 오안내가 된다.
 */
describe('bstage docs', () => {
  const roots: string[] = []
  const originalExitCode = process.exitCode

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
    vi.restoreAllMocks()
    process.exitCode = originalExitCode
  })

  function fixture(withDocs: boolean): string {
    const root = mkdtempSync(join(tmpdir(), 'docs-cmd-'))
    roots.push(root)
    if (withDocs) {
      const dir = join(root, ...CORE_DOCS_SEGMENTS)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'GETTING_STARTED.md'), '# x\n', 'utf-8')
    }
    return root
  }

  async function run(root: string): Promise<{ code: number | undefined; out: string }> {
    const lines: string[] = []
    vi.spyOn(console, 'log').mockImplementation((...a) => void lines.push(a.join(' ')))
    vi.spyOn(process, 'cwd').mockReturnValue(root)
    process.exitCode = undefined
    await docsCommand()
    return { code: process.exitCode, out: lines.join('\n') }
  }

  it('문서가 없으면 사전조건 실패(2)로 끝낸다', async () => {
    const { code } = await run(fixture(false))
    expect(code).toBe(2)
  })

  it('문서가 없을 때 liquid 레포에서 어디를 볼지 알려준다', async () => {
    const { out } = await run(fixture(false))
    expect(out).toContain('bstage-liquid')
  })

  it('문서가 있으면 목록을 내고 종료 코드를 건드리지 않는다', async () => {
    const { code, out } = await run(fixture(true))
    expect(code).toBeUndefined()
    expect(out).toContain('GETTING_STARTED.md')
  })
})
