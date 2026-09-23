import { execFileSync } from 'node:child_process'
import { randomInt } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { checkSecretsScript } from './checkSecretsScript.js'

/**
 * 가드 스크립트는 문자열 리터럴이라 타입도 린트도 지나가지 않는다 — 산출물을 임시 git 레포에
 * 실제로 깔고 `node`로 돌려서 차단/통과를 확인한다. 손 검증은 "차단되지 않았다"가 정상인지
 * 버그인지 구분하지 못한다(힌트 낱말이 든 주석 한 줄이면 실키가 통과했다).
 */

const dirs: string[] = []

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

/** 실제 키 모양을 만들지 않는다 — 접두사 + 무작위 영숫자(대문자 힌트와 겹치지 않는 문자만). */
function randomToken(): string {
  // 힌트 낱말(YOUR·EXAMPLE·PLACEHOLDER·XXXX)과 겹칠 수 없는 소문자·숫자만 쓴다.
  const alphabet = 'abcdefghijklmnopqrstuvwz0123456789'
  return Array.from({ length: 32 }, () => alphabet[randomInt(alphabet.length)]).join('')
}

/** 임시 git 레포에 가드를 깔고 주어진 파일들을 스테이지한 뒤 가드를 돌린다. */
function runGuard(files: Record<string, string>): { status: number; stderr: string } {
  const root = mkdtempSync(join(tmpdir(), 'bstage-guard-'))
  dirs.push(root)
  const git = (args: string[]) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] })
  git(['init', '-q'])
  git(['config', 'user.email', 'test@example.invalid'])
  git(['config', 'user.name', 'test'])

  mkdirSync(join(root, '.husky'), { recursive: true })
  writeFileSync(join(root, '.husky/check-secrets.mjs'), checkSecretsScript(), 'utf-8')
  for (const [rel, content] of Object.entries(files)) {
    const file = join(root, rel)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, content, 'utf-8')
  }
  git(['add', '-A', '--', '.'])

  try {
    execFileSync(process.execPath, ['.husky/check-secrets.mjs'], {
      cwd: root,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { status: 0, stderr: '' }
  } catch (err) {
    const e = err as { status?: number; stderr?: string }
    return { status: e.status ?? -1, stderr: e.stderr ?? '' }
  }
}

describe('check-secrets 가드 — 플레이스홀더 판정', () => {
  it('줄에 힌트 낱말이 있어도 토큰이 진짜면 차단한다', () => {
    const line = `const key = 'bsa_${randomToken()}' // see example above\n`
    const r = runGuard({ 'src/key.ts': line })

    expect(r.status).toBe(1)
    expect(r.stderr).toContain('앱키')
  })

  it('토큰 자체가 플레이스홀더면 통과시킨다', () => {
    const r = runGuard({
      'src/a.ts': `const key = 'bsa_YOUR_APP_ID'\n`,
      'src/b.ts': `const key = 'bsa_YOURAPPKEY1234567890'\n`,
      'src/c.ts': `const key = 'bsa_AAAAAAAAAAAAAAAAAAAA'\n`,
    })

    expect(r.status).toBe(0)
  })
})
