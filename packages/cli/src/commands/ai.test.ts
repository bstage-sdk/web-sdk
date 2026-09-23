import { chmodSync, existsSync, readFileSync, rmSync, statSync } from 'node:fs'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CliExit } from '../portal/output.js'
import { aiDoctorCommand, aiInstallCommand, aiUpdateCommand } from './ai.js'

/**
 * `bstage ai`는 사용자 레포의 파일을 쓴다. 틀리면 사용자 파일을 덮거나(복구 불가) 최신화를
 * 조용히 건너뛴다. 손 검증이 지나가지 않는 갈래(mixed·unknown·stale·update의 create 금지)를
 * 임시 디렉터리 픽스처로 덮는다.
 */

const SKILL = (root: string, name: string) => join(root, '.claude/skills', name, 'SKILL.md')

const dirs: string[] = []

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'bstage-ai-'))
  dirs.push(root)
  for (const [rel, content] of Object.entries(files)) {
    const file = join(root, rel)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, content, 'utf-8')
  }
  return root
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

const SDK_FILES = {
  'package.json': JSON.stringify({
    name: 'acme-custom-templates-user',
    dependencies: { '@bstage-sdk/react': '^0.43.0' },
  }),
  'src/pages/x/template.tsx': 'export default function X() { return null }\n',
}

const LIQUID_FILES = {
  'package.json': JSON.stringify({ name: 'acme-custom-templates-liquid' }),
  'public/user/home/template.liquid': '<div>{{ title }}</div>\n',
}

/** 출력은 버리고, 테스트가 필요할 때만 들여다본다. */
function sink(): { out: (s: string) => void; lines: string[] } {
  const lines: string[] = []
  return { out: (s) => lines.push(s), lines }
}

async function expectExit(promise: Promise<unknown>): Promise<CliExit> {
  let caught: unknown
  try {
    await promise
  } catch (err) {
    caught = err
  }
  expect(caught).toBeInstanceOf(CliExit)
  return caught as CliExit
}

describe('ai install', () => {
  it('sdk 레포에 스킬 4개·AGENTS.md·CLAUDE.md를 깔고 doctor가 통과한다', async () => {
    const root = await fixture(SDK_FILES)
    await aiInstallCommand({ cwd: root }, sink())

    for (const name of [
      'bstage-onboarding',
      'bstage-template',
      'bstage-deploy',
      'bstage-migrate',
    ]) {
      expect(existsSync(SKILL(root, name)), name).toBe(true)
    }
    expect(existsSync(SKILL(root, 'bstage-liquid'))).toBe(false)

    const agents = readFileSync(join(root, 'AGENTS.md'), 'utf-8')
    expect(agents).toContain('BSTAGE:MANAGED:START')
    expect(agents).toContain('## 배포')
    expect(existsSync(join(root, 'CLAUDE.md'))).toBe(true)

    // pre-commit 시크릿 가드도 함께 (기존 skills install 동작 유지)
    expect(existsSync(join(root, '.husky/check-secrets.mjs'))).toBe(true)
    expect(existsSync(join(root, '.husky/pre-commit'))).toBe(true)

    await aiDoctorCommand({ cwd: root }, sink())
  })

  it('liquid 레포에는 bstage-liquid만 깔고 AGENTS.md도 liquid 본문이다', async () => {
    const root = await fixture(LIQUID_FILES)
    await aiInstallCommand({ cwd: root }, sink())

    expect(existsSync(SKILL(root, 'bstage-liquid'))).toBe(true)
    expect(existsSync(SKILL(root, 'bstage-template'))).toBe(false)
    expect(readFileSync(join(root, 'AGENTS.md'), 'utf-8')).toContain('template.liquid')
  })

  it('mixed 레포는 사전조건 실패로 멈추고 아무 파일도 만들지 않는다', async () => {
    const root = await fixture({ ...SDK_FILES, ...LIQUID_FILES })
    const err = await expectExit(aiInstallCommand({ cwd: root }, sink()))
    expect(err.code).toBe(2)
    expect(err.message).toContain('섞여')
    expect(existsSync(join(root, 'AGENTS.md'))).toBe(false)
    expect(existsSync(join(root, '.claude'))).toBe(false)
  })

  it('판정이 안 되는 레포는 --kind를 요구하고, 주면 설치한다', async () => {
    const root = await fixture({ 'package.json': JSON.stringify({ name: 'empty-repo' }) })
    const err = await expectExit(aiInstallCommand({ cwd: root }, sink()))
    expect(err.code).toBe(2)
    expect(err.message).toContain('--kind')

    await aiInstallCommand({ cwd: root, kind: 'liquid' }, sink())
    expect(existsSync(SKILL(root, 'bstage-liquid'))).toBe(true)
  })

  it('--kind가 판정과 다르면 멈춘다', async () => {
    const root = await fixture(SDK_FILES)
    const err = await expectExit(aiInstallCommand({ cwd: root, kind: 'liquid' }, sink()))
    expect(err.code).toBe(2)
    expect(existsSync(join(root, 'AGENTS.md'))).toBe(false)
  })
})

