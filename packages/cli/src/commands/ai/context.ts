import { existsSync, readFileSync } from 'node:fs'
import { basename, isAbsolute, join } from 'node:path'
import pc from 'picocolors'
import {
  BSTAGE_SKILLS,
  parseAgentsIdentity,
  planInstall,
  sanitizeIdentity,
  skillFilePath,
} from '@bstage-sdk/ai-toolkit'
import type {
  DesignTarget,
  InstallAction,
  InstallInput,
  ProjectKind,
} from '@bstage-sdk/ai-toolkit'
import { resolveProjectTarget } from '../../constants.js'
import { detectProjectKind } from '../../project/detectKind.js'
import { ExitCode, fail } from '../../portal/output.js'

export interface AiOptions {
  /** 스킬 디렉터리(기본 '.claude/skills'). 프로젝트 루트 아래 상대 경로만 받는다 */
  dir?: string
  /** 프로젝트 종류를 직접 지정(sdk|liquid) — 자동 판정이 안 될 때 */
  kind?: string
  json?: boolean
  /** 프로젝트 루트. 생략 시 process.cwd() (테스트에서 임시 디렉터리를 주입한다) */
  cwd?: string
  /** pre-commit 시크릿 가드 설치 여부(기본 true). 진단 경로는 false로 부른다 */
  guard?: boolean
}

/** 출력 주입 — 테스트가 콘솔을 더럽히지 않고 결과 문구를 검사할 수 있게 한다. */
export interface AiDeps {
  out?: (s: string) => void
}

export interface AiContext {
  root: string
  kind: ProjectKind
  target: DesignTarget
  skillsDir: string
  input: InstallInput
  actions: InstallAction[]
}

const DEFAULT_SKILLS_DIR = '.claude/skills'

function readIfExists(file: string): string | null {
  if (!existsSync(file)) return null
  try {
    return readFileSync(file, 'utf-8')
  } catch {
    return null
  }
}

function readPkgName(root: string): string | null {
  const raw = readIfExists(join(root, 'package.json'))
  if (raw === null) return null
  try {
    return (JSON.parse(raw) as { name?: string }).name ?? null
  } catch {
    return null
  }
}

/** 마지막 수단. 디렉터리 이름은 사용자 입력이 아니지만 규칙 밖 문자가 있을 수 있어 치환한다. */
function fallbackIdentity(root: string): string {
  const replaced = basename(root)
    .replace(/[^A-Za-z0-9._@/-]/g, '-')
    .slice(0, 100)
  return replaced === '' ? 'bstage-project' : replaced
}

/**
 * 스킬 디렉터리는 **프로젝트 안**이어야 한다. 절대 경로·`..`는 여기서 거부한다 —
 * 쓰기 직전(`applyActions`)에도 한 번 더 막지만, 계획 단계에서 끊어야 경로가 출력에 섞이지 않는다.
 */
function resolveSkillsDir(value: string | undefined): string {
  const dir = value || DEFAULT_SKILLS_DIR
  const segments = dir.split(/[\\/]/)
  if (isAbsolute(dir) || segments.includes('..')) {
    fail(ExitCode.PRECONDITION, `스킬 디렉터리는 프로젝트 안의 상대 경로여야 합니다: ${dir}`)
  }
  return dir
}

function parseKindOption(value: string | undefined): ProjectKind | undefined {
  if (value === undefined) return undefined
  if (value === 'sdk' || value === 'liquid') return value
  fail(ExitCode.PRECONDITION, `--kind 값이 올바르지 않습니다: ${value} (sdk 또는 liquid)`)
}

/**
 * 레포 종류를 정한다. 포털 빌더와 같은 규칙(detectProjectKind)이 1차이고, `--kind`는
 * 판정이 안 될 때의 보조 수단이다 — 판정과 어긋나면 덮어쓰지 않고 멈춘다(엉뚱한 kind로
 * AGENTS.md를 갈아엎으면 되돌릴 수 없다).
 */
function resolveKind(root: string, requested: string | undefined): ProjectKind {
  const wanted = parseKindOption(requested)
  const detected = detectProjectKind(root).kind

  if (detected === 'mixed') {
    fail(
      ExitCode.PRECONDITION,
      'sdk와 liquid가 한 레포에 섞여 있습니다 — 포털이 빌드하지 못합니다. 하나만 남기세요.',
    )
  }
  if (detected === 'unknown') {
    if (!wanted) {
      fail(
        ExitCode.PRECONDITION,
        '프로젝트 종류를 판정하지 못했습니다 — `--kind sdk` 또는 `--kind liquid`로 지정하세요.',
      )
    }
    return wanted
  }
  if (wanted && wanted !== detected) {
    fail(
      ExitCode.PRECONDITION,
      `--kind ${wanted}로 지정했지만 이 레포는 ${detected}로 판정됩니다 — 옵션을 빼거나 --kind ${detected}로 지정하세요.`,
    )
  }
  return detected
}

/**
 * 설치된 스킬의 **본문** 스냅샷. 파일이 없으면 키를 넣지 않는다(있음/없음을 키로 구분).
 * 스탬프가 아니라 본문을 넘겨야 `planInstall`이 손수정 드리프트를 stale로 잡는다.
 */
function snapshotSkills(root: string, skillsDir: string): Record<string, string> {
  const entries = BSTAGE_SKILLS.map((skill) => {
    const content = readIfExists(join(root, skillFilePath(skillsDir, skill.name)))
    return content === null ? null : ([skill.name, content] as const)
  }).filter((e): e is readonly [string, string] => e !== null)
  return Object.fromEntries(entries)
}

/**
 * install·update·doctor가 공유하는 맥락. 상태를 읽어 `planInstall`까지 돌려 놓는다 —
 * 세 명령이 같은 계획을 보고 소비만 달리하므로 진단과 실제 동작이 어긋나지 않는다.
 */
export function resolveAiContext(o: AiOptions, out: (s: string) => void = console.log): AiContext {
  const root = o.cwd ?? process.cwd()
  const skillsDir = resolveSkillsDir(o.dir)
  const kind = resolveKind(root, o.kind)
  const target = resolveProjectTarget(root)

  const rawName = readPkgName(root)
  const pkgName = sanitizeIdentity(rawName)
  if (rawName !== null && pkgName === null) {
    out(pc.yellow('  ! package.json name을 쓸 수 없어 디렉터리 이름을 사용합니다.'))
  }
  const projectName = pkgName ?? fallbackIdentity(root)

  const agentsMd = readIfExists(join(root, 'AGENTS.md'))
  const installedSpace =
    agentsMd === null ? null : sanitizeIdentity(parseAgentsIdentity(agentsMd).space)
  const space = installedSpace ?? projectName.split('-custom-templates-')[0]

  const input: InstallInput = {
    kind,
    target,
    space,
    projectName,
    skillsDir,
    existing: {
      skills: snapshotSkills(root, skillsDir),
      agentsMd,
      claudeMd: readIfExists(join(root, 'CLAUDE.md')),
    },
  }

  return { root, kind, target, skillsDir, input, actions: planInstall(input) }
}
