import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BuildRuleError,
  buildCommand,
  resolveOutputName,
  type BuildOptions,
  type DiscoveredEntry,
} from './build.js'

/**
 * 산출물 위치를 정하는 규칙. 릴리즈 전 손 검증은 정상 페이지 하나·정상 위젯 하나를 빌드해보는
 * 데서 끝나므로, 규칙을 어겼을 때의 분기는 전부 비어 있다. 그런데 이 분기들이 조용히 통과하면
 * **엉뚱한 경로로 배포된다** — `bstage build`는 tsc를 타지 않아 타입도 막아주지 않는다.
 */

function page(...segments: string[]): DiscoveredEntry {
  return { kind: 'page', entry: `src/pages/${segments.join('/')}/template.tsx`, segments }
}

function slot(...segments: string[]): DiscoveredEntry {
  return { kind: 'slot', entry: `src/slots/${segments.join('/')}/template.tsx`, segments }
}

describe('페이지', () => {
  it('폴더 구조가 그대로 배포 경로가 된다', () => {
    expect(resolveOutputName(page('landing'), undefined)).toBe('landing')
  })

  it('중첩 폴더는 중첩 그대로 유지한다', () => {
    expect(resolveOutputName(page('settings', 'custom'), undefined)).toBe('settings/custom')
  })

  it('세그먼트가 없으면 dist 바로 아래(루트 페이지)', () => {
    expect(resolveOutputName(page(), undefined)).toBe('')
  })

  it('slot 옵션을 쓰면 막는다 — 위젯을 pages에 둔 경우다', () => {
    expect(() => resolveOutputName(page('banner'), 'user.contents-home.curation:after')).toThrow(
      BuildRuleError,
    )
  })

  it('동적 경로는 아직 지원하지 않는다고 알린다', () => {
    expect(() => resolveOutputName(page('artist', '[id]'), undefined)).toThrow(/동적 경로/)
  })
})

describe('위젯', () => {
  it('슬롯 id를 디렉토리 이름으로 바꿔 내보낸다', () => {
    expect(resolveOutputName(slot('curation-banner'), 'user.contents-home.curation:after')).toBe(
      'user.contents-home.curation--after',
    )
  })

  it('폴더 이름은 산출물 위치에 영향을 주지 않는다', () => {
    const a = resolveOutputName(slot('아무거나'), 'user.my-home.menu:before')
    const b = resolveOutputName(slot('deeply', 'nested', 'name'), 'user.my-home.menu:before')
    expect(a).toBe(b)
  })

  it('slot 옵션이 없으면 막는다 — 위치만으로는 어느 자리인지 알 수 없다', () => {
    expect(() => resolveOutputName(slot('curation-banner'), undefined)).toThrow(BuildRuleError)
  })

  it('카탈로그에 없는 슬롯 id는 막는다', () => {
    expect(() => resolveOutputName(slot('w'), 'user.contents-home.curation:aftre')).toThrow(
      /카탈로그에 없는/,
    )
  })

  it('오타 메시지에 같은 페이지의 자리를 후보로 보여준다', () => {
    let message = ''
    try {
      resolveOutputName(slot('w'), 'user.contents-home.curation:aftre')
    } catch (e) {
      message = (e as Error).message
    }
    expect(message).toContain('user.contents-home.curation:after')
  })

  it('정규화된 이름을 slot에 그대로 적으면 막는다 — 콜론이 원본 형식이다', () => {
    expect(() => resolveOutputName(slot('w'), 'user.contents-home.curation--after')).toThrow(
      /카탈로그에 없는/,
    )
  })
})

/**
 * liquid 레포에는 빌드 단계가 없다 — 포털이 `public/`을 그대로 패키징한다. 그런데 `bstage build`가
 * sdk 경로로 들어가면 "엔트리를 못 찾았다"며 종료코드 1로 죽는다(정상 레포인데 실패로 보인다).
 * 손 검증은 sdk 레포에서만 이뤄지므로 이 분기는 테스트로만 덮인다.
 */