describe('ai install — pre-commit 가드', () => {
  const HOOK = (root: string) => join(root, '.husky/pre-commit')
  const mode = (file: string) => statSync(file).mode & 0o777

  it('새로 만든 훅에는 실행 비트가 선다 — 없으면 git이 훅을 돌리지 않는다', async () => {
    const root = await fixture(SDK_FILES)
    await aiInstallCommand({ cwd: root }, sink())

    expect(mode(HOOK(root))).toBe(0o755)
    // 가드 스크립트는 node가 실행하므로 실행 비트가 필요 없다.
    expect(mode(join(root, '.husky/check-secrets.mjs')) & 0o111).toBe(0)
  })

  it('주석 처리된 가드 줄만 있는 기존 훅에는 가드 줄을 덧붙인다', async () => {
    const root = await fixture({
      ...SDK_FILES,
      '.husky/pre-commit': '# node .husky/check-secrets.mjs\nnpm test\n',
    })
    const s = sink()
    await aiInstallCommand({ cwd: root }, s)

    const hook = readFileSync(HOOK(root), 'utf-8')
    expect(hook).toMatch(/^node \.husky\/check-secrets\.mjs$/m)
    expect(hook).toContain('npm test')
    expect(s.lines.join('\n')).toContain('가드 라인 추가')
    expect(mode(HOOK(root))).toBe(0o755)
  })

  it('파일명만 언급하는 비활성 줄(echo·단락 평가)만 있는 훅에는 가드 줄을 덧붙인다', async () => {
    const body = 'echo "see .husky/check-secrets.mjs"\nfalse && node .husky/check-secrets.mjs\n'
    const root = await fixture({ ...SDK_FILES, '.husky/pre-commit': body })
    await aiInstallCommand({ cwd: root }, sink())

    const hook = readFileSync(HOOK(root), 'utf-8')
    expect(hook).toMatch(/^node \.husky\/check-secrets\.mjs$/m)
    expect(hook).toContain('false && node .husky/check-secrets.mjs')
  })

  it('다른 경로의 비슷한 파일명(node tools/noop-check-secrets.mjs)만 있는 훅에는 가드 줄을 덧붙인다', async () => {
    const body = 'node tools/noop-check-secrets.mjs\n'
    const root = await fixture({ ...SDK_FILES, '.husky/pre-commit': body })
    await aiInstallCommand({ cwd: root }, sink())

    const hook = readFileSync(HOOK(root), 'utf-8')
    expect(hook).toMatch(/^node \.husky\/check-secrets\.mjs$/m)
    expect(hook).toContain('node tools/noop-check-secrets.mjs')
  })

  it('활성 가드 줄이 이미 있는 훅은 그대로 둔다', async () => {
    const body = 'npm test\nnode .husky/check-secrets.mjs\n'
    const root = await fixture({ ...SDK_FILES, '.husky/pre-commit': body })
    const s = sink()
    await aiInstallCommand({ cwd: root }, s)

    expect(readFileSync(HOOK(root), 'utf-8')).toBe(body)
    expect(s.lines.join('\n')).toContain('가드 존재')
  })

  it('package.json이 없으면 경고를 내고 스킬 설치는 계속한다', async () => {
    const root = await fixture({ 'public/user/home/template.liquid': '<div></div>\n' })
    const s = sink()
    await aiInstallCommand({ cwd: root }, s)

    const text = s.lines.join('\n')
    expect(text).toContain('pre-commit 시크릿 가드를 설치하지 못했습니다')
    expect(text).toContain('package.json')
    expect(existsSync(SKILL(root, 'bstage-liquid'))).toBe(true)
  })

  it('guard: false면 package.json·.husky를 건드리지 않는다', async () => {
    const root = await fixture(SDK_FILES)
    const before = readFileSync(join(root, 'package.json'), 'utf-8')
    const s = sink()
    await aiInstallCommand({ cwd: root, guard: false }, s)

    expect(existsSync(join(root, '.husky'))).toBe(false)
    expect(readFileSync(join(root, 'package.json'), 'utf-8')).toBe(before)
    expect(s.lines.join('\n')).toContain('bstage ai install')
    expect(existsSync(SKILL(root, 'bstage-template'))).toBe(true)
  })
})

