import { beforeEach, describe, expect, it, vi } from 'vitest'

// 명령 본체는 모두 대역으로 — 여기서는 commander 해석(전역 -v, --version 과의 충돌)만 본다.
// (빌드 전 워크스페이스 패키지를 끌어오는 명령 모듈을 읽지 않게 하는 이유도 있다.)
vi.mock('./commands/pull.js', () => ({ pullCommand: vi.fn(async () => {}) }))
vi.mock('./commands/ai.js', () => ({
  aiDoctorCommand: vi.fn(),
  aiInstallCommand: vi.fn(),
  aiUpdateCommand: vi.fn(),
}))
vi.mock('./commands/build.js', () => ({ buildCommand: vi.fn() }))
vi.mock('./commands/deploy.js', () => ({ deployCommand: vi.fn() }))
vi.mock('./commands/dev.js', () => ({ devCommand: vi.fn() }))
vi.mock('./commands/init.js', () => ({ initCommand: vi.fn() }))
vi.mock('./commands/i18n.js', () => ({ i18nPullCommand: vi.fn() }))
vi.mock('./commands/doctor.js', () => ({ doctorCommand: vi.fn() }))
vi.mock('./commands/link.js', () => ({ linkCommand: vi.fn() }))
vi.mock('./commands/list.js', () => ({ listCommand: vi.fn() }))
vi.mock('./commands/logs.js', () => ({ logsCommand: vi.fn() }))
vi.mock('./commands/placement.js', () => ({ placementCreateCommand: vi.fn() }))
vi.mock('./commands/login.js', () => ({ loginCommand: vi.fn() }))
vi.mock('./commands/logout.js', () => ({ logoutCommand: vi.fn() }))
vi.mock('./commands/push.js', () => ({ pushCommand: vi.fn() }))
vi.mock('./commands/publish.js', () => ({ publishCommand: vi.fn() }))
vi.mock('./commands/rollback.js', () => ({ rollbackCommand: vi.fn() }))
vi.mock('./commands/skills.js', () => ({ skillsInstallCommand: vi.fn() }))
vi.mock('./commands/docs.js', () => ({ docsCommand: vi.fn() }))
vi.mock('./commands/whoami.js', () => ({ whoamiCommand: vi.fn() }))

const { createProgram } = await import('./program.js')
const { pullCommand } = await import('./commands/pull.js')

describe('bstage 명령 해석', () => {
  beforeEach(() => vi.mocked(pullCommand).mockClear())

  it('pull --at v3 은 CLI 버전을 찍고 끝나지 않고 pull 에 at 으로 넘어간다', async () => {
    const p = createProgram().exitOverride()
    await p.parseAsync(['node', 'bstage', 'pull', '--at', 'v3', '--yes'])
    expect(pullCommand).toHaveBeenCalledTimes(1)
    expect(vi.mocked(pullCommand).mock.calls[0][0]).toMatchObject({ at: 'v3', yes: true })
  })

  it('pull 에는 --version 옵션이 없다(전역 버전 출력과 부딪치지 않게)', () => {
    const pull = createProgram().commands.find((c) => c.name() === 'pull')!
    expect(pull.options.map((o) => o.long)).not.toContain('--version')
    expect(pull.options.map((o) => o.long)).toContain('--at')
  })
})
