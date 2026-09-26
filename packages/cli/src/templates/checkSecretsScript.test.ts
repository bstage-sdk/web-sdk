import { execFileSync } from 'node:child_process'
import { randomInt } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  GUARD_SCRIPT_REVISION,
  checkSecretsScript,
  readGuardRevision,
} from './checkSecretsScript.js'

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

/** 64자 16진수 — 포털 CLI 토큰 본문 모양. 소스에 리터럴로 두지 않고 실행 때 만든다. */
function randomHex64(): string {
  const alphabet = '0123456789abcdef'
  return Array.from({ length: 64 }, () => alphabet[randomInt(alphabet.length)]).join('')
}

describe('check-secrets 가드 — 검사 범위', () => {
  it('포털 CLI 토큰(bsc_) 리터럴을 차단한다', () => {
    const r = runGuard({ 'src/token.ts': `const t = 'bsc_${randomHex64()}'\n` })

    expect(r.status).toBe(1)
    expect(r.stderr).toContain('포털 CLI 토큰')
  })

  it('1MB를 넘는 파일도 끝까지 검사한다 — 읽기 한도에 걸려 조용히 통과시키지 않는다', () => {
    const filler = 'x'.repeat(1024 * 1024 + 4096)
    const r = runGuard({ 'src/big.ts': `${filler}\nconst key = 'bsa_${randomToken()}'\n` })

    expect(r.status).toBe(1)
    expect(r.stderr).toContain('앱키')
  })

  it('.env.{phase} 파일의 시크릿 이름 키에 값이 들어 있으면 차단한다', () => {
    const r = runGuard({
      '.env.sandbox': `VITE_BSTAGE_PHASE=sandbox\nVITE_CF_ACCESS_CLIENT_SECRET=${randomToken()}\n`,
    })

    expect(r.status).toBe(1)
    expect(r.stderr).toContain('시크릿 값')
    expect(r.stderr).toContain('VITE_CF_ACCESS_CLIENT_SECRET')
  })

  it('.env.{phase}의 빈 값·주석·플레이스홀더는 통과시킨다', () => {
    const r = runGuard({
      '.env.sandbox': [
        'VITE_BSTAGE_PHASE=sandbox',
        'VITE_CF_ACCESS_CLIENT_SECRET=',
        '# VITE_CF_ACCESS_CLIENT_SECRET=' + randomToken(),
        'VITE_SOME_TOKEN=YOUR_TOKEN_HERE',
        '',
      ].join('\n'),
    })

    expect(r.status).toBe(0)
  })

  it('.env.example 계열은 시크릿 이름 키의 값을 보지 않는다', () => {
    const r = runGuard({
      '.env.example': `VITE_CF_ACCESS_CLIENT_SECRET=${randomToken()}\n`,
      '.env.sandbox.example': `VITE_CF_ACCESS_CLIENT_SECRET=${randomToken()}\n`,
    })

    expect(r.status).toBe(0)
  })

  it('.example 파일이라도 진짜 키/토큰 리터럴은 차단한다 — 이름으로 검사를 건너뛰지 않는다', () => {
    const r = runGuard({
      'creds.ts.example': `export const key = 'bsa_${randomToken()}'\n`,
      '.env.example': `VITE_BSTAGE_TOKEN=bsc_${randomHex64()}\n`,
    })

    expect(r.status).toBe(1)
    expect(r.stderr).toContain('creds.ts.example')
    expect(r.stderr).toContain('.env.example')
  })
})

describe('check-secrets 가드 — 마스킹', () => {
  it('.env 값은 앞부분을 드러내지 않는다 — 커밋 로그를 볼 수 있는 사람이 값을 읽게 된다', () => {
    const value = `S3cretValueHere_${randomToken()}`
    const r = runGuard({ '.env.sandbox': `VITE_CF_ACCESS_CLIENT_SECRET=${value}\n` })

    expect(r.status).toBe(1)
    expect(r.stderr).toContain('VITE_CF_ACCESS_CLIENT_SECRET')
    expect(r.stderr).not.toContain(value.slice(0, 8))
  })
})

describe('check-secrets 가드 — 이진 파일', () => {
  it('NUL 바이트가 든 파일도 검사한다 — 이진이라고 건너뛰면 그 안의 키가 통과한다', () => {
    const nul = String.fromCharCode(0)
    const r = runGuard({ 'assets/blob.bin': `${nul}${nul}garbage${nul}bsa_${randomToken()}${nul}` })

    expect(r.status).toBe(1)
    expect(r.stderr).toContain('assets/blob.bin')
  })
})

describe('check-secrets 가드 — 개정 번호', () => {
  it('생성물 머리에 개정 번호가 있고 readGuardRevision이 그것을 읽는다', () => {
    expect(readGuardRevision(checkSecretsScript())).toBe(GUARD_SCRIPT_REVISION)
    expect(readGuardRevision('// 옛 가드\n')).toBeNull()
  })
})