describe('liquid 레포', () => {
  const roots: string[] = []

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  function fixture(files: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), 'build-liquid-'))
    roots.push(root)
    for (const [path, content] of Object.entries(files)) {
      const full = join(root, path)
      mkdirSync(dirname(full), { recursive: true })
      writeFileSync(full, content, 'utf-8')
    }
    return root
  }

  /** process.exit를 던지도록 바꿔 종료코드를 잡는다. 잡히지 않으면 정상 종료(0)다. */
  function catchExit() {
    const codes: number[] = []
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      codes.push(code ?? 0)
      throw new Error(`exit:${code}`)
    }) as never)
    return codes
  }

  async function run(root: string, options: BuildOptions = {}): Promise<number> {
    const codes = catchExit()
    try {
      await buildCommand(options, { cwd: root })
    } catch (err) {
      if (!/^exit:/.test((err as Error).message)) throw err
    }
    return codes[0] ?? 0
  }

  it('정상 템플릿이면 종료코드 0이고 산출물이 없다고 안내한다', async () => {
    const root = fixture({
      'public/user/home/template.liquid': '<h1>{{ title }}</h1>\n',
      'public/user/home/data.json': '{"title":"x"}\n',
    })
    const lines: string[] = []
    vi.spyOn(console, 'log').mockImplementation((...a) => void lines.push(a.join(' ')))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(await run(root)).toBe(0)
    expect(lines.join('\n')).toContain('빌드 산출물 없음')
    expect(lines.join('\n')).toContain('public/{user|admin}/{name}/')
  })

  it('파스 오류면 종료코드 2이고 줄 번호를 보여준다', async () => {
    const root = fixture({ 'public/user/home/template.liquid': 'a\nb\n{% if x %}\n' })
    const errs: string[] = []
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation((...a) => void errs.push(a.join(' ')))

    expect(await run(root)).toBe(2)
    expect(errs.join('\n')).toContain('3')
  })

  it('sdk와 섞여 있으면 종료코드 2로 미리 막는다 — 포털 빌드도 실패한다', async () => {
    const root = fixture({
      'public/user/home/template.liquid': '<h1>x</h1>\n',
      'src/pages/home/template.tsx': 'export default null\n',
    })
    const errs: string[] = []
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation((...a) => void errs.push(a.join(' ')))

    expect(await run(root)).toBe(2)
    expect(errs.join('\n')).toContain('섞여')
  })

  /**
   * liquid 파일이 **전부** 규약 밖이면 판정에 잡히는 liquid 템플릿이 0건이라 kind가 sdk로 떨어진다.
   * 그때 sdk 기준 문구("template.tsx를 찾지 못했습니다")를 내면, React를 만든 적도 없는 사람에게
   * 엉뚱한 파일 이야기를 하게 된다 — 문서가 가장 흔한 실수로 적어 둔 상황이라 여기서 고정한다.
   */
  it('liquid 파일이 전부 규약 밖이면 그 사실을 짚는다 — template.tsx 이야기를 하지 않는다', async () => {
    const root = fixture({ 'public/user/pages/deep/template.liquid': '<h1>x</h1>\n' })
    const errs: string[] = []
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation((...a) => void errs.push(a.join(' ')))

    expect(await run(root)).toBe(1)
    const out = errs.join('\n')
    expect(out).toContain('public/user/pages/deep/template.liquid')
    expect(out).toContain('public/{user|admin}/{이름}/template.liquid')
    expect(out).not.toContain('template.tsx')
  })

  it('--json은 stdout에 { kind, issues } 객체 하나만 쓴다', async () => {
    const root = fixture({ 'public/user/home/template.liquid': '<h1>x</h1>\n' })
    const writes: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string) => {
      writes.push(String(chunk))
      return true
    }) as never)
    vi.spyOn(console, 'log').mockImplementation(() => {})

    expect(await run(root, { json: true })).toBe(0)
    expect(writes).toHaveLength(1)
    expect(JSON.parse(writes[0])).toEqual({ kind: 'liquid', issues: [] })
  })

  it('--json은 오류가 있어도 process.exit 없이 종료코드만 예약한다 — 파이프 출력이 잘리지 않게', async () => {
    const root = fixture({ 'public/user/home/template.liquid': 'a\nb\n{% if x %}\n' })
    const writes: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string) => {
      writes.push(String(chunk))
      return true
    }) as never)
    vi.spyOn(console, 'log').mockImplementation(() => {})

    const before = process.exitCode
    let reserved: typeof process.exitCode
    try {
      expect(await run(root, { json: true })).toBe(0) // process.exit을 부르지 않는다
      reserved = process.exitCode
    } finally {
      process.exitCode = before
    }

    expect(reserved).toBe(2)
    expect(writes).toHaveLength(1)
    expect(JSON.parse(writes[0]).issues.some((i: { level: string }) => i.level === 'error')).toBe(
      true,
    )
  })
})
