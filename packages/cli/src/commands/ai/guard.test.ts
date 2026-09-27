import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { checkSecretsScript, GUARD_SCRIPT_REVISION } from '../../templates/checkSecretsScript.js'
import { installGuardHook } from './guard.js'

/**
 * 가드 설치는 사용자 레포의 `.husky/`를 고친다. 옛 CLI가 새 가드를 덮어 낮추거나, 기존 훅의
 * `exit 0` 뒤에 가드 줄을 붙여 실행되지 않게 만드는 경로는 손 검증으로 드러나지 않는다.
 */

const dirs: string[] = []

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

function project(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'bstage-guard-install-'))
  dirs.push(root)
  writeFileSync(join(root, 'package.json'), '{"name":"t","private":true}\n', 'utf-8')
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(root, rel, '..'), { recursive: true })
    writeFileSync(join(root, rel), content, 'utf-8')
  }
  return root
}

const quiet = () => {}

describe('installGuardHook — 기존 pre-commit 훅에 가드 줄 넣기', () => {
  /** 기존 훅에 끼워 넣는 줄 — 뒤에 `exit 0`이 와도 가드의 실패가 커밋을 막게 상태를 전파한다. */
  const GUARD_LINE = 'node .husky/check-secrets.mjs || exit 1'

  it('shebang 바로 다음에 상태 전파 형태로 넣는다 — 뒤쪽 exit를 찾는 휴리스틱에 기대지 않는다', () => {
    const root = project({ '.husky/pre-commit': '#!/bin/sh\nnpm test\nexit 0 # done\n' })

    installGuardHook(root, quiet)

    const hook = readFileSync(join(root, '.husky/pre-commit'), 'utf-8')
    expect(hook.split('\n')).toEqual(['#!/bin/sh', GUARD_LINE, 'npm test', 'exit 0 # done', ''])
  })

  it('exit 뒤에 놓인 기존 가드 줄은 활성으로 보지 않고 맨 위로 옮긴다', () => {
    const root = project({
      '.husky/pre-commit': 'npm test\nexit 0\nnode .husky/check-secrets.mjs\n',
    })
    const lines: string[] = []

    installGuardHook(root, (s) => lines.push(s))

    const hook = readFileSync(join(root, '.husky/pre-commit'), 'utf-8')
    expect(hook.split('\n')).toEqual([GUARD_LINE, 'npm test', 'exit 0', ''])
    expect(lines.join('\n')).toContain('재배치')
  })

  it('exit 앞에 있어도 상태를 전파하지 않는 기존 가드 줄은 고쳐 쓴다', () => {
    const root = project({
      '.husky/pre-commit': 'node .husky/check-secrets.mjs\nnpm test\nexit 0\n',
    })

    installGuardHook(root, quiet)

    const hook = readFileSync(join(root, '.husky/pre-commit'), 'utf-8')
    expect(hook.split('\n')).toEqual([GUARD_LINE, 'npm test', 'exit 0', ''])
  })

  it('가드 줄 뒤에 다른 명령이 오는데 상태를 전파하지 않으면 고쳐 쓴다 — 훅의 상태는 마지막 명령 것이다', () => {
    const root = project({
      '.husky/pre-commit': '#!/bin/sh\nnode .husky/check-secrets.mjs\nnpm test\n',
    })

    installGuardHook(root, quiet)

    const hook = readFileSync(join(root, '.husky/pre-commit'), 'utf-8')
    expect(hook.split('\n')).toEqual(['#!/bin/sh', GUARD_LINE, 'npm test', ''])
  })

  it('전파 형태가 달라도(||exit 2) 정본이 아니면 다시 넣는다 — 관용은 곧 구멍이다', () => {
    const root = project({
      '.husky/pre-commit': 'node .husky/check-secrets.mjs ||exit 2\nnpm test\n',
    })

    installGuardHook(root, quiet)

    const hook = readFileSync(join(root, '.husky/pre-commit'), 'utf-8')
    expect(hook.split('\n')).toEqual([GUARD_LINE, 'npm test', ''])
  })

  it('주석 속 "|| exit 1"은 전파로 치지 않는다 — 고쳐 쓴다', () => {
    const root = project({
      '.husky/pre-commit': '#!/bin/sh\nnode .husky/check-secrets.mjs   # was: || exit 1\nexit 0\n',
    })

    installGuardHook(root, quiet)

    const hook = readFileSync(join(root, '.husky/pre-commit'), 'utf-8')
    expect(hook.split('\n')).toEqual(['#!/bin/sh', GUARD_LINE, 'exit 0', ''])
  })

  it('set -e에 기대지 않는다 — 범위를 판정할 수 없으므로 가드 줄을 전파 형태로 다시 넣는다', () => {
    const root = project({
      '.husky/pre-commit': '#!/bin/sh\nset -eu\nnode .husky/check-secrets.mjs\nnpm test\n',
    })

    installGuardHook(root, quiet)

    const hook = readFileSync(join(root, '.husky/pre-commit'), 'utf-8')
    expect(hook.split('\n')).toEqual(['#!/bin/sh', GUARD_LINE, 'set -eu', 'npm test', ''])
  })

  it('가드 줄이 함수 본문 안에 있으면 인정하지 않는다 — 불려야 실행된다', () => {
    const root = project({
      '.husky/pre-commit': `#!/bin/sh\nskip() {\n  ${GUARD_LINE}\n}\nnpm test\n`,
    })

    installGuardHook(root, quiet)

    const hook = readFileSync(join(root, '.husky/pre-commit'), 'utf-8')
    expect(hook.split('\n')).toEqual(['#!/bin/sh', GUARD_LINE, 'skip() {', '}', 'npm test', ''])
  })

  it('가드 줄이 제자리(shebang 다음)에 정확한 형태로 있으면 그대로 둔다 — 멱등', () => {
    const body = `#!/bin/sh\n${GUARD_LINE}\nnpm test\n`
    const root = project({ '.husky/pre-commit': body })
    chmodSync(join(root, '.husky/pre-commit'), 0o600)
    const lines: string[] = []

    installGuardHook(root, (s) => lines.push(s))

    expect(readFileSync(join(root, '.husky/pre-commit'), 'utf-8')).toBe(body)
    expect(statSync(join(root, '.husky/pre-commit')).mode & 0o777).toBe(0o755)
    expect(lines.join('\n')).toContain('가드 존재')
  })

  it('새로 만든 훅은 곧바로 제자리·정확한 형태다 — 두 번 돌려도 바뀌지 않는다', () => {
    const root = project()

    installGuardHook(root, quiet)
    const first = readFileSync(join(root, '.husky/pre-commit'), 'utf-8')
    installGuardHook(root, quiet)

    expect(readFileSync(join(root, '.husky/pre-commit'), 'utf-8')).toBe(first)
    expect(first).toContain(GUARD_LINE)
  })

  it('본문 중간의 #! 줄은 shebang이 아니다 — 설치를 중단하지 않는다', () => {
    const root = project({ '.husky/pre-commit': 'npm test\necho "#!/usr/bin/env node"\n' })

    const r = installGuardHook(root, quiet)

    expect(r.installed).toBe(true)
    expect(readFileSync(join(root, '.husky/pre-commit'), 'utf-8')).toContain(GUARD_LINE)
  })

  it('끼워 넣은 훅을 실제로 돌리면 가드가 실패할 때 exit 0에 덮이지 않고 1로 끝난다', () => {
    const root = project({ '.husky/pre-commit': '#!/bin/sh\ntrue\nexit 0 # done\n' })
    installGuardHook(root, quiet)
    // 가드를 "항상 실패"로 바꿔 상태 전파만 본다.
    writeFileSync(join(root, '.husky/check-secrets.mjs'), 'process.exit(1)\n', 'utf-8')

    let status = 0
    try {
      execFileSync('sh', ['.husky/pre-commit'], { cwd: root, stdio: 'ignore' })
    } catch (err) {
      status = (err as { status?: number }).status ?? -1
    }

    expect(status).toBe(1)
  })

  it('shebang이 없으면 맨 위에 넣는다', () => {
    const root = project({ '.husky/pre-commit': 'npm test\n' })

    installGuardHook(root, quiet)

    const hook = readFileSync(join(root, '.husky/pre-commit'), 'utf-8')
    expect(hook.split('\n')).toEqual([GUARD_LINE, 'npm test', ''])
  })

  it('셸이 아닌 훅(shebang이 node 등)은 건드리지 않고 안내한다', () => {
    const body = '#!/usr/bin/env node\nconsole.log(1)\n'
    const root = project({ '.husky/pre-commit': body })
    const lines: string[] = []

    const r = installGuardHook(root, (s) => lines.push(s))

    expect(readFileSync(join(root, '.husky/pre-commit'), 'utf-8')).toBe(body)
    expect(r.installed).toBe(false)
    expect(lines.join('\n')).toContain('셸')
  })
})