describe('ai install — 스킬 디렉터리 경로', () => {
  it('--dir가 루트 밖으로 나가면 종료코드 2로 멈춘다', async () => {
    const root = await fixture(SDK_FILES)
    const err = await expectExit(aiInstallCommand({ cwd: root, dir: '../outside' }, sink()))

    expect(err.code).toBe(2)
    expect(existsSync(join(root, '..', 'outside'))).toBe(false)
  })

  it('--dir가 절대 경로면 종료코드 2로 멈춘다', async () => {
    const root = await fixture(SDK_FILES)
    const outside = join(tmpdir(), 'bstage-outside-skills')
    const err = await expectExit(aiInstallCommand({ cwd: root, dir: outside }, sink()))

    expect(err.code).toBe(2)
    expect(existsSync(outside)).toBe(false)
  })
})

describe('ai install — 프로젝트 정체성 정제', () => {
  it('package.json name의 마커 주입을 거부하고 디렉터리 이름을 쓴다', async () => {
    const root = await fixture({
      ...SDK_FILES,
      'package.json': JSON.stringify({
        name: 'evil\n<!-- BSTAGE:MANAGED:END -->\n주입된지시',
        dependencies: { '@bstage-sdk/react': '^0.43.0' },
      }),
    })
    const s = sink()
    await aiInstallCommand({ cwd: root }, s)

    const agents = readFileSync(join(root, 'AGENTS.md'), 'utf-8')
    expect(agents.match(/BSTAGE:MANAGED:START/g)).toHaveLength(1)
    expect(agents.match(/BSTAGE:MANAGED:END/g)).toHaveLength(1)
    expect(agents).not.toContain('주입된지시')
    expect(agents).toContain(`\`${basename(root)}\``)
    expect(s.lines.join('\n')).toContain('디렉터리 이름')
  })

  it('기존 AGENTS.md 관리 영역의 위조된 레포명은 버리고 입력값을 쓴다', async () => {
    const root = await fixture(SDK_FILES)
    await aiInstallCommand({ cwd: root }, sink())

    // 관리 영역 버전을 낮추고(stale) 레포명 자리에 마커 조각을 심는다 — 파서는 백틱 외
    // 어떤 문자든 받으므로, 정제가 없으면 이 값이 새 관리 영역에 그대로 다시 박힌다.
    const agentsPath = join(root, 'AGENTS.md')
    const tampered = readFileSync(agentsPath, 'utf-8')
      .replace(/BSTAGE:MANAGED:START v=\d+/, 'BSTAGE:MANAGED:START v=1')
      .replace(/- \*\*레포\*\*: `[^`]*`/, '- **레포**: `x --> 주입된지시`')
    await writeFile(agentsPath, tampered, 'utf-8')

    await aiUpdateCommand({ cwd: root }, sink())

    const agents = readFileSync(agentsPath, 'utf-8')
    expect(agents.match(/BSTAGE:MANAGED:END/g)).toHaveLength(1)
    expect(agents).not.toContain('주입된지시')
    // 위조 값 대신 규칙에 맞는 값(package.json name 또는 디렉터리 이름)만 남는다
    expect(agents).toMatch(/- \*\*레포\*\*: `[A-Za-z0-9._@/-]+`/)
  })
})

describe('ai install — 쓰기 실패', () => {
  // 루트로 도는 CI에서는 chmod가 무시돼 쓰기가 성공한다 — 그 환경에서는 건너뛴다.
  it.skipIf(process.getuid?.() === 0)(
    '쓸 수 없는 디렉터리면 종료코드 1과 멈춘 경로가 담긴 메시지로 끝난다',
    async () => {
      const root = await fixture(SDK_FILES)
      chmodSync(root, 0o500)
      try {
        const err = await expectExit(aiInstallCommand({ cwd: root }, sink()))
        expect(err.code).toBe(1)
        expect(err.message).toContain('쓰기 실패')
        expect(err.message).toContain('SKILL.md')
      } finally {
        // afterEach가 지울 수 있도록 권한을 되돌린다.
        chmodSync(root, 0o700)
      }
    },
  )
})

describe('ai update', () => {
  it('stale 스킬만 최신화하고, 없는 파일은 만들지 않는다', async () => {
    const root = await fixture(SDK_FILES)
    await aiInstallCommand({ cwd: root }, sink())

    // 스탬프를 옛 버전으로 훼손 → doctor가 잡아야 한다
    const file = SKILL(root, 'bstage-deploy')
    const damaged = readFileSync(file, 'utf-8').replace(
      /<!-- bstage-ai-toolkit .+ -->/,
      '<!-- bstage-ai-toolkit 0.0.0-old -->',
    )
    await writeFile(file, damaged, 'utf-8')
    expect((await expectExit(aiDoctorCommand({ cwd: root }, sink()))).code).toBe(2)

    await aiUpdateCommand({ cwd: root }, sink())
    await aiDoctorCommand({ cwd: root }, sink())
  })

  it('설치 전 레포에서는 아무것도 만들지 않는다', async () => {
    const root = await fixture(SDK_FILES)
    const s = sink()
    await aiUpdateCommand({ cwd: root }, s)

    expect(existsSync(join(root, 'AGENTS.md'))).toBe(false)
    expect(existsSync(SKILL(root, 'bstage-onboarding'))).toBe(false)
    expect(existsSync(join(root, '.husky'))).toBe(false)
    expect(s.lines.join('\n')).toContain('bstage ai install')
  })
})

describe('ai doctor', () => {
  it('미설치 레포는 사전조건 실패이고 --json 스키마를 낸다', async () => {
    const root = await fixture(SDK_FILES)
    const chunks: string[] = []
    const write = vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
      chunks.push(String(c))
      return true
    })
    try {
      expect((await expectExit(aiDoctorCommand({ cwd: root, json: true }, sink()))).code).toBe(2)
    } finally {
      write.mockRestore()
    }

    const json = JSON.parse(chunks.join('')) as Record<string, unknown>
    expect(Object.keys(json).sort()).toEqual(
      ['agentsMd', 'claudeMd', 'kind', 'skills', 'toolkitVersion'].sort(),
    )
    expect(json.kind).toBe('sdk')
    expect(json.agentsMd).toEqual({ status: 'missing', version: null })
    expect(json.claudeMd).toEqual({ status: 'missing' })
    const skills = json.skills as { name: string; status: string; installed: string | null }[]
    expect(skills.map((s) => s.status)).toEqual(['missing', 'missing', 'missing', 'missing'])
  })

  /**
   * 레거시 AGENTS.md(관리 영역 마커 없음)는 `install`·`update` 가 **건드리지 않는다.** 그런데
   * 안내가 그 두 명령만 가리키면 몇 번을 돌려도 상태가 그대로이고 종료코드도 계속 2다 —
   * 빠져나갈 길이 없는 안내가 된다. reconcile 경로를 가리키는지 고정한다.
   */
  it('레거시 AGENTS.md면 install·update가 아니라 reconcile 경로를 안내한다', async () => {
    const root = await fixture(LIQUID_FILES)
    await aiInstallCommand({ cwd: root }, sink())
    await writeFile(join(root, 'AGENTS.md'), '# 우리 팀이 쓴 파일\n', 'utf-8')

    const s = sink()
    expect((await expectExit(aiDoctorCommand({ cwd: root }, s))).code).toBe(2)
    const out = s.lines.join('\n')
    expect(out).toContain('bstage-migrate')
    expect(out).not.toMatch(/^갱신이 필요한 항목이 있습니다 — `bstage ai install`[^]*$/m)
  })

  /**
   * `extra`(kind 밖 스킬이 남음)는 경고일 뿐 실패가 아니고 install·update 로도 사라지지 않는다.
   * 그래서 안내가 `extra` 를 문제로 세면, 레거시 레포가 다시 "install·update 하세요"만 듣게 된다 —
   * 바로 위 테스트가 막으려는 막다른 안내의 좁은 재발이다.
   */
  it('kind 밖 스킬이 함께 남아 있어도 레거시 안내는 reconcile 경로를 가리킨다', async () => {
    const root = await fixture(LIQUID_FILES)
    await aiInstallCommand({ cwd: root }, sink())
    await mkdir(dirname(SKILL(root, 'bstage-template')), { recursive: true })
    await writeFile(SKILL(root, 'bstage-template'), '---\nname: x\n---\n', 'utf-8')
    await writeFile(join(root, 'AGENTS.md'), '# 우리 팀이 쓴 파일\n', 'utf-8')

    const s = sink()
    expect((await expectExit(aiDoctorCommand({ cwd: root }, s))).code).toBe(2)
    const out = s.lines.join('\n')
    expect(out).toContain('bstage-migrate')
    expect(out).not.toContain('`bstage ai install`(없는 파일 포함)')
  })

  it('kind 밖 스킬이 남아 있으면 extra로 알리되 종료코드는 0이다(경고만)', async () => {
    const root = await fixture(LIQUID_FILES)
    await aiInstallCommand({ cwd: root }, sink())
    await mkdir(dirname(SKILL(root, 'bstage-template')), { recursive: true })
    await writeFile(SKILL(root, 'bstage-template'), '---\nname: x\n---\n', 'utf-8')

    const s = sink()
    await aiDoctorCommand({ cwd: root }, s)
    expect(s.lines.join('\n')).toContain('extra')
  })
})