describe('installGuardHook — 심볼릭 링크', () => {
  it('.husky 가 루트 밖 디렉터리로의 링크면 쓰지 않고 멈춘다', () => {
    const root = project()
    const outside = mkdtempSync(join(tmpdir(), 'bstage-guard-outside-'))
    dirs.push(outside)
    symlinkSync(outside, join(root, '.husky'))

    expect(() => installGuardHook(root, quiet)).toThrow(/심볼릭 링크|루트/)
    expect(existsSync(join(outside, 'check-secrets.mjs'))).toBe(false)
    expect(existsSync(join(outside, 'pre-commit'))).toBe(false)
  })

  it('pre-commit 이 링크면 따라 쓰지 않는다', () => {
    const root = project({ 'elsewhere.sh': 'echo hi\n' })
    mkdirSync(join(root, '.husky'))
    symlinkSync(join(root, 'elsewhere.sh'), join(root, '.husky/pre-commit'))

    expect(() => installGuardHook(root, quiet)).toThrow(/심볼릭 링크/)
    expect(readFileSync(join(root, 'elsewhere.sh'), 'utf-8')).toBe('echo hi\n')
  })
})

describe('installGuardHook — 가드 스크립트 개정', () => {
  it('설치된 가드가 높은 개정을 자칭해도 덮어쓴다 — 파일 안의 번호로 가드를 끌 수 없다', () => {
    const forged = `// bstage 시크릿 가드 rev ${GUARD_SCRIPT_REVISION + 999} — 자칭\nprocess.exit(0)\n`
    const root = project({ '.husky/check-secrets.mjs': forged })
    const lines: string[] = []

    const r = installGuardHook(root, (s) => lines.push(s))

    expect(r.installed).toBe(true)
    expect(readFileSync(join(root, '.husky/check-secrets.mjs'), 'utf-8')).toBe(checkSecretsScript())
    expect(lines.join('\n')).toContain('되돌렸습니다')
  })

  it('개정 표기가 없는 옛 가드는 최신으로 덮는다', () => {
    const root = project({ '.husky/check-secrets.mjs': '// 옛 가드\nprocess.exit(0)\n' })

    installGuardHook(root, quiet)

    expect(readFileSync(join(root, '.husky/check-secrets.mjs'), 'utf-8')).toBe(checkSecretsScript())
  })
})
